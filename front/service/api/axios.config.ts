import { store } from "@/store";
import axios from "axios";
import { authService } from "./auth.service";
import { setTokens, clearAuth } from "@/store/slices/authSlices";
import { TENANT_HEADER, TENANT_REQUIRED, getCurrentTenantId, requestTenantSelection } from "@/utils/tenant";
import { getClientLocale } from "@/i18n/client";
import { clearProfileSnapshots } from "@/utils/offlineProfile";
import { clearOrdersCache } from "@/utils/offlineOrders";
import {
    ADMIN_COPY_EVENT,
    AdminOfflineError,
    clearAdminReadCache,
    enqueueAdminChange,
    getAdminRead,
    mutationTargetOf,
    overlayAdminList,
    readEntityOf,
    saveAdminRead,
} from "@/utils/adminOfflineStore";
import { AxiosError, AxiosResponse, InternalAxiosRequestConfig } from "axios";

const isPlatformRequest = (url?: string) => Boolean(url?.startsWith("/platform/"));

export const isTenantRequiredError = (error: unknown): boolean =>
    error instanceof AxiosError &&
    error.response?.status === 401 &&
    (error.response.data as { code?: string } | undefined)?.code === TENANT_REQUIRED;

// Mismo shape que el 401 real del backend, para que los catch de la app (y error.utils) lo traten igual
const tenantRequiredError = (config: InternalAxiosRequestConfig) =>
    new AxiosError("Selecciona una tienda para continuar.", "ERR_TENANT_REQUIRED", config, undefined, {
        status: 401,
        statusText: "Unauthorized",
        headers: {},
        config,
        data: { statusCode: 401, code: TENANT_REQUIRED, message: "Selecciona una tienda para continuar." },
    } as AxiosResponse);

// Hosts del SaaS (no son dominios de una tienda). Tiene que coincidir con PLATFORM_HOSTS de proxy.ts.
const PLATFORM_HOSTS = (process.env.NEXT_PUBLIC_PLATFORM_HOSTS ?? "localhost,127.0.0.1")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);

export const getApiBaseUrl = (): string => {
    const configuredApiUrl = process.env.NEXT_PUBLIC_API_URL?.trim();

    if (typeof window !== "undefined") {
        const hostname = window.location.hostname.toLowerCase();
        const isLocal = hostname.includes("localhost") || hostname.includes("127.0.0.1") || hostname.includes("10.0.") || hostname.includes("192.168.");
        if (!isLocal) {
            // Dominio propio de una tienda: la API va por el mismo origen y front/proxy.ts la reenvía
            // con el x-tenant-id que resolvió del Host (sin CORS, y el cliente no elige la tienda).
            if (!PLATFORM_HOSTS.includes(hostname)) return `${window.location.origin}/api/v1`;

            // Host central del SaaS: usa la API pública configurada durante el build. El fallback al
            // mismo origen mantiene el despliegue funcional si en el futuro se sirve mediante un proxy.
            return configuredApiUrl || `${window.location.origin}/api/v1`;
        }
    }

    return configuredApiUrl || "http://localhost:3001/api/v1";
};

export const apiClient = axios.create({
    baseURL: getApiBaseUrl(),
    headers: {
        "Content-type": "application/json",
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache",
    },
    timeout: 15000,
    // El default de Axios serializa arrays como "sizes[]=S&sizes[]=L". El ValidationPipe global del
    // backend (whitelist: true) no conoce "sizes[]" como propiedad del DTO y rechaza todo con 400.
    // Con { indexes: null } serializa "sizes=S&sizes=L" (clave repetida), que es lo que espera Nest.
    paramsSerializer: { indexes: null },
});

// Una sola renovación a la vez: si varios requests reciben 401 juntos (p. ej. al volver de
// segundo plano), todos esperan el MISMO refresh. Antes cada uno pedía el suyo; como el backend
// rota el refresh token, el segundo llegaba con uno ya invalidado y forzaba un logout falso.
let refreshInFlight: Promise<string | null> | null = null;

function refreshOnce(): Promise<string | null> {
    refreshInFlight ??= (async () => {
        const refreshToken = store.getState().auth.refreshToken;
        if (!refreshToken) return null;
        const tokens = await authService.refreshToken(refreshToken);
        if (!tokens) return null;
        store.dispatch(setTokens(tokens));
        return tokens.accessToken;
    })().finally(() => {
        refreshInFlight = null;
    });
    return refreshInFlight;
}

// Purga la sesión de ESTA tienda (redux-persist la guarda en persist:root:<tenantId>) y las
// respuestas de API cacheadas por el service worker para este usuario.
function forceLogout(): void {
    store.dispatch(clearAuth());
    if (typeof window === "undefined") return;
    navigator.serviceWorker?.controller?.postMessage({ type: "CLEAR_USER_CACHE" });
    // Copia local del perfil fuera; el cambio pendiente queda para cuando vuelva a entrar la misma cuenta.
    // Se navega después de borrarla: salir de la página podría cortar la transacción de IndexedDB.
    // Los push de esta cuenta en esta tienda dejan de llegar a este navegador (la sesión ya no sirve para
    // avisar al backend: borra la fila en el próximo envío, 410). Import dinámico: push.service usa este archivo.
    const detachPush = import("@/hooks/usePushNotifications")
        .then((m) => m.detachPushForCurrentStore({ notifyBackend: false }))
        .catch(() => undefined);
    void Promise.all([clearProfileSnapshots(), clearOrdersCache(), clearAdminReadCache(), detachPush]).finally(() => {
        // Si ya estamos en el login, redirigir de nuevo solo recargaría la página y repetiría el 401
        if (!window.location.pathname.startsWith("/auth/login")) {
            window.location.href = "/auth/login";
        }
    });
}

apiClient.interceptors.request.use(
    (config) => {
        config.baseURL = getApiBaseUrl();
        const state = store.getState();
        const token = state.auth.accessToken;

        if (token) {
            config.headers.Authorization = `Bearer ${token}`;
        }

        // Cada endpoint de /api/v1 opera sobre el schema de una tienda: sin este header el backend
        // responde 401. Se respeta uno puesto a mano en la petición (p. ej. el panel de plataforma).
        const tenantId = getCurrentTenantId();
        if (tenantId && !config.headers.has(TENANT_HEADER)) {
            config.headers.set(TENANT_HEADER, tenantId);
        }

        // El idioma elegido en el LanguageSwitcher (cookie NEXT_LOCALE), no el del navegador: la API
        // traduce con él los errores y el nombre/descripción de los productos (nestjs-i18n)
        config.headers.set("Accept-Language", getClientLocale());

        // Sin tienda elegida no tiene sentido salir a la red: el backend respondería 401 y, antes de
        // este cambio, eso caía en el refresh → logout → redirect a /auth/login → otro 401… (bucle).
        // /platform/* es la excepción: el selector de tienda lo usa justamente para resolver el slug.
        if (!tenantId && !isPlatformRequest(config.url)) {
            requestTenantSelection();
            return Promise.reject(tenantRequiredError(config));
        }
        return config;
    },
    (error) => {
        return Promise.reject(error);
    }
);

apiClient.interceptors.response.use(
    (response) => response,
    async (error) => {
        // 401 por falta de tienda ≠ sesión vencida: no se refresca, no se borra la sesión ni se
        // redirige; se muestra el selector. Va primero para que no llegue a la lógica de refresh.
        if (isTenantRequiredError(error)) {
            requestTenantSelection();
            return Promise.reject(error);
        }

        const originalRequest = error.config;
        // Los endpoints /auth/* y /platform/auth/* (login, registro...) manejan sus 401 por su cuenta
        const isAuthRequest =
            originalRequest?.url?.startsWith("/auth/") ||
            originalRequest?.url?.startsWith("/platform/auth/");
        if (error.response?.status === 401 && !originalRequest._retry && !isAuthRequest) {
            originalRequest._retry = true;

            const newAccessToken = await refreshOnce();
            if (newAccessToken) {
                originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
                return apiClient(originalRequest);
            }

            // El refresh falló: sesión vencida o token de OTRA tienda (JwtStrategy / RefreshTokenStrategy
            // exigen que el tenantId del token coincida con x-tenant-id). Logout forzado y limpio.
            forceLogout();
        }
        return Promise.reject(error);
    }
);

// ─── Panel de administración sin conexión ────────────────────────────────────────────────────────
// Va después de los interceptores de arriba (la renovación de sesión sigue igual). Ver utils/adminOfflineStore.ts.
//   - GET de listas del panel: se guarda la respuesta; sin red, se responde con esa copia. En ambos casos se
//     superpone lo pendiente, para que la pantalla muestre lo que el usuario editó.
//   - Cambios del panel que se pueden hacer sin conexión: sin red, se encolan y se responde como guardado
//     (202 + x-sf-offline-queued). Lo demás del panel responde "requiere conexión".
const REQUIRES_CONNECTION: Record<string, { action: string; notCached: string }> = {
    es: { action: "Esta acción requiere conexión a Internet.", notCached: "No hay una copia de este dato en el dispositivo: ábrelo con conexión antes de editarlo sin ella." },
    en: { action: "This action requires an Internet connection.", notCached: "There is no copy of this item on the device: open it with a connection before editing it offline." },
    fr: { action: "Cette action nécessite une connexion Internet.", notCached: "Aucune copie de cet élément sur l'appareil : ouvrez-le avec une connexion avant de le modifier hors ligne." },
    zh: { action: "此操作需要网络连接。", notCached: "此设备上没有该数据的副本：请先联网打开一次，再离线编辑。" },
};

const offlineFailure = (config: InternalAxiosRequestConfig, kind: "action" | "notCached") => {
    const lang = (getClientLocale() ?? "es").split("-")[0];
    const message = (REQUIRES_CONNECTION[lang] ?? REQUIRES_CONNECTION.es)[kind];
    return new AxiosError(message, "ERR_OFFLINE_REQUIRES_CONNECTION", config, undefined, {
        status: 503,
        statusText: "Offline",
        headers: {},
        config,
        data: { statusCode: 503, code: "OFFLINE_REQUIRES_CONNECTION", message },
    } as AxiosResponse);
};

const isOffline = () => typeof navigator !== "undefined" && navigator.onLine === false;
const bodyOf = (data: unknown): Record<string, unknown> => {
    if (typeof data === "string") {
        try {
            return JSON.parse(data);
        } catch {
            return {};
        }
    }
    return (data as Record<string, unknown>) ?? {};
};

async function queueOffline(config: InternalAxiosRequestConfig): Promise<AxiosResponse> {
    const target = mutationTargetOf(config.method ?? "get", config.url);
    if (!target || "blocked" in target) throw offlineFailure(config, "action");
    try {
        const { item } = await enqueueAdminChange(target.entity, target.op, target.entityId, bodyOf(config.data));
        return {
            // Mismas formas que las respuestas reales: los pedidos del panel vienen envueltos en { data }
            data: target.entity === "order" ? { data: item } : item,
            status: 202,
            statusText: "Queued offline",
            headers: { "x-sf-offline-queued": "1" },
            config,
        } as AxiosResponse;
    } catch (error) {
        throw offlineFailure(config, error instanceof AdminOfflineError && error.reason === "not-cached" ? "notCached" : "action");
    }
}

apiClient.interceptors.request.use((config) => {
    const method = (config.method ?? "get").toLowerCase();
    if (method !== "get" && isOffline() && mutationTargetOf(method, config.url)) {
        // Sin red no se sale: se encola (o se rechaza con "requiere conexión") sin tocar la red
        config.adapter = () => queueOffline(config);
    }
    return config;
});

apiClient.interceptors.response.use(
    async (response) => {
        const { config } = response;
        if ((config.method ?? "get").toLowerCase() === "get" && readEntityOf(config.url).cacheable && response.status === 200) {
            void saveAdminRead(config.url, config.params, response.data);
            response.data = await overlayAdminList(config.url, config.params, response.data);
        }
        return response;
    },
    async (error) => {
        const config = error?.config as InternalAxiosRequestConfig | undefined;
        if (!config || !axios.isAxiosError(error) || error.response) return Promise.reject(error);
        const method = (config.method ?? "get").toLowerCase();
        if (method === "get" && readEntityOf(config.url).cacheable) {
            const cached = await getAdminRead(config.url, config.params);
            if (!cached) return Promise.reject(error);
            if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(ADMIN_COPY_EVENT, { detail: cached.savedAt }));
            return {
                data: await overlayAdminList(config.url, config.params, cached.data),
                status: 200,
                statusText: "Offline copy",
                headers: { "x-sf-offline-copy": cached.savedAt },
                config,
            } as AxiosResponse;
        }
        // Se cortó la red a mitad de un cambio encolable: se encola. Si el servidor sí lo había aplicado, al
        // sincronizar el valor ya coincide con el nuevo y se acepta sin conflicto.
        const target = method !== "get" ? mutationTargetOf(method, config.url) : null;
        if (target && !("blocked" in target)) return queueOffline(config);
        return Promise.reject(error);
    },
);


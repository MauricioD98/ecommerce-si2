import { store } from "@/store";
import axios from "axios";
import { authService } from "./auth.service";
import { setTokens, clearAuth } from "@/store/slices/authSlices";
import { TENANT_HEADER, TENANT_REQUIRED, getCurrentTenantId, requestTenantSelection } from "@/utils/tenant";
import { getClientLocale } from "@/i18n/client";
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
const PLATFORM_HOSTS = (process.env.NEXT_PUBLIC_PLATFORM_HOSTS ?? "stella-front.wonderfulriver-db5286cd.eastus.azurecontainerapps.io")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);

export const getApiBaseUrl = (): string => {
    if (typeof window !== "undefined") {
        const hostname = window.location.hostname;
        const isLocal = hostname.includes("localhost") || hostname.includes("127.0.0.1") || hostname.includes("10.0.") || hostname.includes("192.168.");
        if (!isLocal) {
            // Dominio propio de una tienda: la API va por el mismo origen y front/proxy.ts la reenvía
            // con el x-tenant-id que resolvió del Host (sin CORS, y el cliente no elige la tienda).
            if (!PLATFORM_HOSTS.includes(hostname)) return `${window.location.origin}/api/v1`;
            return "https://stella-api.wonderfulriver-db5286cd.eastus.azurecontainerapps.io/api/v1";
        }
    }
    return process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1";
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
    // Si ya estamos en el login, redirigir de nuevo solo recargaría la página y repetiría el 401
    if (!window.location.pathname.startsWith("/auth/login")) {
        window.location.href = "/auth/login";
    }
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
        // Los endpoints /auth/* (login, registro...) manejan sus 401 por su cuenta: no se refresca ni se redirige
        const isAuthRequest = originalRequest?.url?.startsWith("/auth/");
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

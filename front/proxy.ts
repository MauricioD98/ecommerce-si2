import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isPlatformPath } from "./utils/platformPaths";
import {
    DEFAULT_LOCALE,
    LOCALE_COOKIE,
    LOCALE_COOKIE_MAX_AGE,
    LOCALE_HEADER,
    isLocale,
    negotiateLocale,
    type Locale,
} from "./i18n/config";

// Enrutamiento por dominio (Next 16: "proxy" es el nuevo nombre de "middleware", corre en Node).
//
// En un dominio propio (boutiquemia.com) el cliente final no ve el SaaS:
//   1. Host → tienda, consultando a la API (GET /platform/tenants/by-domain, con INTERNAL_API_KEY).
//   2. Páginas y Route Handlers: reciben x-tenant-id en los headers del request (SSR, /api/decart/*).
//   3. /api/v1/*: se reescribe a la API real con x-tenant-id PUESTO POR EL PROXY. El valor que mande
//      el navegador se pisa: en un dominio propio la tienda la decide el Host, no el cliente.
//   4. Cookie sf_tenant (legible por JS): utils/tenant.ts la usa para el header del cliente, las
//      claves de IndexedDB/redux-persist y la clave de caché del service worker.
//
// En los hosts de la plataforma (PLATFORM_HOSTS: el dominio del SaaS, localhost) no se resuelve
// tienda: sigue el flujo de ?tenant= / tienda guardada / selector de tienda.
//
// Idioma (next-intl, en todos los hosts): cookie NEXT_LOCALE si el usuario ya eligió uno; si no, se
// negocia Accept-Language y se guarda en la cookie. Va sin prefijo en la URL (/en/...) para no
// romper las rutas de las tiendas ni las claves de caché del service worker. Ver i18n/config.ts.

const TENANT_HEADER = "x-tenant-id";
const TENANT_COOKIE = "sf_tenant";
const INTERNAL_KEY_HEADER = "x-internal-key";

// URL de la API vista DESDE EL SERVIDOR del front (en Docker/Azure puede ser la red interna)
const API_URL = (process.env.API_INTERNAL_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1").replace(/\/+$/, "");
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY ?? "";

const PLATFORM_HOSTS = new Set(
    (process.env.PLATFORM_HOSTS ?? "localhost,127.0.0.1")
        .split(",")
        .map((h) => h.trim().toLowerCase())
        .filter(Boolean)
);

const POSITIVE_TTL_MS = 5 * 60_000;
const NEGATIVE_TTL_MS = 30_000;
// El Host lo controla quien hace el request: sin tope, hosts aleatorios llenarían la memoria
const CACHE_MAX_ENTRIES = 2_000;

// Caché en memoria del proceso: best-effort. La doc de Next advierte que el proxy puede correr
// aislado y no conviene depender de globals; si se pierde, solo cuesta una consulta más a la API.
const cache = new Map<string, { tenantId: string | null; expires: number }>();

const normalizeHost = (raw: string | null): string | null => {
    const host = raw?.split(",")[0].trim().toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
    return host || null;
};

const isPlatformHost = (host: string) =>
    PLATFORM_HOSTS.has(host) || /^(10|127|192\.168|172\.(1[6-9]|2\d|3[01]))\./.test(host);

function remember(domain: string, tenantId: string | null): void {
    if (cache.size >= CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
    cache.set(domain, { tenantId, expires: Date.now() + (tenantId ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS) });
}

/** tenantId, null = dominio no registrado, undefined = no se pudo consultar (API caída) */
async function resolveTenant(host: string): Promise<string | null | undefined> {
    const domain = host.replace(/^www\./, "");
    const hit = cache.get(domain);
    if (hit && hit.expires > Date.now()) return hit.tenantId;

    try {
        const response = await fetch(`${API_URL}/platform/tenants/by-domain?host=${encodeURIComponent(domain)}`, {
            headers: { [INTERNAL_KEY_HEADER]: INTERNAL_API_KEY },
            cache: "no-store",
            signal: AbortSignal.timeout(3000),
        });
        if (response.status === 404) {
            remember(domain, null);
            return null;
        }
        if (!response.ok) return undefined; // 401 (llave mal configurada), 5xx: no se cachea
        const body = (await response.json()) as { data?: { id?: string } };
        const tenantId = body.data?.id ?? null;
        remember(domain, tenantId);
        return tenantId;
    } catch {
        return undefined;
    }
}

/** Idioma del request y si ya venía en la cookie (si no, hay que fijarla en la respuesta). */
function resolveLocale(request: NextRequest): { locale: Locale; persisted: boolean } {
    const fromCookie = request.cookies.get(LOCALE_COOKIE)?.value;
    if (isLocale(fromCookie)) return { locale: fromCookie, persisted: true };
    return { locale: negotiateLocale(request.headers.get("accept-language")) ?? DEFAULT_LOCALE, persisted: false };
}

/**
 * NextResponse.next() con el idioma: va en el header x-locale para que i18n/request.ts renderice ya
 * en ese idioma en la primera visita (la cookie recién la manda el navegador en el request siguiente).
 */
function nextWithLocale(headers: Headers, { locale, persisted }: ReturnType<typeof resolveLocale>) {
    headers.set(LOCALE_HEADER, locale);
    const response = NextResponse.next({ request: { headers } });
    if (!persisted) {
        response.cookies.set(LOCALE_COOKIE, locale, {
            path: "/",
            sameSite: "lax",
            httpOnly: false, // el LanguageSwitcher la reescribe desde el navegador
            maxAge: LOCALE_COOKIE_MAX_AGE,
        });
    }
    return response;
}

export async function proxy(request: NextRequest) {
    const { pathname, search } = request.nextUrl;
    const isApi = pathname === "/api/v1" || pathname.startsWith("/api/v1/");
    const locale = resolveLocale(request);

    // Solo Host: x-forwarded-host lo puede inventar el cliente si el front quedara expuesto sin un
    // proxy confiable delante. Azure Container Apps conserva el Host original del dominio propio.
    const host = normalizeHost(request.headers.get("host"));
    if (!host || isPlatformHost(host)) {
        return isApi ? NextResponse.next() : nextWithLocale(new Headers(request.headers), locale);
    }

    // La landing de ventas y el contacto del SaaS no existen en el dominio de una tienda
    if (isPlatformPath(pathname)) {
        return new NextResponse("Página no encontrada", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
    }
    const tenantId = await resolveTenant(host);

    if (tenantId === undefined) {
        // La API no respondió. Para la API no hay nada que hacer; las páginas siguen y el cliente
        // usa la cookie sf_tenant de una visita anterior, si existe.
        if (isApi) {
            return NextResponse.json({ statusCode: 503, message: "Servicio no disponible, intenta de nuevo." }, { status: 503 });
        }
        return nextWithLocale(new Headers(request.headers), locale);
    }

    if (tenantId === null) {
        // Dominio apuntado al front pero no asignado (o no verificado) a ninguna tienda
        return isApi
            ? NextResponse.json({ statusCode: 401, code: "TENANT_REQUIRED", message: "Tienda no disponible" }, { status: 401 })
            : new NextResponse("Tienda no encontrada", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
    }

    const headers = new Headers(request.headers);
    headers.set(TENANT_HEADER, tenantId);
    headers.delete(INTERNAL_KEY_HEADER); // nunca reenviar algo con forma de llave interna venida del cliente

    if (isApi) {
        // Mismo origen para el navegador (sin CORS); la API real recibe el header resuelto acá.
        // Accept-Language pasa tal cual: con él la API traduce errores y el catálogo (nestjs-i18n).
        const target = new URL(`${API_URL}${pathname.slice("/api/v1".length)}${search}`);
        return NextResponse.rewrite(target, { request: { headers } });
    }

    const response = nextWithLocale(headers, locale);
    if (request.cookies.get(TENANT_COOKIE)?.value !== tenantId) {
        response.cookies.set(TENANT_COOKIE, tenantId, {
            path: "/",
            sameSite: "lax",
            secure: true,
            httpOnly: false, // utils/tenant.ts la lee; no es un secreto (el UUID viaja en cada request)
            maxAge: 60 * 60,
        });
    }
    return response;
}

export const config = {
    matcher: [
        // Todo menos estáticos: chunks, imágenes optimizadas, service worker, manifest e íconos
        "/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest|manifest.json|.*\\.(?:png|jpg|jpeg|gif|svg|webp|avif|ico|woff2?|ttf)$).*)",
    ],
};

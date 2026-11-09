import { useEffect } from "react";
import { getCurrentTenantId } from "@/utils/tenant";
import { PUSH_SCOPE_PREFIX } from "@/hooks/usePushNotifications";

export const SW_UPDATE_EVENT = "sf-sw-update-available";

let userRequestedUpdate = false;

// A pedido del usuario: el worker nuevo toma el control y recién entonces se recarga una vez. Nunca
// automáticamente, para no interrumpir un pago. El intento de compra ya está persistido antes de enviarse.
export async function applyServiceWorkerUpdate(): Promise<void> {
    const registration = await navigator.serviceWorker.getRegistration("/sw.js");
    if (!registration?.waiting) return;
    userRequestedUpdate = true;
    registration.waiting.postMessage({ type: "SKIP_WAITING" });
}

// Registro global del service worker (caché offline del catálogo/assets + PWA instalable).
// Antes solo se registraba dentro de usePushNotifications().subscribe(), es decir, solo para quien
// activaba las notificaciones a mano — la mayoría de las visitas nunca lo registraban y por lo tanto
// nunca tenían caché offline ni la app instalable. El registro es idempotente (no rompe nada si
// usePushNotifications también lo registra después, al activar push).
export function useRegisterServiceWorker(): void {
    useEffect(() => {
        if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
        // En dev, Turbopack recompila el grafo de módulos en cada reinicio del servidor; el
        // CacheFirst de sw.js para _next/static/ seguiría sirviendo chunks viejos para siempre y
        // rompería con "module factory is not available" en cada reinicio. Solo tiene sentido en
        // producción, donde los chunks son realmente inmutables entre builds.
        // No registrarlo no alcanza: un SW que quedó de antes en el mismo origen (un build de producción
        // en localhost:3000, o haber activado push) sigue controlando la página y sirve payloads RSC
        // viejos → "chunk.reason.enqueueModel is not a function". En dev se elimina junto con sus cachés.
        // Las registraciones de push (public/push-sw.js, una por tienda) se respetan: no controlan
        // páginas ni cachean nada, y eliminarlas se llevaba la suscripción push del navegador mientras
        // el backend la seguía dando por activa (se "activaban" en dev pero nunca llegaban).
        if (process.env.NODE_ENV !== "production") {
            navigator.serviceWorker
                .getRegistrations()
                .then(async (all) => {
                    const registrations = all.filter((registration) => !new URL(registration.scope).pathname.startsWith(PUSH_SCOPE_PREFIX));
                    if (registrations.length === 0) return;
                    await Promise.all(registrations.map((registration) => registration.unregister()));
                    const keys = await caches.keys();
                    await Promise.all(keys.filter((key) => key.startsWith("sf-")).map((key) => caches.delete(key)));
                    // La página actual todavía la controla el SW viejo: recargar una vez ya sin él
                    window.location.reload();
                })
                .catch(() => undefined);
            return;
        }

        const announce = () => window.dispatchEvent(new CustomEvent(SW_UPDATE_EVENT));
        const onControllerChange = () => {
            if (userRequestedUpdate) window.location.reload();
        };
        navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

        navigator.serviceWorker
            .register("/sw.js", { updateViaCache: "none" })
            .then((registration) => {
                navigator.serviceWorker.ready
                    .then((ready) => {
                        const locale = document.cookie.split("; ").find((part) => part.startsWith("NEXT_LOCALE="))?.split("=")[1] ?? "";
                        ready.active?.postMessage({ type: "PRECACHE", tenant: getCurrentTenantId(), locale });
                    })
                    .catch(() => undefined);
                if (registration.waiting && navigator.serviceWorker.controller) announce();
                registration.addEventListener("updatefound", () => {
                    const installing = registration.installing;
                    installing?.addEventListener("statechange", () => {
                        if (installing.state === "installed" && navigator.serviceWorker.controller) announce();
                    });
                });
            })
            .catch(() => {
                // Best-effort: si falla (ej. navegador sin soporte real), la app sigue funcionando online
            });

        return () => navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    }, []);
}

import { useEffect } from "react";

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
        if (process.env.NODE_ENV !== "production") {
            navigator.serviceWorker
                .getRegistrations()
                .then(async (registrations) => {
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

        navigator.serviceWorker.register("/sw.js").catch(() => {
            // Best-effort: si falla (ej. navegador sin soporte real), la app sigue funcionando online
        });
    }, []);
}

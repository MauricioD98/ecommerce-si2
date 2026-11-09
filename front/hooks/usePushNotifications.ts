import { useCallback, useEffect, useState } from 'react';
import { pushService, PushTestResult, PushUnavailableReason } from '@/service/api/push.service';
import { getApiErrorMessage } from '@/service/api/error.utils';
import { getCurrentTenantId } from '@/utils/tenant';

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    const output = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; i += 1) {
        output[i] = rawData.charCodeAt(i);
    }
    return output;
}

// Una suscripción queda atada a la llave pública VAPID con la que se creó. Si la tienda regeneró su
// par, la suscripción vieja ya no sirve (el push service rechaza la firma) y hay que rehacerla.
function isSubscriptionForKey(subscription: PushSubscription, publicKey: string): boolean {
    const current = subscription.options.applicationServerKey;
    if (!current) return false;
    const expected = urlBase64ToUint8Array(publicKey);
    const actual = new Uint8Array(current);
    return actual.length === expected.length && actual.every((byte, i) => byte === expected[i]);
}

// Cada tienda tiene su propia registración de public/push-sw.js con un scope propio. El navegador
// guarda UNA suscripción por registración: con una sola en "/" (como antes), dos tiendas del mismo
// origen se pisaban — activar push en una borraba la de la otra, y cerrar sesión en una afectaba a
// ambas. El scope no contiene páginas: el worker nunca controla la app ni cachea nada.
export const PUSH_SCOPE_PREFIX = '/push-scope/';
const PUSH_SCRIPT = '/push-sw.js';

function pushScopeUrl(tenantId: string): string {
    return new URL(`${PUSH_SCOPE_PREFIX}${tenantId}/`, window.location.origin).href;
}

// getRegistration(url) devuelve la registración que CONTROLARÍA esa URL, que puede ser la de "/":
// acá se necesita exactamente la de la tienda.
async function findRegistration(scopeUrl: string): Promise<ServiceWorkerRegistration | undefined> {
    const registrations = await navigator.serviceWorker.getRegistrations();
    return registrations.find((registration) => registration.scope === scopeUrl);
}

// Registración en "/" de sw.js: antes de este cambio las suscripciones vivían ahí
async function findLegacyRegistration(): Promise<ServiceWorkerRegistration | undefined> {
    return findRegistration(new URL('/', window.location.origin).href);
}

async function waitUntilActive(registration: ServiceWorkerRegistration): Promise<void> {
    if (registration.active) return;
    const worker = registration.installing ?? registration.waiting;
    if (!worker) throw new Error('SW_FAILED');
    await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error('SW_FAILED')), 15_000);
        worker.addEventListener('statechange', () => {
            if (worker.state === 'activated') {
                window.clearTimeout(timer);
                resolve();
            } else if (worker.state === 'redundant') {
                window.clearTimeout(timer);
                reject(new Error('SW_FAILED'));
            }
        });
    });
}

async function currentStoreSubscription(tenantId: string): Promise<PushSubscription | null> {
    const registration = await findRegistration(pushScopeUrl(tenantId));
    return (await registration?.pushManager.getSubscription()) ?? null;
}

/**
 * Al cerrar sesión: este navegador deja de recibir los push de ESTA cuenta en ESTA tienda. Toca solo
 * la registración de la tienda actual; la suscripción de otra tienda en el mismo navegador sigue
 * intacta. `notifyBackend` = false cuando la sesión ya no es válida (logout forzado por 401): igual
 * se anula la suscripción en el navegador, y el backend borra la fila en el próximo envío (410).
 */
export async function detachPushForCurrentStore({ notifyBackend }: { notifyBackend: boolean }): Promise<void> {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
    const tenantId = getCurrentTenantId();
    if (!tenantId) return;
    try {
        const subscription = await currentStoreSubscription(tenantId);
        if (!subscription) return;
        if (notifyBackend) await pushService.unsubscribe(subscription.endpoint).catch(() => undefined);
        await subscription.unsubscribe();
    } catch {
        // Best-effort: nunca bloquea el cierre de sesión
    }
}

// Por qué este navegador no puede activar push (restricciones del entorno, no errores)
export type PushEnvironmentIssue = 'INSECURE_CONTEXT' | 'IOS_NEEDS_INSTALL' | 'UNSUPPORTED_BROWSER';
export type PushErrorCode = 'PERMISSION_DISMISSED' | 'SW_FAILED' | 'SUBSCRIBE_FAILED' | 'SERVER';
export type PushTestOutcome = { status: 'accepted' } | { status: 'failed'; reason: NonNullable<PushTestResult['reason']> | 'SERVER' };

function detectEnvironmentIssue(): PushEnvironmentIssue | null {
    // Service workers y push solo existen en HTTPS o en localhost (p. ej. http://192.168.x.x:3000 no sirve)
    if (!window.isSecureContext) return 'INSECURE_CONTEXT';
    const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const standalone = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
    // En iPhone/iPad, Safari solo ofrece push a la app agregada a la pantalla de inicio (iOS 16.4+)
    if (isIos && !standalone && !('PushManager' in window)) return 'IOS_NEEDS_INSTALL';
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'UNSUPPORTED_BROWSER';
    return null;
}

// Suscripción del navegador a las notificaciones push de la tienda actual: pide permiso, registra el
// worker de push de la tienda y guarda la suscripción en el backend a nombre del usuario.
export function usePushNotifications() {
    const [ready, setReady] = useState(false);
    const [environmentIssue, setEnvironmentIssue] = useState<PushEnvironmentIssue | null>(null);
    const [unavailableReason, setUnavailableReason] = useState<PushUnavailableReason | null>(null);
    const [permission, setPermission] = useState<NotificationPermission>('default');
    const [isSubscribed, setIsSubscribed] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<{ code: PushErrorCode; message?: string } | null>(null);
    const [testOutcome, setTestOutcome] = useState<PushTestOutcome | null>(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            const issue = detectEnvironmentIssue();
            if (issue) {
                if (!cancelled) {
                    setEnvironmentIssue(issue);
                    setReady(true);
                }
                return;
            }
            setPermission(Notification.permission);
            const tenantId = getCurrentTenantId();
            try {
                const { publicKey, reason } = await pushService.getVapidPublicKey();
                if (cancelled) return;
                if (!publicKey || !tenantId) {
                    setUnavailableReason(reason ?? 'NOT_CONFIGURED');
                    return;
                }
                let subscription = await currentStoreSubscription(tenantId);
                if (subscription && !isSubscriptionForKey(subscription, publicKey)) subscription = null;
                if (!subscription && Notification.permission === 'granted') {
                    subscription = await migrateLegacySubscription(tenantId, publicKey);
                }
                // Que el navegador tenga suscripción no basta: tiene que estar a nombre de ESTE usuario en
                // esta tienda (pudo quedar de otra cuenta, o el backend la limpió por un 410)
                const subscribed = subscription ? await pushService.isSubscribed(subscription.endpoint) : false;
                if (!cancelled) setIsSubscribed(subscribed);
            } catch {
                // Sin red o API caída: se ofrece activar y el error real aparece al intentarlo
            } finally {
                if (!cancelled) setReady(true);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    const subscribe = useCallback(async () => {
        if (environmentIssue || unavailableReason) return;
        const tenantId = getCurrentTenantId();
        if (!tenantId) return;
        setIsLoading(true);
        setError(null);
        setTestOutcome(null);
        try {
            const { publicKey, reason } = await pushService.getVapidPublicKey();
            if (!publicKey) {
                setUnavailableReason(reason ?? 'NOT_CONFIGURED');
                return;
            }

            const permissionResult = await Notification.requestPermission();
            setPermission(permissionResult);
            if (permissionResult === 'denied') return; // la tarjeta explica cómo desbloquearlas
            if (permissionResult !== 'granted') {
                setError({ code: 'PERMISSION_DISMISSED' });
                return;
            }

            let registration: ServiceWorkerRegistration;
            try {
                registration = await navigator.serviceWorker.register(PUSH_SCRIPT, {
                    scope: pushScopeUrl(tenantId),
                    updateViaCache: 'none',
                });
                await waitUntilActive(registration);
            } catch {
                setError({ code: 'SW_FAILED' });
                return;
            }

            let subscription: PushSubscription | null;
            try {
                subscription = await registration.pushManager.getSubscription();
                if (subscription && !isSubscriptionForKey(subscription, publicKey)) {
                    await subscription.unsubscribe();
                    subscription = null;
                }
                subscription ??= await registration.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: urlBase64ToUint8Array(publicKey),
                });
            } catch {
                setError({ code: 'SUBSCRIBE_FAILED' });
                return;
            }

            await pushService.subscribe(subscription.toJSON() as PushSubscriptionJSON);
            setIsSubscribed(true);
        } catch (err) {
            setError({ code: 'SERVER', message: getApiErrorMessage(err, '') || undefined });
        } finally {
            setIsLoading(false);
        }
    }, [environmentIssue, unavailableReason]);

    const unsubscribe = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        setTestOutcome(null);
        try {
            await detachPushForCurrentStore({ notifyBackend: true });
            setIsSubscribed(false);
        } finally {
            setIsLoading(false);
        }
    }, []);

    // Prueba de ENTREGA, no de activación: el backend firma y envía al push service solo para este navegador
    const sendTest = useCallback(async (text: { title: string; body: string }) => {
        const tenantId = getCurrentTenantId();
        if (!tenantId) return;
        setIsLoading(true);
        setError(null);
        setTestOutcome(null);
        try {
            const subscription = await currentStoreSubscription(tenantId);
            if (!subscription) {
                setIsSubscribed(false);
                setTestOutcome({ status: 'failed', reason: 'NOT_SUBSCRIBED' });
                return;
            }
            const result = await pushService.sendTest(subscription.endpoint, text);
            if (result.accepted) {
                setTestOutcome({ status: 'accepted' });
            } else {
                if (result.reason === 'NOT_SUBSCRIBED' || result.reason === 'EXPIRED') setIsSubscribed(false);
                setTestOutcome({ status: 'failed', reason: result.reason ?? 'PUSH_SERVICE_ERROR' });
            }
        } catch {
            setTestOutcome({ status: 'failed', reason: 'SERVER' });
        } finally {
            setIsLoading(false);
        }
    }, []);

    return {
        ready,
        environmentIssue,
        unavailableReason,
        permission,
        isSubscribed,
        isLoading,
        error,
        testOutcome,
        subscribe,
        unsubscribe,
        sendTest,
    };
}

/**
 * Las suscripciones creadas antes vivían en la registración "/" de sw.js. Si la de este navegador es de
 * esta tienda (misma llave) y del usuario actual, se pasa sin pedir nada (el permiso ya está dado) a la
 * registración propia de la tienda y se da de baja la vieja. Una suscripción "/" con la llave de OTRA
 * tienda no se toca. En desarrollo la registración "/" ya no existe (se elimina en cada carga).
 */
async function migrateLegacySubscription(tenantId: string, publicKey: string): Promise<PushSubscription | null> {
    try {
        const legacyRegistration = await findLegacyRegistration();
        const legacy = await legacyRegistration?.pushManager.getSubscription();
        if (!legacy || !isSubscriptionForKey(legacy, publicKey)) return null;
        if (!(await pushService.isSubscribed(legacy.endpoint))) return null;

        const registration = await navigator.serviceWorker.register(PUSH_SCRIPT, { scope: pushScopeUrl(tenantId), updateViaCache: 'none' });
        await waitUntilActive(registration);
        const subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(publicKey),
        });
        await pushService.subscribe(subscription.toJSON() as PushSubscriptionJSON);
        await pushService.unsubscribe(legacy.endpoint).catch(() => undefined);
        await legacy.unsubscribe().catch(() => undefined);
        return subscription;
    } catch {
        return null;
    }
}

import { useCallback, useEffect, useState } from 'react';
import { pushService } from '@/service/api/push.service';
import { getApiErrorMessage } from '@/service/api/error.utils';

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

// Suscripción del navegador a notificaciones push: pide permiso, registra el Service Worker
// y envía la suscripción al backend. `isSupported` cubre navegadores/iOS sin Push API
export function usePushNotifications() {
    const [isSupported, setIsSupported] = useState(false);
    const [permission, setPermission] = useState<NotificationPermission>('default');
    const [isSubscribed, setIsSubscribed] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const supported = typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window;
        setIsSupported(supported);
        if (!supported) return;

        setPermission(Notification.permission);

        navigator.serviceWorker.getRegistration('/sw.js').then(async (registration) => {
            const subscription = await registration?.pushManager.getSubscription();
            setIsSubscribed(Boolean(subscription));
        });
    }, []);

    const subscribe = useCallback(async () => {
        if (!isSupported) return;
        setIsLoading(true);
        setError(null);
        try {
            const publicKey = await pushService.getVapidPublicKey();
            if (!publicKey) {
                throw new Error('Las notificaciones push no están disponibles en este momento.');
            }

            const permissionResult = await Notification.requestPermission();
            setPermission(permissionResult);
            if (permissionResult !== 'granted') {
                throw new Error('Necesitamos tu permiso para enviarte notificaciones.');
            }

            const registration = await navigator.serviceWorker.register('/sw.js');
            await navigator.serviceWorker.ready;

            const subscription =
                (await registration.pushManager.getSubscription()) ??
                (await registration.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: urlBase64ToUint8Array(publicKey),
                }));

            await pushService.subscribe(subscription.toJSON() as PushSubscriptionJSON);
            setIsSubscribed(true);
        } catch (err) {
            setError(err instanceof Error ? err.message : getApiErrorMessage(err, 'No se pudo activar las notificaciones.'));
        } finally {
            setIsLoading(false);
        }
    }, [isSupported]);

    return { isSupported, permission, isSubscribed, isLoading, error, subscribe };
}

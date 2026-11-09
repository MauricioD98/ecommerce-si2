import { apiClient } from './axios.config';

// PLAN_NOT_INCLUDED: el plan de la tienda no incluye push. NOT_CONFIGURED: la tienda no tiene llaves.
export type PushUnavailableReason = 'PLAN_NOT_INCLUDED' | 'NOT_CONFIGURED';

export interface PushTestResult {
    accepted: boolean;
    reason: 'NOT_CONFIGURED' | 'NOT_SUBSCRIBED' | 'EXPIRED' | 'PUSH_SERVICE_ERROR' | null;
}

export const pushService = {
    getVapidPublicKey: async (): Promise<{ publicKey: string | null; reason: PushUnavailableReason | null }> => {
        const response = await apiClient.get<{ publicKey: string | null; reason?: PushUnavailableReason | null }>(
            '/notifications/vapid-public-key',
        );
        const { publicKey } = response.data;
        // Una API anterior a `reason` respondía solo { publicKey: null }
        return { publicKey, reason: publicKey ? null : (response.data.reason ?? 'NOT_CONFIGURED') };
    },

    // El backend acepta la forma nativa de PushSubscription.toJSON() (endpoint + keys.p256dh/auth)
    subscribe: async (subscription: PushSubscriptionJSON): Promise<void> => {
        await apiClient.post('/notifications/subscribe', subscription);
    },

    isSubscribed: async (endpoint: string): Promise<boolean> => {
        const response = await apiClient.post<{ subscribed: boolean }>('/notifications/subscription-status', { endpoint });
        return response.data.subscribed;
    },

    unsubscribe: async (endpoint: string): Promise<void> => {
        await apiClient.post('/notifications/unsubscribe', { endpoint });
    },

    sendTest: async (endpoint: string, text: { title: string; body: string }): Promise<PushTestResult> => {
        const response = await apiClient.post<PushTestResult>('/notifications/test', { endpoint, ...text });
        return response.data;
    },
};

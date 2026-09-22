import { apiClient } from './axios.config';

export const pushService = {
    getVapidPublicKey: async (): Promise<string | null> => {
        const response = await apiClient.get<{ publicKey: string | null }>('/notifications/vapid-public-key');
        return response.data.publicKey;
    },

    // El backend acepta la forma nativa de PushSubscription.toJSON() (endpoint + keys.p256dh/auth)
    subscribe: async (subscription: PushSubscriptionJSON): Promise<void> => {
        await apiClient.post('/notifications/subscribe', subscription);
    },
};

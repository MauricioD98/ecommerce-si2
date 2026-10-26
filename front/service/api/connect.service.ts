import { apiClient } from "./axios.config";

// Cobros con tarjeta de la tienda (Stripe Connect). Van con x-tenant-id; status y onboarding además
// con el JWT del Super Admin (el backend lo verifica).

export interface ConnectStatus {
    connected: boolean;
    chargesEnabled: boolean;
    detailsSubmitted: boolean;
    pendingRequirements: number;
}

export const connectService = {
    // Público: el checkout lo usa para ofrecer o no el pago con tarjeta
    isCardEnabled: async (): Promise<boolean> => {
        const { data } = await apiClient.get<{ data: { cardEnabled: boolean } }>("/payments/connect/availability");
        return data.data.cardEnabled;
    },

    getStatus: async (): Promise<ConnectStatus> => {
        const { data } = await apiClient.get<{ data: ConnectStatus }>("/payments/connect/status");
        return data.data;
    },

    // URL del formulario de Stripe para completar los datos de la cuenta de cobros
    startOnboarding: async (): Promise<string> => {
        const { data } = await apiClient.post<{ data: { url: string } }>("/payments/connect/onboarding");
        return data.data.url;
    },
};

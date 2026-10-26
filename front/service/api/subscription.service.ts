import { apiClient } from "./axios.config";
import type { PlanKey } from "@/components/modules/platform/plans";

// Suscripción al SaaS de la tienda actual (/api/v1/subscription). Va con x-tenant-id y JWT: la tienda
// la decide el backend desde el token, y solo el Super Admin puede usarlo. El precio nunca sale de acá.

export interface TenantSubscription {
    plan: string;
    planName: string;
    // Estado de Stripe tal cual lo guardó el webhook (active, past_due, canceled…); null = nunca se suscribió
    status: string | null;
    active: boolean;
    canManage: boolean;
    cancelAtPeriodEnd: boolean;
    currentPeriodEnd: string | null;
}

export const subscriptionService = {
    get: async (): Promise<TenantSubscription> => {
        const { data } = await apiClient.get<{ data: TenantSubscription }>("/subscription");
        return data.data;
    },

    // Devuelve la URL de Stripe Checkout a la que hay que redirigir
    createCheckout: async (plan: PlanKey): Promise<string> => {
        const { data } = await apiClient.post<{ data: { url: string } }>("/subscription/checkout", { plan });
        return data.data.url;
    },

    // Billing Portal de Stripe: cambiar de plan, tarjeta o cancelar
    openPortal: async (): Promise<string> => {
        const { data } = await apiClient.post<{ data: { url: string } }>("/subscription/portal");
        return data.data.url;
    },
};

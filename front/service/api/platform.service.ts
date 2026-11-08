import { apiClient } from "./axios.config";
import type { BillingInterval, PlanKey } from "@/components/modules/platform/plans";

// Endpoints del plano de control (/api/v1/platform/*): no llevan tienda. El interceptor de Axios
// los deja salir aunque no haya x-tenant-id (ver isPlatformRequest en axios.config.ts).

export interface SubscriptionCheckoutPayload {
    plan: PlanKey;
    // Mensual o anual: el backend elige el price_id correspondiente
    interval: BillingInterval;
    tenantName: string;
    domain?: string;
    adminEmail: string;
    adminPassword: string;
}

export type SignupStatus = "PENDING" | "PROVISIONING" | "COMPLETED" | "FAILED" | "EXPIRED";

export interface CheckoutStatus {
    status: SignupStatus;
    tenantName: string;
    loginUrl: string | null;
}

// GET /platform/subscriptions/plans: precio real (Stripe) de cada plan e intervalo
export interface PlanPrice {
    plan: PlanKey;
    interval: BillingInterval;
    available: boolean;
    amount: number | null;
    currency: string | null;
}

export interface ContactPayload {
    name: string;
    email: string;
    message: string;
    website?: string; // honeypot: siempre vacío para una persona
}

export const platformService = {
    // Devuelve la URL de Stripe Checkout a la que hay que redirigir
    createCheckout: async (payload: SubscriptionCheckoutPayload): Promise<{ url: string; sessionId: string }> => {
        const { data } = await apiClient.post<{ data: { url: string; sessionId: string } }>(
            "/platform/subscriptions/checkout",
            payload
        );
        return data.data;
    },

    getPlans: async (): Promise<PlanPrice[]> => {
        const { data } = await apiClient.get<{ data: PlanPrice[] }>("/platform/subscriptions/plans");
        return data.data;
    },

    getCheckoutStatus: async (sessionId: string): Promise<CheckoutStatus> => {
        const { data } = await apiClient.get<{ data: CheckoutStatus }>(
            `/platform/subscriptions/checkout/${encodeURIComponent(sessionId)}/status`
        );
        return data.data;
    },

    sendContact: async (payload: ContactPayload): Promise<string> => {
        const { data } = await apiClient.post<{ message: string }>("/platform/contact", payload);
        return data.message;
    },
};

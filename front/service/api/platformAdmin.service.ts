import { getApiBaseUrl } from "./axios.config";
import { getClientLocale } from "@/i18n/client";

// Plano de control (Super Admin del SaaS). Usa fetch y no apiClient a propósito: apiClient manda el
// JWT y la tienda del usuario, y ante un 401 intenta refrescar la sesión y cerrarla. Acá no hay
// usuario: solo la llave de plataforma en x-platform-key (PlatformAdminGuard).

export type TenantStatus = "PROVISIONING" | "ACTIVE" | "SUSPENDED" | "FAILED";

export interface PlatformTenant {
    id: string;
    slug: string;
    name: string;
    status: TenantStatus;
    plan: string;
    domain: string | null;
    schemaVersion: string | null;
    provisionError: string | null;
    stripeChargesEnabled: boolean;
    subscriptionStatus: string | null;
    hasSubscription: boolean;
    ownerEmail: string | null;
    createdAt: string;
}

export interface PlatformMetrics {
    total: number;
    active: number;
    suspended: number;
    provisioning: number;
    failed: number;
    payingTenants: number;
    mrr: number;
    currency: string;
}

export class PlatformApiError extends Error {
    constructor(
        message: string,
        readonly status: number,
    ) {
        super(message);
    }
}

async function request<T>(key: string, path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${getApiBaseUrl()}/platform/tenants${path}`, {
        ...init,
        headers: {
            "Content-Type": "application/json",
            "Accept-Language": getClientLocale(),
            "x-platform-key": key,
            ...init?.headers,
        },
        cache: "no-store",
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
        const message = Array.isArray(body?.message) ? body.message.join(", ") : body?.message;
        throw new PlatformApiError(message || response.statusText, response.status);
    }
    return body.data as T;
}

export const platformAdminService = {
    getTenants: (key: string) => request<PlatformTenant[]>(key, ""),
    getMetrics: (key: string) => request<PlatformMetrics>(key, "/metrics"),
    setStatus: (key: string, id: string, status: "ACTIVE" | "SUSPENDED") =>
        request<Pick<PlatformTenant, "id" | "slug" | "name" | "status">>(key, `/${id}/status`, {
            method: "PATCH",
            body: JSON.stringify({ status }),
        }),
    retry: (key: string, id: string) => request<PlatformTenant>(key, `/${id}/retry`, { method: "POST" }),
};

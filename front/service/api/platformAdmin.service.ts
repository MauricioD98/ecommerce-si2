import { getApiBaseUrl } from "./axios.config";
import { getClientLocale } from "@/i18n/client";

// Plano de control (Super Admin del SaaS). Usa fetch y no apiClient a propósito: apiClient manda el
// JWT y la tienda del usuario, y ante un 401 intenta refrescar la sesión y cerrarla. Acá no hay
// usuario de tienda: el administrador de la plataforma entra con email y contraseña
// (POST /platform/auth/login) y manda su propio token en Authorization (PlatformAdminGuard).

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

export interface PlatformAdminProfile {
    id: string;
    email: string;
    name: string | null;
}

export interface PlatformSession {
    accessToken: string;
    expiresIn: number;
    admin: PlatformAdminProfile;
}

async function request<T>(token: string | null, path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${getApiBaseUrl()}/platform${path}`, {
        ...init,
        headers: {
            "Content-Type": "application/json",
            "Accept-Language": getClientLocale(),
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
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
    login: (email: string, password: string) =>
        request<PlatformSession>(null, "/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
    getTenants: (token: string) => request<PlatformTenant[]>(token, "/tenants"),
    getMetrics: (token: string) => request<PlatformMetrics>(token, "/tenants/metrics"),
    setStatus: (token: string, id: string, status: "ACTIVE" | "SUSPENDED") =>
        request<Pick<PlatformTenant, "id" | "slug" | "name" | "status">>(token, `/tenants/${id}/status`, {
            method: "PATCH",
            body: JSON.stringify({ status }),
        }),
    retry: (token: string, id: string) => request<PlatformTenant>(token, `/tenants/${id}/retry`, { method: "POST" }),
};

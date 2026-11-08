import { getApiBaseUrl } from "./axios.config";
import { getClientLocale } from "@/i18n/client";
import type { BackupApi, BackupConfig, BackupJob, BackupPreview } from "@/types/backup.types";

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

// Respaldos de plataforma: subir (multipart) y descargar (blob) no pasan por request() porque no son JSON
async function rawRequest(token: string, path: string, init?: RequestInit): Promise<Response> {
    const response = await fetch(`${getApiBaseUrl()}/platform${path}`, {
        ...init,
        headers: { "Accept-Language": getClientLocale(), Authorization: `Bearer ${token}`, ...init?.headers },
        cache: "no-store",
    });
    if (!response.ok) {
        const body = await response.json().catch(() => null);
        const message = Array.isArray(body?.message) ? body.message.join(", ") : body?.message;
        throw new PlatformApiError(message || response.statusText, response.status);
    }
    return response;
}

export const platformBackupService = (token: string): BackupApi & {
    createPlatform(): Promise<BackupJob>;
    createForTenant(tenantId: string): Promise<BackupJob>;
} => ({
    config: () => request<BackupConfig>(token, "/backups/config"),
    list: () => request<BackupJob[]>(token, "/backups"),
    createPlatform: () => request<BackupJob>(token, "/backups", { method: "POST" }),
    createForTenant: (tenantId) => request<BackupJob>(token, `/backups/tenants/${encodeURIComponent(tenantId)}`, { method: "POST" }),
    download: async (job) => {
        const response = await rawRequest(token, `/backups/${job.id}/download`);
        const match = response.headers.get("content-disposition")?.match(/filename="?([^";]+)"?/i);
        return { blob: await response.blob(), fileName: match?.[1] ?? `${job.id}.sfbk` };
    },
    upload: async (file) => {
        const form = new FormData();
        form.append("file", file);
        const response = await rawRequest(token, "/backups/upload", { method: "POST", body: form });
        return (await response.json()).data as BackupJob;
    },
    preview: (id) => request<BackupPreview>(token, `/backups/${id}/preview`),
    restore: (id, confirmation) =>
        request<BackupJob>(token, `/backups/${id}/restore`, { method: "POST", body: JSON.stringify({ confirmation, acknowledgeReplace: true }) }),
    remove: (id) => request(token, `/backups/${id}`, { method: "DELETE" }),
});

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

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

/** Tiendas por estado de su suscripción de Stripe (solo las que tienen una). */
export interface PlatformSubscriptionCounts {
    withSubscription: number;
    withoutSubscription: number;
    active: number;
    trialing: number;
    /** past_due, unpaid o incomplete */
    paymentIssues: number;
    /** canceled o incomplete_expired */
    ended: number;
    paused: number;
    otherStatus: number;
}

export interface PlatformMetrics {
    total: number;
    active: number;
    suspended: number;
    provisioning: number;
    failed: number;
    payingTenants: number;
    /** MRR estimado con el precio mensual de lista de cada plan (no es lo cobrado) */
    mrr: number;
    currency: string;
    // Campos agregados después: opcionales por si responde una API anterior (el panel los muestra
    // como "no disponible")
    /** complete: todas las suscripciones que pagan tienen precio; partial: algunas no; unavailable: ninguna */
    mrrStatus?: "complete" | "partial" | "unavailable";
    unpricedTenants?: number;
    failedSignups?: number;
    subscriptions?: PlatformSubscriptionCounts;
    generatedAt?: string;
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

/** GET /platform/tenants/:id: solo plano de control, sin secretos ni ids de Stripe */
export interface PlatformTenantDetail {
    id: string;
    slug: string;
    name: string;
    status: TenantStatus;
    plan: string;
    domain: string | null;
    domainVerifiedAt: string | null;
    schemaVersion: string | null;
    provisionError: string | null;
    /** Stripe Connect: la tienda tiene cuenta conectada / ya puede cobrar */
    hasStripeAccount: boolean;
    stripeChargesEnabled: boolean;
    /** Comisión de la plataforma en puntos básicos (250 = 2,5 %) */
    platformFeeBps: number;
    hasSubscription: boolean;
    subscriptionStatus: string | null;
    ownerEmail: string | null;
    integrations: { provider: string; updatedAt: string }[];
    createdAt: string;
    updatedAt: string;
}

/** GET /platform/branches: sucursales por tienda (solo lectura, supervisión) */
export type BranchAvailability = "available" | "not_provisioned" | "unavailable";

export interface PlatformBranch {
    id: string;
    name: string;
    address: string | null;
    isActive: boolean;
    createdAt: string;
}

export interface PlatformTenantBranches {
    tenantId: string;
    tenantSlug: string;
    tenantName: string;
    tenantStatus: TenantStatus;
    /** unavailable = no se pudo consultar (no es lo mismo que 0 sucursales) */
    availability: BranchAvailability;
    branches: PlatformBranch[];
}

export interface PlatformBranchesResult {
    generatedAt: string;
    tenants: PlatformTenantBranches[];
}

/** GET /platform/subscriptions/tenants: lo que guardaron los webhooks (no consulta Stripe por tienda) */
export interface PlatformTenantSubscription {
    id: string;
    slug: string;
    name: string;
    status: TenantStatus;
    plan: string;
    hasSubscription: boolean;
    subscriptionStatus: string | null;
    /** monthly | annual; null = sin sincronizar o intervalo distinto */
    billingInterval: "monthly" | "annual" | null;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    cancelAt: string | null;
    subscriptionEndedAt: string | null;
    /** null = todavía no se sincronizó con Stripe desde que existe este detalle */
    subscriptionSyncedAt: string | null;
    /** El Price es uno de los planes de este proyecto; null = no se sabe (sin sincronizar) */
    priceRecognized: boolean | null;
}

/** GET /platform/subscriptions/plans (público): precios de este proyecto leídos de Stripe */
export interface PlatformPlanPrice {
    plan: string;
    interval: "monthly" | "annual";
    available: boolean;
    amount: number | null;
    currency: string | null;
}

/** GET /platform/admins: administradores del SaaS (no usuarios de tiendas) */
export interface PlatformAdminAccount {
    id: string;
    email: string;
    name: string | null;
    isActive: boolean;
    /** Bloqueo temporal vigente por intentos fallidos; null si no hay */
    lockedUntil: string | null;
    lastLoginAt: string | null;
    createdAt: string;
}

export type AuditResult = "SUCCESS" | "FAILURE" | "REQUESTED";

export interface PlatformAuditEntry {
    id: string;
    createdAt: string;
    actorType: "PLATFORM_ADMIN" | "PLATFORM_KEY" | "SYSTEM" | "ANONYMOUS";
    actorEmail: string | null;
    action: string;
    tenantId: string | null;
    tenantSlug: string | null;
    tenantName: string | null;
    targetId: string | null;
    result: AuditResult;
    errorCode: string | null;
    details: Record<string, string | number | boolean | null> | null;
    /** Estado actual de la operación de respaldo asociada (acciones BACKUP_*) */
    jobStatus: string | null;
    jobErrorCode: string | null;
}

export interface PlatformAuditPage {
    /** Fecha del registro AUDIT_STARTED: no hay historial anterior */
    auditStartedAt: string | null;
    hasMore: boolean;
    entries: PlatformAuditEntry[];
}

export interface PlatformAuditFilters {
    action?: string;
    tenantId?: string;
    actorEmail?: string;
    result?: string;
    from?: string;
    to?: string;
    before?: string;
}

/** GET /platform/system/status: comprobaciones reales (o "unavailable" si no se pudieron hacer) */
export type SystemCheckStatus = "ok" | "warning" | "error" | "unavailable";
export interface SystemCheck<T> {
    status: SystemCheckStatus;
    checkedAt: string;
    data: T | null;
    reason?: string;
}
export interface PlatformSystemStatus {
    api: SystemCheck<{ startedAt: string; uptimeSeconds: number }>;
    database: SystemCheck<{ latencyMs: number }>;
    migrations: SystemCheck<{
        control: { applied: number; failed: number; pending: number | null };
        tenants: { total: number; outdated: number | null; outdatedStores: { id: string; slug: string; name: string; unknownVersion: boolean }[] };
    }>;
    backups: SystemCheck<{
        keyConfigured: boolean;
        active: number;
        stuck: number;
        failedLast7Days: number;
        succeededLast7Days: number;
        lastSuccessAt: string | null;
        lastPlatformSuccessAt: string | null;
        lastFailure: { at: string | null; scope: string; errorCode: string | null } | null;
    }>;
    externalSync: SystemCheck<{
        pending: number;
        unresolved: number;
        dead: number;
        processedLast24h: number;
        oldestOpenAt: string | null;
        lastProcessedAt: string | null;
        recentProblems: { type: string; status: string; attempts: number; at: string | null }[];
    }>;
    signups: SystemCheck<{ failed: number; stuckProvisioning: number }>;
    configuration: SystemCheck<{ stripeConfigured: boolean; stripeMissingSettings: number; emailMode: "smtp" | "console" }>;
}

export const platformAdminService = {
    getSystemStatus: (token: string) => request<PlatformSystemStatus>(token, "/system/status"),
    getAdmins: (token: string) => request<PlatformAdminAccount[]>(token, "/admins"),
    getAudit: (token: string, filters: PlatformAuditFilters) => {
        const params = new URLSearchParams();
        for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
        const query = params.toString();
        return request<PlatformAuditPage>(token, `/audit${query ? `?${query}` : ""}`);
    },
    getSubscriptions: (token: string) => request<PlatformTenantSubscription[]>(token, "/subscriptions/tenants"),
    getPlanPrices: (token: string) => request<PlatformPlanPrice[]>(token, "/subscriptions/plans"),
    /** Relee en Stripe la suscripción de la tienda (no modifica Stripe) */
    syncSubscription: (token: string, id: string) =>
        request<PlatformTenantSubscription | null>(token, `/subscriptions/tenants/${encodeURIComponent(id)}/sync`, { method: "POST" }),
    /** Sin tenantId consulta todas las tiendas (una consulta por tienda en el servidor) */
    getBranches: (token: string, tenantId?: string) =>
        request<PlatformBranchesResult>(token, `/branches${tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : ""}`),
    login: (email: string, password: string) =>
        request<PlatformSession>(null, "/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
    getTenants: (token: string) => request<PlatformTenant[]>(token, "/tenants"),
    getTenant: (token: string, id: string) => request<PlatformTenantDetail>(token, `/tenants/${encodeURIComponent(id)}`),
    /** Respaldos y restauraciones de una sola tienda (solo lectura) */
    getTenantBackups: (token: string, id: string) =>
        request<BackupJob[]>(token, `/backups?tenantId=${encodeURIComponent(id)}&scope=TENANT`),
    getMetrics: (token: string) => request<PlatformMetrics>(token, "/tenants/metrics"),
    setStatus: (token: string, id: string, status: "ACTIVE" | "SUSPENDED") =>
        request<Pick<PlatformTenant, "id" | "slug" | "name" | "status">>(token, `/tenants/${id}/status`, {
            method: "PATCH",
            body: JSON.stringify({ status }),
        }),
    retry: (token: string, id: string) => request<PlatformTenant>(token, `/tenants/${id}/retry`, { method: "POST" }),
};

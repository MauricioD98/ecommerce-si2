// Copias de seguridad (api/src/modules/backups). Mismos nombres que devuelve la API.

export type BackupJobStatus = "PREPARING" | "AVAILABLE" | "VALIDATING" | "RESTORING" | "COMPLETED" | "FAILED";
export type BackupScope = "TENANT" | "PLATFORM";

export const ACTIVE_BACKUP_STATUSES: BackupJobStatus[] = ["PREPARING", "VALIDATING", "RESTORING"];

export interface BackupComponent {
    id: string;
    detail?: string;
}

export interface BackupSummary {
    formatVersion: number;
    appVersion: string;
    createdAt: string;
    included: BackupComponent[];
    excluded: BackupComponent[];
    tenant?: { id: string; slug: string; name: string };
    tenants?: { id: string; slug: string; name: string; schemaIncluded: boolean; rows: number }[];
    tables?: { name: string; rows: number }[];
    totalRows: number;
}

export interface BackupJob {
    id: string;
    kind: "BACKUP" | "RESTORE";
    scope: BackupScope;
    tenantId: string | null;
    tenantName: string | null;
    tenantSlug: string | null;
    status: BackupJobStatus;
    origin: "GENERATED" | "UPLOADED" | null;
    sourceBackupId: string | null;
    sizeBytes: number | null;
    sha256: string | null;
    backupCreatedAt: string | null;
    summary: BackupSummary | null;
    result: Record<string, unknown> | null;
    errorCode: string | null;
    errorDetail: string | null;
    requestedBy: { type: string; email: string | null };
    createdAt: string;
    startedAt: string | null;
    finishedAt: string | null;
}

export interface BackupProblem {
    code: string;
    detail: string;
}

export interface BackupPreview {
    backup: BackupJob;
    scope: BackupScope;
    backupCreatedAt: string;
    appVersion: string;
    included: BackupComponent[];
    excluded: BackupComponent[];
    compatible: boolean;
    problems: BackupProblem[];
    confirmationPhrase: string;
    tenant?: { id: string; slug: string; name: string };
    tables?: { name: string; backupRows: number; currentRows: number | null }[];
    tenants?: { id: string; slug: string; name: string; schemaIncluded: boolean; existsNow: boolean; rows: number }[];
    preservedTenants?: { id: string; slug: string; name: string }[];
}

export interface BackupConfig {
    available: boolean;
    maxBytes: number;
    formatVersion: number;
    platformConfirmation: string;
}

// Operaciones que comparten el panel de tienda y el de plataforma (cada uno con su propio transporte)
export interface BackupApi {
    config(): Promise<BackupConfig>;
    list(): Promise<BackupJob[]>;
    download(job: BackupJob): Promise<{ blob: Blob; fileName: string }>;
    upload(file: File): Promise<BackupJob>;
    preview(id: string): Promise<BackupPreview>;
    restore(id: string, confirmation: string): Promise<BackupJob>;
    remove(id: string): Promise<unknown>;
}

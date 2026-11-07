export type ProfileField = 'firstName' | 'lastName';
export type ProfileValues = Record<ProfileField, string | null>;
export type ChangeStatus = 'pending' | 'syncing' | 'synced' | 'conflict' | 'error' | 'needs-login';
export type SyncOutcome = 'synced' | 'pending' | 'conflict' | 'error' | 'needs-login' | 'skipped';

export interface ProfileChange {
  tenantId: string;
  userId: string;
  changeId: string;
  changes: Partial<ProfileValues>;
  expected: Partial<Record<ProfileField, (string | null)[]>>;
  sent: boolean;
  attempts: number;
  status: ChangeStatus;
  lastError: string | null;
  conflict: { server: ProfileValues; fields: ProfileField[] } | null;
  createdAt: string;
  updatedAt: string;
  syncedAt: string | null;
}

export interface SqlAdapter {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: unknown[]): Promise<unknown>;
  get(sql: string, params?: unknown[]): Promise<any>;
  all(sql: string, params?: unknown[]): Promise<any[]>;
}

export interface ProfileLike {
  id: string;
  email?: string;
  firstName?: string | null;
  lastName?: string | null;
}

export interface OfflineStore {
  init(): Promise<void>;
  saveProfileSnapshot(tenantId: string, user: ProfileLike): Promise<void>;
  getProfileSnapshot(tenantId: string, userId: string): Promise<{ user: ProfileLike; savedAt: string } | null>;
  getProfileChange(tenantId: string | null, userId: string | null): Promise<ProfileChange | null>;
  recordProfileEdit(tenantId: string, userId: string, serverValues: Partial<ProfileValues>, form: Partial<ProfileValues>): Promise<ProfileChange | null>;
  patchProfileChange(
    tenantId: string,
    userId: string,
    changeId: string,
    patch: Partial<ProfileChange> | ((current: ProfileChange) => ProfileChange | null)
  ): Promise<ProfileChange | null>;
  discardProfileChange(tenantId: string, userId: string): Promise<ProfileChange | null>;
  resolveProfileConflict(tenantId: string, userId: string, choice: 'mine' | 'server'): Promise<ProfileChange | null>;
  requeueProfileChange(tenantId: string, userId: string, from: ChangeStatus[]): Promise<ProfileChange | null>;
  unsyncedUsers(tenantId: string | null): Promise<string[]>;
  saveRead(tenantId: string, userId: string | null, key: string, data: unknown): Promise<void>;
  getRead<T = unknown>(tenantId: string, userId: string | null, key: string): Promise<{ data: T; savedAt: string } | null>;
  clearUserData(tenantId: string, userId: string): Promise<void>;
  clearPrivateData(tenantId: string): Promise<void>;
}

export interface SyncSession {
  tenantId: string | null;
  userId: string | null;
  accessToken: string | null;
}

export const PROFILE_FIELDS: readonly ProfileField[];
export const STATUSES: readonly ChangeStatus[];
export const SCHEMA_VERSION: number;
export function createOfflineStore(options: { db: SqlAdapter; now?: () => Date; newId?: () => string }): OfflineStore;
export function syncProfileOnce(deps: {
  store: OfflineStore;
  getSession: () => Promise<SyncSession | null>;
  send: (change: ProfileChange, session: SyncSession) => Promise<{ status: number; data: any }>;
  sessionStillValid?: () => Promise<boolean>;
  errorMessage?: (response: { status: number; data: any }) => string;
}): Promise<SyncOutcome>;
export function normalizeProfileValue(value: string | null | undefined): string | null;
export function profileValuesOf(user: Partial<ProfileLike> | null | undefined): ProfileValues;
export function applyPendingValues<T extends Partial<ProfileLike> | null>(user: T, change: ProfileChange | null): T;
export function jwtPayload(token: string | null | undefined): { sub?: string; tenantId?: string; exp?: number; [k: string]: unknown } | null;
export function tokenBelongsTo(token: string | null | undefined, userId: string, tenantId: string): boolean;
export function isTokenExpired(token: string | null | undefined, now?: number): boolean;
export function readScopeOf(path: string | undefined): 'public' | 'private' | null;
export function readCacheKey(path: string | undefined, params: Record<string, unknown> | undefined, language: string | undefined): string;

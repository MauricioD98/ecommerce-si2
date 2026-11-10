export interface DirectoryStore {
  id: string;
  name: string;
  slug: string;
  planName: string | null;
  mobileApp: boolean;
  logoUrl: string | null;
}

export type DirectoryError = 'offline' | 'network' | 'server';

export function normalizeText(value: unknown): string;
export function resolveLogoUrl(logoUrl: unknown, apiBaseUrl: string | null | undefined): string | null;
export function toStores(rawList: unknown, apiBaseUrl: string | null | undefined): DirectoryStore[];
export function searchStores(stores: DirectoryStore[], query: string): DirectoryStore[];
export function storeInitials(name: string): string;
export function classifyDirectoryError(failure?: { online?: boolean; status?: number }): DirectoryError;

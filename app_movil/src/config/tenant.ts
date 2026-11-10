import { appStorage } from '../utils/storage';

// Tienda (tenant) activa. El backend exige el header x-tenant-id (UUID) en cada petición y rechaza
// con 401 si falta o no coincide con la tienda que emitió el JWT.
//
// Fuente de verdad: este módulo (memoria) + AsyncStorage. TenantContext lo hidrata al arrancar y
// lo actualiza al cambiar de tienda; el cliente HTTP lo lee de acá porque los interceptores de
// Axios viven fuera del árbol de React y no pueden usar hooks.

export const TENANT_HEADER = 'x-tenant-id';
export const TENANT_ID_KEY = '@tenant_id';
export const TENANT_NAME_KEY = '@tenant_name';
export const TENANT_SLUG_KEY = '@tenant_slug';
// Código que manda el backend (TenantMiddleware) cuando falta la tienda o no es válida
export const TENANT_REQUIRED = 'TENANT_REQUIRED';

// El cliente HTTP avisa por acá; TenantProvider se registra y muestra el selector de tienda.
let onTenantRequired: (() => void) | null = null;

export const setOnTenantRequiredCallback = (callback: (() => void) | null) => {
  onTenantRequired = callback;
};

export const notifyTenantRequired = () => {
  try {
    onTenantRequired?.();
  } catch {
    // ignore
  }
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// undefined = todavía no se leyó AsyncStorage; null = no hay tienda elegida
let currentTenantId: string | null | undefined;
let currentTenantName: string | null | undefined;
let currentTenantSlug: string | null | undefined;

export const normalizeTenantId = (value: string | null | undefined): string | null => {
  const v = value?.trim().toLowerCase();
  return v && UUID_RE.test(v) ? v : null;
};

// Builds de una sola tienda: EXPO_PUBLIC_TENANT_ID en .env / eas.json
const envTenantId = () => normalizeTenantId(process.env.EXPO_PUBLIC_TENANT_ID);

export const getTenantId = async (): Promise<string | null> => {
  if (currentTenantId !== undefined) return currentTenantId;
  const saved = normalizeTenantId(await appStorage.getItem(TENANT_ID_KEY));
  currentTenantId = saved ?? envTenantId();
  return currentTenantId;
};

export const getTenantName = async (): Promise<string | null> => {
  if (currentTenantName !== undefined) return currentTenantName;
  const saved = await appStorage.getItem(TENANT_NAME_KEY);
  currentTenantName = saved ?? null;
  return currentTenantName;
};

export const getTenantSlug = async (): Promise<string | null> => {
  if (currentTenantSlug !== undefined) return currentTenantSlug;
  const saved = await appStorage.getItem(TENANT_SLUG_KEY);
  currentTenantSlug = saved ?? null;
  return currentTenantSlug;
};

export const setTenantId = async (tenantId: string | null): Promise<void> => {
  const next = tenantId === null ? null : normalizeTenantId(tenantId);
  if (tenantId !== null && !next) {
    throw new Error('El identificador de la tienda no es válido.');
  }
  currentTenantId = next;
  if (next) {
    await appStorage.setItem(TENANT_ID_KEY, next);
  } else {
    await appStorage.removeItem(TENANT_ID_KEY);
  }
};

// Logo de la última tienda elegida (URL pública del directorio): solo para mostrarla en el login.
export const TENANT_LOGO_KEY = '@tenant_logo';

export const getTenantLogo = async (): Promise<string | null> => (await appStorage.getItem(TENANT_LOGO_KEY)) ?? null;

export const setTenantLogo = async (logoUrl: string | null): Promise<void> => {
  if (logoUrl) await appStorage.setItem(TENANT_LOGO_KEY, logoUrl);
  else await appStorage.removeItem(TENANT_LOGO_KEY);
};

export const setTenantDetails = async (name: string | null, slug: string | null): Promise<void> => {
  currentTenantName = name;
  currentTenantSlug = slug;
  if (name) {
    await appStorage.setItem(TENANT_NAME_KEY, name);
  } else {
    await appStorage.removeItem(TENANT_NAME_KEY);
  }
  if (slug) {
    await appStorage.setItem(TENANT_SLUG_KEY, slug);
  } else {
    await appStorage.removeItem(TENANT_SLUG_KEY);
  }
};

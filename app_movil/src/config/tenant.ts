import { appStorage } from '../utils/storage';

// Tienda (tenant) activa. El backend exige el header x-tenant-id (UUID) en cada petición y rechaza
// con 401 si falta o no coincide con la tienda que emitió el JWT.
//
// Fuente de verdad: este módulo (memoria) + AsyncStorage. TenantContext lo hidrata al arrancar y
// lo actualiza al cambiar de tienda; el cliente HTTP lo lee de acá porque los interceptores de
// Axios viven fuera del árbol de React y no pueden usar hooks.

export const TENANT_HEADER = 'x-tenant-id';
export const TENANT_ID_KEY = '@tenant_id';
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

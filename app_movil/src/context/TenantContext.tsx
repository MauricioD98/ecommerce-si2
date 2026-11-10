import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import apiClient, { ACCESS_TOKEN_KEY, REFRESH_TOKEN_KEY, USER_DATA_KEY } from '../api/client';
import {
  getTenantId,
  getTenantName,
  getTenantLogo,
  getTenantSlug,
  setOnTenantRequiredCallback,
  setTenantDetails,
  setTenantId,
  setTenantLogo,
} from '../config/tenant';
import { appStorage } from '../utils/storage';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { TenantSelectorScreen } from '../screens/tenant/TenantSelectorScreen';

// Claves atadas a una tienda: los tokens solo valen en la tienda que los emitió y la sucursal
// elegida es un id del schema de esa tienda. Se limpian al cambiar de tienda.
const TENANT_BOUND_KEYS = [ACCESS_TOKEN_KEY, REFRESH_TOKEN_KEY, USER_DATA_KEY, '@selected_branch_id'];

export interface TenantSwitchPayload {
  id: string;
  name?: string | null;
  slug?: string | null;
  logoUrl?: string | null;
}

interface TenantContextType {
  tenantId: string | null;
  tenantName: string | null;
  tenantSlug: string | null;
  tenantLogo: string | null;
  switchTenant: (next: TenantSwitchPayload | string) => Promise<void>;
  clearTenant: () => Promise<void>;
  refreshTenantInfo: () => Promise<void>;
}

const TenantContext = createContext<TenantContextType | undefined>(undefined);

export const TenantProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [tenantId, setTenantState] = useState<string | null>(null);
  const [tenantName, setTenantNameState] = useState<string | null>(null);
  const [tenantSlug, setTenantSlugState] = useState<string | null>(null);
  // Logo de la última tienda elegida (solo para mostrarla en el login; no es un dato de la sesión)
  const [tenantLogo, setTenantLogoState] = useState<string | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);
  // El backend respondió TENANT_REQUIRED: la tienda guardada ya no existe o está suspendida
  const [tenantRejected, setTenantRejected] = useState(false);
  // Se incrementa al volver a elegir la MISMA tienda, para remontar el árbol y reintentar todo
  const [mountKey, setMountKey] = useState(0);

  const fetchTenantDetails = useCallback(async (id: string) => {
    try {
      const { data } = await apiClient.get<{ data: { id: string; name: string; slug: string } }>(
        `/platform/tenants/resolve/${encodeURIComponent(id)}`
      );
      if (data?.data?.name) {
        setTenantNameState(data.data.name);
        setTenantSlugState(data.data.slug);
        await setTenantDetails(data.data.name, data.data.slug);
      }
    } catch {
      // Ignorar error de red si no se puede resolver en este momento
    }
  }, []);

  useEffect(() => {
    Promise.all([getTenantId(), getTenantName(), getTenantSlug(), getTenantLogo()])
      .then(async ([id, name, slug, logo]) => {
        setTenantState(id);
        setTenantNameState(name);
        setTenantSlugState(slug);
        setTenantLogoState(id ? logo : null);
        if (id && !name) {
          await fetchTenantDetails(id);
        }
      })
      .finally(() => setIsHydrated(true));
  }, [fetchTenantDetails]);

  useEffect(() => {
    setOnTenantRequiredCallback(() => setTenantRejected(true));
    return () => setOnTenantRequiredCallback(null);
  }, []);

  const applyTenant = useCallback(
    async (next: TenantSwitchPayload | string | null) => {
      setTenantRejected(false);
      const nextId = typeof next === 'string' ? next.trim().toLowerCase() : next?.id?.trim().toLowerCase() ?? null;
      const nextName = typeof next === 'object' && next !== null ? next.name ?? null : null;
      const nextSlug = typeof next === 'object' && next !== null ? next.slug ?? null : null;
      const nextLogo = typeof next === 'object' && next !== null ? next.logoUrl ?? null : null;

      if (nextId === tenantId) {
        // Misma tienda: no se borra la sesión
        if (nextName || nextSlug) {
          setTenantNameState(nextName);
          setTenantSlugState(nextSlug);
          setTenantLogoState(nextLogo);
          await setTenantDetails(nextName, nextSlug);
          await setTenantLogo(nextLogo);
        }
        setMountKey((k) => k + 1);
        return;
      }
      await Promise.all(TENANT_BOUND_KEYS.map((key) => appStorage.removeItem(key)));
      await setTenantId(nextId);
      await setTenantDetails(nextName, nextSlug);
      await setTenantLogo(nextLogo);
      setTenantState(nextId);
      setTenantNameState(nextName);
      setTenantSlugState(nextSlug);
      setTenantLogoState(nextLogo);

      if (nextId && !nextName) {
        await fetchTenantDetails(nextId);
      }
    },
    [tenantId, fetchTenantDetails]
  );

  const switchTenant = useCallback(
    (next: TenantSwitchPayload | string) => applyTenant(next),
    [applyTenant]
  );

  const clearTenant = useCallback(() => applyTenant(null), [applyTenant]);

  const refreshTenantInfo = useCallback(async () => {
    if (tenantId) {
      await fetchTenantDetails(tenantId);
    }
  }, [tenantId, fetchTenantDetails]);

  const value = useMemo(
    () => ({ tenantId, tenantName, tenantSlug, tenantLogo, switchTenant, clearTenant, refreshTenantInfo }),
    [tenantId, tenantName, tenantSlug, tenantLogo, switchTenant, clearTenant, refreshTenantInfo]
  );

  // Hasta leer AsyncStorage no se monta nada
  if (!isHydrated) return <LoadingSpinner />;

  // Tienda rechazada por el backend (suspendida, eliminada o sin app en su plan): aviso + selector EN
  // LUGAR de la app. Sin tienda elegida se monta la app normal: el login trae su propio selector.
  if (tenantRejected) {
    return (
      <TenantContext.Provider value={value}>
        <TenantSelectorScreen rejected={tenantRejected} onSelect={switchTenant} />
      </TenantContext.Provider>
    );
  }

  return (
    <TenantContext.Provider value={value}>
      {/* key: al cambiar de tienda se remonta Auth/Branch/Cart y cada uno recarga desde cero: nada en
          memoria de la tienda anterior queda a la vista */}
      <React.Fragment key={`${tenantId ?? 'none'}:${mountKey}`}>{children}</React.Fragment>
    </TenantContext.Provider>
  );
};

export const useTenant = (): TenantContextType => {
  const ctx = useContext(TenantContext);
  if (!ctx) throw new Error('useTenant debe usarse dentro de TenantProvider');
  return ctx;
};

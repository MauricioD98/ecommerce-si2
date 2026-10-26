import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ACCESS_TOKEN_KEY, REFRESH_TOKEN_KEY, USER_DATA_KEY } from '../api/client';
import { getTenantId, setOnTenantRequiredCallback, setTenantId } from '../config/tenant';
import { appStorage } from '../utils/storage';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { TenantSelectorScreen } from '../screens/tenant/TenantSelectorScreen';

// Claves atadas a una tienda: los tokens solo valen en la tienda que los emitió y la sucursal
// elegida es un id del schema de esa tienda. Se limpian al cambiar de tienda.
const TENANT_BOUND_KEYS = [ACCESS_TOKEN_KEY, REFRESH_TOKEN_KEY, USER_DATA_KEY, '@selected_branch_id'];

interface TenantContextType {
  tenantId: string | null;
  switchTenant: (tenantId: string) => Promise<void>;
  clearTenant: () => Promise<void>;
}

const TenantContext = createContext<TenantContextType | undefined>(undefined);

export const TenantProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [tenantId, setTenantState] = useState<string | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);
  // El backend respondió TENANT_REQUIRED: la tienda guardada ya no existe o está suspendida
  const [tenantRejected, setTenantRejected] = useState(false);
  // Se incrementa al volver a elegir la MISMA tienda, para remontar el árbol y reintentar todo
  const [mountKey, setMountKey] = useState(0);

  useEffect(() => {
    getTenantId()
      .then(setTenantState)
      .finally(() => setIsHydrated(true));
  }, []);

  useEffect(() => {
    setOnTenantRequiredCallback(() => setTenantRejected(true));
    return () => setOnTenantRequiredCallback(null);
  }, []);

  const applyTenant = useCallback(
    async (next: string | null) => {
      setTenantRejected(false);
      if (next === tenantId) {
        // Misma tienda (p. ej. se reactivó): no se borra la sesión, solo se reintenta
        setMountKey((k) => k + 1);
        return;
      }
      await Promise.all(TENANT_BOUND_KEYS.map((key) => appStorage.removeItem(key)));
      await setTenantId(next);
      setTenantState(next);
    },
    [tenantId]
  );

  const switchTenant = useCallback((next: string) => applyTenant(next.trim().toLowerCase()), [applyTenant]);
  const clearTenant = useCallback(() => applyTenant(null), [applyTenant]);

  const value = useMemo(() => ({ tenantId, switchTenant, clearTenant }), [tenantId, switchTenant, clearTenant]);

  // Hasta leer AsyncStorage no se monta nada: si AuthProvider arrancara antes, su primer
  // GET /users/me saldría sin x-tenant-id.
  if (!isHydrated) return <LoadingSpinner />;

  // Sin tienda (o rechazada por el backend) se muestra el selector EN LUGAR de la app: Auth, Branch
  // y Cart no se montan, así que no disparan requests que terminarían en el auto-logout.
  if (!tenantId || tenantRejected) {
    return (
      <TenantContext.Provider value={value}>
        <TenantSelectorScreen rejected={tenantRejected} onSelect={switchTenant} />
      </TenantContext.Provider>
    );
  }

  return (
    <TenantContext.Provider value={value}>
      {/* key: al cambiar de tienda se remonta Auth/Branch/Cart y cada uno recarga desde cero */}
      <React.Fragment key={`${tenantId}:${mountKey}`}>{children}</React.Fragment>
    </TenantContext.Provider>
  );
};

export const useTenant = (): TenantContextType => {
  const ctx = useContext(TenantContext);
  if (!ctx) throw new Error('useTenant debe usarse dentro de TenantProvider');
  return ctx;
};

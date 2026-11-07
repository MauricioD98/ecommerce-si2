import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import apiClient, { ACCESS_TOKEN_KEY, USER_DATA_KEY } from '../api/client';
import { TENANT_HEADER, getTenantId } from '../config/tenant';
import { appStorage } from '../utils/storage';
import type { User } from '../types';
import { getOfflineStore } from './database';
import { emitOffline, onOffline } from './events';
import { useIsOnline } from './network';
import {
  applyPendingValues,
  profileValuesOf,
  syncProfileOnce,
  type ProfileChange,
  type ProfileValues,
  type SyncOutcome,
  type SyncSession,
} from './offlineCore';

// Puente entre la cola del perfil (offlineCore.js, en SQLite) y la app: sesión activa, envío por PATCH
// /users/me/sync (el mismo endpoint y reglas que la PWA) y un hook para las pantallas.

async function activeSession(): Promise<SyncSession> {
  const [tenantId, accessToken, rawUser] = await Promise.all([
    getTenantId(),
    appStorage.getItem(ACCESS_TOKEN_KEY),
    appStorage.getItem(USER_DATA_KEY),
  ]);
  let userId: string | null = null;
  try {
    userId = rawUser ? (JSON.parse(rawUser) as User).id ?? null : null;
  } catch {
    userId = null;
  }
  return { tenantId, userId, accessToken };
}

let inFlight: Promise<SyncOutcome> | null = null;

/** Intenta enviar el cambio pendiente de la sesión activa. Nunca lanza; una sola sincronización a la vez. */
export function syncProfileNow(): Promise<SyncOutcome> {
  inFlight ??= (async () => {
    const store = await getOfflineStore();
    if (!store) return 'skipped' as SyncOutcome;
    try {
      const outcome = await syncProfileOnce({
        store,
        getSession: async () => {
          const session = await activeSession();
          emitOffline('profile');
          return session;
        },
        send: async (change, session) => {
          emitOffline('profile');
          try {
            const res = await apiClient.patch<User>(
              '/users/me/sync',
              { changeId: change.changeId, changes: change.changes, expected: change.expected },
              // La tienda del cambio, explícita: aunque el usuario cambie de tienda a mitad del envío
              { headers: { [TENANT_HEADER]: session.tenantId as string } }
            );
            return { status: res.status, data: res.data };
          } catch (error) {
            if (axios.isAxiosError(error) && error.response) return { status: error.response.status, data: error.response.data };
            throw error; // sin respuesta (o el cliente no pudo renovar la sesión)
          }
        },
        // El cliente HTTP borra la sesión si no pudo renovarla: entonces hay que volver a iniciar sesión
        sessionStillValid: async () => !!(await appStorage.getItem(ACCESS_TOKEN_KEY)),
      });
      // El servidor devolvió su versión del perfil (aplicado o en conflicto): la sesión en pantalla se
      // actualiza, solo si sigue siendo la misma persona (AuthContext lo comprueba)
      if (outcome === 'synced' || outcome === 'conflict') {
        const session = await activeSession();
        const snapshot = session.tenantId && session.userId ? await store.getProfileSnapshot(session.tenantId, session.userId) : null;
        if (snapshot) emitOffline('server-profile', snapshot.user);
      }
      return outcome;
    } catch {
      return 'pending' as SyncOutcome;
    } finally {
      emitOffline('profile');
    }
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

export const isProfileSyncRunning = () => inFlight !== null;

/** Guarda en el dispositivo lo editado en el formulario (campos compatibles: nombre y apellido) */
export async function saveProfileOffline(user: User, form: Partial<ProfileValues>): Promise<ProfileChange | null> {
  const [store, tenantId] = await Promise.all([getOfflineStore(), getTenantId()]);
  if (!store || !tenantId) throw new Error('offline-storage-unavailable');
  // Valor esperado = la última versión confirmada por el servidor (copia local); si no hay, el usuario de la sesión
  const snapshot = await store.getProfileSnapshot(tenantId, user.id);
  const server = profileValuesOf(snapshot?.user ?? user);
  const change = await store.recordProfileEdit(tenantId, user.id, server, form);
  emitOffline('profile');
  return change;
}

export async function saveProfileSnapshot(user: User): Promise<void> {
  try {
    const [store, tenantId] = await Promise.all([getOfflineStore(), getTenantId()]);
    if (store && tenantId && user?.id) await store.saveProfileSnapshot(tenantId, user as any);
  } catch {
    // la copia es una ayuda; nunca rompe el login
  }
}

/** Cierre de sesión: borra lo privado guardado de esa persona; conserva sus cambios sin confirmar */
export async function clearOfflineUserData(userId: string | null | undefined): Promise<void> {
  try {
    const [store, tenantId] = await Promise.all([getOfflineStore(), getTenantId()]);
    if (!store || !tenantId) return;
    if (userId) await store.clearUserData(tenantId, userId);
    else await store.clearPrivateData(tenantId);
  } catch {
    // ignore
  }
  emitOffline('profile');
}

/** La misma persona volvió a iniciar sesión: lo que esperaba sesión vuelve a la cola y se envía */
export async function resumeAfterLogin(userId: string): Promise<void> {
  try {
    const [store, tenantId] = await Promise.all([getOfflineStore(), getTenantId()]);
    if (store && tenantId) await store.requeueProfileChange(tenantId, userId, ['needs-login']);
  } catch {
    // ignore
  }
  void syncProfileNow();
}

export async function hasUnsyncedProfileChange(userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false;
  const [store, tenantId] = await Promise.all([getOfflineStore(), getTenantId()]);
  const change = await store?.getProfileChange(tenantId, userId);
  return !!change && change.status !== 'synced';
}

/** Estado del perfil para las pantallas: cambio guardado, red y acciones de revisión */
export function useProfileSync(user: User | null) {
  const isOnline = useIsOnline();
  const [change, setChange] = useState<ProfileChange | null>(null);
  const [syncing, setSyncing] = useState(false);
  const userId = user?.id ?? null;

  const reload = useCallback(async () => {
    try {
      const [store, tenantId] = await Promise.all([getOfflineStore(), getTenantId()]);
      const next = store && tenantId && userId ? await store.getProfileChange(tenantId, userId) : null;
      setChange(next);
      setSyncing(isProfileSyncRunning() || next?.status === 'syncing');
    } catch {
      setChange(null);
    }
  }, [userId]);

  useEffect(() => {
    void reload();
    return onOffline('profile', () => void reload());
  }, [reload]);

  const withStore = useCallback(
    async (fn: (store: NonNullable<Awaited<ReturnType<typeof getOfflineStore>>>, tenantId: string, userId: string) => Promise<unknown>) => {
      const [store, tenantId] = await Promise.all([getOfflineStore(), getTenantId()]);
      if (!store || !tenantId || !userId) return;
      await fn(store, tenantId, userId);
      emitOffline('profile');
      void syncProfileNow();
    },
    [userId]
  );

  return {
    change,
    isOnline,
    syncing,
    /** Perfil a mostrar: servidor + cambios sin confirmar */
    displayUser: applyPendingValues(user, change),
    resolveConflict: (choice: 'mine' | 'server') => withStore((s, t, u) => s.resolveProfileConflict(t, u, choice)),
    retry: () => withStore((s, t, u) => s.requeueProfileChange(t, u, ['error', 'needs-login'])),
    discard: () => withStore((s, t, u) => s.discardProfileChange(t, u)),
    syncNow: () => void syncProfileNow(),
  };
}

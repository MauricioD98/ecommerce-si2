'use client';

import { createContext, useContext } from 'react';
import type { PlatformBranchesResult, PlatformMetrics, PlatformTenant } from '@/service/api/platformAdmin.service';
import type { BackupConfig, BackupJob } from '@/types/backup.types';

/**
 * Resumen de respaldos para Inicio. Se pide la primera vez que se abre Inicio y se conserva al moverse
 * entre secciones; "Actualizar" lo vuelve a `idle` para que se pida de nuevo.
 */
export type BackupOverview =
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'ready'; config: BackupConfig; jobs: BackupJob[] }
    | { status: 'error'; message: string };

/**
 * Sucursales de la plataforma (consulta a cada tienda en el servidor). Se piden al abrir la sección y se
 * conservan al navegar; "Actualizar" las invalida. scope = 'all' o el id de una sola tienda.
 */
export type BranchOverview =
    | { status: 'idle' }
    | { status: 'loading'; scope: string }
    | { status: 'ready'; scope: string; data: PlatformBranchesResult }
    | { status: 'error'; scope: string; message: string };

// Estado compartido por todas las secciones de /plataforma. Lo provee PlatformAdminShell (en el layout),
// así la sesión y la lista de tiendas no se vuelven a pedir al moverse entre secciones del menú.
export interface PlatformAdminState {
    token: string;
    email: string;
    tenants: PlatformTenant[];
    metrics: PlatformMetrics | null;
    isLoading: boolean;
    error: string | null;
    /** Vuelve a pedir tiendas y métricas. Un 401 cierra la sesión. */
    reload: () => Promise<void>;
    /** Muestra un error de una acción (un 401 cierra la sesión). */
    reportError: (err: unknown, fallback: string) => void;
    /** Momento de la última carga correcta de tiendas y métricas */
    loadedAt: Date | null;
    backupOverview: BackupOverview;
    loadBackupOverview: () => Promise<void>;
    branchOverview: BranchOverview;
    /** scope: 'all' o el id de una tienda */
    loadBranches: (scope: string) => Promise<void>;
}

export const PlatformAdminContext = createContext<PlatformAdminState | null>(null);

export function usePlatformAdmin(): PlatformAdminState {
    const value = useContext(PlatformAdminContext);
    if (!value) throw new Error('usePlatformAdmin debe usarse dentro de PlatformAdminShell');
    return value;
}

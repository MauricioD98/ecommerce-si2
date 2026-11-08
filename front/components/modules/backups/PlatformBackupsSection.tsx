'use client';

import React, { useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import styles from '@/components/modules/admin/admin-table.module.scss';
import { platformBackupService, type PlatformTenant } from '@/service/api/platformAdmin.service';
import type { BackupJob } from '@/types/backup.types';
import BackupsPanel from './BackupsPanel';

// Panel del SaaS → "Respaldos": respaldo completo de la plataforma y respaldos de una tienda. Reutiliza
// BackupsPanel (el mismo del panel de cada tienda) con las operaciones de /platform/backups.
// El filtro de alcance solo cambia lo que se muestra: el historial completo sigue siendo el de la API.
type ScopeFilter = '' | 'PLATFORM' | 'TENANT' | `tenant:${string}`;

export default function PlatformBackupsSection({ token, tenants }: { token: string; tenants: PlatformTenant[] }) {
    const t = useTranslations('Backups');
    const api = useMemo(() => platformBackupService(token), [token]);
    const [tenantId, setTenantId] = useState('');
    // ?tienda=<id> (desde el detalle de una tienda) abre el historial filtrado por esa tienda
    const initialTenant = useSearchParams().get('tienda');
    const [scope, setScope] = useState<ScopeFilter>(initialTenant ? `tenant:${initialTenant}` : '');
    const selectable = tenants.filter((tenant) => tenant.status === 'ACTIVE' || tenant.status === 'SUSPENDED');
    const sorted = useMemo(() => [...tenants].sort((a, b) => a.name.localeCompare(b.name)), [tenants]);

    const jobFilter = useMemo(() => {
        if (!scope) return undefined;
        if (scope === 'PLATFORM' || scope === 'TENANT') return (job: BackupJob) => job.scope === scope;
        const id = scope.slice('tenant:'.length);
        return (job: BackupJob) => job.scope === 'TENANT' && job.tenantId === id;
    }, [scope]);

    return (
        <section className={styles.page}>
            <div className={styles.pageHeader}>
                <div>
                    <h1>{t('platformTitle')}</h1>
                    <p>{t('platformSubtitle')}</p>
                </div>
            </div>
            <BackupsPanel
                api={api}
                showStore
                createActions={[
                    { key: 'platform', label: t('createPlatform'), run: api.createPlatform },
                    { key: 'tenant', label: t('createForTenant'), disabled: !tenantId, run: () => api.createForTenant(tenantId) },
                ]}
                extraControls={
                    <select className={styles.input} value={tenantId} onChange={(e) => setTenantId(e.target.value)} aria-label={t('selectTenant')}>
                        <option value="">{t('selectTenant')}</option>
                        {selectable.map((tenant) => (
                            <option key={tenant.id} value={tenant.id}>
                                {tenant.name} ({tenant.slug})
                            </option>
                        ))}
                    </select>
                }
                filterControls={
                    <select
                        className={styles.input}
                        value={scope}
                        onChange={(e) => setScope(e.target.value as ScopeFilter)}
                        aria-label={t('filter.label')}
                    >
                        <option value="">{t('filter.all')}</option>
                        <option value="PLATFORM">{t('filter.platform')}</option>
                        <option value="TENANT">{t('filter.tenants')}</option>
                        {sorted.map((tenant) => (
                            <option key={tenant.id} value={`tenant:${tenant.id}`}>
                                {t('filter.oneTenant', { name: tenant.name })}
                            </option>
                        ))}
                    </select>
                }
                jobFilter={jobFilter}
            />
        </section>
    );
}

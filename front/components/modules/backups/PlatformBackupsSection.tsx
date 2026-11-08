'use client';

import React, { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import styles from '@/components/modules/admin/admin-table.module.scss';
import { platformBackupService, type PlatformTenant } from '@/service/api/platformAdmin.service';
import BackupsPanel from './BackupsPanel';

// Panel del SaaS → "Respaldos de plataforma": respaldo completo y gestión de respaldos de una tienda.
export default function PlatformBackupsSection({ token, tenants }: { token: string; tenants: PlatformTenant[] }) {
    const t = useTranslations('Backups');
    const api = useMemo(() => platformBackupService(token), [token]);
    const [tenantId, setTenantId] = useState('');
    const selectable = tenants.filter((tenant) => tenant.status === 'ACTIVE' || tenant.status === 'SUSPENDED');

    return (
        <section className={styles.form}>
            <div className={styles.pageHeader}>
                <div>
                    <h2>{t('platformTitle')}</h2>
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
            />
        </section>
    );
}

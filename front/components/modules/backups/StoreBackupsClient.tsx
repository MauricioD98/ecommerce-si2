'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import styles from '@/components/modules/admin/admin-table.module.scss';
import { storeBackupService } from '@/service/api/backup.service';
import BackupsPanel from './BackupsPanel';

// Panel de tienda → "Copias de seguridad". La tienda la fija el backend desde la sesión (JWT + x-tenant-id).
export default function StoreBackupsClient() {
    const t = useTranslations('Backups');
    return (
        <div className={styles.page}>
            <div className={styles.pageHeader}>
                <div>
                    <h1>{t('title')}</h1>
                    <p>{t('subtitle')}</p>
                </div>
            </div>
            <BackupsPanel api={storeBackupService} createActions={[{ key: 'store', label: t('create'), run: storeBackupService.create }]} />
        </div>
    );
}

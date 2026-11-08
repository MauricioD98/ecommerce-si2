'use client';

import React from 'react';
import { ArchiveRestore, Download, Globe2, Loader2, Store, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import styles from '@/components/modules/admin/admin-table.module.scss';
import { intlLocale } from '@/i18n/config';
import type { BackupJob, BackupJobStatus } from '@/types/backup.types';
import { formatBytes } from './useBackupJobs';

const STATUS_BADGE: Record<BackupJobStatus, string> = {
    PREPARING: styles.badgeInfo,
    AVAILABLE: styles.badgeSuccess,
    VALIDATING: styles.badgeInfo,
    RESTORING: styles.badgeWarning,
    COMPLETED: styles.badgeSuccess,
    FAILED: styles.badgeDanger,
};

// Códigos que la API guarda en backup_jobs.error_code; cualquier otro se muestra como "unknown"
export const KNOWN_BACKUP_ERRORS = [
    'BACKUP_INTERRUPTED',
    'BACKUP_INCOMPATIBLE_VERSION',
    'BACKUP_VALIDATION_FAILED',
    'BACKUP_RESTORE_FAILED',
    'BACKUP_VERIFY_FAILED',
    'BACKUP_ACTOR_EMAIL_CONFLICT',
    'BACKUP_TENANT_SCHEMA_MISSING',
    'BACKUP_TOO_LARGE',
    'BACKUP_INTEGRITY_FAILED',
    'BACKUP_WRONG_TENANT',
    'BACKUP_KEY_UNKNOWN',
    'BACKUP_NOT_A_BACKUP',
    'BACKUP_UNSUPPORTED_VERSION',
    'BACKUP_FAILED',
] as const;
type KnownError = (typeof KNOWN_BACKUP_ERRORS)[number];

export function useBackupErrorLabel() {
    const t = useTranslations('Backups');
    return (code: string | null) =>
        code && (KNOWN_BACKUP_ERRORS as readonly string[]).includes(code) ? t(`errors.${code as KnownError}`) : t('errors.unknown');
}

interface Props {
    jobs: BackupJob[];
    showStore?: boolean;
    canAct: boolean;
    busyId: string | null;
    onDownload: (job: BackupJob) => void;
    onRestore: (job: BackupJob) => void;
    onDelete: (job: BackupJob) => void;
    /** Texto cuando no hay filas (p. ej. "ninguna coincide con el filtro") */
    emptyText?: string;
}

export default function BackupJobsTable({ jobs, showStore = false, canAct, busyId, onDownload, onRestore, onDelete, emptyText }: Props) {
    const t = useTranslations('Backups');
    const locale = intlLocale(useLocale());
    const errorLabel = useBackupErrorLabel();
    const formatDate = (value: string | null) =>
        value ? new Date(value).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' }) : '—';

    if (jobs.length === 0) return <div className={styles.emptyState}>{emptyText ?? t('empty')}</div>;

    return (
        <div className={styles.tableWrapper}>
            <table className={styles.table}>
                <thead>
                    <tr>
                        <th>{t('columns.date')}</th>
                        <th>{t('columns.type')}</th>
                        {showStore && <th>{t('columns.scope')}</th>}
                        <th>{t('columns.status')}</th>
                        <th className={styles.numeric}>{t('columns.size')}</th>
                        <th className={styles.numeric}>{t('columns.actions')}</th>
                    </tr>
                </thead>
                <tbody>
                    {jobs.map((job) => {
                        const busy = busyId === job.id;
                        const active = job.status === 'PREPARING' || job.status === 'VALIDATING' || job.status === 'RESTORING';
                        const rows = typeof job.result?.rows === 'number' ? job.result.rows : null;
                        return (
                            <tr key={job.id}>
                                <td>
                                    <div className={styles.cellMain}>
                                        {/* Fecha de la operación (created_at). Una copia subida conserva además la fecha en
                                            que se generó originalmente. */}
                                        <span className={styles.cellTitle}>{formatDate(job.createdAt)}</span>
                                        {job.origin === 'UPLOADED' && job.backupCreatedAt && (
                                            <span className={styles.cellSub}>{t('originalDate', { date: formatDate(job.backupCreatedAt) })}</span>
                                        )}
                                    </div>
                                </td>
                                <td>
                                    <div className={styles.cellMain}>
                                        <span className={styles.cellTitle}>{t(`kind.${job.kind}`)}</span>
                                        <span className={styles.cellSub}>
                                            {/* Sin la columna de alcance (panel de una tienda) el alcance va acá */}
                                            {!showStore && t(`scope.${job.scope}`)}
                                            {!showStore && job.origin ? ' · ' : ''}
                                            {job.origin ? t(`origin.${job.origin}`) : ''}
                                        </span>
                                    </div>
                                </td>
                                {showStore && (
                                    <td data-scope={job.scope}>
                                        {job.scope === 'PLATFORM' ? (
                                            <span className={`${styles.badge} ${styles.scopePlatform}`}>
                                                <Globe2 size={12} aria-hidden /> {t('scopeBadge.platform')}
                                            </span>
                                        ) : (
                                            <div className={styles.cellMain}>
                                                <span className={`${styles.badge} ${styles.badgeMuted}`}>
                                                    <Store size={12} aria-hidden /> {t('scopeBadge.tenant')}
                                                </span>
                                                <span className={styles.cellTitle}>{job.tenantName ?? job.tenantSlug ?? job.tenantId}</span>
                                                {job.tenantSlug && job.tenantName && <span className={styles.cellSub}>{job.tenantSlug}</span>}
                                            </div>
                                        )}
                                    </td>
                                )}
                                <td>
                                    <div className={styles.cellMain}>
                                        <span className={`${styles.badge} ${STATUS_BADGE[job.status]}`}>
                                            {active && <Loader2 size={12} aria-hidden />} {t(`status.${job.status}`)}
                                        </span>
                                        {job.status === 'FAILED' && (
                                            <span className={styles.rowError} title={job.errorDetail ?? undefined}>
                                                {errorLabel(job.errorCode)}
                                            </span>
                                        )}
                                        {job.status === 'COMPLETED' && rows !== null && (
                                            <span className={styles.cellSub}>{t('restoredRows', { count: rows })}</span>
                                        )}
                                    </div>
                                </td>
                                <td className={`${styles.numeric} ${styles.cellSub}`}>{formatBytes(job.sizeBytes, locale)}</td>
                                <td>
                                    {job.kind === 'BACKUP' && job.status === 'AVAILABLE' && (
                                        <div className={styles.actions}>
                                            <button type="button" className={styles.buttonSecondary} disabled={busy} onClick={() => onDownload(job)}>
                                                <Download size={14} />
                                                {t('download')}
                                            </button>
                                            <button type="button" className={styles.button} disabled={busy || !canAct} onClick={() => onRestore(job)}>
                                                <ArchiveRestore size={14} />
                                                {t('restore')}
                                            </button>
                                            <button type="button" className={styles.buttonDanger} disabled={busy} onClick={() => onDelete(job)} aria-label={t('delete')}>
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    )}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}

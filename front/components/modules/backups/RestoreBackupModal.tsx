'use client';

import React, { FormEvent, useEffect, useState } from 'react';
import { AlertTriangle, ArchiveRestore, Globe2, Store } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import AdminModal from '@/components/modules/admin/AdminModal';
import styles from '@/components/modules/admin/admin-table.module.scss';
import { intlLocale } from '@/i18n/config';
import type { BackupApi, BackupComponent, BackupJob, BackupPreview } from '@/types/backup.types';
import { useBackupErrorLabel } from './BackupJobsTable';
import { backupErrorText } from './useBackupJobs';

// Ids de componentes que describe la API (backup-policy.ts); uno desconocido se muestra con su id
const KNOWN_COMPONENTS = [
    'catalog', 'branches', 'orders', 'checkout', 'users', 'settings', 'sync',
    'sessions', 'platformControl', 'integrations', 'externalImages', 'aiModels', 'reportingViews', 'externalServices',
    'control', 'allTenants', 'backupJobs', 'mobileAttestation', 'secretsKeys', 'databaseRoles', 'tenantSchemaMissing',
] as const;
type KnownComponent = (typeof KNOWN_COMPONENTS)[number];

interface Props {
    api: BackupApi;
    job: BackupJob;
    onClose: () => void;
    onStarted: (job: BackupJob) => void;
}

// Antes de restaurar: qué tienda (o la plataforma), de qué fecha, qué se incluye y qué no, si es compatible
// y que los datos actuales se reemplazan. Pide escribir la frase de confirmación y marcar la casilla; la API
// vuelve a verificar las dos cosas.
export default function RestoreBackupModal({ api, job, onClose, onStarted }: Props) {
    const t = useTranslations('Backups');
    const locale = intlLocale(useLocale());
    const errorLabel = useBackupErrorLabel();
    const [preview, setPreview] = useState<BackupPreview | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [confirmation, setConfirmation] = useState('');
    const [acknowledged, setAcknowledged] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        api.preview(job.id)
            .then((data) => !cancelled && setPreview(data))
            .catch((err) => !cancelled && setLoadError(backupErrorText(err, t('previewFailed'))));
        return () => {
            cancelled = true;
        };
    }, [api, job.id, t]);

    const componentLabel = (component: BackupComponent) =>
        (KNOWN_COMPONENTS as readonly string[]).includes(component.id)
            ? t(`components.${component.id as KnownComponent}`) + (component.id === 'tenantSchemaMissing' && component.detail ? ` (${component.detail.split(':')[0]})` : '')
            : component.id;

    const canSubmit = !!preview && preview.compatible && acknowledged && confirmation.trim() === preview.confirmationPhrase && !submitting;

    const submit = async (e: FormEvent) => {
        e.preventDefault();
        if (!preview || !canSubmit) return;
        setSubmitting(true);
        setSubmitError(null);
        try {
            onStarted(await api.restore(job.id, confirmation.trim()));
        } catch (err) {
            setSubmitError(backupErrorText(err, t('restoreFailed')));
            setSubmitting(false);
        }
    };

    return (
        <AdminModal
            title={
                job.scope === 'PLATFORM'
                    ? t('restoreModal.titlePlatform')
                    : t('restoreModal.titleTenant', { name: job.tenantName ?? job.tenantSlug ?? '' })
            }
            onClose={onClose}
        >
            <form className={styles.form} onSubmit={submit}>
                {!preview && !loadError && <div className={styles.loadingState}>{t('restoreModal.validating')}</div>}
                {loadError && <div className={styles.errorMessage}>{loadError}</div>}
                {preview && (
                    <>
                        {/* Alcance, antes que todo lo demás: una restauración de plataforma se ve distinta */}
                        <div
                            className={preview.scope === 'PLATFORM' ? styles.restoreScopePlatform : styles.restoreScopeTenant}
                            data-restore-scope={preview.scope}
                        >
                            {preview.scope === 'PLATFORM' ? <Globe2 size={20} aria-hidden /> : <Store size={20} aria-hidden />}
                            <div>
                                <strong>
                                    {preview.scope === 'PLATFORM'
                                        ? t('restoreModal.scopePlatformTitle')
                                        : t('restoreModal.scopeTenantTitle', { name: preview.tenant?.name ?? '' })}
                                </strong>
                                <p>
                                    {preview.scope === 'PLATFORM'
                                        ? t('restoreModal.scopePlatformText', { count: preview.tenants?.length ?? 0 })
                                        : t('restoreModal.scopeTenantText')}
                                </p>
                            </div>
                        </div>
                        <div className={styles.cellMain}>
                            <span className={styles.statLabel}>{t('restoreModal.affected')}</span>
                            <span className={styles.cellTitle}>
                                {preview.scope === 'TENANT' ? `${preview.tenant?.name} (${preview.tenant?.slug})` : t('restoreModal.platformScope')}
                            </span>
                        </div>
                        <div className={styles.cellMain}>
                            <span className={styles.statLabel}>{t('restoreModal.backupDate')}</span>
                            <span className={styles.cellTitle}>
                                {new Date(preview.backupCreatedAt).toLocaleString(locale, { dateStyle: 'long', timeStyle: 'short' })}
                            </span>
                            <span className={styles.cellSub}>{t('restoreModal.appVersion', { version: preview.appVersion })}</span>
                        </div>

                        {preview.scope === 'PLATFORM' && (
                            <div className={styles.cellMain}>
                                <span className={styles.statLabel}>{t('restoreModal.tenantsInBackup')}</span>
                                <ul>
                                    {preview.tenants?.map((tenant) => (
                                        <li key={tenant.id}>
                                            {tenant.name} ({tenant.slug}) — {t('rows', { count: tenant.rows })}
                                            {!tenant.existsNow && ` · ${t('restoreModal.willBeCreated')}`}
                                        </li>
                                    ))}
                                </ul>
                                {!!preview.preservedTenants?.length && (
                                    <span className={styles.cellSub}>
                                        {t('restoreModal.preservedTenants', { names: preview.preservedTenants.map((x) => x.name).join(', ') })}
                                    </span>
                                )}
                            </div>
                        )}

                        <div className={styles.cellMain}>
                            <span className={styles.statLabel}>{t('restoreModal.included')}</span>
                            <ul>{preview.included.map((c) => <li key={c.id}>{componentLabel(c)}</li>)}</ul>
                        </div>
                        <div className={styles.cellMain}>
                            <span className={styles.statLabel}>{t('restoreModal.excluded')}</span>
                            <ul>{preview.excluded.map((c, i) => <li key={`${c.id}-${i}`}>{componentLabel(c)}</li>)}</ul>
                        </div>

                        {preview.scope === 'TENANT' && !!preview.tables?.length && (
                            <details>
                                <summary>{t('restoreModal.tables')}</summary>
                                <table className={styles.table}>
                                    <thead>
                                        <tr>
                                            <th>{t('restoreModal.table')}</th>
                                            <th className={styles.numeric}>{t('restoreModal.inBackup')}</th>
                                            <th className={styles.numeric}>{t('restoreModal.current')}</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {preview.tables.map((row) => (
                                            <tr key={row.name}>
                                                <td className={styles.cellSub}>{row.name}</td>
                                                <td className={styles.numeric}>{row.backupRows}</td>
                                                <td className={styles.numeric}>{row.currentRows ?? '—'}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </details>
                        )}

                        {!preview.compatible && (
                            <div className={styles.errorMessage}>
                                {t('restoreModal.incompatible')}
                                <ul>
                                    {preview.problems.map((p, i) => (
                                        <li key={i} title={p.detail || undefined}>{errorLabel(p.code)}</li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        <div className={styles.errorMessage}>
                            <AlertTriangle size={16} aria-hidden />{' '}
                            {preview.scope === 'TENANT' ? t('restoreModal.replaceWarningTenant') : t('restoreModal.replaceWarningPlatform')}
                        </div>
                        <p className={styles.confirmNote}>{t('restoreModal.credentialsNote')}</p>
                        <p className={styles.confirmNote}>{t('restoreModal.externalNote')}</p>

                        {preview.compatible && (
                            <>
                                <label className={styles.inlineCheckbox}>
                                    <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />
                                    <span>{t('restoreModal.acknowledge')}</span>
                                </label>
                                <label className={styles.field}>
                                    <span>{t('restoreModal.typeToConfirm', { phrase: preview.confirmationPhrase })}</span>
                                    <input
                                        className={styles.input}
                                        value={confirmation}
                                        onChange={(e) => setConfirmation(e.target.value)}
                                        autoComplete="off"
                                        spellCheck={false}
                                    />
                                </label>
                            </>
                        )}
                        {submitError && <div className={styles.errorMessage}>{submitError}</div>}
                    </>
                )}
                <div className={styles.modalFooter}>
                    <button type="button" className={styles.buttonSecondary} onClick={onClose}>
                        {t('restoreModal.cancel')}
                    </button>
                    <button type="submit" className={styles.buttonDanger} disabled={!canSubmit}>
                        <ArchiveRestore size={16} />
                        {submitting ? t('restoreModal.starting') : t('restoreModal.confirm')}
                    </button>
                </div>
            </form>
        </AdminModal>
    );
}

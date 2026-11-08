'use client';

import React, { ChangeEvent, useRef, useState } from 'react';
import { DatabaseBackup, RefreshCw, Upload } from 'lucide-react';
import { useTranslations } from 'next-intl';
import styles from '@/components/modules/admin/admin-table.module.scss';
import type { BackupApi, BackupJob } from '@/types/backup.types';
import BackupJobsTable from './BackupJobsTable';
import RestoreBackupModal from './RestoreBackupModal';
import { backupErrorText, saveBlob, useBackupJobs } from './useBackupJobs';

export interface BackupCreateAction {
    key: string;
    label: string;
    disabled?: boolean;
    run: () => Promise<BackupJob>;
}

interface Props {
    api: BackupApi;
    createActions: BackupCreateAction[];
    showStore?: boolean;
    // Controles extra junto a los botones de crear (p. ej. el selector de tienda del panel de plataforma)
    extraControls?: React.ReactNode;
    // Filtro del historial (solo afecta lo que se muestra; el sondeo y las reglas usan la lista completa)
    filterControls?: React.ReactNode;
    jobFilter?: (job: BackupJob) => boolean;
}

export default function BackupsPanel({ api, createActions, showStore = false, extraControls, filterControls, jobFilter }: Props) {
    const t = useTranslations('Backups');
    const { jobs, config, isLoading, error, setError, reload, hasActive } = useBackupJobs(api, t('loadFailed'));
    const [notice, setNotice] = useState<string | null>(null);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [creating, setCreating] = useState<string | null>(null);
    const [uploading, setUploading] = useState(false);
    const [restoring, setRestoring] = useState<BackupJob | null>(null);
    const fileInput = useRef<HTMLInputElement>(null);

    // Sin clave configurada en el servidor no se ofrece ninguna acción que no podría funcionar
    const available = config?.available ?? false;

    const create = async (action: BackupCreateAction) => {
        setCreating(action.key);
        setError(null);
        setNotice(null);
        try {
            await action.run();
            setNotice(t('created'));
            await reload();
        } catch (err) {
            setError(backupErrorText(err, t('actionFailed')));
        } finally {
            setCreating(null);
        }
    };

    const download = async (job: BackupJob) => {
        setBusyId(job.id);
        setError(null);
        try {
            const { blob, fileName } = await api.download(job);
            saveBlob(blob, fileName);
        } catch (err) {
            setError(backupErrorText(err, t('actionFailed')));
        } finally {
            setBusyId(null);
        }
    };

    const remove = async (job: BackupJob) => {
        if (!window.confirm(t('confirmDelete'))) return;
        setBusyId(job.id);
        setError(null);
        setNotice(null);
        try {
            await api.remove(job.id);
            setNotice(t('deleted'));
            await reload();
        } catch (err) {
            setError(backupErrorText(err, t('actionFailed')));
        } finally {
            setBusyId(null);
        }
    };

    const upload = async (e: ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        if (config && file.size > config.maxBytes) {
            setError(t('fileTooLarge'));
            return;
        }
        setUploading(true);
        setError(null);
        setNotice(null);
        try {
            await api.upload(file);
            setNotice(t('uploaded'));
            await reload();
        } catch (err) {
            setError(backupErrorText(err, t('actionFailed')));
        } finally {
            setUploading(false);
        }
    };

    return (
        <div className={styles.form}>
            {config && !available && <div className={styles.errorMessage}>{t('notConfigured')}</div>}
            {error && <div className={styles.errorMessage}>{error}</div>}
            {notice && <div className={styles.successMessage}>{notice}</div>}

            <div className={styles.toolbar}>
                {extraControls}
                {createActions.map((action) => (
                    <button
                        key={action.key}
                        type="button"
                        className={styles.button}
                        disabled={!available || hasActive || creating !== null || action.disabled}
                        onClick={() => create(action)}
                    >
                        <DatabaseBackup size={16} />
                        {creating === action.key ? t('creating') : action.label}
                    </button>
                ))}
                <button type="button" className={styles.buttonSecondary} disabled={!available || uploading} onClick={() => fileInput.current?.click()}>
                    <Upload size={16} />
                    {uploading ? t('uploading') : t('upload')}
                </button>
                <input ref={fileInput} type="file" accept=".sfbk,application/octet-stream" hidden onChange={upload} />
                <button type="button" className={styles.buttonSecondary} onClick={() => reload()} disabled={isLoading}>
                    <RefreshCw size={16} />
                    {t('refresh')}
                </button>
            </div>
            <p className={styles.cellSub}>{t('uploadHint')}</p>
            {hasActive && <p className={styles.cellSub}>{t('activeHint')}</p>}

            {filterControls && (
                <div className={styles.toolbar}>
                    {filterControls}
                    {jobFilter && !isLoading && (
                        <span className={styles.cellSub} aria-live="polite">
                            {t('filter.count', { shown: jobs.filter(jobFilter).length, total: jobs.length })}
                        </span>
                    )}
                </div>
            )}

            <div className={styles.tableCard}>
                {isLoading ? (
                    <div className={styles.loadingState}>{t('loading')}</div>
                ) : (
                    <BackupJobsTable
                        jobs={jobFilter ? jobs.filter(jobFilter) : jobs}
                        emptyText={jobFilter && jobs.length > 0 ? t('filter.noResults') : undefined}
                        showStore={showStore}
                        canAct={available && !hasActive}
                        busyId={busyId}
                        onDownload={download}
                        onRestore={setRestoring}
                        onDelete={remove}
                    />
                )}
            </div>
            <p className={styles.cellSub}>{t('keyNote')}</p>

            {restoring && (
                <RestoreBackupModal
                    api={api}
                    job={restoring}
                    onClose={() => setRestoring(null)}
                    onStarted={async () => {
                        setRestoring(null);
                        setNotice(t('restoreStarted'));
                        await reload();
                    }}
                />
            )}
        </div>
    );
}

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { getApiErrorMessage } from '@/service/api/error.utils';
import { ACTIVE_BACKUP_STATUSES, type BackupApi, type BackupConfig, type BackupJob } from '@/types/backup.types';

// Mientras haya una operación en curso se reconsulta el estado: la operación corre en el servidor y la
// pantalla nunca queda bloqueada esperándola.
const POLL_MS = 2500;

export function backupErrorText(error: unknown, fallback: string): string {
    if (axios.isAxiosError(error)) return getApiErrorMessage(error, fallback);
    return error instanceof Error && error.message ? error.message : fallback;
}

export function useBackupJobs(api: BackupApi | null, loadFailed: string) {
    const [jobs, setJobs] = useState<BackupJob[]>([]);
    const [config, setConfig] = useState<BackupConfig | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const load = useCallback(async () => {
        if (!api) return;
        try {
            const [cfg, list] = await Promise.all([api.config(), api.list()]);
            setConfig(cfg);
            setJobs(list);
            setError(null);
        } catch (err) {
            setError(backupErrorText(err, loadFailed));
        } finally {
            setIsLoading(false);
        }
    }, [api, loadFailed]);

    // Primera carga en un callback (no setState síncrono dentro del efecto)
    useEffect(() => {
        const first = setTimeout(load, 0);
        return () => clearTimeout(first);
    }, [load]);

    const hasActive = jobs.some((job) => ACTIVE_BACKUP_STATUSES.includes(job.status));
    useEffect(() => {
        if (!hasActive) return;
        timer.current = setTimeout(load, POLL_MS);
        return () => {
            if (timer.current) clearTimeout(timer.current);
        };
    }, [hasActive, jobs, load]);

    return { jobs, config, isLoading, error, setError, reload: load, hasActive };
}

export function saveBlob(blob: Blob, fileName: string) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function formatBytes(bytes: number | null, locale: string): string {
    if (bytes === null) return '—';
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit += 1;
    }
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: unit === 0 ? 0 : 1 }).format(value)} ${units[unit]}`;
}

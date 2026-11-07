'use client';

import React, { useState } from 'react';
import { AlertTriangle, CloudOff, LogIn, RefreshCw } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import styles from './admin-offline.module.scss';
import { useAdminOfflineState } from '@/hooks/useAdminOffline';
import { removeAdminChange, resolveAdminConflict, type AdminChange } from '@/utils/adminOfflineStore';
import { requeueAdminChanges, syncAdminChanges } from '@/utils/adminOfflineSync';

const FIELD_KEYS = new Set(['name', 'description', 'categoryId', 'sku', 'price', 'sizes', 'imageUrl', 'isActive', 'branchId', 'collectionIds', 'translations', 'slug', 'bannerImageUrl', 'status']);

const show = (value: unknown): string => {
    if (value === null || value === undefined || value === '') return '—';
    if (typeof value === 'boolean') return value ? '✓' : '✗';
    if (Array.isArray(value)) return value.join(', ') || '—';
    if (typeof value === 'object') return JSON.stringify(value);
    const text = String(value);
    return text.startsWith('data:') ? '[imagen]' : text.length > 60 ? `${text.slice(0, 57)}…` : text;
};

/**
 * Barra del panel: avisa si no hay conexión (y desde cuándo son los datos mostrados), cuenta los cambios
 * hechos sin conexión y permite revisarlos: reintentar, descartar o resolver un conflicto con otro dispositivo.
 */
export default function AdminOfflineBar() {
    const t = useTranslations('AdminOffline');
    const format = useFormatter();
    const { changes, syncingId, isOnline, copyAt } = useAdminOfflineState();
    const [open, setOpen] = useState(false);

    const blocked = changes.filter((c) => c.status !== 'pending').length;
    if (isOnline && changes.length === 0) return null;

    const fieldName = (field: string) => (FIELD_KEYS.has(field) ? t(`fields.${field}` as Parameters<typeof t>[0]) : field);
    const entityName = (c: AdminChange) => t(`entities.${c.entity}`);

    return (
        <div className={styles.bar} role="status" data-testid="admin-offline-bar">
            <div className={styles.summary}>
                {!isOnline && (
                    <span className={styles.offline}>
                        <CloudOff size={16} />
                        {t('offline')}
                        {copyAt ? ` ${t('copyFrom', { date: format.dateTime(new Date(copyAt), { dateStyle: 'medium', timeStyle: 'short' }) })}` : ''}
                    </span>
                )}
                {changes.length > 0 && (
                    <span className={blocked ? styles.attention : undefined} data-testid="admin-pending-count">
                        {syncingId ? <RefreshCw size={16} className={styles.spin} /> : null}
                        {t('pending', { count: changes.length })}
                        {blocked > 0 ? ` · ${t('needsReview', { count: blocked })}` : ''}
                    </span>
                )}
                <span className={styles.actions}>
                    {changes.length > 0 && (
                        <button type="button" onClick={() => setOpen((v) => !v)}>
                            {open ? t('hide') : t('review')}
                        </button>
                    )}
                    {isOnline && changes.some((c) => c.status === 'pending') && (
                        <button type="button" onClick={() => void syncAdminChanges()}>
                            {t('syncNow')}
                        </button>
                    )}
                </span>
            </div>

            {open && (
                <ul className={styles.list} data-testid="admin-changes-list">
                    {changes.map((c) => (
                        <li key={c.changeId} className={styles.item} data-status={c.status} data-entity={c.entity}>
                            <div className={styles.itemHead}>
                                <strong>
                                    {entityName(c)} · {c.label || c.entityId.slice(0, 8)}
                                </strong>
                                <span className={styles.badge}>
                                    {c.changeId === syncingId ? t('status.syncing') : t(`status.${c.status}`)}
                                </span>
                            </div>
                            <p className={styles.fields}>
                                {c.op === 'create' ? t('created') : Object.keys(c.changes).map(fieldName).join(', ')}
                            </p>

                            {c.status === 'conflict' && c.conflict && (
                                <>
                                    <p className={styles.hint}>
                                        <AlertTriangle size={14} /> {t('conflictDescription')}
                                    </p>
                                    <table className={styles.table}>
                                        <thead>
                                            <tr>
                                                <th>{t('field')}</th>
                                                <th>{t('yourChange')}</th>
                                                <th>{t('serverValue')}</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {c.conflict.fields.map((f) => (
                                                <tr key={f} data-field={f}>
                                                    <td>{fieldName(f)}</td>
                                                    <td>{show(c.changes[f])}</td>
                                                    <td>{show(c.conflict!.current[f])}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                    <div className={styles.itemActions}>
                                        <button type="button" onClick={async () => { await resolveAdminConflict(c.changeId, 'mine'); void syncAdminChanges(); }}>
                                            {t('keepMine')}
                                        </button>
                                        <button type="button" onClick={async () => { await resolveAdminConflict(c.changeId, 'server'); void syncAdminChanges(); }}>
                                            {t('keepServer')}
                                        </button>
                                    </div>
                                </>
                            )}

                            {c.status === 'error' && <p className={styles.error}>{c.lastError}</p>}
                            {c.status === 'needs-login' && (
                                <p className={styles.hint}>
                                    <LogIn size={14} /> {t('needsLogin')}{' '}
                                    {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
                                    <a href="/auth/login?redirect=/admin">{t('signIn')}</a>
                                </p>
                            )}

                            {c.status !== 'conflict' && (
                                <div className={styles.itemActions}>
                                    {(c.status === 'error' || c.status === 'needs-login') && (
                                        <button type="button" disabled={!isOnline} onClick={async () => { await requeueAdminChanges([c.status as 'error' | 'needs-login']); void syncAdminChanges(); }}>
                                            {t('retry')}
                                        </button>
                                    )}
                                    <button type="button" className={styles.danger} onClick={() => void removeAdminChange(c.changeId)}>
                                        {t('discard')}
                                    </button>
                                </div>
                            )}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

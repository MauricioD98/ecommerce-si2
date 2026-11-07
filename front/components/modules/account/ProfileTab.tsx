'use client';

import React, { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, CloudOff, Info, LogIn, RefreshCw } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import styles from './account.module.scss';
import { useAuth } from '@/hooks/useAuth';
import { useAppDispatch } from '@/store';
import { setUser } from '@/store/slices/authSlices';
import { authService } from '@/service/api/auth.service';
import { BranchService } from '@/service/api/branch.service';
import { useOfflineProfile } from '@/hooks/useProfileSync';
import {
    PROFILE_FIELDS,
    applyPendingValues,
    discardPendingProfileChange,
    dropOtherProfileSnapshots,
    profileValuesOf,
    recordProfileEdit,
    resolveProfileConflict,
    saveProfileSnapshot,
    type ProfileField,
    type ProfileSnapshot,
    type ProfileValues,
} from '@/utils/offlineProfile';
import { requeuePendingProfile, syncPendingProfile } from '@/utils/profileSync';

const PHONE_REGEX = /^\+?[\d\s-]{7,20}$/;

type FormState = Record<ProfileField, string>;
const toForm = (values: ProfileValues): FormState => ({
    firstName: values.firstName ?? '',
    lastName: values.lastName ?? '',
    phone: values.phone ?? '',
    preferredBranchId: values.preferredBranchId ?? '',
});

/**
 * Pestaña 1: datos personales y sucursal favorita.
 *
 * Funciona igual con o sin conexión: guardar registra el cambio en IndexedDB y, si hay red, lo envía en el
 * acto. Sin red queda pendiente y se envía solo al volver (useProfileSyncRunner). El servidor solo lo aplica
 * si el dato no cambió en otro dispositivo; si cambió, se muestra el conflicto para decidir.
 *
 * `offlineOnly`: se monta desde el fallback /offline del service worker. No sale a la red.
 */
export default function ProfileTab({ offlineOnly = false }: { offlineOnly?: boolean }) {
    const { user } = useAuth();
    const dispatch = useAppDispatch();
    const t = useTranslations('Account.profile');
    const ts = useTranslations('Account.profile.sync');
    const format = useFormatter();
    const userId = user?.id ?? null;
    const { loaded, snapshot, pending, view, isOnline, reload } = useOfflineProfile(userId);

    const [form, setForm] = useState<FormState>({ firstName: '', lastName: '', phone: '', preferredBranchId: '' });
    const [dirty, setDirty] = useState(false);
    const [onlineBranches, setOnlineBranches] = useState<ProfileSnapshot['branches'] | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<'saved' | 'savedLocally' | null>(null);

    // Con red: perfil fresco del servidor → copia local. Es lo que después se muestra sin conexión
    const fetchedFor = useRef<string | null>(null);
    useEffect(() => {
        if (offlineOnly || !userId || !isOnline || fetchedFor.current === userId) return;
        fetchedFor.current = userId;
        let active = true;
        (async () => {
            const [profile, branches] = await Promise.all([
                authService.getProfile().catch(() => null),
                BranchService.getActiveBranches().catch(() => null),
            ]);
            if (!active) return;
            if (branches) setOnlineBranches(branches);
            else setError(t('branchesFailed'));
            if (profile && profile.id === userId) {
                dispatch(setUser({ ...user, ...profile }));
                await saveProfileSnapshot(profile, branches ?? undefined);
                // Si en este dispositivo quedó la copia de otra cuenta, se borra
                await dropOtherProfileSnapshots(userId);
            }
            void syncPendingProfile();
        })();
        return () => {
            active = false;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [userId, isOnline, offlineOnly]);

    // Última versión conocida del servidor: la copia local; sin copia todavía, lo que trajo el login
    const serverValues = useMemo<ProfileValues>(
        () => snapshot?.values ?? profileValuesOf(user ?? {}),
        [snapshot, user],
    );
    const branches = onlineBranches ?? (snapshot?.branches?.length ? snapshot.branches : []);

    // Sin copia de sucursales (p. ej. nunca se abrió "Mi cuenta" con conexión): son datos públicos de la tienda
    // y el service worker los sirve desde su caché pública aunque no haya red
    useEffect(() => {
        if (!loaded || onlineBranches || snapshot?.branches?.length) return;
        let active = true;
        BranchService.getActiveBranches()
            .then((data) => active && setOnlineBranches(data))
            .catch(() => undefined);
        return () => {
            active = false;
        };
    }, [loaded, onlineBranches, snapshot]);

    // El formulario sigue al servidor + pendientes mientras el usuario no esté escribiendo
    useEffect(() => {
        if (!loaded || dirty) return;
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setForm(toForm(applyPendingValues(serverValues, pending)));
    }, [loaded, dirty, serverValues, pending]);

    const phoneInvalid = form.phone.trim().length > 0 && !PHONE_REGEX.test(form.phone.trim());
    const inConflict = view === 'conflict';
    const canSubmit = loaded && form.firstName.trim().length > 0 && !phoneInvalid && !isSaving && !inConflict;

    const update = (field: ProfileField, value: string) => {
        setForm((prev) => ({ ...prev, [field]: value }));
        setDirty(true);
        setNotice(null);
    };

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        if (!canSubmit || !userId) return;
        setIsSaving(true);
        setError(null);
        setNotice(null);
        try {
            const change = await recordProfileEdit(userId, serverValues, {
                firstName: form.firstName,
                lastName: form.lastName,
                phone: form.phone,
                preferredBranchId: form.preferredBranchId || null,
            });
            setDirty(false);
            if (!change) {
                setNotice('saved');
                return;
            }
            if (!navigator.onLine) {
                setNotice('savedLocally');
                return;
            }
            const outcome = await syncPendingProfile();
            if (outcome === 'synced') setNotice('saved');
            else if (outcome === 'pending' || outcome === 'skipped') setNotice('savedLocally');
        } catch {
            // IndexedDB no disponible o lleno: no se afirma nada guardado
            setError(t('saveFailed'));
        } finally {
            setIsSaving(false);
            await reload();
        }
    };

    const resolve = async (choice: 'mine' | 'server') => {
        if (!userId) return;
        await resolveProfileConflict(userId, choice);
        setDirty(false);
        await reload();
        if (navigator.onLine) await syncPendingProfile();
    };

    const discard = async () => {
        if (!userId) return;
        await discardPendingProfileChange(userId);
        setDirty(false);
        await reload();
    };

    const retry = async () => {
        if (!userId) return;
        await requeuePendingProfile(userId, ['error', 'needs-login']);
        await syncPendingProfile();
    };

    const branchName = (id: string | null) =>
        id ? branches.find((b) => b.id === id)?.name ?? id : t('noPreferredBranch');
    const display = (field: ProfileField, value: string | null) =>
        field === 'preferredBranchId' ? branchName(value) : value || ts('emptyValue');

    const savedAt = snapshot ? format.dateTime(new Date(snapshot.savedAt), { dateStyle: 'medium', timeStyle: 'short' }) : null;

    return (
        <div className={styles.card}>
            <h1 className={styles.heading}>{t('title')}</h1>
            <p className={styles.subheading}>{t('subtitle')}</p>

            <div className={styles.syncStatus} role="status" aria-live="polite" data-sync-state={view}>
                {view === 'offline' && (
                    <div className={styles.alertInfo}>
                        <CloudOff size={18} />
                        <span>
                            {pending ? ts('offlinePending') : ts('offline')}
                            {savedAt ? ` ${ts('copyFrom', { date: savedAt })}` : ''}
                        </span>
                    </div>
                )}
                {view === 'pending' && (
                    <div className={styles.alertInfo}>
                        <RefreshCw size={18} />
                        <span>{ts('pending')}</span>
                    </div>
                )}
                {view === 'syncing' && (
                    <div className={styles.alertInfo}>
                        <RefreshCw size={18} className={styles.spin} />
                        <span>{ts('syncing')}</span>
                    </div>
                )}
                {view === 'synced' && !dirty && (
                    <div className={styles.alertSuccess}>
                        <Check size={18} />
                        <span>{ts('synced')}</span>
                    </div>
                )}
                {view === 'needs-login' && (
                    <div className={styles.alertWarning}>
                        <LogIn size={18} />
                        <span>{ts('needsLogin')}</span>
                        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
                        <a className={styles.linkButton} href="/auth/login?redirect=/account">{ts('signIn')}</a>
                    </div>
                )}
                {view === 'error' && pending && (
                    <div className={styles.alertError}>
                        <Info size={18} />
                        <span>{ts('error', { reason: pending.lastError ?? '' })}</span>
                        <button type="button" className={styles.linkButton} onClick={retry} disabled={!isOnline}>{ts('retry')}</button>
                        <button type="button" className={`${styles.linkButton} ${styles.linkDanger}`} onClick={discard}>{ts('discard')}</button>
                    </div>
                )}
            </div>

            {inConflict && pending?.conflict && (
                <div className={styles.conflict} role="alert">
                    <p className={styles.conflictTitle}>
                        <AlertTriangle size={18} /> {ts('conflictTitle')}
                    </p>
                    <p className={styles.hint}>{ts('conflictDescription')}</p>
                    <table className={styles.conflictTable}>
                        <thead>
                            <tr>
                                <th>{ts('field')}</th>
                                <th>{ts('yourChange')}</th>
                                <th>{ts('serverValue')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {PROFILE_FIELDS.filter((f) => pending.conflict!.fields.includes(f)).map((field) => (
                                <tr key={field} data-field={field}>
                                    <td>{t(field === 'preferredBranchId' ? 'preferredBranch' : field)}</td>
                                    <td>{display(field, pending.changes[field] ?? null)}</td>
                                    <td>{display(field, pending.conflict!.server[field])}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    <div className={styles.buttonRow}>
                        <button type="button" className={styles.primaryButton} onClick={() => resolve('mine')}>{ts('keepMine')}</button>
                        <button type="button" className={styles.secondaryButton} onClick={() => resolve('server')}>{ts('keepServer')}</button>
                    </div>
                </div>
            )}

            <form className={styles.form} onSubmit={handleSubmit} noValidate>
                {error && (
                    <div className={styles.alertError} role="alert">
                        <Info size={18} />
                        <span>{error}</span>
                    </div>
                )}
                {notice && (
                    <div className={notice === 'saved' ? styles.alertSuccess : styles.alertInfo} role="status">
                        {notice === 'saved' ? <Check size={18} /> : <CloudOff size={18} />}
                        <span>{notice === 'saved' ? t('saved') : ts('savedLocally')}</span>
                    </div>
                )}

                <fieldset className={styles.fieldset} disabled={inConflict || !loaded}>
                    <div className={styles.row}>
                        <div className={styles.field}>
                            <label htmlFor="firstName">{t('firstName')}</label>
                            <input id="firstName" type="text" value={form.firstName} maxLength={60} required autoComplete="given-name" onChange={(e) => update('firstName', e.target.value)} />
                        </div>
                        <div className={styles.field}>
                            <label htmlFor="lastName">{t('lastName')}</label>
                            <input id="lastName" type="text" value={form.lastName} maxLength={60} autoComplete="family-name" onChange={(e) => update('lastName', e.target.value)} />
                        </div>
                    </div>

                    <div className={styles.field}>
                        <label htmlFor="email">{t('email')}</label>
                        <input id="email" type="email" value={snapshot?.email ?? user?.email ?? ''} disabled readOnly />
                        <span className={styles.hint}>{t('emailHint')}</span>
                    </div>

                    <div className={styles.field}>
                        <label htmlFor="phone">{t('phone')}</label>
                        <input id="phone" type="tel" value={form.phone} maxLength={20} placeholder="+591 70000000" autoComplete="tel" aria-invalid={phoneInvalid} onChange={(e) => update('phone', e.target.value)} />
                        {phoneInvalid && <span className={styles.fieldError}>{t('phoneInvalid')}</span>}
                    </div>

                    <div className={styles.field}>
                        <label htmlFor="preferredBranch">{t('preferredBranch')}</label>
                        <select id="preferredBranch" value={form.preferredBranchId} onChange={(e) => update('preferredBranchId', e.target.value)}>
                            <option value="">{t('noPreferredBranch')}</option>
                            {/* Si la sucursal guardada ya no está en la lista, se sigue mostrando en vez de perderla */}
                            {form.preferredBranchId && !branches.some((b) => b.id === form.preferredBranchId) && (
                                <option value={form.preferredBranchId}>{form.preferredBranchId}</option>
                            )}
                            {branches.map((branch) => (
                                <option key={branch.id} value={branch.id}>
                                    {branch.name}
                                    {branch.address ? ` — ${branch.address}` : ''}
                                </option>
                            ))}
                        </select>
                        <span className={styles.hint}>{t('preferredBranchHint')}</span>
                    </div>
                </fieldset>

                {!isOnline && <p className={styles.hint}>{ts('offlineFields')}</p>}

                <button type="submit" className={styles.primaryButton} disabled={!canSubmit}>
                    {isSaving ? t('saving') : isOnline ? t('save') : ts('saveOffline')}
                </button>
            </form>
        </div>
    );
}

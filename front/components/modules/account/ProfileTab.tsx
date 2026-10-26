'use client';

import React, { FormEvent, useEffect, useRef, useState } from 'react';
import { Check, Info } from 'lucide-react';
import { useTranslations } from 'next-intl';
import styles from './account.module.scss';
import { useAuth } from '@/hooks/useAuth';
import { authService } from '@/service/api/auth.service';
import { BranchService } from '@/service/api/branch.service';
import { getApiErrorMessage } from '@/service/api/error.utils';
import { Branch } from '@/types/branch.types';

const PHONE_REGEX = /^\+?[\d\s-]{7,20}$/;

// Pestaña 1: datos personales y sucursal favorita (la que se usa para sus notificaciones)
export default function ProfileTab() {
    const { user, refreshProfile } = useAuth();
    const t = useTranslations('Account.profile');

    const [firstName, setFirstName] = useState('');
    const [lastName, setLastName] = useState('');
    const [phone, setPhone] = useState('');
    const [preferredBranchId, setPreferredBranchId] = useState('');
    const [branches, setBranches] = useState<Branch[]>([]);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [saved, setSaved] = useState(false);

    // El formulario se llena una sola vez con el perfil; no se pisa lo que el usuario esté escribiendo
    const initialized = useRef(false);
    useEffect(() => {
        if (!user || initialized.current) return;
        initialized.current = true;
        setFirstName(user.firstName ?? '');
        setLastName(user.lastName ?? '');
        setPhone(user.phone ?? '');
        setPreferredBranchId(user.preferredBranchId ?? '');
    }, [user]);

    useEffect(() => {
        let active = true;
        BranchService.getActiveBranches()
            .then((data) => active && setBranches(data))
            .catch(() => active && setError(t('branchesFailed')));
        return () => {
            active = false;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const phoneInvalid = phone.trim().length > 0 && !PHONE_REGEX.test(phone.trim());
    const canSubmit = firstName.trim().length > 0 && !phoneInvalid && !isSaving;

    const markDirty = () => setSaved(false);

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        if (!canSubmit) return;

        setIsSaving(true);
        setError(null);
        setSaved(false);
        try {
            await authService.updateProfile({
                firstName: firstName.trim(),
                lastName: lastName.trim(),
                // Vacío = el backend lo guarda como null
                phone: phone.trim(),
                preferredBranchId: preferredBranchId || null,
            });
            await refreshProfile();
            setSaved(true);
        } catch (err) {
            setError(getApiErrorMessage(err, t('saveFailed')));
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className={styles.card}>
            <h1 className={styles.heading}>{t('title')}</h1>
            <p className={styles.subheading}>{t('subtitle')}</p>

            <form className={styles.form} onSubmit={handleSubmit} noValidate>
                {error && (
                    <div className={styles.alertError} role="alert">
                        <Info size={18} />
                        <span>{error}</span>
                    </div>
                )}
                {saved && (
                    <div className={styles.alertSuccess} role="status">
                        <Check size={18} />
                        <span>{t('saved')}</span>
                    </div>
                )}

                <div className={styles.row}>
                    <div className={styles.field}>
                        <label htmlFor="firstName">{t('firstName')}</label>
                        <input id="firstName" type="text" value={firstName} maxLength={60} required autoComplete="given-name" onChange={(e) => { setFirstName(e.target.value); markDirty(); }} />
                    </div>
                    <div className={styles.field}>
                        <label htmlFor="lastName">{t('lastName')}</label>
                        <input id="lastName" type="text" value={lastName} maxLength={60} autoComplete="family-name" onChange={(e) => { setLastName(e.target.value); markDirty(); }} />
                    </div>
                </div>

                <div className={styles.field}>
                    <label htmlFor="email">{t('email')}</label>
                    <input id="email" type="email" value={user?.email ?? ''} disabled readOnly />
                    <span className={styles.hint}>{t('emailHint')}</span>
                </div>

                <div className={styles.field}>
                    <label htmlFor="phone">{t('phone')}</label>
                    <input id="phone" type="tel" value={phone} maxLength={20} placeholder="+591 70000000" autoComplete="tel" aria-invalid={phoneInvalid} onChange={(e) => { setPhone(e.target.value); markDirty(); }} />
                    {phoneInvalid && <span className={styles.fieldError}>{t('phoneInvalid')}</span>}
                </div>

                <div className={styles.field}>
                    <label htmlFor="preferredBranch">{t('preferredBranch')}</label>
                    <select id="preferredBranch" value={preferredBranchId} onChange={(e) => { setPreferredBranchId(e.target.value); markDirty(); }}>
                        <option value="">{t('noPreferredBranch')}</option>
                        {branches.map((branch) => (
                            <option key={branch.id} value={branch.id}>
                                {branch.name}
                                {branch.address ? ` — ${branch.address}` : ''}
                            </option>
                        ))}
                    </select>
                    <span className={styles.hint}>{t('preferredBranchHint')}</span>
                </div>

                <button type="submit" className={styles.primaryButton} disabled={!canSubmit}>
                    {isSaving ? t('saving') : t('save')}
                </button>
            </form>
        </div>
    );
}

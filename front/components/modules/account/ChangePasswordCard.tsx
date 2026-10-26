'use client';

import React, { FormEvent, useState } from 'react';
import { Check, Circle, Eye, EyeOff, Info } from 'lucide-react';
import styles from './account.module.scss';
import { authService } from '@/service/api/auth.service';
import { getApiErrorMessage } from '@/service/api/error.utils';
import { useTranslations } from 'next-intl';

// key: Auth.requirements.<key> en messages/<idioma>.json (mismos requisitos que el registro)
const PASSWORD_REQUIREMENTS = [
    { key: 'minLength', test: (p: string) => p.length >= 8 },
    { key: 'uppercase', test: (p: string) => /[A-Z]/.test(p) },
    { key: 'lowercase', test: (p: string) => /[a-z]/.test(p) },
    { key: 'number', test: (p: string) => /\d/.test(p) },
    { key: 'special', test: (p: string) => /[@$!%*?&]/.test(p) },
] as const;

type FieldName = 'current' | 'next' | 'confirm';

// Seguridad: cambio de contraseña desde "Mi perfil" (pide la contraseña actual)
export default function ChangePasswordCard() {
    const t = useTranslations('Account.security');
    const tAuth = useTranslations('Auth');
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [visible, setVisible] = useState<Record<FieldName, boolean>>({ current: false, next: false, confirm: false });
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);

    const allRequirementsMet = PASSWORD_REQUIREMENTS.every((req) => req.test(newPassword));
    const confirmMismatch = confirmPassword.length > 0 && newPassword !== confirmPassword;
    const canSubmit =
        currentPassword.length > 0 && allRequirementsMet && confirmPassword.length > 0 && !confirmMismatch && !isSaving;

    const toggle = (field: FieldName) => setVisible((prev) => ({ ...prev, [field]: !prev[field] }));
    const clearFeedback = () => {
        setError(null);
        setSuccess(false);
    };

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        if (!canSubmit) return;

        setIsSaving(true);
        clearFeedback();
        try {
            await authService.changePassword(currentPassword, newPassword);
            // Se limpian los campos y se confirma el cambio
            setCurrentPassword('');
            setNewPassword('');
            setConfirmPassword('');
            setSuccess(true);
        } catch (err) {
            setError(getApiErrorMessage(err, t('failed')));
        } finally {
            setIsSaving(false);
        }
    };

    const renderPasswordField = (
        field: FieldName,
        id: string,
        label: string,
        value: string,
        onChange: (value: string) => void,
        autoComplete: string,
    ) => (
        <div className={styles.field}>
            <label htmlFor={id}>{label}</label>
            <div className={styles.inputWrapper}>
                <input
                    id={id}
                    type={visible[field] ? 'text' : 'password'}
                    value={value}
                    autoComplete={autoComplete}
                    aria-invalid={field === 'confirm' && confirmMismatch}
                    onChange={(e) => {
                        onChange(e.target.value);
                        clearFeedback();
                    }}
                />
                <button
                    type="button"
                    className={styles.toggleButton}
                    onClick={() => toggle(field)}
                    aria-label={visible[field] ? tAuth('hidePassword') : tAuth('showPassword')}
                >
                    {visible[field] ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
            </div>
        </div>
    );

    return (
        <div className={styles.card}>
            <h2 className={styles.heading}>{t('title')}</h2>
            <p className={styles.subheading}>{t('subtitle')}</p>

            <form className={styles.form} onSubmit={handleSubmit} noValidate>
                {error && (
                    <div className={styles.alertError} role="alert">
                        <Info size={18} />
                        <span>{error}</span>
                    </div>
                )}
                {success && (
                    <div className={styles.alertSuccess} role="status">
                        <Check size={18} />
                        <span>{t('success')}</span>
                    </div>
                )}

                {renderPasswordField('current', 'currentPassword', t('current'), currentPassword, setCurrentPassword, 'current-password')}

                <div>
                    {renderPasswordField('next', 'newPassword', t('new'), newPassword, setNewPassword, 'new-password')}
                    {newPassword.length > 0 && (
                        <ul className={styles.checklist}>
                            {PASSWORD_REQUIREMENTS.map((req) => {
                                const met = req.test(newPassword);
                                return (
                                    <li key={req.key} className={`${styles.checkItem} ${met ? styles.checkItemMet : ''}`}>
                                        {met ? <Check size={14} strokeWidth={3} /> : <Circle size={10} />}
                                        {tAuth(`requirements.${req.key}`)}
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>

                <div>
                    {renderPasswordField('confirm', 'confirmPassword', t('confirm'), confirmPassword, setConfirmPassword, 'new-password')}
                    {confirmMismatch && <span className={styles.fieldError}>{tAuth('passwordsDontMatch')}</span>}
                </div>

                <button type="submit" className={styles.primaryButton} disabled={!canSubmit}>
                    {isSaving ? t('updating') : t('update')}
                </button>
            </form>
        </div>
    );
}

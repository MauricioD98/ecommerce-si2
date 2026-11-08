'use client';

import React, { FormEvent, useState } from 'react';
import { AlertCircle, Lock, ShieldCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import styles from './platform-admin.module.scss';
import { platformAdminService, type PlatformSession } from '@/service/api/platformAdmin.service';

// Login del administrador del SaaS (POST /platform/auth/login). No es la cuenta de una tienda.
export default function PlatformLoginGate({
    initialError,
    onSignedIn,
}: {
    initialError: string | null;
    onSignedIn: (session: PlatformSession) => void;
}) {
    const t = useTranslations('PlatformAdmin');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [isSigningIn, setIsSigningIn] = useState(false);
    const [error, setError] = useState<string | null>(initialError);

    const handleLogin = async (e: FormEvent) => {
        e.preventDefault();
        if (!email.trim() || !password) return;
        setIsSigningIn(true);
        setError(null);
        try {
            const session = await platformAdminService.login(email.trim(), password);
            setPassword('');
            onSignedIn(session);
        } catch (err) {
            // La API ya responde el motivo traducido (credenciales inválidas, cuenta bloqueada…)
            setError(err instanceof Error && err.message ? err.message : t('loginFailed'));
        } finally {
            setIsSigningIn(false);
        }
    };

    return (
        <div className={styles.gate}>
            <section aria-label={t('gateTitle')} className={styles.gateIntro}>
                <div className={styles.gateBadge}>
                    <ShieldCheck size={22} aria-hidden />
                    {t('restricted')}
                </div>
                <div>
                    <h1>{t('gateTitle')}</h1>
                    <p>{t('gateText')}</p>
                </div>
                <div className={styles.gateRule} aria-hidden />
            </section>

            <main className={styles.gateMain}>
                <form className={styles.gateForm} onSubmit={handleLogin} noValidate>
                    <h2>{t('signInTitle')}</h2>
                    {error && (
                        <div role="alert" className={styles.gateError}>
                            <AlertCircle size={18} aria-hidden />
                            <span>{error}</span>
                        </div>
                    )}
                    <div>
                        <label className={styles.gateLabel} htmlFor="platform-email">
                            {t('emailLabel')}
                        </label>
                        <input
                            id="platform-email"
                            type="email"
                            className={styles.gateInput}
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder={t('emailPlaceholder')}
                            autoComplete="username"
                            autoFocus
                            required
                        />
                    </div>
                    <div>
                        <label className={styles.gateLabel} htmlFor="platform-password">
                            {t('passwordLabel')}
                        </label>
                        <div className={styles.gatePassword}>
                            <input
                                id="platform-password"
                                type={showPassword ? 'text' : 'password'}
                                className={styles.gateInput}
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                autoComplete="current-password"
                                required
                            />
                            <button
                                type="button"
                                onClick={() => setShowPassword((v) => !v)}
                                aria-pressed={showPassword}
                                aria-label={showPassword ? t('hidePasswordLabel') : t('showPasswordLabel')}
                            >
                                {showPassword ? t('hidePassword') : t('showPassword')}
                            </button>
                        </div>
                    </div>
                    <button type="submit" className={styles.gateSubmit} disabled={isSigningIn || !email.trim() || !password}>
                        {isSigningIn ? t('signingIn') : t('enter')}
                    </button>
                    <div className={styles.gateNote}>
                        <Lock size={18} aria-hidden />
                        <span>{t('loginHint')}</span>
                    </div>
                </form>
            </main>
        </div>
    );
}

'use client';

import React, { FormEvent, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import tableStyles from '@/components/modules/admin/admin-table.module.scss';
import styles from './platform-admin.module.scss';
import { PlatformApiError, platformAdminService } from '@/service/api/platformAdmin.service';
import { usePlatformAdmin } from './PlatformAdminContext';
import { SUSPENDING_SUBSCRIPTION_STATUSES } from './tenantDisplay';

export type TenantActionKind = 'suspend' | 'reactivate' | 'retry';

export interface TenantActionTarget {
    id: string;
    name: string;
    slug: string;
    subscriptionStatus: string | null;
}

// Confirmación de las acciones que cambian el estado de UNA tienda. Explica el efecto antes de
// confirmar y, para suspender, pide escribir el identificador de la tienda (evita suspender otra por
// error). Las reglas siguen en la API: PATCH /platform/tenants/:id/status solo acepta ACTIVE ⇄
// SUSPENDED y POST :id/retry solo FAILED; si la tienda cambió mientras tanto, el error de la API se
// muestra acá mismo.
export default function TenantActionDialog({
    kind,
    tenant,
    onClose,
    onDone,
}: {
    kind: TenantActionKind;
    tenant: TenantActionTarget;
    onClose: () => void;
    onDone: (message: string) => void;
}) {
    const t = useTranslations('PlatformAdmin');
    const tSub = useTranslations('AdminSubscription');
    const { token, reportError } = usePlatformAdmin();
    const [typed, setTyped] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const firstField = useRef<HTMLInputElement | HTMLButtonElement | null>(null);

    useEffect(() => {
        firstField.current?.focus();
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && !busy) onClose();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [busy, onClose]);

    const needsTyping = kind === 'suspend';
    const canConfirm = !busy && (!needsTyping || typed.trim() === tenant.slug);
    const effects = t.raw(`tenants.actions.${kind}.effects`) as string[];
    const billingWarning =
        kind === 'reactivate' && tenant.subscriptionStatus && SUSPENDING_SUBSCRIPTION_STATUSES.has(tenant.subscriptionStatus)
            ? t('tenants.actions.reactivate.billingWarning', { status: tSub(`statuses.${tenant.subscriptionStatus as 'canceled'}`) })
            : null;

    const confirm = async (e: FormEvent) => {
        e.preventDefault();
        if (!canConfirm) return;
        setBusy(true);
        setError(null);
        try {
            if (kind === 'retry') {
                await platformAdminService.retry(token, tenant.id);
                onDone(t('retried', { name: tenant.name }));
            } else {
                const status = kind === 'suspend' ? 'SUSPENDED' : 'ACTIVE';
                await platformAdminService.setStatus(token, tenant.id, status);
                onDone(kind === 'suspend' ? t('suspended', { name: tenant.name }) : t('reactivated', { name: tenant.name }));
            }
        } catch (err) {
            if (err instanceof PlatformApiError && err.status === 401) {
                reportError(err, t('actionFailed'));
                return;
            }
            setError(err instanceof Error && err.message ? err.message : t('actionFailed'));
            setBusy(false);
        }
    };

    return (
        <div className={tableStyles.overlay} onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
            <form
                className={`${tableStyles.modal} ${styles.dialog}`}
                role="dialog"
                aria-modal="true"
                aria-labelledby="tenant-action-title"
                onSubmit={confirm}
            >
                <div className={tableStyles.modalHeader}>
                    <h2 id="tenant-action-title">{t(`tenants.actions.${kind}.title`, { name: tenant.name })}</h2>
                    <button type="button" className={tableStyles.iconButton} onClick={onClose} disabled={busy} aria-label={t('tenants.actions.cancel')}>
                        <X size={18} aria-hidden />
                    </button>
                </div>

                <p className={styles.dialogTarget}>
                    <strong>{tenant.name}</strong> · <code>{tenant.slug}</code>
                </p>

                <p className={styles.dialogLead}>{t('tenants.actions.whatHappens')}</p>
                <ul className={styles.effectList}>
                    {effects.map((effect) => (
                        <li key={effect}>{effect}</li>
                    ))}
                </ul>

                {billingWarning && <p className={styles.inlineNotice}>{billingWarning}</p>}

                {needsTyping && (
                    <div className={styles.dialogField}>
                        <label htmlFor="tenant-action-confirm">{t('tenants.actions.suspend.typeToConfirm', { slug: tenant.slug })}</label>
                        <input
                            id="tenant-action-confirm"
                            ref={(el) => {
                                firstField.current = el;
                            }}
                            className={tableStyles.input}
                            value={typed}
                            onChange={(e) => setTyped(e.target.value)}
                            autoComplete="off"
                            spellCheck={false}
                        />
                    </div>
                )}

                {error && (
                    <div className={tableStyles.errorMessage} role="alert">
                        {error}
                    </div>
                )}

                <div className={tableStyles.modalFooter}>
                    <button
                        type="button"
                        className={tableStyles.buttonSecondary}
                        onClick={onClose}
                        disabled={busy}
                        ref={(el) => {
                            if (!needsTyping) firstField.current = el;
                        }}
                    >
                        {t('tenants.actions.cancel')}
                    </button>
                    <button type="submit" className={kind === 'suspend' ? tableStyles.buttonDanger : tableStyles.button} disabled={!canConfirm}>
                        {busy ? t('tenants.actions.working') : t(`tenants.actions.${kind}.confirm`)}
                    </button>
                </div>
            </form>
        </div>
    );
}

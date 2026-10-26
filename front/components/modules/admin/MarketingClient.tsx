'use client';

import React, { useState } from 'react';
import { Send } from 'lucide-react';
import { useTranslations } from 'next-intl';
import styles from './admin-table.module.scss';
import { useAdminBranches } from '@/hooks/useAdminBranches';
import { useAdminRole } from '@/hooks/useAdminAccess';
import { MarketingService } from '@/service/api/marketing.service';
import { getApiErrorMessage } from '@/service/api/error.utils';
import { CampaignResult } from '@/types/admin.types';

const SUBJECT_MAX = 150;
const MESSAGE_MAX = 5000;

const escapeHtml = (value: string) =>
    value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// El backend recibe HTML: el texto del textarea se escapa y los saltos de línea pasan a párrafos
const messageToHtml = (message: string): string =>
    message
        .trim()
        .split(/\n{2,}/)
        .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`)
        .join('');

export default function MarketingClient() {
    const { isGlobal, branchId: ownBranchId } = useAdminRole();
    const t = useTranslations('AdminMarketing');
    const { branches, isLoading: branchesLoading } = useAdminBranches();
    // '' = todas las sucursales (solo con alcance global)
    const [selectedBranchId, setSelectedBranchId] = useState('');
    const [subject, setSubject] = useState('');
    const [message, setMessage] = useState('');
    const [isSending, setIsSending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<CampaignResult | null>(null);

    // Con alcance de sucursal el backend usa siempre la propia: el selector no aparece
    const targetBranchId = isGlobal ? selectedBranchId : ownBranchId ?? '';
    const audienceLabel = targetBranchId
        ? branches.find((branch) => branch.id === targetBranchId)?.name ?? t('yourBranch')
        : t('allUsers');

    const canSend = subject.trim().length > 0 && message.trim().length > 0 && !isSending;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!canSend) return;

        const question = targetBranchId
            ? t('confirmBranch', { audience: audienceLabel })
            : t('confirmAll');
        if (!window.confirm(question)) return;

        setIsSending(true);
        setError(null);
        setResult(null);
        try {
            const campaignResult = await MarketingService.sendCampaign({
                subject: subject.trim(),
                htmlBody: messageToHtml(message),
                ...(isGlobal && selectedBranchId ? { branchId: selectedBranchId } : {}),
            });
            setResult(campaignResult);
            // La campaña ya salió: se limpia el formulario para no reenviarla por error
            setSubject('');
            setMessage('');
        } catch (error) {
            setError(getApiErrorMessage(error, t('sendFailed')));
        } finally {
            setIsSending(false);
        }
    };

    return (
        <div className={styles.page}>
            <div className={styles.pageHeader}>
                <div>
                    <h1>{t('title')}</h1>
                    <p>
                        {isGlobal ? t('subtitleGlobal') : t('subtitleOwn', { audience: audienceLabel })}
                    </p>
                </div>
            </div>

            {error && <div className={styles.errorMessage}>{error}</div>}

            {result && (
                <div className={styles.successMessage}>
                    {t.rich(result.failed > 0 ? 'sentWithFailures' : 'sent', {
                        audience: result.audience,
                        sent: result.sent,
                        recipients: result.recipients,
                        failed: result.failed,
                        strong: (chunks) => <strong>{chunks}</strong>,
                    })}
                </div>
            )}

            <div className={styles.tableCard}>
                <form className={`${styles.form} ${styles.formCard}`} onSubmit={handleSubmit}>
                    {isGlobal ? (
                        <div className={styles.field}>
                            <label htmlFor="campaign-branch">{t('audience')}</label>
                            <select
                                id="campaign-branch"
                                className={styles.input}
                                value={selectedBranchId}
                                onChange={(e) => setSelectedBranchId(e.target.value)}
                                disabled={branchesLoading}
                            >
                                <option value="">{t('allBranches')}</option>
                                {branches.map((branch) => (
                                    <option key={branch.id} value={branch.id}>
                                        {t('branchCustomers', { branch: branch.name })}
                                    </option>
                                ))}
                            </select>
                        </div>
                    ) : (
                        <div className={styles.field}>
                            <label>{t('audience')}</label>
                            <p className={styles.cellSub}>
                                {t.rich('ownAudience', { audience: audienceLabel, strong: (chunks) => <strong>{chunks}</strong> })}
                            </p>
                        </div>
                    )}

                    <div className={styles.field}>
                        <label htmlFor="campaign-subject">{t('subject')}</label>
                        <input
                            id="campaign-subject"
                            className={styles.input}
                            value={subject}
                            onChange={(e) => setSubject(e.target.value)}
                            maxLength={SUBJECT_MAX}
                            placeholder={t('subjectPlaceholder')}
                        />
                        <small>{subject.length}/{SUBJECT_MAX}</small>
                    </div>

                    <div className={styles.field}>
                        <label htmlFor="campaign-message">{t('message')}</label>
                        <textarea
                            id="campaign-message"
                            className={`${styles.input} ${styles.textarea}`}
                            value={message}
                            onChange={(e) => setMessage(e.target.value)}
                            maxLength={MESSAGE_MAX}
                            placeholder={t('messagePlaceholder')}
                        />
                        <small>{message.length}/{MESSAGE_MAX}</small>
                    </div>

                    <div className={styles.modalFooter}>
                        <button type="submit" className={styles.button} disabled={!canSend}>
                            <Send size={16} />
                            {isSending ? t('sending') : t('send')}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

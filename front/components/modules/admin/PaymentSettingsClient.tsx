'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Coins, CreditCard, QrCode, RefreshCw, Trash2, Unlink, Upload } from 'lucide-react';
import { useTranslations } from 'next-intl';
import styles from './admin-table.module.scss';
import cards from './payment-settings.module.scss';
import { getApiErrorMessage } from '@/service/api/error.utils';
import { PaymentSettings, USDT_NETWORKS, UsdtNetwork, paymentSettingsService } from '@/service/api/paymentSettings.service';

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

type Feedback = { type: 'success' | 'error'; text: string } | null;

// Medios de cobro de la tienda: tarjeta (Stripe Connect), QR bancario propio y USDT. Los dos últimos
// se verifican a mano desde Pedidos. Al volver del formulario de Stripe se vuelve a leer el estado.
export default function PaymentSettingsClient() {
    const t = useTranslations('AdminPayments');
    const returnState = useSearchParams().get('connect');

    const [settings, setSettings] = useState<PaymentSettings | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    const load = useCallback(async () => {
        setIsLoading(true);
        try {
            setSettings(await paymentSettingsService.get());
            setLoadError(null);
        } catch (err) {
            setLoadError(getApiErrorMessage(err, t('loadFailed')));
        } finally {
            setIsLoading(false);
        }
        // t solo cambia con el idioma
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        // Carga inicial: el setState ocurre después del await dentro de load, no de forma síncrona
        // eslint-disable-next-line react-hooks/set-state-in-effect
        load();
    }, [load]);

    return (
        <div className={styles.page}>
            <div className={styles.pageHeader}>
                <div>
                    <h1>{t('title')}</h1>
                    <p>{t('subtitle')}</p>
                </div>
                <button type="button" className={styles.buttonSecondary} onClick={load} disabled={isLoading}>
                    <RefreshCw size={16} />
                    {t('refresh')}
                </button>
            </div>

            {loadError && <div className={styles.errorMessage}>{loadError}</div>}

            {isLoading && !settings ? (
                <div className={styles.loadingState}>{t('loading')}</div>
            ) : (
                settings && (
                    <div className={cards.grid}>
                        <StripeCard settings={settings} returnState={returnState} onChange={setSettings} />
                        <QrCard settings={settings} onChange={setSettings} />
                        <UsdtCard settings={settings} onChange={setSettings} />
                    </div>
                )
            )}
        </div>
    );
}

function FeedbackMessage({ feedback }: { feedback: Feedback }) {
    if (!feedback) return null;
    return <div className={feedback.type === 'success' ? styles.successMessage : styles.errorMessage}>{feedback.text}</div>;
}

function StripeCard({
    settings,
    returnState,
    onChange,
}: {
    settings: PaymentSettings;
    returnState: string | null;
    onChange: (s: PaymentSettings) => void;
}) {
    const t = useTranslations('AdminPayments');
    const { stripe } = settings;
    const [busy, setBusy] = useState(false);
    const [feedback, setFeedback] = useState<Feedback>(null);

    const state = stripe.chargesEnabled ? 'enabled' : stripe.connected ? 'pending' : 'none';
    const badge = state === 'enabled' ? styles.badgeSuccess : state === 'pending' ? styles.badgeWarning : styles.badgeMuted;

    const startOnboarding = async () => {
        setBusy(true);
        setFeedback(null);
        try {
            window.location.href = await paymentSettingsService.startStripeOnboarding();
        } catch (err) {
            setFeedback({ type: 'error', text: getApiErrorMessage(err, t('onboardingFailed')) });
            setBusy(false);
        }
    };

    const disconnect = async () => {
        if (!window.confirm(t('stripe.confirmDisconnect'))) return;
        setBusy(true);
        setFeedback(null);
        try {
            onChange(await paymentSettingsService.disconnectStripe());
            setFeedback({ type: 'success', text: t('stripe.disconnected') });
        } catch (err) {
            setFeedback({ type: 'error', text: getApiErrorMessage(err, t('saveFailed')) });
        } finally {
            setBusy(false);
        }
    };

    return (
        <section className={`${styles.tableCard} ${styles.form} ${styles.formCard}`} aria-labelledby="pay-stripe">
            <div className={cards.cardHeader}>
                <h2 id="pay-stripe"><CreditCard size={18} />{t('stripe.title')}</h2>
                <span className={`${styles.badge} ${badge}`}>{t(`states.${state}`)}</span>
            </div>

            {returnState === 'refresh' && <div className={styles.errorMessage}>{t('linkExpired')}</div>}
            {returnState === 'return' && state === 'enabled' && <div className={styles.successMessage}>{t('enabledNow')}</div>}
            <FeedbackMessage feedback={feedback} />

            <p className={styles.cellSub}>{t(`descriptions.${state}`)}</p>
            {state === 'pending' && stripe.pendingRequirements > 0 && (
                <p className={styles.cellSub}>{t('pendingRequirements', { count: stripe.pendingRequirements })}</p>
            )}
            {stripe.accountId && (
                <div className={styles.cellMain}>
                    <span className={styles.statLabel}>{t('stripe.accountId')}</span>
                    <span className={cards.accountId}>{stripe.accountId}</span>
                </div>
            )}

            <div className={cards.buttonRow}>
                {state !== 'enabled' && (
                    <button type="button" className={styles.button} onClick={startOnboarding} disabled={busy}>
                        <CreditCard size={16} />
                        {busy ? t('redirecting') : state === 'pending' ? t('continue') : t('setup')}
                    </button>
                )}
                {stripe.connected && (
                    <button type="button" className={styles.buttonDanger} onClick={disconnect} disabled={busy}>
                        <Unlink size={16} />
                        {t('stripe.disconnect')}
                    </button>
                )}
            </div>
            <small className={styles.cellSub}>{t('note')}</small>
        </section>
    );
}

function QrCard({ settings, onChange }: { settings: PaymentSettings; onChange: (s: PaymentSettings) => void }) {
    const t = useTranslations('AdminPayments');
    const [enabled, setEnabled] = useState(settings.qr.enabled);
    const [instructions, setInstructions] = useState(settings.qr.instructions);
    const [preview, setPreview] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [feedback, setFeedback] = useState<Feedback>(null);
    const fileInput = useRef<HTMLInputElement>(null);

    const { hasImage } = settings.qr;

    // Vista previa del QR guardado; el object URL se libera al cambiar o desmontar
    useEffect(() => {
        if (!hasImage) return;
        let url: string | null = null;
        let active = true;
        paymentSettingsService
            .qrImageUrl()
            .then((u) => {
                url = u;
                if (active) setPreview(u);
                else URL.revokeObjectURL(u);
            })
            .catch(() => active && setPreview(null));
        return () => {
            active = false;
            if (url) URL.revokeObjectURL(url);
        };
    }, [hasImage, settings]);

    const run = async (action: () => Promise<void>, success: string) => {
        setBusy(true);
        setFeedback(null);
        try {
            await action();
            setFeedback({ type: 'success', text: success });
        } catch (err) {
            setFeedback({ type: 'error', text: getApiErrorMessage(err, t('saveFailed')) });
        } finally {
            setBusy(false);
        }
    };

    const upload = (file?: File) => {
        if (fileInput.current) fileInput.current.value = '';
        if (!file) return;
        if (!IMAGE_TYPES.includes(file.type)) return setFeedback({ type: 'error', text: t('qr.invalidImage') });
        if (file.size > MAX_IMAGE_BYTES) return setFeedback({ type: 'error', text: t('qr.imageTooLarge') });
        run(async () => {
            await paymentSettingsService.uploadQrImage(file);
            onChange(await paymentSettingsService.get());
        }, t('qr.imageUploaded'));
    };

    const removeImage = () => {
        if (!window.confirm(t('qr.confirmRemove'))) return;
        run(async () => {
            await paymentSettingsService.removeQrImage();
            setEnabled(false);
            onChange(await paymentSettingsService.get());
        }, t('qr.imageRemoved'));
    };

    const save = () =>
        run(async () => {
            onChange(await paymentSettingsService.update({ qrEnabled: enabled, qrInstructions: instructions }));
        }, t('saved'));

    return (
        <section className={`${styles.tableCard} ${styles.form} ${styles.formCard}`} aria-labelledby="pay-qr">
            <div className={cards.cardHeader}>
                <h2 id="pay-qr"><QrCode size={18} />{t('qr.title')}</h2>
                <span className={`${styles.badge} ${settings.qr.enabled ? styles.badgeSuccess : styles.badgeMuted}`}>
                    {settings.qr.enabled ? t('active') : t('inactive')}
                </span>
            </div>
            <p className={styles.cellSub}>{t('qr.description')}</p>
            <FeedbackMessage feedback={feedback} />

            {hasImage && preview ? (
                // eslint-disable-next-line @next/next/no-img-element -- object URL local, no pasa por next/image
                <img src={preview} alt={t('qr.previewAlt')} className={cards.qrPreview} />
            ) : (
                <div className={cards.qrEmpty}>{t('qr.noImage')}</div>
            )}

            <div className={cards.buttonRow}>
                <input
                    ref={fileInput}
                    type="file"
                    accept={IMAGE_TYPES.join(',')}
                    hidden
                    onChange={(e) => upload(e.target.files?.[0])}
                />
                <button type="button" className={styles.buttonSecondary} onClick={() => fileInput.current?.click()} disabled={busy}>
                    <Upload size={16} />
                    {hasImage ? t('qr.replaceImage') : t('qr.uploadImage')}
                </button>
                {hasImage && (
                    <button type="button" className={styles.buttonDanger} onClick={removeImage} disabled={busy}>
                        <Trash2 size={16} />
                        {t('qr.removeImage')}
                    </button>
                )}
            </div>
            <small className={styles.cellSub}>{t('qr.imageHint')}</small>

            <div className={styles.field}>
                <label htmlFor="qr-instructions">{t('qr.instructions')}</label>
                <textarea
                    id="qr-instructions"
                    className={`${styles.input} ${styles.textareaSmall}`}
                    value={instructions}
                    maxLength={1000}
                    placeholder={t('qr.instructionsPlaceholder')}
                    onChange={(e) => setInstructions(e.target.value)}
                />
            </div>

            <label className={styles.inlineCheckbox}>
                <input type="checkbox" checked={enabled} disabled={!hasImage} onChange={(e) => setEnabled(e.target.checked)} />
                {t('qr.enable')}
            </label>
            {!hasImage && <small className={styles.cellSub}>{t('qr.enableHint')}</small>}

            <div>
                <button type="button" className={styles.button} onClick={save} disabled={busy}>
                    {busy ? t('saving') : t('save')}
                </button>
            </div>
        </section>
    );
}

// Mismas reglas que el backend (isValidWallet): avisar antes de guardar una dirección mal copiada
const walletLooksValid = (network: UsdtNetwork, address: string) =>
    network === 'TRC20' ? /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address) : /^0x[a-fA-F0-9]{40}$/.test(address);

function UsdtCard({ settings, onChange }: { settings: PaymentSettings; onChange: (s: PaymentSettings) => void }) {
    const t = useTranslations('AdminPayments');
    const [enabled, setEnabled] = useState(settings.usdt.enabled);
    const [network, setNetwork] = useState<UsdtNetwork | ''>(settings.usdt.network ?? '');
    const [address, setAddress] = useState(settings.usdt.walletAddress);
    const [busy, setBusy] = useState(false);
    const [feedback, setFeedback] = useState<Feedback>(null);

    const trimmed = address.trim();
    const invalidAddress = Boolean(network && trimmed && !walletLooksValid(network, trimmed));
    const complete = Boolean(network && trimmed && !invalidAddress);

    const save = async () => {
        setBusy(true);
        setFeedback(null);
        try {
            onChange(
                await paymentSettingsService.update({
                    usdtEnabled: enabled && complete,
                    usdtNetwork: network || null,
                    usdtWalletAddress: trimmed,
                }),
            );
            setFeedback({ type: 'success', text: t('saved') });
        } catch (err) {
            setFeedback({ type: 'error', text: getApiErrorMessage(err, t('saveFailed')) });
        } finally {
            setBusy(false);
        }
    };

    return (
        <section className={`${styles.tableCard} ${styles.form} ${styles.formCard}`} aria-labelledby="pay-usdt">
            <div className={cards.cardHeader}>
                <h2 id="pay-usdt"><Coins size={18} />{t('usdt.title')}</h2>
                <span className={`${styles.badge} ${settings.usdt.enabled ? styles.badgeSuccess : styles.badgeMuted}`}>
                    {settings.usdt.enabled ? t('active') : t('inactive')}
                </span>
            </div>
            <p className={styles.cellSub}>{t('usdt.description')}</p>
            <FeedbackMessage feedback={feedback} />

            <div className={styles.field}>
                <label htmlFor="usdt-network">{t('usdt.network')}</label>
                <select
                    id="usdt-network"
                    className={styles.input}
                    value={network}
                    onChange={(e) => setNetwork(e.target.value as UsdtNetwork | '')}
                >
                    <option value="">{t('usdt.networkPlaceholder')}</option>
                    {USDT_NETWORKS.map((n) => (
                        <option key={n} value={n}>{t(`usdt.networks.${n}`)}</option>
                    ))}
                </select>
            </div>

            <div className={styles.field}>
                <label htmlFor="usdt-address">{t('usdt.address')}</label>
                <input
                    id="usdt-address"
                    className={`${styles.input} ${cards.mono}`}
                    value={address}
                    maxLength={100}
                    spellCheck={false}
                    autoComplete="off"
                    placeholder={network === 'TRC20' ? 'T…' : '0x…'}
                    aria-invalid={invalidAddress}
                    onChange={(e) => setAddress(e.target.value)}
                />
                {invalidAddress && network && <span className={styles.rowError}>{t('usdt.invalidAddress', { network })}</span>}
            </div>
            <small className={styles.cellSub}>{t('usdt.warning')}</small>

            <label className={styles.inlineCheckbox}>
                <input type="checkbox" checked={enabled} disabled={!complete} onChange={(e) => setEnabled(e.target.checked)} />
                {t('usdt.enable')}
            </label>

            <div>
                <button type="button" className={styles.button} onClick={save} disabled={busy || invalidAddress}>
                    {busy ? t('saving') : t('save')}
                </button>
            </div>
        </section>
    );
}

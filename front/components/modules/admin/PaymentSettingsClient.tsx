'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
    AlertCircle,
    AlertTriangle,
    CheckCircle2,
    Coins,
    CreditCard,
    Info,
    Lock,
    QrCode,
    RefreshCw,
    Trash2,
    Unlink,
    Upload,
    Wallet as WalletIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import ui from './billing.module.scss';
import { getApiErrorMessage } from '@/service/api/error.utils';
import { PaymentSettings, USDT_NETWORKS, UsdtNetwork, paymentSettingsService } from '@/service/api/paymentSettings.service';
import { useStorePlan } from '@/providers/StoreInfoProvider';
import { useAdminRole } from '@/hooks/useAdminAccess';

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

type Feedback = { type: 'success' | 'error'; text: string } | null;

// Medios de cobro de la tienda: tarjeta (Stripe Connect), QR bancario propio, USDT y Billeteras Digitales.
// Cada tarjeta guarda por separado; el plan decide qué medios se pueden activar (lo exige también la API).
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

    // Ningún medio activo: el checkout no puede ofrecer cómo pagar
    const nothingActive =
        settings &&
        !settings.stripe.chargesEnabled &&
        !settings.qr.enabled &&
        !settings.usdt.enabled &&
        !settings.wallet?.enabled;

    return (
        <div className={ui.page}>
            <header className={ui.header}>
                <div>
                    <h1>{t('title')}</h1>
                    <p>{t('subtitle')}</p>
                </div>
                <button type="button" className={`${ui.btn} ${ui.btnLine}`} onClick={load} disabled={isLoading}>
                    <RefreshCw size={18} aria-hidden />
                    {t('refresh')}
                </button>
            </header>

            {loadError && (
                <div role="alert" className={`${ui.banner} ${ui.bannerError}`}>
                    <AlertCircle size={20} aria-hidden />
                    <span>{loadError}</span>
                </div>
            )}

            {nothingActive && (
                <div role="status" className={`${ui.banner} ${ui.bannerWarn}`}>
                    <Info size={20} aria-hidden />
                    <span>
                        <strong>{t('notReadyTitle')}</strong> {t('notReadyText')}
                    </span>
                </div>
            )}

            {isLoading && !settings ? (
                <div role="status" className={`${ui.banner} ${ui.bannerInfo}`}>
                    <RefreshCw size={20} aria-hidden />
                    <span>{t('loading')}</span>
                </div>
            ) : (
                settings && (
                    <>
                        <div className={ui.columns}>
                            <div className={ui.column}>
                                <StripeCard settings={settings} returnState={returnState} onChange={setSettings} />
                                <UsdtCard settings={settings} onChange={setSettings} />
                            </div>
                            <div className={ui.column}>
                                <QrCard settings={settings} onChange={setSettings} />
                            </div>
                        </div>
                        <WalletCard settings={settings} onChange={setSettings} />
                    </>
                )
            )}
        </div>
    );
}

function FeedbackMessage({ feedback }: { feedback: Feedback }) {
    if (!feedback) return null;
    const ok = feedback.type === 'success';
    return (
        <div role={ok ? 'status' : 'alert'} className={`${ui.banner} ${ok ? ui.bannerOk : ui.bannerError}`}>
            {ok ? <CheckCircle2 size={18} aria-hidden /> : <AlertCircle size={18} aria-hidden />}
            <span>{feedback.text}</span>
        </div>
    );
}

function StatusPill({ active }: { active: boolean }) {
    const t = useTranslations('AdminPayments');
    return <span className={`${ui.pill} ${active ? ui.pillGreen : ''}`}>{active ? t('active') : t('inactive')}</span>;
}

// Medio no incluido en el plan: franja con candado y enlace a Suscripción (solo el dueño puede pagar)
function LockedMethod({
    id,
    icon,
    title,
    description,
    plan,
    unlocked,
}: {
    id: string;
    icon: React.ReactNode;
    title: string;
    description: string;
    plan: string;
    unlocked: string;
}) {
    const t = useTranslations('AdminPayments');
    const { features } = useStorePlan();
    const { isSuperAdmin } = useAdminRole();
    return (
        <section className={ui.wide} aria-labelledby={id}>
            <div className={ui.wideInfo}>
                <div className={ui.cardHead}>
                    <div className={ui.tile}>{icon}</div>
                    <h2 id={id}>{title}</h2>
                </div>
                <div>
                    <span className={`${ui.pill} ${ui.pillAmber}`}>{t('locked.planBadge', { plan })}</span>
                </div>
                <p className={ui.text}>{description}</p>
            </div>
            <div className={ui.locked}>
                <div className={ui.lockedTitle}>
                    <Lock size={20} aria-hidden />
                    {t('locked.title', { plan })}
                </div>
                <p className={ui.hint}>
                    {t.rich('locked.text', {
                        plan,
                        current: features.planName,
                        unlocked,
                        b: (chunks) => <strong>{chunks}</strong>,
                    })}
                </p>
                {isSuperAdmin && (
                    <div>
                        <Link href="/admin/suscripcion" className={`${ui.btn} ${ui.btnLine}`}>
                            {t('locked.upgrade', { plan })}
                        </Link>
                    </div>
                )}
            </div>
        </section>
    );
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
    const pill = state === 'enabled' ? ui.pillGreen : state === 'pending' ? ui.pillAmber : '';

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
        <section className={ui.card} aria-labelledby="pay-stripe">
            <div className={ui.cardHead}>
                <div className={ui.tile}>
                    <CreditCard size={22} aria-hidden />
                </div>
                <h2 id="pay-stripe">{t('stripe.title')}</h2>
                <span className={`${ui.pill} ${pill}`}>{t(`states.${state}`)}</span>
            </div>

            {returnState === 'refresh' && <FeedbackMessage feedback={{ type: 'error', text: t('linkExpired') }} />}
            {returnState === 'return' && state === 'enabled' && <FeedbackMessage feedback={{ type: 'success', text: t('enabledNow') }} />}
            <FeedbackMessage feedback={feedback} />

            <p className={ui.text}>{t(`descriptions.${state}`)}</p>
            {state === 'pending' && stripe.pendingRequirements > 0 && (
                <p className={ui.hint}>{t('pendingRequirements', { count: stripe.pendingRequirements })}</p>
            )}
            {stripe.accountId && (
                <div className={ui.account}>
                    <span>{t('stripe.accountId')}</span>
                    <span className={ui.mono}>{stripe.accountId}</span>
                </div>
            )}

            <div className={ui.buttonRow}>
                {state !== 'enabled' && (
                    <button type="button" className={`${ui.btn} ${ui.btnDark} ${ui.btnTall}`} onClick={startOnboarding} disabled={busy}>
                        <CreditCard size={18} aria-hidden />
                        {busy ? t('redirecting') : state === 'pending' ? t('continue') : t('setup')}
                    </button>
                )}
                {stripe.connected && (
                    <button type="button" className={`${ui.btn} ${ui.btnDanger}`} onClick={disconnect} disabled={busy}>
                        <Unlink size={18} aria-hidden />
                        {t('stripe.disconnect')}
                    </button>
                )}
            </div>
            {state !== 'enabled' && <p className={ui.note}>{t('note')}</p>}
        </section>
    );
}

function QrCard({ settings, onChange }: { settings: PaymentSettings; onChange: (s: PaymentSettings) => void }) {
    const t = useTranslations('AdminPayments');
    const { features } = useStorePlan();
    const [enabled, setEnabled] = useState(settings.qr.enabled);
    const [instructions, setInstructions] = useState(settings.qr.instructions);
    const [preview, setPreview] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [feedback, setFeedback] = useState<Feedback>(null);
    const fileInput = useRef<HTMLInputElement>(null);

    const qrAllowed = settings.qr.allowed !== false && features.qrPayments;
    const { hasImage } = settings.qr;

    // Vista previa del QR guardado; el object URL se libera al cambiar o desmontar
    useEffect(() => {
        if (!hasImage || !qrAllowed) return;
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
    }, [hasImage, qrAllowed, settings]);

    if (!qrAllowed) {
        return (
            <LockedMethod
                id="pay-qr"
                icon={<QrCode size={22} aria-hidden />}
                title={t('qr.title')}
                description={t('qr.description')}
                plan="Pro"
                unlocked={t('locked.withoutQr')}
            />
        );
    }

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
        <section className={ui.card} aria-labelledby="pay-qr" style={{ flex: 1 }}>
            <div className={ui.cardHead}>
                <div className={ui.tile}>
                    <QrCode size={22} aria-hidden />
                </div>
                <h2 id="pay-qr">{t('qr.title')}</h2>
                <StatusPill active={settings.qr.enabled} />
            </div>
            <p className={ui.text}>{t('qr.description')}</p>
            <FeedbackMessage feedback={feedback} />

            <div className={ui.qrRow}>
                {hasImage && preview ? (
                    // eslint-disable-next-line @next/next/no-img-element -- object URL local, no pasa por next/image
                    <img src={preview} alt={t('qr.previewAlt')} className={ui.qrImage} />
                ) : (
                    <div className={ui.qrBox}>
                        <QrCode size={32} aria-hidden />
                        {t('qr.noImage')}
                    </div>
                )}
                <div className={ui.qrActions}>
                    <input
                        ref={fileInput}
                        type="file"
                        accept={IMAGE_TYPES.join(',')}
                        hidden
                        onChange={(e) => upload(e.target.files?.[0])}
                    />
                    <div className={ui.buttonRow}>
                        <button type="button" className={`${ui.btn} ${ui.btnLine}`} onClick={() => fileInput.current?.click()} disabled={busy}>
                            <Upload size={18} aria-hidden />
                            {hasImage ? t('qr.replaceImage') : t('qr.uploadImage')}
                        </button>
                        {hasImage && (
                            <button type="button" className={`${ui.btn} ${ui.btnDanger}`} onClick={removeImage} disabled={busy}>
                                <Trash2 size={18} aria-hidden />
                                {t('qr.removeImage')}
                            </button>
                        )}
                    </div>
                    <p className={ui.hint}>{t('qr.imageHint')}</p>
                </div>
            </div>

            <div>
                <label className={ui.label} htmlFor="qr-instructions">{t('qr.instructions')}</label>
                <textarea
                    id="qr-instructions"
                    className={ui.field}
                    rows={4}
                    value={instructions}
                    maxLength={1000}
                    placeholder={t('qr.instructionsPlaceholder')}
                    onChange={(e) => setInstructions(e.target.value)}
                />
            </div>

            <div>
                <label className={ui.switch}>
                    <input
                        type="checkbox"
                        role="switch"
                        checked={enabled}
                        disabled={!hasImage}
                        aria-describedby={!hasImage ? 'qr-enable-hint' : undefined}
                        onChange={(e) => setEnabled(e.target.checked)}
                    />
                    {t('qr.enable')}
                </label>
                {!hasImage && (
                    <p id="qr-enable-hint" className={ui.switchHint}>
                        {t('qr.enableHint')}
                    </p>
                )}
            </div>

            <div style={{ marginTop: 'auto' }}>
                <button type="button" className={`${ui.btn} ${ui.btnDark} ${ui.btnTall}`} onClick={save} disabled={busy}>
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
        <section className={ui.card} aria-labelledby="pay-usdt">
            <div className={ui.cardHead}>
                <div className={ui.tile}>
                    <Coins size={22} aria-hidden />
                </div>
                <h2 id="pay-usdt">{t('usdt.title')}</h2>
                <StatusPill active={settings.usdt.enabled} />
            </div>
            <p className={ui.text}>{t('usdt.description')}</p>
            <FeedbackMessage feedback={feedback} />

            <div>
                <label className={ui.label} htmlFor="usdt-network">{t('usdt.network')}</label>
                <select
                    id="usdt-network"
                    className={ui.field}
                    value={network}
                    onChange={(e) => setNetwork(e.target.value as UsdtNetwork | '')}
                >
                    <option value="">{t('usdt.networkPlaceholder')}</option>
                    {USDT_NETWORKS.map((n) => (
                        <option key={n} value={n}>{t(`usdt.networks.${n}`)}</option>
                    ))}
                </select>
            </div>

            <div>
                <label className={ui.label} htmlFor="usdt-address">{t('usdt.address')}</label>
                <input
                    id="usdt-address"
                    className={`${ui.field} ${ui.mono}`}
                    value={address}
                    maxLength={100}
                    spellCheck={false}
                    autoComplete="off"
                    placeholder={network === 'TRC20' ? 'T…' : '0x…'}
                    aria-invalid={invalidAddress}
                    aria-describedby={invalidAddress ? 'usdt-address-error' : undefined}
                    onChange={(e) => setAddress(e.target.value)}
                />
                {invalidAddress && network && (
                    <span id="usdt-address-error" className={ui.fieldError}>
                        {t('usdt.invalidAddress', { network })}
                    </span>
                )}
            </div>

            <div className={ui.warnBox}>
                <AlertTriangle size={18} aria-hidden />
                <span>{t('usdt.warning')}</span>
            </div>

            <label className={ui.switch}>
                <input type="checkbox" role="switch" checked={enabled} disabled={!complete} onChange={(e) => setEnabled(e.target.checked)} />
                {t('usdt.enable')}
            </label>

            <div>
                <button type="button" className={`${ui.btn} ${ui.btnDark} ${ui.btnTall}`} onClick={save} disabled={busy || invalidAddress}>
                    {busy ? t('saving') : t('save')}
                </button>
            </div>
        </section>
    );
}

function WalletCard({ settings, onChange }: { settings: PaymentSettings; onChange: (s: PaymentSettings) => void }) {
    const t = useTranslations('AdminPayments');
    const { features } = useStorePlan();
    const [enabled, setEnabled] = useState(settings.wallet?.enabled ?? false);
    const [provider, setProvider] = useState(settings.wallet?.provider ?? '');
    const [account, setAccount] = useState(settings.wallet?.account ?? '');
    const [instructions, setInstructions] = useState(settings.wallet?.instructions ?? '');
    const [busy, setBusy] = useState(false);
    const [feedback, setFeedback] = useState<Feedback>(null);

    useEffect(() => {
        // Sincroniza el formulario cuando el servidor devuelve datos nuevos (guardar / actualizar)
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setEnabled(settings.wallet?.enabled ?? false);
        setProvider(settings.wallet?.provider ?? '');
        setAccount(settings.wallet?.account ?? '');
        setInstructions(settings.wallet?.instructions ?? '');
    }, [settings.wallet]);

    const walletAllowed = settings.wallet?.allowed !== false && features.digitalWallet;

    if (!walletAllowed) {
        return (
            <LockedMethod
                id="pay-wallet"
                icon={<WalletIcon size={22} aria-hidden />}
                title={t('wallet.title')}
                description={t('wallet.description')}
                plan="Growth"
                unlocked={t('locked.withoutWallet')}
            />
        );
    }

    // Igual que la API: sin proveedor y cuenta de cobro reales no se puede activar
    const complete = Boolean(provider.trim() && account.trim());

    const save = async () => {
        setBusy(true);
        setFeedback(null);
        try {
            onChange(
                await paymentSettingsService.update({
                    walletEnabled: enabled && complete,
                    walletProvider: provider.trim(),
                    walletAccount: account.trim(),
                    walletInstructions: instructions.trim(),
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
        <section className={ui.card} aria-labelledby="pay-wallet">
            <div className={ui.cardHead}>
                <div className={ui.tile}>
                    <WalletIcon size={22} aria-hidden />
                </div>
                <h2 id="pay-wallet">{t('wallet.title')}</h2>
                <StatusPill active={Boolean(settings.wallet?.enabled)} />
            </div>
            <p className={ui.text}>{t('wallet.description')}</p>
            <FeedbackMessage feedback={feedback} />

            <div className={ui.columns}>
                <div className={ui.column}>
                    <div>
                        <label className={ui.label} htmlFor="wallet-provider">{t('wallet.provider')}</label>
                        <input
                            id="wallet-provider"
                            className={ui.field}
                            value={provider}
                            placeholder={t('wallet.providerPlaceholder')}
                            onChange={(e) => setProvider(e.target.value)}
                        />
                    </div>
                    <div>
                        <label className={ui.label} htmlFor="wallet-account">{t('wallet.account')}</label>
                        <input
                            id="wallet-account"
                            className={ui.field}
                            value={account}
                            placeholder={t('wallet.accountPlaceholder')}
                            onChange={(e) => setAccount(e.target.value)}
                        />
                    </div>
                </div>
                <div className={ui.column}>
                    <div>
                        <label className={ui.label} htmlFor="wallet-instructions">{t('wallet.instructions')}</label>
                        <textarea
                            id="wallet-instructions"
                            className={ui.field}
                            rows={4}
                            value={instructions}
                            placeholder={t('wallet.instructionsPlaceholder')}
                            onChange={(e) => setInstructions(e.target.value)}
                        />
                    </div>
                </div>
            </div>

            <div>
                <label className={ui.switch}>
                    <input
                        type="checkbox"
                        role="switch"
                        checked={enabled}
                        disabled={!complete}
                        aria-describedby={!complete ? 'wallet-enable-hint' : undefined}
                        onChange={(e) => setEnabled(e.target.checked)}
                    />
                    {t('wallet.enable')}
                </label>
                {!complete && (
                    <p id="wallet-enable-hint" className={ui.switchHint}>
                        {t('wallet.enableHint')}
                    </p>
                )}
            </div>

            <div>
                <button
                    type="button"
                    className={`${ui.btn} ${ui.btnDark} ${ui.btnTall}`}
                    onClick={save}
                    disabled={busy || (!complete && enabled)}
                >
                    {busy ? t('saving') : t('save')}
                </button>
            </div>
        </section>
    );
}

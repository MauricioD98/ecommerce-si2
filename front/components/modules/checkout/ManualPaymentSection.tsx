'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, Copy, Upload, Wallet as WalletIcon } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import qrStyles from './qr-payment.module.scss';
import styles from './manual-payment.module.scss';
import { formatMoney } from '@/i18n/config';
import { getApiErrorMessage } from '@/service/api/error.utils';
import { ManualPaymentMethod, PaymentOptions, paymentSettingsService } from '@/service/api/paymentSettings.service';

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

interface ManualPaymentSectionProps {
    method: ManualPaymentMethod;
    options: PaymentOptions;
    amount: number;
    // Crea el pedido si todavía no existe (reserva el stock) y devuelve su id
    ensureOrder: () => Promise<string | null>;
    onSubmitted?: (orderId: string) => void;
}

// Pago manual con los datos de la tienda: QR bancario, USDT o Billetera Digital (Airtm, Takenos, Wallbit).
// El pedido queda pendiente con el stock reservado hasta que la tienda lo aprueba en Pedidos.
export default function ManualPaymentSection({ method, options, amount, ensureOrder, onSubmitted }: ManualPaymentSectionProps) {
    const t = useTranslations('Checkout.manual');
    const locale = useLocale();
    const [qrUrl, setQrUrl] = useState<string | null>(null);
    const [file, setFile] = useState<File | null>(null);
    const [txId, setTxId] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [submittedOrderId, setSubmittedOrderId] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);
    const fileInput = useRef<HTMLInputElement>(null);

    // QR bancario de la tienda (la API lo sirve con x-tenant-id, por eso va como blob)
    useEffect(() => {
        if (method !== 'BANK_QR') return;
        let url: string | null = null;
        let active = true;
        paymentSettingsService
            .publicQrImageUrl()
            .then((u) => {
                url = u;
                if (active) setQrUrl(u);
                else URL.revokeObjectURL(u);
            })
            .catch(() => active && setError(t('qrLoadFailed')));
        return () => {
            active = false;
            if (url) URL.revokeObjectURL(url);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [method]);

    const pickFile = (picked?: File) => {
        setError(null);
        if (!picked) return;
        if (!IMAGE_TYPES.includes(picked.type)) return setError(t('invalidImage'));
        if (picked.size > MAX_IMAGE_BYTES) return setError(t('imageTooLarge'));
        setFile(picked);
    };

    const copyAddress = async () => {
        const textToCopy = method === 'WALLET' ? options.wallet?.account : options.usdt?.walletAddress;
        if (!textToCopy) return;
        try {
            await navigator.clipboard.writeText(textToCopy);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            // Sin permiso de portapapeles
        }
    };

    const canSubmit = method === 'BANK_QR' ? Boolean(file) : txId.trim().length > 0;

    const submit = async () => {
        if (!canSubmit || isSubmitting) return;
        setIsSubmitting(true);
        setError(null);
        try {
            const orderId = await ensureOrder();
            if (!orderId) throw new Error(t('orderFailed'));
            await paymentSettingsService.submitProof(
                orderId,
                method,
                method === 'BANK_QR' ? { file } : { txId, file: file || undefined },
            );
            setSubmittedOrderId(orderId);
            onSubmitted?.(orderId);
        } catch (err) {
            setError(err instanceof Error && !('isAxiosError' in err) ? err.message : getApiErrorMessage(err, t('submitFailed')));
        } finally {
            setIsSubmitting(false);
        }
    };

    if (submittedOrderId) {
        return (
            <div className={`${qrStyles.qrContainer} ${styles.done}`}>
                <CheckCircle2 size={40} className={styles.doneIcon} />
                <h3 className={qrStyles.title}>{t('submittedTitle')}</h3>
                <p className={qrStyles.subtitle}>{t('submittedText')}</p>
                <Link href={`/account/orders/${submittedOrderId}`} className={qrStyles.simulateBtn}>
                    {t('viewOrder')}
                </Link>
            </div>
        );
    }

    const title =
        method === 'BANK_QR'
            ? t('qrTitle')
            : method === 'WALLET'
            ? (t('walletTitle') || 'Transfiere desde tu billetera digital')
            : t('usdtTitle');

    const subtitle =
        method === 'BANK_QR'
            ? t('qrSubtitle')
            : method === 'WALLET'
            ? (t('walletSubtitle') || 'Transfiere el monto a nuestra cuenta e ingresa la referencia de la transferencia.')
            : t('usdtSubtitle');

    return (
        <div className={qrStyles.qrContainer}>
            <h3 className={qrStyles.title}>{title}</h3>
            <p className={qrStyles.subtitle}>{subtitle}</p>

            {method === 'BANK_QR' && (
                <div className={qrStyles.qrFrame}>
                    {qrUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={qrUrl} alt={t('qrAlt')} className={styles.qrImage} />
                    ) : (
                        <div className={styles.qrPlaceholder}><div className={qrStyles.spinner} /></div>
                    )}
                </div>
            )}

            {method === 'USDT' && options.usdt && (
                <div className={qrStyles.qrFrame}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={options.usdt.walletQr} alt={t('walletQrAlt')} className={qrStyles.qrImage} />
                </div>
            )}

            {method === 'WALLET' && (
                <div className={qrStyles.qrFrame} style={{ padding: '2rem', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', background: '#f8fafc', borderRadius: '1rem', border: '1px dashed #cbd5e1' }}>
                    <WalletIcon size={44} color="#6366f1" />
                    <span style={{ fontWeight: 700, fontSize: '1rem', color: '#1e293b' }}>
                        {options.wallet?.provider || 'Airtm / Takenos / Wallbit'}
                    </span>
                    <span style={{ fontSize: '0.8125rem', color: '#64748b' }}>Transferencia P2P entre billeteras</span>
                </div>
            )}

            <div className={qrStyles.amountBox}>
                <p className={qrStyles.label}>{t('amount')}</p>
                <p className={qrStyles.value}>{formatMoney(amount, locale)}</p>
                {method === 'USDT' && <p className={styles.hint}>{t('usdtAmountHint')}</p>}
                {method === 'WALLET' && <p className={styles.hint}>Transfiere este monto exacto a la cuenta indicada a continuación.</p>}
            </div>

            {method === 'BANK_QR' && options.bankQr?.instructions && (
                <div className={styles.instructions}>
                    <p className={styles.label}>{t('instructions')}</p>
                    <p className={styles.preformatted}>{options.bankQr.instructions}</p>
                </div>
            )}

            {method === 'USDT' && options.usdt && (
                <div className={styles.walletBox}>
                    <p className={styles.label}>{t('network')}</p>
                    <p className={styles.network}>{t(`networks.${options.usdt.network}`)}</p>
                    <p className={styles.label}>{t('wallet')}</p>
                    <div className={styles.walletRow}>
                        <code className={styles.wallet}>{options.usdt.walletAddress}</code>
                        <button type="button" className={styles.copyButton} onClick={copyAddress} aria-label={t('copy')}>
                            <Copy size={16} />
                            {copied ? t('copied') : t('copy')}
                        </button>
                    </div>
                    <p className={styles.warning}>{t('networkWarning', { network: options.usdt.network })}</p>
                </div>
            )}

            {method === 'WALLET' && options.wallet && (
                <div className={styles.walletBox}>
                    <p className={styles.label}>Billeteras aceptadas</p>
                    <p className={styles.network}>{options.wallet.provider}</p>
                    <p className={styles.label}>Cuenta o Usuario de cobro</p>
                    <div className={styles.walletRow}>
                        <code className={styles.wallet}>{options.wallet.account}</code>
                        <button type="button" className={styles.copyButton} onClick={copyAddress} aria-label="Copiar cuenta">
                            <Copy size={16} />
                            {copied ? t('copied') : t('copy')}
                        </button>
                    </div>
                    {options.wallet.instructions && (
                        <div className={styles.instructions} style={{ marginTop: '0.75rem' }}>
                            <p className={styles.label}>{t('instructions')}</p>
                            <p className={styles.preformatted}>{options.wallet.instructions}</p>
                        </div>
                    )}
                </div>
            )}

            <div className={styles.proofForm}>
                {method === 'BANK_QR' && (
                    <>
                        <input
                            ref={fileInput}
                            type="file"
                            accept={IMAGE_TYPES.join(',')}
                            hidden
                            onChange={(e) => pickFile(e.target.files?.[0])}
                        />
                        <button type="button" className={styles.uploadButton} onClick={() => fileInput.current?.click()}>
                            <Upload size={16} />
                            {file ? t('changeReceipt') : t('uploadReceipt')}
                        </button>
                        <p className={styles.hint}>{file ? file.name : t('receiptHint')}</p>
                    </>
                )}

                {method === 'USDT' && (
                    <label className={styles.txField}>
                        <span className={styles.label}>{t('txId')}</span>
                        <input
                            className={styles.txInput}
                            value={txId}
                            maxLength={100}
                            spellCheck={false}
                            autoComplete="off"
                            required
                            placeholder={options.usdt?.network === 'TRC20' ? t('txIdPlaceholderTron') : t('txIdPlaceholderEvm')}
                            onChange={(e) => setTxId(e.target.value)}
                        />
                        <span className={styles.hint}>{t('txIdHint')}</span>
                    </label>
                )}

                {method === 'WALLET' && (
                    <>
                        <label className={styles.txField}>
                            <span className={styles.label}>ID o Referencia de la transferencia</span>
                            <input
                                className={styles.txInput}
                                value={txId}
                                maxLength={100}
                                spellCheck={false}
                                autoComplete="off"
                                required
                                placeholder="Ej. AIRTM-982341, TK-123456, WB-987654"
                                onChange={(e) => setTxId(e.target.value)}
                            />
                            <span className={styles.hint}>Ingresa el código o número de referencia de la transferencia.</span>
                        </label>
                        <div style={{ marginTop: '0.5rem' }}>
                            <input
                                ref={fileInput}
                                type="file"
                                accept={IMAGE_TYPES.join(',')}
                                hidden
                                onChange={(e) => pickFile(e.target.files?.[0])}
                            />
                            <button type="button" className={styles.uploadButton} onClick={() => fileInput.current?.click()}>
                                <Upload size={16} />
                                {file ? t('changeReceipt') : 'Adjuntar comprobante (opcional)'}
                            </button>
                            <p className={styles.hint}>{file ? file.name : t('receiptHint')}</p>
                        </div>
                    </>
                )}

                {error && <div className={qrStyles.errorBox}>{error}</div>}

                <button type="button" className={qrStyles.simulateBtn} onClick={submit} disabled={!canSubmit || isSubmitting}>
                    {isSubmitting ? t('submitting') : t('submit')}
                </button>
                <p className={styles.hint}>{t('reviewNote')}</p>
            </div>
        </div>
    );
}

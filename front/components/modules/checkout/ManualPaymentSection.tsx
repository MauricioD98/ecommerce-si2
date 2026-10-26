'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, Copy, Upload } from 'lucide-react';
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

// Pago manual con los datos de la tienda: QR bancario (el cliente sube el comprobante) o USDT (informa
// el TxID). El pedido queda pendiente con el stock reservado hasta que la tienda lo aprueba en Pedidos.
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
        // t solo cambia con el idioma
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
        if (!options.usdt) return;
        try {
            await navigator.clipboard.writeText(options.usdt.walletAddress);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            // Sin permiso de portapapeles: la dirección igual se puede seleccionar a mano
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
            await paymentSettingsService.submitProof(orderId, method, method === 'BANK_QR' ? { file } : { txId });
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

    return (
        <div className={qrStyles.qrContainer}>
            <h3 className={qrStyles.title}>{method === 'BANK_QR' ? t('qrTitle') : t('usdtTitle')}</h3>
            <p className={qrStyles.subtitle}>{method === 'BANK_QR' ? t('qrSubtitle') : t('usdtSubtitle')}</p>

            <div className={qrStyles.qrFrame}>
                {method === 'BANK_QR' ? (
                    qrUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element -- object URL local
                        <img src={qrUrl} alt={t('qrAlt')} className={styles.qrImage} />
                    ) : (
                        <div className={styles.qrPlaceholder}><div className={qrStyles.spinner} /></div>
                    )
                ) : (
                    // eslint-disable-next-line @next/next/no-img-element -- data URL generado por la API
                    <img src={options.usdt!.walletQr} alt={t('walletQrAlt')} className={qrStyles.qrImage} />
                )}
            </div>

            <div className={qrStyles.amountBox}>
                <p className={qrStyles.label}>{t('amount')}</p>
                <p className={qrStyles.value}>{formatMoney(amount, locale)}</p>
                {method === 'USDT' && <p className={styles.hint}>{t('usdtAmountHint')}</p>}
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

            <div className={styles.proofForm}>
                {method === 'BANK_QR' ? (
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
                ) : (
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

                {error && <div className={qrStyles.errorBox}>{error}</div>}

                <button type="button" className={qrStyles.simulateBtn} onClick={submit} disabled={!canSubmit || isSubmitting}>
                    {isSubmitting ? t('submitting') : t('submit')}
                </button>
                <p className={styles.hint}>{t('reviewNote')}</p>
            </div>
        </div>
    );
}

'use client';

import React from 'react';
import { Check, Printer, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import styles from './pos.module.scss';
import { PosReceipt } from '@/types/pos.types';
import { ReceiptTexts, printPosReceipt } from '@/utils/printPosReceipt';
import { formatMoney, intlLocale } from '@/i18n/config';
import { useStoreName } from '@/providers/StoreInfoProvider';

// Modal de venta exitosa. `.printArea` es solo la vista previa en pantalla: el ticket real se
// imprime aparte con printPosReceipt() (iframe con su propio documento), porque este modal usa
// position: fixed + overflow-y: auto, que rompe el truco clásico de @media print + visibility.
export default function PosReceiptModal({ receipt, onClose }: { receipt: PosReceipt; onClose: () => void }) {
    const t = useTranslations('AdminPos');
    const tc = useTranslations('AdminCommon');
    const locale = useLocale();
    const storeName = useStoreName();
    const money = (value: number) => formatMoney(value, locale);
    const date = new Date(receipt.createdAt);
    const method = receipt.paymentMethod in { CASH: 1, PHYSICAL_CARD: 1, QR: 1 }
        ? t(`methods.${receipt.paymentMethod as 'CASH' | 'PHYSICAL_CARD' | 'QR'}`)
        : receipt.paymentMethod;

    // Los mismos textos sirven para la vista previa y para el ticket impreso
    const texts: ReceiptTexts = {
        store: storeName,
        order: t('receipt.order', { number: receipt.orderNumber }),
        cashier: t('receipt.cashier', { name: receipt.cashierName }),
        customer: t('receipt.customer', { name: receipt.customerName }),
        nit: receipt.nit ? t('receipt.nit', { nit: receipt.nit }) : null,
        razonSocial: receipt.razonSocial ? t('receipt.razonSocial', { name: receipt.razonSocial }) : null,
        subtotal: t('receipt.subtotal'),
        discount: t('receipt.discount'),
        total: t('receipt.total'),
        payment: t('receipt.payment', { method }),
        received: receipt.amountReceived != null ? t('receipt.received', { amount: money(receipt.amountReceived) }) : null,
        change: receipt.amountReceived != null ? t('receipt.change', { amount: money(receipt.change ?? 0) }) : null,
        thanks: t('receipt.thanks'),
    };

    return (
        <div className={styles.overlay}>
            <div className={styles.receiptModal} role="dialog" aria-modal="true" aria-label={t('receipt.success')}>
                <div className={styles.receiptModalHeader}>
                    <span className={styles.successBadge}>
                        <Check size={18} strokeWidth={3} /> {t('receipt.success')}
                    </span>
                    <button type="button" className={styles.iconButton} onClick={onClose} aria-label={tc('close')}>
                        <X size={20} />
                    </button>
                </div>

                <div className={styles.printArea}>
                    <p className={styles.receiptStore}>{storeName}</p>
                    <p className={styles.receiptLine}>{receipt.branchName}</p>
                    <p className={styles.receiptLine}>{date.toLocaleString(intlLocale(locale))}</p>
                    <p className={styles.receiptLine}>{texts.order}</p>
                    <p className={styles.receiptLine}>{texts.cashier}</p>
                    <p className={styles.receiptLine}>{texts.customer}</p>
                    {texts.nit && <p className={styles.receiptLine}>{texts.nit}</p>}
                    {texts.razonSocial && <p className={styles.receiptLine}>{texts.razonSocial}</p>}
                    <hr className={styles.receiptDivider} />

                    {receipt.items.map((item, index) => (
                        <div className={styles.receiptItem} key={index}>
                            <span>{item.quantity} x {item.productName} ({item.size})</span>
                            <span>{money(item.subtotal)}</span>
                        </div>
                    ))}

                    <hr className={styles.receiptDivider} />
                    <div className={styles.receiptItem}>
                        <span>{texts.subtotal}</span>
                        <span>{money(receipt.subtotal)}</span>
                    </div>
                    {receipt.discountApplied > 0 && (
                        <div className={styles.receiptItem}>
                            <span>{texts.discount}</span>
                            <span>-{money(receipt.discountApplied)}</span>
                        </div>
                    )}
                    <div className={`${styles.receiptItem} ${styles.receiptTotal}`}>
                        <span>{texts.total}</span>
                        <span>{money(receipt.total)}</span>
                    </div>
                    <p className={styles.receiptLine}>{texts.payment}</p>
                    {receipt.paymentMethod === 'CASH' && receipt.amountReceived != null && (
                        <>
                            <p className={styles.receiptLine}>{texts.received}</p>
                            <p className={styles.receiptLine}>{texts.change}</p>
                        </>
                    )}
                    <hr className={styles.receiptDivider} />
                    <p className={styles.receiptFooter}>{texts.thanks}</p>
                </div>

                <div className={styles.receiptModalFooter}>
                    <button type="button" className={styles.secondaryButton} onClick={onClose}>
                        {t('receipt.newSale')}
                    </button>
                    <button type="button" className={styles.primaryButton} onClick={() => printPosReceipt(receipt, texts, locale)}>
                        <Printer size={16} />
                        {t('receipt.print')}
                    </button>
                </div>
            </div>
        </div>
    );
}

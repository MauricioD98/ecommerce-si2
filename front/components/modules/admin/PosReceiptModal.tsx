'use client';

import React from 'react';
import { Check, Printer, X } from 'lucide-react';
import styles from './pos.module.scss';
import { PosReceipt } from '@/types/pos.types';
import { PAYMENT_METHOD_LABEL, printPosReceipt } from '@/utils/printPosReceipt';

// Modal de venta exitosa. `.printArea` es solo la vista previa en pantalla: el ticket real se
// imprime aparte con printPosReceipt() (iframe con su propio documento), porque este modal usa
// position: fixed + overflow-y: auto, que rompe el truco clásico de @media print + visibility.
export default function PosReceiptModal({ receipt, onClose }: { receipt: PosReceipt; onClose: () => void }) {
    const date = new Date(receipt.createdAt);

    return (
        <div className={styles.overlay}>
            <div className={styles.receiptModal} role="dialog" aria-modal="true" aria-label="Venta exitosa">
                <div className={styles.receiptModalHeader}>
                    <span className={styles.successBadge}>
                        <Check size={18} strokeWidth={3} /> Venta exitosa
                    </span>
                    <button type="button" className={styles.iconButton} onClick={onClose} aria-label="Cerrar">
                        <X size={20} />
                    </button>
                </div>

                <div className={styles.printArea}>
                    <p className={styles.receiptStore}>STELLA FEMME</p>
                    <p className={styles.receiptLine}>{receipt.branchName}</p>
                    <p className={styles.receiptLine}>{date.toLocaleString('es-BO')}</p>
                    <p className={styles.receiptLine}>Pedido #{receipt.orderNumber}</p>
                    <p className={styles.receiptLine}>Cajero: {receipt.cashierName}</p>
                    <p className={styles.receiptLine}>Cliente: {receipt.customerName}</p>
                    {receipt.nit && <p className={styles.receiptLine}>NIT/CI: {receipt.nit}</p>}
                    {receipt.razonSocial && <p className={styles.receiptLine}>Razón Social: {receipt.razonSocial}</p>}
                    <hr className={styles.receiptDivider} />

                    {receipt.items.map((item, index) => (
                        <div className={styles.receiptItem} key={index}>
                            <span>{item.quantity} x {item.productName}</span>
                            <span>${item.subtotal.toFixed(2)}</span>
                        </div>
                    ))}

                    <hr className={styles.receiptDivider} />
                    <div className={styles.receiptItem}>
                        <span>Subtotal</span>
                        <span>${receipt.subtotal.toFixed(2)}</span>
                    </div>
                    {receipt.discountApplied > 0 && (
                        <div className={styles.receiptItem}>
                            <span>Descuento</span>
                            <span>-${receipt.discountApplied.toFixed(2)}</span>
                        </div>
                    )}
                    <div className={`${styles.receiptItem} ${styles.receiptTotal}`}>
                        <span>Total</span>
                        <span>${receipt.total.toFixed(2)}</span>
                    </div>
                    <p className={styles.receiptLine}>Pago: {PAYMENT_METHOD_LABEL[receipt.paymentMethod] ?? receipt.paymentMethod}</p>
                    {receipt.paymentMethod === 'CASH' && receipt.amountReceived != null && (
                        <>
                            <p className={styles.receiptLine}>Monto Recibido: ${receipt.amountReceived.toFixed(2)}</p>
                            <p className={styles.receiptLine}>Cambio: ${(receipt.change ?? 0).toFixed(2)}</p>
                        </>
                    )}
                    <hr className={styles.receiptDivider} />
                    <p className={styles.receiptFooter}>¡Gracias por su compra!</p>
                </div>

                <div className={styles.receiptModalFooter}>
                    <button type="button" className={styles.secondaryButton} onClick={onClose}>
                        Nueva venta
                    </button>
                    <button type="button" className={styles.primaryButton} onClick={() => printPosReceipt(receipt)}>
                        <Printer size={16} />
                        Imprimir recibo
                    </button>
                </div>
            </div>
        </div>
    );
}

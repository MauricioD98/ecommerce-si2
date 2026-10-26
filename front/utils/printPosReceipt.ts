import { PosReceipt } from "@/types/pos.types";
import { formatMoney, intlLocale } from "@/i18n/config";

// Textos ya traducidos (AdminPos.receipt): esto corre fuera de React, sin acceso a useTranslations
export interface ReceiptTexts {
    store: string;
    order: string;
    cashier: string;
    customer: string;
    nit: string | null;
    razonSocial: string | null;
    subtotal: string;
    discount: string;
    total: string;
    payment: string;
    received: string | null;
    change: string | null;
    thanks: string;
}

const escapeHtml = (value: string) =>
    value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");

const buildReceiptHtml = (receipt: PosReceipt, texts: ReceiptTexts, locale: string): string => {
    const money = (value: number) => formatMoney(value, locale);
    const date = new Date(receipt.createdAt).toLocaleString(intlLocale(locale));

    const itemsHtml = receipt.items
        .map(
            (item) => `
                <div class="row">
                    <span>${item.quantity} x ${escapeHtml(item.productName)}</span>
                    <span>${money(item.subtotal)}</span>
                </div>`,
        )
        .join("");

    const cashLinesHtml =
        receipt.paymentMethod === "CASH" && receipt.amountReceived != null
            ? `
                <p>${escapeHtml(texts.received ?? "")}</p>
                <p>${escapeHtml(texts.change ?? "")}</p>`
            : "";

    return `<!DOCTYPE html>
<html lang="${locale}">
<head>
<meta charset="utf-8" />
<style>
    @page { margin: 0; size: 80mm auto; }
    * { box-sizing: border-box; }
    body {
        font-family: 'Courier New', monospace;
        width: 80mm;
        font-size: 12px;
        margin: 0;
        padding: 10px;
        color: #000;
        background: #fff;
    }
    p { margin: 0 0 2px; }
    .store { text-align: center; font-size: 14px; font-weight: 700; letter-spacing: 0.05em; margin-bottom: 8px; }
    .divider { border: none; border-top: 1px dashed #000; margin: 8px 0; }
    .row { display: flex; justify-content: space-between; gap: 8px; margin-bottom: 2px; }
    .total { font-weight: 700; font-size: 13px; }
    .footer { text-align: center; margin-top: 8px; }
</style>
</head>
<body>
    <p class="store">${escapeHtml(texts.store)}</p>
    <p>${escapeHtml(receipt.branchName)}</p>
    <p>${date}</p>
    <p>${escapeHtml(texts.order)}</p>
    <p>${escapeHtml(texts.cashier)}</p>
    <p>${escapeHtml(texts.customer)}</p>
    ${texts.nit ? `<p>${escapeHtml(texts.nit)}</p>` : ""}
    ${texts.razonSocial ? `<p>${escapeHtml(texts.razonSocial)}</p>` : ""}
    <hr class="divider" />
    ${itemsHtml}
    <hr class="divider" />
    <div class="row"><span>${escapeHtml(texts.subtotal)}</span><span>${money(receipt.subtotal)}</span></div>
    ${receipt.discountApplied > 0 ? `<div class="row"><span>${escapeHtml(texts.discount)}</span><span>-${money(receipt.discountApplied)}</span></div>` : ""}
    <div class="row total"><span>${escapeHtml(texts.total)}</span><span>${money(receipt.total)}</span></div>
    <p>${escapeHtml(texts.payment)}</p>
    ${cashLinesHtml}
    <hr class="divider" />
    <p class="footer">${escapeHtml(texts.thanks)}</p>
</body>
</html>`;
};

// Imprime el recibo en un iframe oculto con su propio documento HTML, sin depender del árbol de
// CSS de la app (el modal usa position: fixed + overflow-y: auto, que en varios navegadores hace
// que la impresión con visibility:hidden/position:absolute salga en blanco o en varias hojas).
export function printPosReceipt(receipt: PosReceipt, texts: ReceiptTexts, locale: string): void {
    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    document.body.appendChild(iframe);

    const cleanup = () => {
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
    };

    const doc = iframe.contentDocument ?? iframe.contentWindow?.document;
    if (!doc) {
        cleanup();
        return;
    }

    doc.open();
    doc.write(buildReceiptHtml(receipt, texts, locale));
    doc.close();

    let cleaned = false;
    const cleanupOnce = () => {
        if (cleaned) return;
        cleaned = true;
        cleanup();
    };

    iframe.contentWindow?.addEventListener("afterprint", cleanupOnce);

    iframe.onload = () => {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
        // Respaldo por si el navegador no dispara "afterprint" (pasa en algunos WebKit)
        setTimeout(cleanupOnce, 2000);
    };
}

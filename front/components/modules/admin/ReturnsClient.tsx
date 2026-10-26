'use client';

import React, { useMemo, useState } from 'react';
import { CheckCircle2, PackageCheck, RotateCcw, Search, TriangleAlert } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import styles from './returns.module.scss';
import { formatMoney, intlLocale } from '@/i18n/config';
import { useAdminRole } from '@/hooks/useAdminAccess';
import { useAdminBranches } from '@/hooks/useAdminBranches';
import { useOrderSearch, useProcessReturn } from '@/hooks/useReturns';
import { getApiErrorMessage } from '@/service/api/error.utils';
import { round2 } from '@/utils/pricing';
import {
    ITEM_CONDITIONS,
    ItemCondition,
    RETURN_REASONS,
    ReturnableOrder,
    ReturnReason,
    ReturnRecord,
} from '@/types/returns.types';

// Línea que el cajero armó para un ítem de la venta. La UI permite un estado por ítem; el backend
// además acepta partir la misma línea en vendible + merma, por si se necesita desde la API.
interface DraftLine {
    quantity: number;
    reason: ReturnReason;
    condition: ItemCondition;
}


export default function ReturnsClient() {
    const { isGlobal, branchId: staffBranchId } = useAdminRole();
    const t = useTranslations('AdminReturns');
    const tc = useTranslations('AdminCommon');
    const locale = useLocale();
    const money = (value: number) => formatMoney(value, locale);
    const formatDate = (value: string) => new Date(value).toLocaleString(intlLocale(locale));
    const { branches } = useAdminBranches();
    const [selectedBranchId, setSelectedBranchId] = useState('');

    // Sucursal que RECIBE la mercadería: la propia, o la elegida si el usuario tiene alcance global
    const effectiveBranchId = isGlobal ? selectedBranchId || null : staffBranchId;
    const branchName = branches.find((branch) => branch.id === effectiveBranchId)?.name;

    const [term, setTerm] = useState('');
    const { results, isSearching, error: searchError, hasSearched, search, reset } = useOrderSearch(effectiveBranchId);
    const { process, isProcessing } = useProcessReturn();

    const [selectedOrder, setSelectedOrder] = useState<ReturnableOrder | null>(null);
    const [draft, setDraft] = useState<Record<string, DraftLine>>({});
    const [notes, setNotes] = useState('');
    const [processError, setProcessError] = useState<string | null>(null);
    const [receipt, setReceipt] = useState<ReturnRecord | null>(null);

    const selectOrder = (order: ReturnableOrder) => {
        setSelectedOrder(order);
        setDraft({});
        setNotes('');
        setProcessError(null);
        setReceipt(null);
    };

    const handleSearch = (event: React.FormEvent) => {
        event.preventDefault();
        setSelectedOrder(null);
        setDraft({});
        setReceipt(null);
        setProcessError(null);
        search(term);
    };

    // Alta/baja de un ítem en la devolución. Al incluirlo arranca con 1 unidad, "otro motivo" y
    // vendible: el cajero ajusta lo que corresponda.
    const toggleItem = (orderItemId: string, returnable: number) => {
        setProcessError(null);
        setDraft((prev) => {
            if (prev[orderItemId]) {
                const { [orderItemId]: _removed, ...rest } = prev;
                return rest;
            }
            if (returnable <= 0) return prev;
            return { ...prev, [orderItemId]: { quantity: 1, reason: 'OTHER', condition: 'SELLABLE' } };
        });
    };

    const updateLine = (orderItemId: string, patch: Partial<DraftLine>) => {
        setProcessError(null);
        setDraft((prev) => (prev[orderItemId] ? { ...prev, [orderItemId]: { ...prev[orderItemId], ...patch } } : prev));
    };

    // Resumen de lo que se va a devolver, para que el cajero confirme el monto antes de procesar
    const summary = useMemo(() => {
        if (!selectedOrder) return { refund: 0, sellable: 0, damaged: 0, lines: 0 };
        return selectedOrder.items.reduce(
            (acc, item) => {
                const line = draft[item.orderItemId];
                if (!line) return acc;
                acc.lines += 1;
                acc.refund = round2(acc.refund + item.unitPrice * line.quantity);
                if (line.condition === 'SELLABLE') acc.sellable += line.quantity;
                else acc.damaged += line.quantity;
                return acc;
            },
            { refund: 0, sellable: 0, damaged: 0, lines: 0 },
        );
    }, [selectedOrder, draft]);

    const handleProcess = async () => {
        if (!selectedOrder || summary.lines === 0 || isProcessing) return;
        if (!effectiveBranchId) {
            setProcessError(t('selectBranchError'));
            return;
        }

        setProcessError(null);
        try {
            const record = await process({
                orderId: selectedOrder.orderId,
                branchId: effectiveBranchId,
                ...(notes.trim() ? { notes: notes.trim() } : {}),
                items: Object.entries(draft).map(([orderItemId, line]) => ({
                    orderItemId,
                    quantity: line.quantity,
                    reason: line.reason,
                    condition: line.condition,
                })),
            });

            setReceipt(record);
            setSelectedOrder(null);
            setDraft({});
            setNotes('');
            // Se vuelve a buscar para que los topes por línea (`alreadyReturned`) queden al día
            search(term);
        } catch (error) {
            setProcessError(getApiErrorMessage(error, t('processFailed')));
        }
    };

    return (
        <div className={styles.page}>
            <div className={styles.pageHeader}>
                <div>
                    <h1>{t('title')}</h1>
                    <p>{t('subtitle')}</p>
                    {!isGlobal && branchName && (
                        <p className={styles.branchNotice}>
                            {t.rich('branchNotice', { branch: branchName, strong: (chunks) => <strong>{chunks}</strong> })}
                        </p>
                    )}
                </div>

                {isGlobal && (
                    <select
                        className={styles.branchSelect}
                        value={selectedBranchId}
                        onChange={(e) => setSelectedBranchId(e.target.value)}
                        aria-label={t('branchLabel')}
                    >
                        <option value="">{t('selectBranch')}</option>
                        {branches.filter((branch) => branch.isActive).map((branch) => (
                            <option key={branch.id} value={branch.id}>{branch.name}</option>
                        ))}
                    </select>
                )}
            </div>

            {isGlobal && !effectiveBranchId ? (
                <div className={styles.emptyState}>
                    {t('selectBranchFirst')}
                </div>
            ) : (
                <div className={styles.layout}>
                    {/* Izquierda: buscador de la venta original */}
                    <section className={styles.panel}>
                        <h2 className={styles.panelTitle}>
                            <Search size={18} /> {t('searchTitle')}
                        </h2>

                        <form className={styles.searchForm} onSubmit={handleSearch}>
                            <input
                                type="text"
                                className={styles.input}
                                placeholder={t('searchPlaceholder')}
                                value={term}
                                onChange={(e) => setTerm(e.target.value)}
                                aria-label={t('searchLabel')}
                            />
                            <button type="submit" className={styles.button} disabled={!term.trim() || isSearching}>
                                {isSearching ? t('searching') : tc('search')}
                            </button>
                        </form>

                        {searchError && <div className={styles.errorMessage}>{searchError}</div>}

                        {isSearching ? (
                            <div className={styles.emptyState}>{t('searchingSales')}</div>
                        ) : results.length === 0 ? (
                            <div className={styles.emptyState}>
                                {hasSearched ? t('noResults') : t('searchHint')}
                            </div>
                        ) : (
                            <ul className={styles.orderList}>
                                {results.map((order) => (
                                    <li key={order.orderId}>
                                        <button
                                            type="button"
                                            className={`${styles.orderCard} ${selectedOrder?.orderId === order.orderId ? styles.orderCardActive : ''}`}
                                            onClick={() => selectOrder(order)}
                                        >
                                            <span className={styles.orderCardTop}>
                                                <strong>#{order.orderNumber}</strong>
                                                <span className={styles.orderCardTotal}>{money(order.totalAmount)}</span>
                                            </span>
                                            <span className={styles.orderCardMeta}>
                                                {order.customerName} · {formatDate(order.createdAt)}
                                            </span>
                                            <span className={styles.orderCardMeta}>
                                                {order.source === 'POS' ? t('posSale') : t('onlineSale')}
                                                {order.branchName ? ` · ${order.branchName}` : ''}
                                                {order.nit ? ` · ${t('nit', { nit: order.nit })}` : ''}
                                            </span>
                                            {order.fullyReturned && (
                                                <span className={styles.badgeMuted}>{t('fullyReturned')}</span>
                                            )}
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </section>

                    {/* Derecha: armado de la devolución */}
                    <section className={styles.panel}>
                        <h2 className={styles.panelTitle}>
                            <RotateCcw size={18} /> {t('processTitle')}
                        </h2>

                        {receipt && <ReturnSummaryCard record={receipt} onDismiss={() => setReceipt(null)} />}

                        {!selectedOrder ? (
                            <div className={styles.emptyState}>
                                {t('selectSale')}
                            </div>
                        ) : (
                            <>
                                <div className={styles.orderRecap}>
                                    <span>
                                        {t.rich('saleRecap', { number: selectedOrder.orderNumber, customer: selectedOrder.customerName, strong: (chunks) => <strong>{chunks}</strong> })}
                                    </span>
                                    <span className={styles.orderCardMeta}>{formatDate(selectedOrder.createdAt)}</span>
                                </div>

                                <div className={styles.itemList}>
                                    {selectedOrder.items.map((item) => {
                                        const line = draft[item.orderItemId];
                                        const exhausted = item.returnableQuantity <= 0;

                                        return (
                                            <div
                                                key={item.orderItemId}
                                                className={`${styles.itemCard} ${exhausted ? styles.itemCardDisabled : ''}`}
                                            >
                                                <label className={styles.itemHeader}>
                                                    <input
                                                        type="checkbox"
                                                        checked={!!line}
                                                        disabled={exhausted}
                                                        onChange={() => toggleItem(item.orderItemId, item.returnableQuantity)}
                                                    />
                                                    <span className={styles.itemInfo}>
                                                        <span className={styles.itemName}>
                                                            {item.productName}
                                                            {item.size && <span className={styles.itemSize}>{t('sizeTag', { size: item.size })}</span>}
                                                        </span>
                                                        <span className={styles.itemMeta}>
                                                            {t('itemMeta', { price: money(item.unitPrice), sold: item.quantity })}
                                                            {item.alreadyReturned > 0 && t('alreadyReturned', { count: item.alreadyReturned })}
                                                        </span>
                                                    </span>
                                                    {exhausted ? (
                                                        <span className={styles.badgeMuted}>{t('noBalance')}</span>
                                                    ) : (
                                                        <span className={styles.badgeInfo}>{t('upTo', { count: item.returnableQuantity })}</span>
                                                    )}
                                                </label>

                                                {line && (
                                                    <div className={styles.itemForm}>
                                                        <label className={styles.field}>
                                                            <span>{t('quantity')}</span>
                                                            <input
                                                                type="number"
                                                                className={`${styles.input} ${styles.inputSmall}`}
                                                                min={1}
                                                                max={item.returnableQuantity}
                                                                step={1}
                                                                value={line.quantity}
                                                                onChange={(e) => {
                                                                    // Se acota al saldo de la línea: el backend igual lo revalida
                                                                    const next = Number(e.target.value);
                                                                    if (!Number.isFinite(next)) return;
                                                                    updateLine(item.orderItemId, {
                                                                        quantity: Math.max(1, Math.min(Math.trunc(next), item.returnableQuantity)),
                                                                    });
                                                                }}
                                                            />
                                                        </label>

                                                        <label className={styles.field}>
                                                            <span>{t('size')}</span>
                                                            {/* Solo lectura: la talla es la que se vendió, el backend la toma de la orden */}
                                                            <input
                                                                type="text"
                                                                className={`${styles.input} ${styles.inputSmall}`}
                                                                value={item.size ?? t('noSize')}
                                                                readOnly
                                                                aria-label={t('sizeLabel', { name: item.productName })}
                                                            />
                                                        </label>

                                                        <label className={styles.field}>
                                                            <span>{t('reason')}</span>
                                                            <select
                                                                className={styles.input}
                                                                value={line.reason}
                                                                onChange={(e) => updateLine(item.orderItemId, { reason: e.target.value as ReturnReason })}
                                                            >
                                                                {RETURN_REASONS.map((reason) => (
                                                                    <option key={reason} value={reason}>
                                                                        {t(`reasons.${reason}`)}
                                                                    </option>
                                                                ))}
                                                            </select>
                                                        </label>

                                                        <fieldset className={styles.conditionGroup}>
                                                            <legend>{t('condition')}</legend>
                                                            {ITEM_CONDITIONS.map((condition) => (
                                                                <label key={condition} className={styles.radioOption}>
                                                                    <input
                                                                        type="radio"
                                                                        name={`condition-${item.orderItemId}`}
                                                                        checked={line.condition === condition}
                                                                        onChange={() => updateLine(item.orderItemId, { condition })}
                                                                    />
                                                                    <span>{t(`conditions.${condition}`)}</span>
                                                                </label>
                                                            ))}
                                                        </fieldset>

                                                        <p className={styles.conditionHint}>
                                                            {line.condition === 'SELLABLE'
                                                                ? branchName
                                                                    ? t('sellableHintBranch', { branch: branchName })
                                                                    : t('sellableHint')
                                                                : t('damagedHint')}
                                                        </p>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>

                                <label className={styles.field}>
                                    <span>{t('notes')}</span>
                                    <textarea
                                        className={styles.textarea}
                                        rows={2}
                                        maxLength={500}
                                        placeholder={t('notesPlaceholder')}
                                        value={notes}
                                        onChange={(e) => setNotes(e.target.value)}
                                    />
                                </label>

                                <div className={styles.totals}>
                                    <div className={styles.totalRow}>
                                        <span>{t('toRefund')}</span>
                                        <strong>{money(summary.refund)}</strong>
                                    </div>
                                    <div className={styles.totalMeta}>
                                        <span><PackageCheck size={14} /> {t('toSellable', { count: summary.sellable })}</span>
                                        <span><TriangleAlert size={14} /> {t('toDamaged', { count: summary.damaged })}</span>
                                    </div>
                                </div>

                                {processError && <div className={styles.errorMessage}>{processError}</div>}

                                <button
                                    type="button"
                                    className={styles.processButton}
                                    disabled={summary.lines === 0 || isProcessing}
                                    onClick={handleProcess}
                                >
                                    {isProcessing ? t('processing') : t('process', { amount: money(summary.refund) })}
                                </button>
                            </>
                        )}
                    </section>
                </div>
            )}
        </div>
    );
}

// Comprobante de lo que acaba de pasar, con el detalle de a qué inventario fue cada prenda
function ReturnSummaryCard({ record, onDismiss }: { record: ReturnRecord; onDismiss: () => void }) {
    const t = useTranslations('AdminReturns');
    const tc = useTranslations('AdminCommon');
    const locale = useLocale();

    return (
        <div className={styles.successCard}>
            <div className={styles.successHeader}>
                <CheckCircle2 size={18} />
                <span>{t('registered', { number: record.returnNumber })}</span>
                <button type="button" className={styles.linkButton} onClick={onDismiss}>{tc('close')}</button>
            </div>

            <p className={styles.successTotal}>{t.rich('refunded', { amount: formatMoney(record.totalRefunded, locale), strong: (chunks) => <strong>{chunks}</strong> })}</p>

            <ul className={styles.successList}>
                {record.items.map((item) => (
                    <li key={item.id}>
                        {item.quantity} × {item.productName}
                        {item.size ? ` (${item.size})` : ''} —{' '}
                        {item.condition === 'SELLABLE' ? t('wentSellable') : t('wentDamaged')}
                    </li>
                ))}
            </ul>

            <p className={styles.successMeta}>
                {t('unitsSummary', { sellable: record.sellableUnits, damaged: record.damagedUnits })}
                {record.branchName ? ` · ${record.branchName}` : ''}
            </p>
        </div>
    );
}

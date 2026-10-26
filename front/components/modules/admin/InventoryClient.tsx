'use client';

import React, { useState } from 'react';
import { CloudOff, RefreshCw } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import styles from './admin-table.module.scss';
import { InventoryRow, useInventory } from '@/hooks/useInventory';
import { useAdminBranches } from '@/hooks/useAdminBranches';
import { useAdminRole } from '@/hooks/useAdminAccess';
import { useReturnHistory } from '@/hooks/useReturns';
import { useOfflineInventorySync } from '@/hooks/useOfflineInventorySync';
import { getApiErrorMessage } from '@/service/api/error.utils';
import { ProductDiscountPayload, SetInventoryPayload } from '@/types/admin.types';
import { formatMoney, intlLocale } from '@/i18n/config';

const toNumberOrNull = (value: string): number | null => (value.trim() === '' ? null : Number(value));
const toDraft = (value: number | null): string => (value != null ? String(value) : '');

interface InventoryRowEditorProps {
    row: InventoryRow;
    isGlobal: boolean;
    branchName?: string;
    onSave: (productId: string, payload: SetInventoryPayload, productName?: string) => Promise<{ isOffline: boolean } | void>;
    onApplyToAll: (productId: string, discount: ProductDiscountPayload) => Promise<void>;
    // Abre el historial de devoluciones de esta prenda (pestaña de auditoría)
    onViewReturns: (productId: string) => void;
    isPendingSync?: boolean;
}

function InventoryRowEditor({ row, isGlobal, branchName, onSave, onApplyToAll, onViewReturns, isPendingSync }: InventoryRowEditorProps) {
    const { product } = row;
    const t = useTranslations('AdminInventory');
    const tc = useTranslations('AdminCommon');
    const locale = useLocale();
    // Un draft de stock por talla (clave = talla), en vez de un solo input general
    const [sizeDrafts, setSizeDrafts] = useState<Record<string, string>>(
        () => Object.fromEntries(row.sizes.map((s) => [s.size, String(s.stock)])),
    );
    const [discountPrice, setDiscountPrice] = useState(toDraft(row.discountPrice));
    const [discountPercentage, setDiscountPercentage] = useState(toDraft(row.discountPercentage));
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);

    const isDirty =
        row.sizes.some((s) => sizeDrafts[s.size] !== String(s.stock)) ||
        toNumberOrNull(discountPrice) !== row.discountPrice ||
        toNumberOrNull(discountPercentage) !== row.discountPercentage;

    const markEdited = () => setMessage(null);

    const setSizeDraft = (size: string, value: string) => {
        setSizeDrafts((prev) => ({ ...prev, [size]: value }));
        markEdited();
    };

    // Devuelve el descuento validado o un mensaje de error
    const readDiscount = (): { discount: ProductDiscountPayload } | { error: string } => {
        const price = toNumberOrNull(discountPrice);
        if (price !== null && (Number.isNaN(price) || price < 0 || price >= Number(product.price))) {
            return { error: t('errors.salePrice') };
        }
        const pct = toNumberOrNull(discountPercentage);
        if (pct !== null && (!Number.isInteger(pct) || pct < 0 || pct > 100)) {
            return { error: t('errors.percentage') };
        }
        return { discount: { discountPrice: price, discountPercentage: pct } };
    };

    const run = async (action: () => Promise<string>) => {
        setIsSaving(true);
        setError(null);
        setMessage(null);
        try {
            setMessage(await action());
        } catch (error) {
            setError(getApiErrorMessage(error, t('errors.saveFailed')));
        } finally {
            setIsSaving(false);
        }
    };

    // Guarda el stock de cada talla y el descuento de esta sucursal en una sola llamada
    const handleSave = () => {
        const sizes: { size: string; stock: number }[] = [];
        for (const { size } of row.sizes) {
            const draft = sizeDrafts[size] ?? '';
            const value = Number(draft);
            if (draft.trim() === '' || !Number.isInteger(value) || value < 0) {
                setError(t('errors.sizeStock', { size }));
                return;
            }
            sizes.push({ size, stock: value });
        }

        const result = readDiscount();
        if ('error' in result) {
            setError(result.error);
            return;
        }

        run(async () => {
            const res = await onSave(product.id, { sizes, ...result.discount }, product.name);
            if (res && res.isOffline) {
                return t('savedOffline');
            }
            return t('saved');
        });
    };

    // SUPERADMIN: copia el descuento escrito a todas las sucursales
    const handleApplyToAll = () => {
        const result = readDiscount();
        if ('error' in result) {
            setError(result.error);
            return;
        }
        const removing = result.discount.discountPrice === null && result.discount.discountPercentage === null;
        const question = removing
            ? t('confirmRemoveAll', { name: product.name })
            : t('confirmApplyAll', { name: product.name });
        if (!window.confirm(question)) return;

        run(async () => {
            await onApplyToAll(product.id, result.discount);
            return t('appliedAll');
        });
    };

    return (
        <tr>
            <td>
                <div className={styles.cellMain}>
                    <span className={styles.cellTitle}>{product.name}</span>
                    <span className={styles.cellSub}>{t('sku', { sku: product.sku })}</span>
                    {isPendingSync && (
                        <span className={`${styles.badge} ${styles.badgeWarning}`}>
                            {t('pendingSync')}
                        </span>
                    )}
                </div>
            </td>
            <td className={styles.numeric}>{formatMoney(Number(product.price), locale)}</td>
            <td>
                <input
                    type="number"
                    min={0}
                    step="0.01"
                    className={`${styles.input} ${styles.inputSmall}`}
                    value={discountPrice}
                    onChange={(e) => { setDiscountPrice(e.target.value); markEdited(); }}
                    placeholder="—"
                    aria-label={branchName ? t('salePriceLabelBranch', { name: product.name, branch: branchName }) : t('salePriceLabel', { name: product.name })}
                />
            </td>
            <td>
                <input
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    className={`${styles.input} ${styles.inputSmall}`}
                    value={discountPercentage}
                    onChange={(e) => { setDiscountPercentage(e.target.value); markEdited(); }}
                    placeholder="—"
                    aria-label={branchName ? t('discountLabelBranch', { name: product.name, branch: branchName }) : t('discountLabel', { name: product.name })}
                />
            </td>
            <td>
                <div className={styles.sizeStockGroup}>
                    {row.sizes.map(({ size }) => (
                        <label key={size} className={styles.sizeStockField}>
                            <span>{size}</span>
                            <input
                                type="number"
                                min={0}
                                step={1}
                                className={`${styles.input} ${styles.inputSmall}`}
                                value={sizeDrafts[size] ?? ''}
                                onChange={(e) => setSizeDraft(size, e.target.value)}
                                aria-label={t('sizeStockLabel', { name: product.name, size })}
                            />
                        </label>
                    ))}
                </div>
            </td>
            {/* Mermas: unidades devueltas en mal estado. Van aparte del stock vendible (no se pueden
                vender) y solo se muestran para auditoría o para dar de baja la prenda. */}
            <td>
                {row.damagedStock === 0 ? (
                    <span className={styles.cellSub}>—</span>
                ) : (
                    <div className={styles.cellMain}>
                        <span className={`${styles.badge} ${styles.badgeDanger}`}>{t('damagedCount', { count: row.damagedStock })}</span>
                        <span className={styles.cellSub}>
                            {row.sizes
                                .filter((size) => (size.damagedStock ?? 0) > 0)
                                .map((size) => `${size.size}: ${size.damagedStock}`)
                                .join(' · ')}
                        </span>
                    </div>
                )}
                <button type="button" className={styles.linkButton} onClick={() => onViewReturns(product.id)}>
                    {t('viewReturns')}
                </button>
            </td>
            <td>
                <div className={styles.actions}>
                    {message && !isDirty && <span className={`${styles.badge} ${styles.badgeSuccess}`}>{message}</span>}
                    <button type="button" className={styles.button} onClick={handleSave} disabled={!isDirty || isSaving}>
                        {isSaving ? tc('saving') : tc('save')}
                    </button>
                    {isGlobal && (
                        <button type="button" className={styles.buttonSecondary} onClick={handleApplyToAll} disabled={isSaving}>
                            {t('applyToAll')}
                        </button>
                    )}
                </div>
                {error && <span className={styles.rowError}>{error}</span>}
            </td>
        </tr>
    );
}

// Auditoría: historial de devoluciones de la sucursal, o de una sola prenda. Una fila por prenda
// devuelta, con el estado en que volvió (que es lo que decidió si sumó al stock o a las mermas).
function ReturnsAuditPanel({
    branchId,
    productId,
    productName,
    onClearProduct,
}: {
    branchId: string | null;
    productId?: string;
    productName?: string;
    onClearProduct: () => void;
}) {
    const { returns, isLoading, error } = useReturnHistory({ productId, branchId, enabled: !!branchId });
    const t = useTranslations('AdminInventory.audit');
    const tr = useTranslations('AdminReturns');
    const tc = useTranslations('AdminCommon');
    const locale = useLocale();

    const rows = returns.flatMap((record) =>
        record.items.map((item) => ({ record, item, key: item.id })),
    );

    return (
        <>
            {productId && (
                <div className={styles.toolbar}>
                    <span className={`${styles.badge} ${styles.badgeInfo}`}>
                        {t('onlyProduct', { name: productName ?? t('selectedProduct') })}
                    </span>
                    <button type="button" className={styles.linkButton} onClick={onClearProduct}>
                        {t('viewAll')}
                    </button>
                </div>
            )}

            {error && <div className={styles.errorMessage}>{error}</div>}

            <div className={styles.tableCard}>
                {isLoading ? (
                    <div className={styles.loadingState}>{t('loading')}</div>
                ) : rows.length === 0 ? (
                    <div className={styles.emptyState}>
                        {productId ? t('emptyProduct') : t('empty')}
                    </div>
                ) : (
                    <div className={styles.tableWrapper}>
                        <table className={styles.table}>
                            <thead>
                                <tr>
                                    <th>{tc('date')}</th>
                                    <th>{t('item')}</th>
                                    <th>{t('size')}</th>
                                    <th className={styles.numeric}>{t('quantity')}</th>
                                    <th>{t('reason')}</th>
                                    <th>{t('condition')}</th>
                                    <th className={styles.numeric}>{t('refund')}</th>
                                    <th>{t('saleReturn')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map(({ record, item, key }) => (
                                    <tr key={key}>
                                        <td>{formatDate(record.createdAt, locale)}</td>
                                        <td>
                                            <div className={styles.cellMain}>
                                                <span className={styles.cellTitle}>{item.productName}</span>
                                                <span className={styles.cellSub}>SKU: {item.sku}</span>
                                            </div>
                                        </td>
                                        <td>{item.size ?? '—'}</td>
                                        <td className={styles.numeric}>{item.quantity}</td>
                                        <td>{tr(`reasons.${item.reason}`)}</td>
                                        <td>
                                            <span
                                                className={`${styles.badge} ${item.condition === 'SELLABLE' ? styles.badgeSuccess : styles.badgeDanger}`}
                                            >
                                                {tr(`conditions.${item.condition}`)}
                                            </span>
                                        </td>
                                        <td className={styles.numeric}>{formatMoney(item.subtotal, locale)}</td>
                                        <td>
                                            <div className={styles.cellMain}>
                                                <span className={styles.cellSub}>{t('sale', { number: record.orderNumber })}</span>
                                                <span className={styles.cellSub}>{t('cashier', { name: record.cashierName })}</span>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </>
    );
}

const formatDate = (value: string, locale: string) =>
    new Date(value).toLocaleDateString(intlLocale(locale), { day: '2-digit', month: 'short', year: 'numeric' });

export default function InventoryClient() {
    const { isGlobal, branchId: ownBranchId } = useAdminRole();
    const { branches, isLoading: branchesLoading } = useAdminBranches();
    const t = useTranslations('AdminInventory');
    const tc = useTranslations('AdminCommon');
    const [chosenBranchId, setChosenBranchId] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    const [activeTab, setActiveTab] = useState<'stock' | 'returns'>('stock');
    // Prenda cuyo historial se está viendo (se fija al pulsar "Ver devoluciones" en su fila)
    const [returnsProductId, setReturnsProductId] = useState<string | undefined>(undefined);

    // SUPERADMIN elige la sucursal; ADMIN_SUCURSAL queda fijo en la suya
    const branchId = isGlobal ? chosenBranchId ?? branches[0]?.id ?? null : ownBranchId;
    const branchName = branches.find((branch) => branch.id === branchId)?.name;

    const { rows, isLoading, error, saveInventory, applyDiscountToAllBranches } = useInventory(branchId);
    const { pendingCount, pendingUpdates, isSyncing, lastSyncError, lastSyncSuccess, syncNow } = useOfflineInventorySync();

    const pendingProductIds = new Set(
        pendingUpdates
            .filter((u) => !branchId || u.branchId === branchId)
            .map((u) => u.productId)
    );

    const term = search.trim().toLowerCase();
    const visibleRows = term
        ? rows.filter(({ product }) => product.name.toLowerCase().includes(term) || product.sku.toLowerCase().includes(term))
        : rows;

    const viewProductReturns = (productId: string) => {
        setReturnsProductId(productId);
        setActiveTab('returns');
    };
    const returnsProductName = rows.find(({ product }) => product.id === returnsProductId)?.product.name;
    // Total de mermas de la sucursal, para tener el dato de auditoría a la vista sin abrir el historial
    const totalDamaged = rows.reduce((sum, row) => sum + row.damagedStock, 0);

    return (
        <div className={styles.page}>
            <div className={styles.pageHeader}>
                <div>
                    <h1>{isGlobal ? t('title') : t('titleOwn')}</h1>
                    <p>
                        {isGlobal ? t('subtitleGlobal') : t('subtitleOwn', { branch: branchName ?? t('yourBranch') })}
                    </p>
                </div>

                <div className={styles.toolbar}>
                    {isGlobal && (
                        <select
                            className={styles.input}
                            value={branchId ?? ''}
                            onChange={(e) => setChosenBranchId(e.target.value)}
                            aria-label={tc('branch')}
                            disabled={branchesLoading || branches.length === 0}
                        >
                            {branches.map((branch) => (
                                <option key={branch.id} value={branch.id}>{branch.name}</option>
                            ))}
                        </select>
                    )}
                    {activeTab === 'stock' && (
                        <input
                            className={styles.input}
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder={t('searchPlaceholder')}
                            aria-label={t('searchLabel')}
                        />
                    )}
                </div>
            </div>

            {pendingCount > 0 && (
                <div className={styles.syncBanner} style={{ marginBottom: '1rem' }}>
                    <div className={styles.syncInfo}>
                        <CloudOff size={18} />
                        <span>
                            {t.rich('pendingBanner', { count: pendingCount, strong: (chunks) => <strong>{chunks}</strong> })}
                        </span>
                    </div>
                    <button
                        type="button"
                        className={styles.syncButton}
                        onClick={() => syncNow()}
                        disabled={isSyncing}
                    >
                        <RefreshCw size={14} className={isSyncing ? styles.spinner : ''} />
                        {isSyncing ? t('syncing') : t('syncNow')}
                    </button>
                </div>
            )}

            {lastSyncSuccess && (
                <div
                    className={`${styles.badge} ${styles.badgeSuccess}`}
                    style={{ padding: '0.625rem 1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', width: 'fit-content' }}
                >
                    {lastSyncSuccess}
                </div>
            )}

            {lastSyncError && (
                <div className={styles.errorMessage} style={{ marginBottom: '1rem' }}>
                    {lastSyncError}
                </div>
            )}

            <div className={styles.tabs}>
                <button
                    type="button"
                    className={`${styles.tab} ${activeTab === 'stock' ? styles.tabActive : ''}`}
                    onClick={() => setActiveTab('stock')}
                >
                    {t('tabStock')}
                </button>
                <button
                    type="button"
                    className={`${styles.tab} ${activeTab === 'returns' ? styles.tabActive : ''}`}
                    onClick={() => setActiveTab('returns')}
                >
                    {totalDamaged > 0 ? t('tabReturnsCount', { count: totalDamaged }) : t('tabReturns')}
                </button>
            </div>

            {error && <div className={styles.errorMessage}>{error}</div>}

            {activeTab === 'returns' ? (
                <ReturnsAuditPanel
                    branchId={branchId}
                    productId={returnsProductId}
                    productName={returnsProductName}
                    onClearProduct={() => setReturnsProductId(undefined)}
                />
            ) : (
            <div className={styles.tableCard}>
                {!branchId && !branchesLoading ? (
                    <div className={styles.emptyState}>{t('noBranch')}</div>
                ) : isLoading ? (
                    <div className={styles.loadingState}>{t('loading')}</div>
                ) : visibleRows.length === 0 ? (
                    <div className={styles.emptyState}>{t('noProducts')}</div>
                ) : (
                    <div className={styles.tableWrapper}>
                        <table className={styles.table}>
                            <thead>
                                <tr>
                                    <th>{t('product')}</th>
                                    <th className={styles.numeric}>{t('price')}</th>
                                    <th>{t('salePrice')}</th>
                                    <th>{t('discountPct')}</th>
                                    <th>{t('stockBySize')}</th>
                                    <th>{t('damaged')}</th>
                                    <th className={styles.numeric}>{tc('actions')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {visibleRows.map((row) => (
                                    <InventoryRowEditor
                                        key={`${branchId}-${row.product.id}`}
                                        row={row}
                                        isGlobal={isGlobal}
                                        branchName={branchName}
                                        onSave={saveInventory}
                                        onApplyToAll={applyDiscountToAllBranches}
                                        onViewReturns={viewProductReturns}
                                        isPendingSync={pendingProductIds.has(row.product.id)}
                                    />
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
            )}
        </div>
    );
}

'use client';

import React, { useState } from 'react';
import styles from './admin-table.module.scss';
import { InventoryRow, useInventory } from '@/hooks/useInventory';
import { useAdminBranches } from '@/hooks/useAdminBranches';
import { useAdminRole } from '@/hooks/useAdminAccess';
import { useReturnHistory } from '@/hooks/useReturns';
import { getApiErrorMessage } from '@/service/api/error.utils';
import { ProductDiscountPayload, SetInventoryPayload } from '@/types/admin.types';
import { ITEM_CONDITION_LABELS, RETURN_REASON_LABELS } from '@/types/returns.types';

const toNumberOrNull = (value: string): number | null => (value.trim() === '' ? null : Number(value));
const toDraft = (value: number | null): string => (value != null ? String(value) : '');

interface InventoryRowEditorProps {
    row: InventoryRow;
    isGlobal: boolean;
    branchName?: string;
    onSave: (productId: string, payload: SetInventoryPayload) => Promise<void>;
    onApplyToAll: (productId: string, discount: ProductDiscountPayload) => Promise<void>;
    // Abre el historial de devoluciones de esta prenda (pestaña de auditoría)
    onViewReturns: (productId: string) => void;
}

function InventoryRowEditor({ row, isGlobal, branchName, onSave, onApplyToAll, onViewReturns }: InventoryRowEditorProps) {
    const { product } = row;
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
            return { error: 'El precio de oferta debe ser menor al precio normal.' };
        }
        const pct = toNumberOrNull(discountPercentage);
        if (pct !== null && (!Number.isInteger(pct) || pct < 0 || pct > 100)) {
            return { error: 'El porcentaje debe ser un entero entre 0 y 100.' };
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
            setError(getApiErrorMessage(error, 'No se pudieron guardar los cambios.'));
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
                setError(`El stock de la talla ${size} debe ser un entero mayor o igual a 0.`);
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
            await onSave(product.id, { sizes, ...result.discount });
            return 'Guardado';
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
            ? `¿Quitar el descuento de "${product.name}" en TODAS las sucursales?`
            : `¿Aplicar este descuento a "${product.name}" en TODAS las sucursales? Reemplaza el descuento actual de cada una.`;
        if (!window.confirm(question)) return;

        run(async () => {
            await onApplyToAll(product.id, result.discount);
            return 'Aplicado a todas las sucursales';
        });
    };

    return (
        <tr>
            <td>
                <div className={styles.cellMain}>
                    <span className={styles.cellTitle}>{product.name}</span>
                    <span className={styles.cellSub}>SKU: {product.sku}</span>
                </div>
            </td>
            <td className={styles.numeric}>Bs {Number(product.price).toFixed(2)}</td>
            <td>
                <input
                    type="number"
                    min={0}
                    step="0.01"
                    className={`${styles.input} ${styles.inputSmall}`}
                    value={discountPrice}
                    onChange={(e) => { setDiscountPrice(e.target.value); markEdited(); }}
                    placeholder="—"
                    aria-label={`Precio de oferta de ${product.name}${branchName ? ` en ${branchName}` : ''}`}
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
                    aria-label={`Porcentaje de descuento de ${product.name}${branchName ? ` en ${branchName}` : ''}`}
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
                                aria-label={`Stock de ${product.name}, talla ${size}`}
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
                        <span className={`${styles.badge} ${styles.badgeDanger}`}>{row.damagedStock} en mermas</span>
                        <span className={styles.cellSub}>
                            {row.sizes
                                .filter((size) => (size.damagedStock ?? 0) > 0)
                                .map((size) => `${size.size}: ${size.damagedStock}`)
                                .join(' · ')}
                        </span>
                    </div>
                )}
                <button type="button" className={styles.linkButton} onClick={() => onViewReturns(product.id)}>
                    Ver devoluciones
                </button>
            </td>
            <td>
                <div className={styles.actions}>
                    {message && !isDirty && <span className={`${styles.badge} ${styles.badgeSuccess}`}>{message}</span>}
                    <button type="button" className={styles.button} onClick={handleSave} disabled={!isDirty || isSaving}>
                        {isSaving ? 'Guardando...' : 'Guardar'}
                    </button>
                    {isGlobal && (
                        <button type="button" className={styles.buttonSecondary} onClick={handleApplyToAll} disabled={isSaving}>
                            Aplicar descuento a todas las sucursales
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

    const rows = returns.flatMap((record) =>
        record.items.map((item) => ({ record, item, key: item.id })),
    );

    return (
        <>
            {productId && (
                <div className={styles.toolbar}>
                    <span className={`${styles.badge} ${styles.badgeInfo}`}>
                        Solo devoluciones de {productName ?? 'la prenda seleccionada'}
                    </span>
                    <button type="button" className={styles.linkButton} onClick={onClearProduct}>
                        Ver todas las devoluciones
                    </button>
                </div>
            )}

            {error && <div className={styles.errorMessage}>{error}</div>}

            <div className={styles.tableCard}>
                {isLoading ? (
                    <div className={styles.loadingState}>Cargando devoluciones...</div>
                ) : rows.length === 0 ? (
                    <div className={styles.emptyState}>
                        {productId
                            ? 'Esta prenda no tiene devoluciones registradas en esta sucursal.'
                            : 'Todavía no se registraron devoluciones en esta sucursal.'}
                    </div>
                ) : (
                    <div className={styles.tableWrapper}>
                        <table className={styles.table}>
                            <thead>
                                <tr>
                                    <th>Fecha</th>
                                    <th>Prenda</th>
                                    <th>Talla</th>
                                    <th className={styles.numeric}>Cant.</th>
                                    <th>Motivo</th>
                                    <th>Estado en que volvió</th>
                                    <th className={styles.numeric}>Reembolso</th>
                                    <th>Venta / Devolución</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map(({ record, item, key }) => (
                                    <tr key={key}>
                                        <td>{formatDate(record.createdAt)}</td>
                                        <td>
                                            <div className={styles.cellMain}>
                                                <span className={styles.cellTitle}>{item.productName}</span>
                                                <span className={styles.cellSub}>SKU: {item.sku}</span>
                                            </div>
                                        </td>
                                        <td>{item.size ?? '—'}</td>
                                        <td className={styles.numeric}>{item.quantity}</td>
                                        <td>{RETURN_REASON_LABELS[item.reason]}</td>
                                        <td>
                                            <span
                                                className={`${styles.badge} ${item.condition === 'SELLABLE' ? styles.badgeSuccess : styles.badgeDanger}`}
                                            >
                                                {ITEM_CONDITION_LABELS[item.condition]}
                                            </span>
                                        </td>
                                        <td className={styles.numeric}>Bs {item.subtotal.toFixed(2)}</td>
                                        <td>
                                            <div className={styles.cellMain}>
                                                <span className={styles.cellSub}>Venta #{record.orderNumber}</span>
                                                <span className={styles.cellSub}>Atendió: {record.cashierName}</span>
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

const formatDate = (value: string) =>
    new Date(value).toLocaleDateString('es-BO', { day: '2-digit', month: 'short', year: 'numeric' });

export default function InventoryClient() {
    const { isGlobal, branchId: ownBranchId } = useAdminRole();
    const { branches, isLoading: branchesLoading } = useAdminBranches();
    const [chosenBranchId, setChosenBranchId] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    const [activeTab, setActiveTab] = useState<'stock' | 'returns'>('stock');
    // Prenda cuyo historial se está viendo (se fija al pulsar "Ver devoluciones" en su fila)
    const [returnsProductId, setReturnsProductId] = useState<string | undefined>(undefined);

    // SUPERADMIN elige la sucursal; ADMIN_SUCURSAL queda fijo en la suya
    const branchId = isGlobal ? chosenBranchId ?? branches[0]?.id ?? null : ownBranchId;
    const branchName = branches.find((branch) => branch.id === branchId)?.name;

    const { rows, isLoading, error, saveInventory, applyDiscountToAllBranches } = useInventory(branchId);

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
                    <h1>{isGlobal ? 'Inventario y Ofertas' : 'Mi Inventario'}</h1>
                    <p>
                        {isGlobal
                            ? 'Actualiza el stock y las ofertas de cada sucursal, o aplica una oferta a todas a la vez.'
                            : `Actualiza el stock y las ofertas de ${branchName ?? 'tu sucursal'}. Las ofertas solo afectan a tu sucursal.`}
                    </p>
                </div>

                <div className={styles.toolbar}>
                    {isGlobal && (
                        <select
                            className={styles.input}
                            value={branchId ?? ''}
                            onChange={(e) => setChosenBranchId(e.target.value)}
                            aria-label="Sucursal"
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
                            placeholder="Buscar por nombre o SKU"
                            aria-label="Buscar producto"
                        />
                    )}
                </div>
            </div>

            <div className={styles.tabs}>
                <button
                    type="button"
                    className={`${styles.tab} ${activeTab === 'stock' ? styles.tabActive : ''}`}
                    onClick={() => setActiveTab('stock')}
                >
                    Stock y ofertas
                </button>
                <button
                    type="button"
                    className={`${styles.tab} ${activeTab === 'returns' ? styles.tabActive : ''}`}
                    onClick={() => setActiveTab('returns')}
                >
                    Devoluciones y mermas{totalDamaged > 0 ? ` (${totalDamaged})` : ''}
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
                    <div className={styles.emptyState}>No hay una sucursal para mostrar el inventario.</div>
                ) : isLoading ? (
                    <div className={styles.loadingState}>Cargando inventario...</div>
                ) : visibleRows.length === 0 ? (
                    <div className={styles.emptyState}>No se encontraron productos.</div>
                ) : (
                    <div className={styles.tableWrapper}>
                        <table className={styles.table}>
                            <thead>
                                <tr>
                                    <th>Producto</th>
                                    <th className={styles.numeric}>Precio</th>
                                    <th>Precio oferta</th>
                                    <th>% descuento</th>
                                    <th>Stock por talla</th>
                                    <th>Mermas</th>
                                    <th className={styles.numeric}>Acciones</th>
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

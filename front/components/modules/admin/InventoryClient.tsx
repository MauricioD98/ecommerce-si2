'use client';

import React, { useState } from 'react';
import styles from './admin-table.module.scss';
import { InventoryRow, useInventory } from '@/hooks/useInventory';
import { useAdminBranches } from '@/hooks/useAdminBranches';
import { useAdminRole } from '@/hooks/useAdminAccess';
import { getApiErrorMessage } from '@/service/api/error.utils';
import { ProductDiscountPayload, SetInventoryPayload } from '@/types/admin.types';

const toNumberOrNull = (value: string): number | null => (value.trim() === '' ? null : Number(value));
const toDraft = (value: number | null): string => (value != null ? String(value) : '');

interface InventoryRowEditorProps {
    row: InventoryRow;
    isGlobal: boolean;
    branchName?: string;
    onSave: (productId: string, payload: SetInventoryPayload) => Promise<void>;
    onApplyToAll: (productId: string, discount: ProductDiscountPayload) => Promise<void>;
}

function InventoryRowEditor({ row, isGlobal, branchName, onSave, onApplyToAll }: InventoryRowEditorProps) {
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

export default function InventoryClient() {
    const { isGlobal, branchId: ownBranchId } = useAdminRole();
    const { branches, isLoading: branchesLoading } = useAdminBranches();
    const [chosenBranchId, setChosenBranchId] = useState<string | null>(null);
    const [search, setSearch] = useState('');

    // SUPERADMIN elige la sucursal; ADMIN_SUCURSAL queda fijo en la suya
    const branchId = isGlobal ? chosenBranchId ?? branches[0]?.id ?? null : ownBranchId;
    const branchName = branches.find((branch) => branch.id === branchId)?.name;

    const { rows, isLoading, error, saveInventory, applyDiscountToAllBranches } = useInventory(branchId);

    const term = search.trim().toLowerCase();
    const visibleRows = term
        ? rows.filter(({ product }) => product.name.toLowerCase().includes(term) || product.sku.toLowerCase().includes(term))
        : rows;

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
                    <input
                        className={styles.input}
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Buscar por nombre o SKU"
                        aria-label="Buscar producto"
                    />
                </div>
            </div>

            {error && <div className={styles.errorMessage}>{error}</div>}

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
                                    />
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}

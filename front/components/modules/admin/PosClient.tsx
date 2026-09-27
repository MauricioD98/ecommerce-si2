'use client';

import React, { useRef, useState } from 'react';
import { Banknote, CreditCard, Minus, Plus, QrCode, Search, ShoppingCart, Trash2 } from 'lucide-react';
import styles from './pos.module.scss';
import { useAdminRole } from '@/hooks/useAdminAccess';
import { useAdminBranches } from '@/hooks/useAdminBranches';
import { usePosCatalog } from '@/hooks/usePos';
import { PosService } from '@/service/api/pos.service';
import { getApiErrorMessage } from '@/service/api/error.utils';
import { round2 } from '@/utils/pricing';
import { Product } from '@/types/product.types';
import { PosPaymentMethod, PosReceipt } from '@/types/pos.types';
import PosReceiptModal from './PosReceiptModal';

interface TicketLine {
    product: Product;
    size: string;
    quantity: number;
}

const PAYMENT_METHODS: { value: PosPaymentMethod; label: string; icon: React.ReactNode }[] = [
    { value: 'CASH', label: 'Efectivo', icon: <Banknote size={18} /> },
    { value: 'PHYSICAL_CARD', label: 'Tarjeta (POS)', icon: <CreditCard size={18} /> },
    { value: 'QR', label: 'QR / Transferencia', icon: <QrCode size={18} /> },
];

export default function PosClient() {
    const { isGlobal, branchId: cashierBranchId } = useAdminRole();
    const { branches } = useAdminBranches();
    const [selectedBranchId, setSelectedBranchId] = useState('');

    const effectiveBranchId = isGlobal ? selectedBranchId || null : cashierBranchId;

    const [searchInput, setSearchInput] = useState('');
    const [search, setSearch] = useState('');
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const { products, isLoading: isLoadingProducts, error: catalogError, refetch: refetchCatalog } = usePosCatalog(effectiveBranchId, search);

    const [ticket, setTicket] = useState<TicketLine[]>([]);
    const [pendingSizeProductId, setPendingSizeProductId] = useState<string | null>(null);
    const [paymentMethod, setPaymentMethod] = useState<PosPaymentMethod>('CASH');
    const [amountReceivedInput, setAmountReceivedInput] = useState('');
    const [nit, setNit] = useState('');
    const [razonSocial, setRazonSocial] = useState('');
    const [isCharging, setIsCharging] = useState(false);
    const [checkoutError, setCheckoutError] = useState<string | null>(null);
    const [receipt, setReceipt] = useState<PosReceipt | null>(null);

    const handleSearchChange = (value: string) => {
        setSearchInput(value);
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => setSearch(value.trim()), 300);
    };

    // El catálogo del POS siempre se pide con sucursal, así que `stockBySize` trae una entrada por
    // cada talla del producto en esa sucursal, con 0 incluido. Una talla sin entrada no tiene
    // inventario acá: es 0, nunca el stock global (que suma todas las sucursales y todas las tallas,
    // y hacía que una talla agotada se viera vendible).
    const getSizeStock = (product: Product, size: string): number => {
        const source = product as Product & {
            inventory?: { sizes?: { size: string; stock: number }[] } | { size: string; stock: number }[] | null;
        };

        let arrayToSearch: { size: string; stock: number }[] | null = null;
        if (Array.isArray(source.stockBySize)) arrayToSearch = source.stockBySize;
        else if (Array.isArray(source.inventory)) arrayToSearch = source.inventory;
        else if (!Array.isArray(source.inventory) && Array.isArray(source.inventory?.sizes)) {
            arrayToSearch = source.inventory.sizes;
        }

        // Con desglose por talla, una talla ausente es 0: nunca el stock global (que suma sucursales).
        if (arrayToSearch) return arrayToSearch.find((row) => row.size === size)?.stock ?? 0;
        return product.stock ?? 0;
    };

    const addToTicket = (product: Product, size: string) => {
        const sizeStock = getSizeStock(product, size);
        if (sizeStock <= 0) {
            setCheckoutError(`"${product.name}" no tiene stock en la talla ${size} en esta sucursal.`);
            return;
        }

        // El techo de cada línea es el stock de ESA talla, no el del producto entero
        const existing = ticket.find((line) => line.product.id === product.id && line.size === size);
        if (existing && existing.quantity >= sizeStock) {
            setCheckoutError(
                `Solo ${sizeStock} ${sizeStock === 1 ? 'unidad' : 'unidades'} de "${product.name}" en talla ${size} en esta sucursal.`,
            );
            return;
        }

        setCheckoutError(null);
        setPendingSizeProductId(null);
        setTicket((prev) =>
            existing
                ? prev.map((line) =>
                      line.product.id === product.id && line.size === size ? { ...line, quantity: line.quantity + 1 } : line,
                  )
                : [...prev, { product, size, quantity: 1 }],
        );
    };

    const handleCardClick = (product: Product) => {
        if (product.stock <= 0) return;
        if (product.sizes.length <= 1) {
            addToTicket(product, product.sizes[0] ?? '');
            return;
        }
        setPendingSizeProductId((prev) => (prev === product.id ? null : product.id));
    };

    const changeQuantity = (productId: string, size: string, delta: number) => {
        setTicket((prev) =>
            prev.map((line) => {
                if (line.product.id !== productId || line.size !== size) return line;
                // Techo = stock de esa talla en la sucursal; piso = 1 (para bajar de 1 está el botón
                // de quitar). El Math.max va al final a propósito: si la talla quedó en 0 mientras el
                // ticket estaba abierto, el orden inverso dejaba la línea en cantidad 0.
                const maxForSize = getSizeStock(line.product, line.size);
                return { ...line, quantity: Math.max(Math.min(line.quantity + delta, maxForSize), 1) };
            }),
        );
    };

    const removeLine = (productId: string, size: string) => {
        setTicket((prev) => prev.filter((line) => !(line.product.id === productId && line.size === size)));
    };

    const total = round2(
        ticket.reduce((sum, line) => sum + (line.product.effectivePrice ?? line.product.price) * line.quantity, 0),
    );

    const amountReceived = amountReceivedInput === '' ? null : Number(amountReceivedInput);
    const change = paymentMethod === 'CASH' && amountReceived !== null ? round2(amountReceived - total) : null;
    const cashBlocked = paymentMethod === 'CASH' && (amountReceived === null || amountReceived < total);

    const resetTicketState = () => {
        setTicket([]);
        setPendingSizeProductId(null);
        setSearchInput('');
        setSearch('');
        setAmountReceivedInput('');
        setNit('');
        setRazonSocial('');
        setPaymentMethod('CASH');
    };

    const handleCharge = async () => {
        if (ticket.length === 0 || !effectiveBranchId || isCharging || cashBlocked) return;

        const invalidLine = ticket.find((line) => getSizeStock(line.product, line.size) < line.quantity);
        if (invalidLine) {
            setCheckoutError(
                `"${invalidLine.product.name}" (${invalidLine.size}) ya no tiene stock suficiente. Quítalo o ajusta la cantidad del ticket.`,
            );
            return;
        }

        setIsCharging(true);
        setCheckoutError(null);
        try {
            const response = await PosService.checkout({
                items: ticket.map((line) => ({ productId: line.product.id, quantity: line.quantity, size: line.size })),
                paymentMethod,
                branchId: effectiveBranchId,
                ...(paymentMethod === 'CASH' && amountReceived !== null ? { amountReceived } : {}),
                ...(nit.trim() ? { nit: nit.trim() } : {}),
                ...(razonSocial.trim() ? { razonSocial: razonSocial.trim() } : {}),
            });
            setReceipt(response.data);
            resetTicketState();

            // Retrasamos el refresco medio segundo para darle tiempo a PostgreSQL de guardar la venta
            setTimeout(() => {
                refetchCatalog();
            }, 500);

        } catch (error) {
            setCheckoutError(getApiErrorMessage(error, 'No se pudo completar la venta.'));
        } finally {
            setIsCharging(false);
        }
    };

    return (
        <div className={styles.page}>
            <div className={styles.pageHeader}>
                <div>
                    <h1>Punto de Venta</h1>
                    <p>Cobra ventas físicas en mostrador. El inventario se descuenta de la misma sucursal que la tienda en línea.</p>
                </div>

                {isGlobal && (
                    <select
                        className={styles.branchSelect}
                        value={selectedBranchId}
                        onChange={(e) => setSelectedBranchId(e.target.value)}
                    >
                        <option value="">Selecciona una sucursal</option>
                        {branches.filter((b) => b.isActive).map((branch) => (
                            <option key={branch.id} value={branch.id}>{branch.name}</option>
                        ))}
                    </select>
                )}
            </div>

            {!effectiveBranchId ? (
                <div className={styles.emptyState}>Selecciona una sucursal para empezar a cobrar.</div>
            ) : (
                <div className={styles.layout}>
                    <div className={styles.catalog}>
                        <div className={styles.searchBar}>
                            <Search size={18} />
                            <input
                                type="text"
                                placeholder="Buscar producto por nombre..."
                                value={searchInput}
                                onChange={(e) => handleSearchChange(e.target.value)}
                            />
                        </div>

                        {catalogError && <div className={styles.errorMessage}>{catalogError}</div>}

                        {isLoadingProducts ? (
                            <div className={styles.emptyState}>Cargando productos...</div>
                        ) : products.length === 0 ? (
                            <div className={styles.emptyState}>No se encontraron productos.</div>
                        ) : (
                            <div className={styles.productGrid}>
                                {products.map((product) => (
                                    <div key={product.id} className={styles.productCardWrapper}>
                                        <button
                                            type="button"
                                            className={styles.productCard}
                                            disabled={product.stock <= 0}
                                            onClick={() => handleCardClick(product)}
                                        >
                                            <img src={product.imageUrl} alt={product.name} className={styles.productImage} />
                                            <span className={styles.productName}>{product.name}</span>
                                            <span className={styles.productPrice}>Bs {(product.effectivePrice ?? product.price).toFixed(2)}</span>
                                            <span className={`${styles.stockBadge} ${product.stock <= 0 ? styles.stockBadgeOut : ''}`}>
                                                {product.stock <= 0 ? 'Sin stock' : `Stock: ${product.stock}`}
                                            </span>
                                        </button>

                                        {pendingSizeProductId === product.id && (
                                            <div className={styles.sizePicker}>
                                                <span className={styles.sizePickerLabel}>Talla</span>
                                                <div className={styles.sizePickerOptions}>
                                                    {product.sizes.map((size) => {
                                                        const sizeStock = getSizeStock(product, size);
                                                        const sizeOutOfStock = sizeStock <= 0;
                                                        return (
                                                            <button
                                                                key={size}
                                                                type="button"
                                                                className={`${styles.sizePickerOption} ${sizeOutOfStock ? styles.sizePickerOptionDisabled : ''}`}
                                                                onClick={() => addToTicket(product, size)}
                                                                disabled={sizeOutOfStock}
                                                                aria-disabled={sizeOutOfStock}
                                                                title={sizeOutOfStock ? `Talla ${size} agotada en esta sucursal` : undefined}
                                                            >
                                                                {size} <span className={styles.sizePickerOptionStock}>({sizeStock})</span>
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                                <button
                                                    type="button"
                                                    className={styles.sizePickerCancel}
                                                    onClick={() => setPendingSizeProductId(null)}
                                                >
                                                    Cancelar
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <aside className={styles.ticket}>
                        <h2 className={styles.ticketTitle}>
                            <ShoppingCart size={18} /> Ticket
                        </h2>

                        {ticket.length === 0 ? (
                            <div className={styles.emptyState}>Agrega productos desde el catálogo.</div>
                        ) : (
                            <div className={styles.ticketLines}>
                                {ticket.map((line) => (
                                    <div className={styles.ticketLine} key={`${line.product.id}-${line.size}`}>
                                        <div className={styles.ticketLineInfo}>
                                            <span className={styles.ticketLineName}>
                                                {line.product.name} <span className={styles.ticketLineSize}>({line.size})</span>
                                            </span>
                                            <span className={styles.ticketLinePrice}>
                                                Bs ${(line.product.effectivePrice ?? line.product.price).toFixed(2)} c/u
                                            </span>
                                        </div>
                                        <div className={styles.ticketLineActions}>
                                            <button
                                                type="button"
                                                className={styles.quantityButton}
                                                onClick={() => changeQuantity(line.product.id, line.size, -1)}
                                                aria-label="Quitar uno"
                                            >
                                                <Minus size={14} />
                                            </button>
                                            <span>{line.quantity}</span>
                                            <button
                                                type="button"
                                                className={styles.quantityButton}
                                                onClick={() => changeQuantity(line.product.id, line.size, 1)}
                                                disabled={line.quantity >= getSizeStock(line.product, line.size)}
                                                aria-label="Agregar uno"
                                            >
                                                <Plus size={14} />
                                            </button>
                                            <button
                                                type="button"
                                                className={styles.removeButton}
                                                onClick={() => removeLine(line.product.id, line.size)}
                                                aria-label="Quitar del ticket"
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        <div className={styles.customerFields}>
                            <div className={styles.field}>
                                <label htmlFor="pos-nit">NIT / CI</label>
                                <input
                                    id="pos-nit"
                                    type="text"
                                    placeholder="0"
                                    value={nit}
                                    onChange={(e) => setNit(e.target.value)}
                                />
                            </div>
                            <div className={styles.field}>
                                <label htmlFor="pos-razon">Nombre / Razón Social</label>
                                <input
                                    id="pos-razon"
                                    type="text"
                                    placeholder="Sin nombre"
                                    value={razonSocial}
                                    onChange={(e) => setRazonSocial(e.target.value)}
                                />
                            </div>
                        </div>

                        <div className={styles.paymentMethods}>
                            {PAYMENT_METHODS.map((method) => (
                                <button
                                    type="button"
                                    key={method.value}
                                    className={`${styles.paymentMethodButton} ${paymentMethod === method.value ? styles.paymentMethodActive : ''}`}
                                    onClick={() => setPaymentMethod(method.value)}
                                >
                                    {method.icon}
                                    {method.label}
                                </button>
                            ))}
                        </div>

                        {paymentMethod === 'CASH' && (
                            <div className={styles.cashPanel}>
                                <div className={styles.field}>
                                    <label htmlFor="pos-received">Monto Recibido</label>
                                    <input
                                        id="pos-received"
                                        type="number"
                                        inputMode="decimal"
                                        min={0}
                                        step="0.01"
                                        placeholder="0.00"
                                        value={amountReceivedInput}
                                        onChange={(e) => setAmountReceivedInput(e.target.value)}
                                    />
                                </div>
                                <div className={`${styles.changeRow} ${cashBlocked ? styles.changeRowInsufficient : ''}`}>
                                    <span>Cambio</span>
                                    <span>{change !== null ? `Bs ${change.toFixed(2)}` : '—'}</span>
                                </div>
                            </div>
                        )}

                        {checkoutError && <div className={styles.errorMessage}>{checkoutError}</div>}

                        <div className={styles.ticketTotal}>
                            <span>Total</span>
                            <span>Bs ${total.toFixed(2)}</span>
                        </div>

                        <button
                            type="button"
                            className={styles.chargeButton}
                            disabled={ticket.length === 0 || isCharging || cashBlocked}
                            onClick={handleCharge}
                        >
                            {isCharging ? 'Cobrando...' : `Cobrar Bs ${total.toFixed(2)}`}
                        </button>
                    </aside>
                </div>
            )}

            {receipt && <PosReceiptModal receipt={receipt} onClose={() => setReceipt(null)} />}
        </div>
    );
}

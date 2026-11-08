'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Banknote, ChevronRight, CreditCard, Minus, Plus, QrCode, Search, ShoppingCart, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import styles from './pos.module.scss';
import { formatMoney } from '@/i18n/config';
import { useAdminRole } from '@/hooks/useAdminAccess';
import { useAdminBranches } from '@/hooks/useAdminBranches';
import { usePosCatalog, usePosCategories } from '@/hooks/usePos';
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

// Etiqueta de cada método: AdminPos.methods.<método>
const PAYMENT_METHODS: { value: PosPaymentMethod; icon: React.ReactNode }[] = [
    { value: 'CASH', icon: <Banknote size={22} /> },
    { value: 'PHYSICAL_CARD', icon: <CreditCard size={22} /> },
    { value: 'QR', icon: <QrCode size={22} /> },
];

// Colores: todo lo "relleno" (talla elegida, categoría activa, encabezado del ticket, método de pago y
// botón de cobrar) usa el color primario de Apariencia (--color-primary) con su texto legible
// (--color-primary-text); la tipografía y el fondo también salen de Apariencia. Ver pos.module.scss.
export default function PosClient() {
    const { isGlobal, branchId: cashierBranchId } = useAdminRole();
    const t = useTranslations('AdminPos');
    const locale = useLocale();
    const money = (value: number) => formatMoney(value, locale);
    const { branches } = useAdminBranches();
    const [selectedBranchId, setSelectedBranchId] = useState('');

    const effectiveBranchId = isGlobal ? selectedBranchId || null : cashierBranchId;

    const [searchInput, setSearchInput] = useState('');
    const [search, setSearch] = useState('');
    const [categoryId, setCategoryId] = useState('');
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const categoriesRef = useRef<HTMLDivElement>(null);
    const categories = usePosCategories();
    // La flecha de las categorías solo aparece si quedan categorías fuera de la vista
    const [categoriesOverflow, setCategoriesOverflow] = useState(false);
    useEffect(() => {
        const row = categoriesRef.current;
        if (!row) return;
        const measure = () => setCategoriesOverflow(row.scrollWidth - row.clientWidth - row.scrollLeft > 4);
        measure();
        row.addEventListener('scroll', measure, { passive: true });
        const observer = new ResizeObserver(measure);
        observer.observe(row);
        return () => {
            row.removeEventListener('scroll', measure);
            observer.disconnect();
        };
    }, [categories.length, effectiveBranchId]);
    const { products, isLoading: isLoadingProducts, error: catalogError, refetch: refetchCatalog } = usePosCatalog(effectiveBranchId, search, categoryId);

    const [ticket, setTicket] = useState<TicketLine[]>([]);
    // Talla elegida en cada tarjeta (si no se tocó, la primera con stock)
    const [chosenSizes, setChosenSizes] = useState<Record<string, string>>({});
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

    // Talla que agrega el botón "+" de la tarjeta: la elegida, o la primera con stock
    const selectedSizeOf = (product: Product): string => {
        const chosen = chosenSizes[product.id];
        if (chosen && product.sizes.includes(chosen)) return chosen;
        return product.sizes.find((size) => getSizeStock(product, size) > 0) ?? product.sizes[0] ?? '';
    };

    const addToTicket = (product: Product, size: string) => {
        const sizeStock = getSizeStock(product, size);
        if (sizeStock <= 0) {
            setCheckoutError(t('errors.sizeNoStock', { name: product.name, size }));
            return;
        }

        // El techo de cada línea es el stock de ESA talla, no el del producto entero
        const existing = ticket.find((line) => line.product.id === product.id && line.size === size);
        if (existing && existing.quantity >= sizeStock) {
            setCheckoutError(t('errors.sizeLimit', { count: sizeStock, name: product.name, size }));
            return;
        }

        setCheckoutError(null);
        setTicket((prev) =>
            existing
                ? prev.map((line) =>
                      line.product.id === product.id && line.size === size ? { ...line, quantity: line.quantity + 1 } : line,
                  )
                : [...prev, { product, size, quantity: 1 }],
        );
    };

    const changeQuantity = (productId: string, size: string, delta: number) => {
        setTicket((prev) =>
            prev.map((line) => {
                if (line.product.id !== productId || line.size !== size) return line;
                // Techo = stock de esa talla en la sucursal; piso = 1 (para bajar de 1 está quitar la
                // línea). El Math.max va al final a propósito: si la talla quedó en 0 mientras el
                // ticket estaba abierto, el orden inverso dejaba la línea en cantidad 0.
                const maxForSize = getSizeStock(line.product, line.size);
                return { ...line, quantity: Math.max(Math.min(line.quantity + delta, maxForSize), 1) };
            }),
        );
    };

    const removeLine = (productId: string, size: string) => {
        setTicket((prev) => prev.filter((line) => !(line.product.id === productId && line.size === size)));
    };

    const unitPrice = (product: Product) => product.effectivePrice ?? product.price;
    const total = round2(ticket.reduce((sum, line) => sum + unitPrice(line.product) * line.quantity, 0));

    const amountReceived = amountReceivedInput === '' ? null : Number(amountReceivedInput);
    const change = paymentMethod === 'CASH' && amountReceived !== null ? round2(amountReceived - total) : null;
    const cashBlocked = paymentMethod === 'CASH' && (amountReceived === null || amountReceived < total);

    const resetTicketState = () => {
        setTicket([]);
        setChosenSizes({});
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
            setCheckoutError(t('errors.lineNoStock', { name: invalidLine.product.name, size: invalidLine.size }));
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
            setCheckoutError(getApiErrorMessage(error, t('errors.checkoutFailed')));
        } finally {
            setIsCharging(false);
        }
    };

    return (
        <div className={styles.page}>
            <div className={styles.pageHeader}>
                <div>
                    <h1>{t('title')}</h1>
                    <p>{t('subtitle')}</p>
                </div>

                {isGlobal && (
                    <select
                        className={styles.branchSelect}
                        value={selectedBranchId}
                        onChange={(e) => setSelectedBranchId(e.target.value)}
                        aria-label={t('selectBranch')}
                    >
                        <option value="">{t('selectBranch')}</option>
                        {branches.filter((b) => b.isActive).map((branch) => (
                            <option key={branch.id} value={branch.id}>{branch.name}</option>
                        ))}
                    </select>
                )}
            </div>

            {!effectiveBranchId ? (
                <div className={styles.emptyState}>{t('selectBranchFirst')}</div>
            ) : (
                <div className={styles.layout}>
                    <div className={styles.catalog}>
                        <div className={styles.searchBar}>
                            <Search size={20} />
                            <input
                                type="search"
                                placeholder={t('searchPlaceholder')}
                                value={searchInput}
                                onChange={(e) => handleSearchChange(e.target.value)}
                                aria-label={t('searchPlaceholder')}
                            />
                        </div>

                        {categories.length > 0 && (
                            <div className={styles.categoryBar}>
                                <div className={styles.categoryChips} ref={categoriesRef} role="group" aria-label={t('categoriesLabel')}>
                                    {[{ id: '', name: t('allCategories') }, ...categories].map((category) => (
                                        <button
                                            type="button"
                                            key={category.id || 'all'}
                                            className={`${styles.categoryChip} ${categoryId === category.id ? styles.categoryChipActive : ''}`}
                                            aria-pressed={categoryId === category.id}
                                            onClick={() => setCategoryId(category.id)}
                                        >
                                            {category.name}
                                        </button>
                                    ))}
                                </div>
                                {categoriesOverflow && <button
                                    type="button"
                                    className={styles.categoryScroll}
                                    aria-label={t('scrollCategories')}
                                    onClick={() => categoriesRef.current?.scrollBy({ left: 200, behavior: 'smooth' })}
                                >
                                    <ChevronRight size={18} />
                                </button>}
                            </div>
                        )}

                        {catalogError && <div className={styles.errorMessage}>{catalogError}</div>}

                        {/* Lo único que scrollea de la columna: buscador y categorías quedan fijos arriba */}
                        <div className={styles.catalogScroll}>
                            {isLoadingProducts ? (
                                <div className={styles.emptyState}>{t('loading')}</div>
                            ) : products.length === 0 ? (
                                <div className={styles.emptyState}>{t('noProducts')}</div>
                            ) : (
                                <div className={styles.productGrid}>
                                    {products.map((product) => {
                                        const hasSizes = product.sizes.length > 0;
                                        const size = selectedSizeOf(product);
                                        const sizeStock = hasSizes ? getSizeStock(product, size) : product.stock;
                                        const inTicket = ticket.find((line) => line.product.id === product.id && line.size === size)?.quantity ?? 0;
                                        const canAdd = sizeStock > 0 && inTicket < sizeStock;
                                        const addLabel = hasSizes ? t('addSize', { name: product.name, size }) : t('addProduct', { name: product.name });
                                        return (
                                            <article key={product.id} className={styles.productCard}>
                                                <button
                                                    type="button"
                                                    className={styles.productImageButton}
                                                    onClick={() => addToTicket(product, size)}
                                                    disabled={!canAdd}
                                                    aria-label={addLabel}
                                                    tabIndex={-1}
                                                >
                                                    <img src={product.imageUrl} alt="" className={styles.productImage} />
                                                </button>
                                                <span className={styles.productName}>{product.name}</span>

                                                {hasSizes && (
                                                    <div className={styles.sizeRow} role="group" aria-label={t('sizeGroup', { name: product.name })}>
                                                        {product.sizes.map((option) => {
                                                            const optionStock = getSizeStock(product, option);
                                                            const soldOut = optionStock <= 0;
                                                            return (
                                                                <button
                                                                    type="button"
                                                                    key={option}
                                                                    className={`${styles.sizeChip} ${option === size ? styles.sizeChipActive : ''} ${soldOut ? styles.sizeChipSoldOut : ''}`}
                                                                    aria-pressed={option === size}
                                                                    disabled={soldOut}
                                                                    title={soldOut ? t('sizeSoldOut', { size: option }) : undefined}
                                                                    onClick={() => setChosenSizes((prev) => ({ ...prev, [product.id]: option }))}
                                                                >
                                                                    {option}
                                                                </button>
                                                            );
                                                        })}
                                                    </div>
                                                )}

                                                <div className={styles.productFooter}>
                                                    <div className={styles.productMeta}>
                                                        <span className={styles.productPrice}>{money(unitPrice(product))}</span>
                                                        <span className={`${styles.stockBadge} ${sizeStock <= 0 ? styles.stockBadgeOut : ''}`}>
                                                            {sizeStock <= 0
                                                                ? t('noStock')
                                                                : hasSizes
                                                                    ? t('sizeStock', { size, count: sizeStock })
                                                                    : t('stock', { count: sizeStock })}
                                                        </span>
                                                    </div>
                                                    <button
                                                        type="button"
                                                        className={styles.addButton}
                                                        onClick={() => addToTicket(product, size)}
                                                        disabled={!canAdd}
                                                        aria-label={addLabel}
                                                        title={addLabel}
                                                    >
                                                        <Plus size={20} />
                                                    </button>
                                                </div>
                                            </article>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>

                    <aside className={styles.ticket}>
                        <h2 className={styles.ticketTitle}>
                            <ShoppingCart size={24} /> {t('ticket')}
                        </h2>

                        {/* Zona con scroll: líneas del ticket, datos de factura y método de pago */}
                        <div className={styles.ticketScroll}>
                            {ticket.length === 0 ? (
                                <div className={styles.emptyState}>{t('emptyTicket')}</div>
                            ) : (
                                <div className={styles.ticketLines}>
                                    {ticket.map((line) => {
                                        const max = getSizeStock(line.product, line.size);
                                        return (
                                            <div className={styles.ticketLine} key={`${line.product.id}-${line.size}`}>
                                                <img src={line.product.imageUrl} alt="" className={styles.ticketThumb} />
                                                <div className={styles.ticketLineInfo}>
                                                    <span className={styles.ticketLineName}>{line.product.name}</span>
                                                    {line.size && <span className={styles.ticketLineSize}>{t('lineSize', { size: line.size })}</span>}
                                                    <span className={styles.ticketLinePrice}>{money(unitPrice(line.product))}</span>
                                                </div>
                                                <div className={styles.stepper}>
                                                    {line.quantity > 1 ? (
                                                        <button
                                                            type="button"
                                                            onClick={() => changeQuantity(line.product.id, line.size, -1)}
                                                            aria-label={t('removeOne')}
                                                        >
                                                            <Minus size={16} />
                                                        </button>
                                                    ) : (
                                                        <button
                                                            type="button"
                                                            className={styles.stepperRemove}
                                                            onClick={() => removeLine(line.product.id, line.size)}
                                                            aria-label={t('removeLine')}
                                                            title={t('removeLine')}
                                                        >
                                                            <Trash2 size={15} />
                                                        </button>
                                                    )}
                                                    <span aria-live="polite">{line.quantity}</span>
                                                    <button
                                                        type="button"
                                                        onClick={() => changeQuantity(line.product.id, line.size, 1)}
                                                        disabled={line.quantity >= max}
                                                        aria-label={t('addOne')}
                                                    >
                                                        <Plus size={16} />
                                                    </button>
                                                </div>
                                                <span className={styles.ticketLineTotal}>{money(round2(unitPrice(line.product) * line.quantity))}</span>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}

                            <div className={styles.totals}>
                                <div className={styles.subtotalRow}>
                                    <span>{t('subtotal')}</span>
                                    <span>{money(total)}</span>
                                </div>
                                <div className={styles.totalRow}>
                                    <span>{t('total')}</span>
                                    <span>{money(total)}</span>
                                </div>
                            </div>

                            <div className={styles.customerFields}>
                                <div className={styles.field}>
                                    <label htmlFor="pos-nit">{t('nit')}</label>
                                    <input
                                        id="pos-nit"
                                        type="text"
                                        inputMode="numeric"
                                        placeholder={t('nitPlaceholder')}
                                        value={nit}
                                        onChange={(e) => setNit(e.target.value)}
                                    />
                                </div>
                                <div className={styles.field}>
                                    <label htmlFor="pos-razon">{t('razonSocial')}</label>
                                    <input
                                        id="pos-razon"
                                        type="text"
                                        placeholder={t('razonPlaceholder')}
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
                                        aria-pressed={paymentMethod === method.value}
                                        onClick={() => setPaymentMethod(method.value)}
                                    >
                                        {method.icon}
                                        {t(`methods.${method.value}`)}
                                    </button>
                                ))}
                            </div>

                            {paymentMethod === 'CASH' && (
                                <div className={styles.cashPanel}>
                                    <div className={styles.field}>
                                        <label htmlFor="pos-received">{t('amountReceived')}</label>
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
                                        <span>{t('change')}</span>
                                        <span>{change !== null ? money(change) : '—'}</span>
                                    </div>
                                </div>
                            )}

                            {checkoutError && <div className={styles.errorMessage} role="alert">{checkoutError}</div>}
                        </div>

                        {/* Anclado abajo: el cajero ve el botón de cobrar sin scrollear */}
                        <div className={styles.ticketFooter}>
                            <button
                                type="button"
                                className={styles.chargeButton}
                                disabled={ticket.length === 0 || isCharging || cashBlocked}
                                onClick={handleCharge}
                            >
                                {isCharging ? t('charging') : t('charge', { amount: money(total) })}
                            </button>
                        </div>
                    </aside>
                </div>
            )}

            {receipt && <PosReceiptModal receipt={receipt} onClose={() => setReceipt(null)} />}
        </div>
    );
}

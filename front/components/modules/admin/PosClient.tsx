'use client';

import React, { useRef, useState } from 'react';
import { Banknote, CreditCard, Minus, Plus, QrCode, Search, ShoppingCart, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import styles from './pos.module.scss';
import { formatMoney } from '@/i18n/config';
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

// Etiqueta de cada método: AdminPos.methods.<método>
const PAYMENT_METHODS: { value: PosPaymentMethod; icon: React.ReactNode }[] = [
    { value: 'CASH', icon: <Banknote size={18} /> },
    { value: 'PHYSICAL_CARD', icon: <CreditCard size={18} /> },
    { value: 'QR', icon: <QrCode size={18} /> },
];

export default function PosClient() {
    const { isGlobal, branchId: cashierBranchId } = useAdminRole();
    const t = useTranslations('AdminPos');
    const tc = useTranslations('AdminCommon');
    const locale = useLocale();
    const money = (value: number) => formatMoney(value, locale);
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
                            <Search size={18} />
                            <input
                                type="text"
                                placeholder={t('searchPlaceholder')}
                                value={searchInput}
                                onChange={(e) => handleSearchChange(e.target.value)}
                            />
                        </div>

                        {catalogError && <div className={styles.errorMessage}>{catalogError}</div>}

                        {/* Lo único que scrollea de la columna central: el buscador de arriba queda fijo */}
                        <div className={styles.catalogScroll}>
                        {isLoadingProducts ? (
                            <div className={styles.emptyState}>{t('loading')}</div>
                        ) : products.length === 0 ? (
                            <div className={styles.emptyState}>{t('noProducts')}</div>
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
                                            <span className={styles.productPrice}>{money(product.effectivePrice ?? product.price)}</span>
                                            <span className={`${styles.stockBadge} ${product.stock <= 0 ? styles.stockBadgeOut : ''}`}>
                                                {product.stock <= 0 ? t('noStock') : t('stock', { count: product.stock })}
                                            </span>
                                        </button>

                                        {pendingSizeProductId === product.id && (
                                            <div className={styles.sizePicker}>
                                                <span className={styles.sizePickerLabel}>{t('size')}</span>
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
                                                                title={sizeOutOfStock ? t('sizeSoldOut', { size }) : undefined}
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
                                                    {tc('cancel')}
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                        </div>
                    </div>

                    <aside className={styles.ticket}>
                        <h2 className={styles.ticketTitle}>
                            <ShoppingCart size={18} /> {t('ticket')}
                        </h2>

                        {/* Zona con scroll: líneas del ticket, datos de factura y método de pago */}
                        <div className={styles.ticketScroll}>
                        {ticket.length === 0 ? (
                            <div className={styles.emptyState}>{t('emptyTicket')}</div>
                        ) : (
                            <div className={styles.ticketLines}>
                                {ticket.map((line) => (
                                    <div className={styles.ticketLine} key={`${line.product.id}-${line.size}`}>
                                        <div className={styles.ticketLineInfo}>
                                            <span className={styles.ticketLineName}>
                                                {line.product.name} <span className={styles.ticketLineSize}>({line.size})</span>
                                            </span>
                                            <span className={styles.ticketLinePrice}>
                                                {t('unitPrice', { price: money(line.product.effectivePrice ?? line.product.price) })}
                                            </span>
                                        </div>
                                        <div className={styles.ticketLineActions}>
                                            <button
                                                type="button"
                                                className={styles.quantityButton}
                                                onClick={() => changeQuantity(line.product.id, line.size, -1)}
                                                aria-label={t('removeOne')}
                                            >
                                                <Minus size={14} />
                                            </button>
                                            <span>{line.quantity}</span>
                                            <button
                                                type="button"
                                                className={styles.quantityButton}
                                                onClick={() => changeQuantity(line.product.id, line.size, 1)}
                                                disabled={line.quantity >= getSizeStock(line.product, line.size)}
                                                aria-label={t('addOne')}
                                            >
                                                <Plus size={14} />
                                            </button>
                                            <button
                                                type="button"
                                                className={styles.removeButton}
                                                onClick={() => removeLine(line.product.id, line.size)}
                                                aria-label={t('removeLine')}
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
                                <label htmlFor="pos-nit">{t('nit')}</label>
                                <input
                                    id="pos-nit"
                                    type="text"
                                    placeholder="0"
                                    value={nit}
                                    onChange={(e) => setNit(e.target.value)}
                                />
                            </div>
                            <div className={styles.field}>
                                <label htmlFor="pos-razon">{t('razonSocial')}</label>
                                <input
                                    id="pos-razon"
                                    type="text"
                                    placeholder={t('noName')}
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

                        {checkoutError && <div className={styles.errorMessage}>{checkoutError}</div>}
                        </div>

                        {/* Anclado abajo: el cajero ve el total y el botón de cobrar sin scrollear */}
                        <div className={styles.ticketFooter}>
                            <div className={styles.ticketTotal}>
                                <span>{t('total')}</span>
                                <span>{money(total)}</span>
                            </div>

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

'use client';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Product } from '@/types/product.types';
import Link from 'next/link';
import Image from 'next/image';
import { ShoppingBag, Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import styles from "./product-card.module.scss";
import { getEffectivePrice, hasProductDiscount } from '@/utils/pricing';
import { useCart } from '@/hooks/useCart';
import SizePickerModal from './SizePickerModal';
import pickerStyles from './size-picker-modal.module.scss';

export default function ProductCard({ product }: { product: Product }) {
    const { items, addProductToCart } = useCart();
    const [added, setAdded] = useState(false);
    const [isPickerOpen, setIsPickerOpen] = useState(false);
    const [toast, setToast] = useState<string | null>(null);
    const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
    const t = useTranslations('Store.card');
    const tPicker = useTranslations('Store.sizePicker');
    const id = product.id;

    const inCartQty = useMemo(() => {
        return items
            .filter((item) => item.productId === id)
            .reduce((sum, item) => sum + item.quantity, 0);
    }, [items, id]);

    const availableStock = Math.max(0, product.stock - inCartQty);
    const isInStock = availableStock > 0;
    const hasDiscount = hasProductDiscount(product);

    const hasSizes = !!product.sizes && product.sizes.length > 0;

    useEffect(() => () => timersRef.current.forEach(clearTimeout), []);

    const showAdded = (message: string) => {
        setAdded(true);
        setToast(message);
        timersRef.current.push(setTimeout(() => setAdded(false), 1500));
        timersRef.current.push(setTimeout(() => setToast(null), 3000));
    };

    // Con tallas se pide elegirla en el selector (antes se tomaba la primera con stock sin preguntar).
    // Sin tallas se mantiene el comportamiento anterior: se añade sin talla.
    const handleQuickAdd = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (!isInStock) return;

        if (hasSizes) {
            setIsPickerOpen(true);
            return;
        }

        addProductToCart(product, undefined, 1);
        showAdded(t('added'));
    };

    const closePicker = useCallback(() => setIsPickerOpen(false), []);

    const handleConfirmSize = (freshProduct: typeof product, size: string) => {
        setIsPickerOpen(false);
        addProductToCart(freshProduct, size, 1);
        showAdded(tPicker('addedToast', { name: freshProduct.name, size }));
    };

    return (
        <>
        <Link href={`/${id}`} className={styles.card}>
            <div className={styles.imageWrapper}>
                <Image
                    src={product.imageUrl?.trimEnd() || "https://upload.wikimedia.org/wikipedia/commons/a/a3/Image-not-found.png"}
                    alt={product.name}
                    width={400}
                    height={400}
                    loading="lazy"
                />
            </div>

            <div className={styles.content}>
                <span className={styles.category}>
                    {product.category}
                </span>
                <h3 className={styles.name}>{product.name}</h3>
                <p className={styles.description}>{product.description}</p>
                <div className={styles.footer}>
                    <span className={styles.price}>
                        Bs {getEffectivePrice(product).toFixed(2)}
                        {hasDiscount && <span className={styles.oldPrice}>Bs {product.price.toFixed(2)}</span>}
                    </span>

                    <span
                        className={`${styles.stock} ${!isInStock ? styles.outOfStock : ""}`}
                    >
                        {isInStock ? t('inStock', { count: availableStock }) : t('soldOut')}
                    </span>
                </div>

                <button
                    type="button"
                    className={`${styles.addBtn} ${added ? styles.added : ""}`}
                    disabled={!isInStock}
                    onClick={handleQuickAdd}
                    aria-label={hasSizes ? tPicker('openLabel', { name: product.name }) : t('addLabel', { name: product.name })}
                    aria-haspopup={hasSizes ? 'dialog' : undefined}
                >
                    {added ? (
                        <>
                            <Check size={15} />
                            <span>{t('added')}</span>
                        </>
                    ) : (
                        <>
                            <ShoppingBag size={15} />
                            <span>{isInStock ? t('add') : t('noStock')}</span>
                        </>
                    )}
                </button>
            </div>
        </Link>

        {/* Fuera del <Link>: los clics del selector no deben navegar al detalle */}
        {isPickerOpen && (
            <SizePickerModal product={product} onClose={closePicker} onConfirm={handleConfirmSize} />
        )}
        {toast && typeof document !== 'undefined' && createPortal(
            <div className={pickerStyles.toast} role="status" aria-live="polite">{toast}</div>,
            document.body,
        )}
        </>
    );
}
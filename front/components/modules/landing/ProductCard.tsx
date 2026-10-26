'use client';
import React, { useMemo, useState } from 'react';
import { Product } from '@/types/product.types';
import Link from 'next/link';
import Image from 'next/image';
import { ShoppingBag, Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import styles from "./product-card.module.scss";
import { getEffectivePrice, hasProductDiscount } from '@/utils/pricing';
import { useCart } from '@/hooks/useCart';

export default function ProductCard({ product }: { product: Product }) {
    const { items, addProductToCart } = useCart();
    const [added, setAdded] = useState(false);
    const t = useTranslations('Store.card');
    const id = product.id;

    const inCartQty = useMemo(() => {
        return items
            .filter((item) => item.productId === id)
            .reduce((sum, item) => sum + item.quantity, 0);
    }, [items, id]);

    const availableStock = Math.max(0, product.stock - inCartQty);
    const isInStock = availableStock > 0;
    const hasDiscount = hasProductDiscount(product);

    const handleQuickAdd = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (!isInStock) return;

        // Si tiene tallas, elegir la primera con stock disponible
        let sizeToAdd: string | undefined = undefined;
        if (product.sizes && product.sizes.length > 0) {
            const availableRow = product.stockBySize?.find((s) => s.stock > 0);
            sizeToAdd = availableRow ? availableRow.size : product.sizes[0];
        }

        addProductToCart(product, sizeToAdd, 1);
        setAdded(true);
        setTimeout(() => setAdded(false), 1500);
    };

    return (
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
                    aria-label={t('addLabel', { name: product.name })}
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
    );
}
'use client';
import React from 'react';
import { Product } from '@/types/product.types';
import Link from 'next/link';
import Image from 'next/image'; // 1. Importación agregada
import styles from "./product-card.module.scss";
import { getEffectivePrice, hasProductDiscount } from '@/utils/pricing';

export default function ProductCard({ product }: { product: Product }) {
    const id = product.id;
    const isInStock = product.stock > 0;
    const hasDiscount = hasProductDiscount(product);

    return (
        // 2. Comillas invertidas (backticks) para interpolar la variable id
        <Link href={`/${id}`} className={styles.card}>
            {/*image */}
            <div className={styles.imageWrapper}>
                <Image
                    src={product.imageUrl.trimEnd() ?? "https://upload.wikimedia.org/wikipedia/commons/a/a3/Image-not-found.png"}
                    alt={product.name}
                    width={400}
                    height={400}
                    loading="lazy"
                />
            </div>

            {/*content */}
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

                    {/* 3. Sintaxis de template literal corregida y variable isInStock bien escrita */}
                    <span
                        className={`${styles.stock} ${!isInStock ? styles.outOfStock : ""}`}
                    >
                        {isInStock ? product.stock + " en stock" : "Agotado"}
                    </span>
                </div>
            </div>
        </Link>
    );
}
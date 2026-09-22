'use client'
import React, { useState } from 'react';
import Image from 'next/image';
import { ScanFace } from 'lucide-react';
import { Product } from '@/types/product.types';
import styles from './product-detail.module.scss'
import { useCart } from '@/hooks/useCart';
import { getEffectivePrice, hasProductDiscount } from '@/utils/pricing';

export default function ProductDetail({ product }: { product: Product }) {

    const { addProductToCart } = useCart();
    const isInStock = product.stock > 0;
    const hasDiscount = hasProductDiscount(product);
    const [quantity, setQuantity] = useState(1);
    const [selectedSize, setSelectedSize] = useState<string>("");
    const hasSizes = !!product.sizes && product.sizes.length > 0;
    const handleDecrement = () => {
        if (quantity > 1) {
            setQuantity(quantity - 1);
        }
    };
    const handleIncrement = () => {
        if (quantity < product.stock) {
            setQuantity(quantity + 1);
        }
    };

    // Placeholder: el probador virtual aún no existe. No toca el carrito ni la talla elegida
    const handleTryOn = () => {
        alert('Próximamente: Probador Virtual');
    };

    const handleAddToCart = () => {
        if (isInStock) {
            if (hasSizes && !selectedSize) {
                alert("Por favor, selecciona una talla");
                return;
            }
            addProductToCart(product, hasSizes ? selectedSize : undefined);
            setQuantity(1);
            alert("Se agregaron " + quantity + " " + product.name + " al carrito");
            alert(`Se agregaron ${quantity} ${product.name} al carrito`);
        }
    }

    return (
        <section className={styles.section}>
            <div className={styles.container}>
                <div className={styles.grid}>
                    <div className={styles.imageWrapper}>
                        <Image src={product.imageUrl.trimEnd()}
                            alt={product.name}
                            width={600}
                            height={600}
                            priority
                        />
                    </div>
                    <div className={styles.info}>
                        <span className={styles.category}>{product.category}</span>
                        <h1 className={styles.title}> {product.name}</h1>
                        <p className={styles.price}>
                            ${getEffectivePrice(product).toFixed(2)}
                            {hasDiscount && <span className={styles.oldPrice}>${product.price.toFixed(2)}</span>}
                            {hasDiscount && <span className={styles.discountBadge}>Oferta</span>}
                        </p>
                        <span className={`${styles.stock} ${!isInStock ? styles.outOfStock : ""}`}>
                            {
                                isInStock ? `${product.stock} disponibles en stock` : "Agotado"
                            }
                        </span>
                        <hr className={styles.divider} />
                        <p className={styles.description}>{product.description}</p>
                        <hr className={styles.divider} />

                        {
                            isInStock && hasSizes && (
                                <div className={styles.sizeSection}>
                                    <span className={styles.label}>Talla</span>
                                    <div className={styles.sizeOptions}>
                                        {product.sizes!.map((size) => (
                                            <button
                                                key={size}
                                                type="button"
                                                className={`${styles.sizeButton} ${selectedSize === size ? styles.sizeButtonActive : ""}`}
                                                onClick={() => setSelectedSize(size)}
                                                aria-pressed={selectedSize === size}
                                            >
                                                {size}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )
                        }

                        {
                            isInStock && (
                                <div className={styles.quantitySection}>
                                    <label htmlFor="quantity" className={styles.label}>Cantidad</label>
                                    <div className={styles.quantityControls}>
                                        <button className={styles.quantityButton}
                                            onClick={handleDecrement}
                                            disabled={quantity <= 1}
                                            aria-label="Disminuir cantidad">-

                                        </button>
                                        <span className={styles.quantityValue}>{quantity}</span>
                                        <button className={styles.quantityButton}
                                            onClick={handleIncrement}
                                            disabled={quantity >= product.stock}
                                            aria-label="Aumentar cantidad">
                                            +
                                        </button>
                                    </div>
                                </div>
                            )
                        }
                        <button className={styles.addToCartButton} onClick={handleAddToCart} disabled={!isInStock}>
                            {isInStock ? "Agregar al carrito" : "Agotado"}
                        </button>
                        <button type="button" className={styles.tryOnButton} onClick={handleTryOn}>
                            <ScanFace size={20} />
                            Probador Virtual 3D
                            <span className={styles.tryOnBadge}>Próximamente</span>
                        </button>
                        <p className={styles.sku}>SKU: {product.sku}</p>
                    </div>
                </div>
            </div>
        </section>

    );
}
'use client'
import React, { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { ScanFace } from 'lucide-react';
import { Product } from '@/types/product.types';
import styles from './product-detail.module.scss'
import { useCart } from '@/hooks/useCart';
import { getEffectivePrice, hasProductDiscount } from '@/utils/pricing';

export default function ProductDetail({ product }: { product: Product }) {

    const { addProductToCart } = useCart();
    const hasDiscount = hasProductDiscount(product);
    const [quantity, setQuantity] = useState(1);
    const [selectedSize, setSelectedSize] = useState<string>("");
    const hasSizes = !!product.sizes && product.sizes.length > 0;

    // Stock por talla en la sucursal elegida. Sin sucursal (stockBySize null) no hay forma de saber
    // el stock de cada talla por separado: se cae al stock agregado del producto para no bloquear
    // todo el selector.
    const stockBySize = useMemo(() => {
        const map = new Map<string, number>();
        if (product.stockBySize) {
            for (const row of product.stockBySize) map.set(row.size, row.stock);
        }
        return map;
    }, [product.stockBySize]);

    const getStockForSize = (size: string): number =>
        product.stockBySize ? (stockBySize.get(size) ?? 0) : product.stock;

    // Auto-selección inteligente: nunca elige de entrada una talla agotada.
    useEffect(() => {
        if (!hasSizes) {
            setSelectedSize("");
            return;
        }
        const firstAvailable = product.sizes!.find((size) => getStockForSize(size) > 0);
        setSelectedSize(firstAvailable ?? "");
        setQuantity(1);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [product.id, product.stockBySize, hasSizes]);

    // Stock relevante para la cantidad/botón de agregar: el de la talla elegida, o el del producto
    // si no maneja tallas.
    const relevantStock = hasSizes ? (selectedSize ? getStockForSize(selectedSize) : 0) : product.stock;
    const isInStock = relevantStock > 0;

    const handleDecrement = () => {
        if (quantity > 1) {
            setQuantity(quantity - 1);
        }
    };
    const handleIncrement = () => {
        if (quantity < relevantStock) {
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
                        {/* Reactivo a la talla elegida: cambia al vuelo si el usuario cambia de talla */}
                        <span className={`${styles.stock} ${!isInStock ? styles.outOfStock : ""}`}>
                            {isInStock ? `${relevantStock} disponibles en stock` : "Agotado"}
                        </span>
                        <hr className={styles.divider} />
                        <p className={styles.description}>{product.description}</p>
                        <hr className={styles.divider} />

                        {
                            hasSizes && (
                                <div className={styles.sizeSection}>
                                    <span className={styles.label}>Talla</span>
                                    <div className={styles.sizeOptions}>
                                        {product.sizes!.map((size) => {
                                            const sizeStock = getStockForSize(size);
                                            const sizeOutOfStock = sizeStock <= 0;
                                            return (
                                                <button
                                                    key={size}
                                                    type="button"
                                                    className={[
                                                        styles.sizeButton,
                                                        selectedSize === size ? styles.sizeButtonActive : "",
                                                        sizeOutOfStock ? styles.sizeButtonDisabled : "",
                                                    ].filter(Boolean).join(" ")}
                                                    onClick={() => setSelectedSize(size)}
                                                    disabled={sizeOutOfStock}
                                                    aria-pressed={selectedSize === size}
                                                    aria-disabled={sizeOutOfStock}
                                                    title={sizeOutOfStock ? `Talla ${size} agotada` : undefined}
                                                >
                                                    {size}
                                                </button>
                                            );
                                        })}
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
                                            disabled={quantity >= relevantStock}
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

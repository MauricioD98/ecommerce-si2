'use client'
import React, { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { useRouter, usePathname } from 'next/navigation';
import { ScanFace } from 'lucide-react';
import { Product } from '@/types/product.types';
import styles from './product-detail.module.scss'
import { useCart } from '@/hooks/useCart';
import { useAuth } from '@/hooks/useAuth';
import { getEffectivePrice, hasProductDiscount } from '@/utils/pricing';

export default function ProductDetail({ product }: { product: Product }) {

    const { addProductToCart, items } = useCart();
    const { isAuthenticated } = useAuth();
    const router = useRouter();
    const pathname = usePathname();
    const hasDiscount = hasProductDiscount(product);
    const [quantity, setQuantity] = useState(1);
    const [selectedSize, setSelectedSize] = useState<string>("");
    const hasSizes = !!product.sizes && product.sizes.length > 0;

    // Stock base por talla en la sucursal elegida
    const stockBySize = useMemo(() => {
        const map = new Map<string, number>();
        if (product.stockBySize) {
            for (const row of product.stockBySize) map.set(row.size, row.stock);
        }
        return map;
    }, [product.stockBySize]);

    const getStockForSize = (size: string): number =>
        product.stockBySize ? (stockBySize.get(size) ?? 0) : product.stock;

    // Cantidad de este producto que ya está reservada en el carrito (total y por talla)
    const cartQtyBySize = useMemo(() => {
        const map = new Map<string, number>();
        for (const item of items) {
            if (item.productId === product.id && item.selectedSize) {
                map.set(item.selectedSize, (map.get(item.selectedSize) ?? 0) + item.quantity);
            }
        }
        return map;
    }, [items, product.id]);

    const totalInCart = useMemo(() => {
        return items
            .filter((item) => item.productId === product.id)
            .reduce((sum, item) => sum + item.quantity, 0);
    }, [items, product.id]);

    // Stock disponible real restando lo que el usuario ya tiene en el carrito
    const getAvailableStockForSize = (size: string): number => {
        const baseStock = getStockForSize(size);
        const inCart = cartQtyBySize.get(size) ?? 0;
        return Math.max(0, baseStock - inCart);
    };

    // Stock relevante para la talla elegida (o stock total sin tallas)
    const relevantStock = hasSizes
        ? (selectedSize ? getAvailableStockForSize(selectedSize) : 0)
        : Math.max(0, product.stock - totalInCart);

    const isInStock = relevantStock > 0;

    // Auto-selección inteligente: nunca elige de entrada una talla agotada (o agotada en carrito).
    useEffect(() => {
        if (!hasSizes) {
            setSelectedSize("");
            return;
        }
        const currentStillAvailable = selectedSize && getAvailableStockForSize(selectedSize) > 0;
        if (!currentStillAvailable) {
            const firstAvailable = product.sizes!.find((size) => getAvailableStockForSize(size) > 0);
            setSelectedSize(firstAvailable ?? "");
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [product.id, product.stockBySize, hasSizes, items]);

    // Ajustar la cantidad seleccionada si el stock disponible cambia (ej. al agregar al carrito)
    useEffect(() => {
        if (relevantStock <= 0) {
            setQuantity(0);
        } else if (quantity > relevantStock) {
            setQuantity(relevantStock);
        } else if (quantity < 1 && relevantStock > 0) {
            setQuantity(1);
        }
    }, [relevantStock, quantity]);

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
        // Sin sesión no se reserva nada en el carrito: se manda a iniciar sesión y se vuelve aquí.
        if (!isAuthenticated) {
            router.push(`/auth/login?redirect=${encodeURIComponent(pathname)}`);
            return;
        }
        if (isInStock && quantity > 0) {
            if (hasSizes && !selectedSize) {
                alert("Por favor, selecciona una talla");
                return;
            }
            const qtyToAdd = Math.min(quantity, relevantStock);
            addProductToCart(product, hasSizes ? selectedSize : undefined, qtyToAdd);
            alert(`Se agregaron ${qtyToAdd} ${product.name} al carrito`);
        }
    };

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
                            Bs {getEffectivePrice(product).toFixed(2)}
                            {hasDiscount && <span className={styles.oldPrice}>Bs {product.price.toFixed(2)}</span>}
                            {hasDiscount && <span className={styles.discountBadge}>Oferta</span>}
                        </p>
                        {/* Reactivo a la talla elegida y a lo ya puesto en el carrito */}
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
                                            const sizeStock = getAvailableStockForSize(size);
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
                                                    title={sizeOutOfStock ? `Talla ${size} agotada (o en tu carrito)` : undefined}
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

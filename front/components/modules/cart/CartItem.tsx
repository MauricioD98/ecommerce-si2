'use client';
import { CartItem as CartItemType } from "@/types/cart.types";
import Link from "next/link";
import Image from "next/image";
import { Trash2 } from "lucide-react";
import React from "react";
import { useCart } from "@/hooks/useCart";
import styles from "./cart-item.module.scss";
import { getEffectivePrice, hasProductDiscount } from "@/utils/pricing";

interface CartItemProps {
    item: CartItemType;
}

export default function CartItem({ item }: CartItemProps) {
    const { decrementProductQuantity, incrementProductQuantity, removeFromCart } = useCart();
    const { product, quantity, selectedSize } = item;

    const handleDecrement = async () => {
        await decrementProductQuantity(product.id, selectedSize);
    };

    const handleIncrement = async () => {
        if (quantity < product.stock) {
            await incrementProductQuantity(product.id, selectedSize);
        } else {
            alert(`Solo hay ${product.stock} artículos disponibles en stock`);
        }
    };

    const handleRemove = async () => {
        if (window.confirm(`¿Quitar ${product.name} del carrito?`)) {
            await removeFromCart(product.id, selectedSize);
        }
    };

    const unitPrice = getEffectivePrice(product);
    const hasDiscount = hasProductDiscount(product);
    const itemTotal = unitPrice * quantity;

    return (
        <div className={styles.cartItem}>
            <Link className={styles.imageWrapper} href={`/${product.id}`}>
                <Image
                    src={
                        product.imageUrl?.trimEnd() ?? "https://upload.wikimedia.org/wikipedia/commons/a/a3/Image-not-found.png"
                    }
                    alt={product.name}
                    width={120}
                    height={120}
                />
            </Link>

            <div className={styles.details}>
                <div className={styles.info}>
                    <Link className={styles.name} href={`/${product.id}`}>
                        {product.name}
                    </Link>
                    <span className={styles.category}>{product.categoryId}</span>
                    {selectedSize && (
                        <span className={styles.size}>Talla: {selectedSize}</span>
                    )}
                    <span className={styles.price}>
                        ${unitPrice.toFixed(2)}
                        {hasDiscount && <span className={styles.oldPrice}>${product.price.toFixed(2)}</span>}
                        {hasDiscount && <span className={styles.discountBadge}>Oferta</span>}
                    </span>

                    {product.stock <= 0 ? (
                        <span className={styles.lowStock}>Agotado: ya no hay stock disponible</span>
                    ) : product.stock <= 5 ? (
                        <span className={styles.lowStock}>
                            Solo quedan {product.stock} en stock
                        </span>
                    ) : null}
                </div>

                <div className={styles.actions}>
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

                    <div className={styles.itemTotal}>${itemTotal.toFixed(2)}</div>

                    <button className={styles.removeButton} onClick={handleRemove} aria-label="Quitar artículo">
                        <Trash2 size={18} />
                    </button>
                </div>
            </div>
        </div>
    )
}
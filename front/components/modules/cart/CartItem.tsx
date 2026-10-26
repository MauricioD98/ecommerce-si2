'use client';
import { CartItem as CartItemType } from "@/types/cart.types";
import Link from "next/link";
import Image from "next/image";
import { Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
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
    const t = useTranslations("Cart");

    let maxStock = product.stock;
    if (selectedSize && product.stockBySize) {
        const row = product.stockBySize.find((s) => s.size === selectedSize);
        if (row !== undefined) maxStock = row.stock;
    }

    const handleDecrement = async () => {
        await decrementProductQuantity(product.id, selectedSize);
    };

    const handleIncrement = async () => {
        if (quantity < maxStock) {
            await incrementProductQuantity(product.id, selectedSize);
        } else {
            alert(t("maxStock", { count: maxStock }));
        }
    };

    const handleRemove = async () => {
        if (window.confirm(t("confirmRemove", { name: product.name }))) {
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
                        <span className={styles.size}>{t("size", { size: selectedSize })}</span>
                    )}
                    <span className={styles.price}>
                        Bs {unitPrice.toFixed(2)}
                        {hasDiscount && <span className={styles.oldPrice}>Bs {product.price.toFixed(2)}</span>}
                        {hasDiscount && <span className={styles.discountBadge}>{t("sale")}</span>}
                    </span>

                    {maxStock <= 0 ? (
                        <span className={styles.lowStock}>{t("outOfStock")}</span>
                    ) : maxStock <= 5 ? (
                        <span className={styles.lowStock}>
                            {t("lowStock", { count: maxStock })}
                        </span>
                    ) : null}
                </div>

                <div className={styles.actions}>
                    <div className={styles.quantityControls}>
                        <button className={styles.quantityButton}
                            onClick={handleDecrement}
                            disabled={quantity <= 1}
                            aria-label={t("decrease")}>-
                        </button>

                        <span className={styles.quantityValue}>{quantity}</span>

                        <button className={styles.quantityButton}
                            onClick={handleIncrement}
                            disabled={quantity >= maxStock}
                            aria-label={t("increase")}>
                            +
                        </button>
                    </div>

                    <div className={styles.itemTotal}>Bs {itemTotal.toFixed(2)}</div>

                    <button className={styles.removeButton} onClick={handleRemove} aria-label={t("remove")}>
                        <Trash2 size={18} />
                    </button>
                </div>
            </div>
        </div>
    )
}
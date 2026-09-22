'use client';
import { useEffect } from 'react';
import { useCart } from '@/hooks/useCart';
import { useSelectedBranchId } from '@/hooks/useBranches';
import { useAuth } from '@/hooks/useAuth';
import { useRouter } from 'next/navigation';
import { CartItem } from '@/types/cart.types';
import styles from "./cart.module.scss";
import CartItemComponent from './CartItem';
import { ShoppingCart } from 'lucide-react';
import Link from 'next/link';

export default function CartClient() {
    const { items, clearAllCart, totalPrice, totals, syncCartProducts } = useCart();
    const selectedBranchId = useSelectedBranchId();
    const { isAuthenticated } = useAuth();
    const router = useRouter();

    // Las ofertas dependen de la sucursal: al entrar o cambiarla se actualizan los precios del carrito
    useEffect(() => {
        syncCartProducts(selectedBranchId);
    }, [selectedBranchId, syncCartProducts]);

    const handleClearCart = async () => {
        if (window.confirm("¿Seguro que quieres vaciar todo tu carrito?")) {
            await clearAllCart();
        }
    };

    const handleCheckout = () => {
        // Con sesión va directo al pago; sin sesión pasa por el login y vuelve al checkout
        router.push(isAuthenticated ? "/checkout" : "/auth/login?redirect=/checkout");
    };

    if (items.length === 0) {
        return (
            <section className={styles.section}>
                <div className={styles.container}>
                    <div className={styles.empty}>
                        <ShoppingCart className={styles.emptyIcon} size={64} />
                        <h2>Tu carrito está vacío</h2>
                        <p>Agrega productos a tu carrito para comenzar</p>
                        <Link href="/" className={styles.continueButton}>
                            Continuar comprando
                        </Link>
                    </div>
                </div>
            </section>
        );
    }

    return (
        <section className={styles.section}>
            <div className={styles.container}>
                <div className={styles.header}>
                    <h1>Carrito de compras</h1>
                    <button onClick={handleClearCart} className={styles.clearButton}>Vaciar carrito</button>
                </div>

                <div className={styles.content}>
                    <div className={styles.itemsList}>
                        {
                            items.map((item: CartItem) => (
                                <CartItemComponent key={item.product.id} item={item} />
                            ))
                        }
                    </div>

                    <div className={styles.summary}>
                        <h2>Resumen del pedido</h2>
                        <div className={styles.summaryRow}>
                            <span>Subtotal</span>
                            <span>${totals.listSubtotal.toFixed(2)}</span>
                        </div>

                        {totals.productDiscount > 0 && (
                            <div className={`${styles.summaryRow} ${styles.discountRow}`}>
                                <span>Descuento en productos</span>
                                <span>-${totals.productDiscount.toFixed(2)}</span>
                            </div>
                        )}

                        {totals.employeeDiscount > 0 && (
                            <div className={`${styles.summaryRow} ${styles.discountRow}`}>
                                <span>Descuento de empleado ({totals.employeeDiscountPercent}%)</span>
                                <span>-${totals.employeeDiscount.toFixed(2)}</span>
                            </div>
                        )}

                        <div className={styles.summaryRow}>
                            <span>Envío</span>
                            <span>Se calcula al finalizar la compra</span>
                        </div>

                        <hr className={styles.divider} />

                        {totals.employeeDiscountPercent > 0 && (
                            <p className={styles.discountNote}>
                                Tu descuento de empleado del {totals.employeeDiscountPercent}% se aplica sobre el precio con oferta.
                            </p>
                        )}

                        <div className={styles.summaryTotal}>
                            <span>Total</span>
                            <span>${totalPrice.toFixed(2)}</span>
                        </div>

                        <button className={styles.checkoutButton} onClick={handleCheckout}>
                            Ir a finalizar compra
                        </button>

                        <Link className={styles.continueLink} href="/">
                            Continuar comprando
                        </Link>
                    </div>
                </div>
            </div>
        </section>
    );
}
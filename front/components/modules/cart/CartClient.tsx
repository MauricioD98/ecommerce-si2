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
import { useTranslations } from 'next-intl';

export default function CartClient() {
    const { items, clearAllCart, totalPrice, totals, syncCartProducts } = useCart();
    const selectedBranchId = useSelectedBranchId();
    const { isAuthenticated } = useAuth();
    const router = useRouter();
    const t = useTranslations('Cart');

    // Las ofertas dependen de la sucursal: al entrar o cambiarla se actualizan los precios del carrito
    useEffect(() => {
        syncCartProducts(selectedBranchId);
    }, [selectedBranchId, syncCartProducts]);

    const handleClearCart = async () => {
        if (window.confirm(t('confirmClear'))) {
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
                        <h2>{t('empty')}</h2>
                        <p>{t('emptyDescription')}</p>
                        <Link href="/" className={styles.continueButton}>
                            {t('continueShopping')}
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
                    <h1>{t('title')}</h1>
                    <button onClick={handleClearCart} className={styles.clearButton}>{t('clear')}</button>
                </div>

                <div className={styles.content}>
                    <div className={styles.itemsList}>
                        {
                            items.map((item: CartItem) => (
                                <CartItemComponent key={`${item.productId}-${item.selectedSize ?? 'default'}`} item={item} />
                            ))
                        }
                    </div>

                    <div className={styles.summary}>
                        <h2>{t('summary')}</h2>
                        <div className={styles.summaryRow}>
                            <span>{t('subtotal')}</span>
                            <span>Bs {totals.listSubtotal.toFixed(2)}</span>
                        </div>

                        {totals.productDiscount > 0 && (
                            <div className={`${styles.summaryRow} ${styles.discountRow}`}>
                                <span>{t('productDiscount')}</span>
                                <span>-Bs {totals.productDiscount.toFixed(2)}</span>
                            </div>
                        )}

                        {totals.employeeDiscount > 0 && (
                            <div className={`${styles.summaryRow} ${styles.discountRow}`}>
                                <span>{t('employeeDiscount', { percent: totals.employeeDiscountPercent })}</span>
                                <span>-Bs {totals.employeeDiscount.toFixed(2)}</span>
                            </div>
                        )}

                        <div className={styles.summaryRow}>
                            <span>{t('shipping')}</span>
                            <span>{t('shippingAtCheckout')}</span>
                        </div>

                        <hr className={styles.divider} />

                        {totals.employeeDiscountPercent > 0 && (
                            <p className={styles.discountNote}>
                                {t('employeeNote', { percent: totals.employeeDiscountPercent })}
                            </p>
                        )}

                        <div className={styles.summaryTotal}>
                            <span>{t('total')}</span>
                            <span>Bs {totalPrice.toFixed(2)}</span>
                        </div>

                        <button className={styles.checkoutButton} onClick={handleCheckout}>
                            {t('checkout')}
                        </button>

                        <Link className={styles.continueLink} href="/">
                            {t('continueShopping')}
                        </Link>
                    </div>
                </div>
            </div>
        </section>
    );
}
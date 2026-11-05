'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { CloudOff } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import styles from './checkout.module.scss';
import { useAuth } from '@/hooks/useAuth';
import { useCart } from '@/hooks/useCart';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { ACTIVE_DRAFT_SESSION_KEY } from '@/hooks/useOrder';
import { ProductService } from '@/service/api/product.service';
import { OrderDraft, getOrderDrafts, removeOrderDraft } from '@/utils/offlineOrderQueue';

// Borradores guardados sin conexión. Nada se envía desde acá: "Revisar" carga el borrador en el carrito con
// los productos, precios y stock ACTUALES, y la compra se confirma en el checkout, con una clave nueva.
export default function OrderDraftsClient() {
    const t = useTranslations('Checkout.drafts');
    const router = useRouter();
    const { user } = useAuth();
    const { addProductToCart, clearAllCart } = useCart();
    const { isOnline } = useNetworkStatus();
    const [drafts, setDrafts] = useState<OrderDraft[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    const userId = user?.id ?? null;
    const load = useCallback(async () => {
        try {
            setDrafts(await getOrderDrafts(userId));
        } catch {
            setError(t('loadFailed'));
        }
    }, [userId, t]);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        load();
    }, [load]);

    const review = async (draft: OrderDraft) => {
        setBusy(true);
        setError(null);
        try {
            const results = await Promise.allSettled(draft.payload.items.map((item) => ProductService.getProductById(item.productId, draft.payload.branchId)));
            clearAllCart();
            let unavailable = 0;
            results.forEach((result, index) => {
                const item = draft.payload.items[index];
                if (result.status === 'fulfilled' && result.value.isActive !== false) {
                    addProductToCart(result.value, item.selectedSize, item.quantity);
                } else {
                    unavailable += 1;
                }
            });
            sessionStorage.setItem(ACTIVE_DRAFT_SESSION_KEY, draft.id);
            if (unavailable > 0) setError(t('someUnavailable', { count: unavailable }));
            router.push('/checkout');
        } catch {
            setError(t('reviewFailed'));
        } finally {
            setBusy(false);
        }
    };

    const discard = async (draft: OrderDraft) => {
        await removeOrderDraft(draft.id);
        window.dispatchEvent(new CustomEvent('offline-order-added'));
        await load();
    };

    return (
        <section className={styles.section}>
            <div className={styles.container}>
                <div className={styles.stepContent}>
                    <h2>{t('title')}</h2>
                    <p className={styles.paymentHint}>{t('notice')}</p>
                    {error && <div className={styles.errorMessage}>{error}</div>}
                    {drafts.length === 0 && <p className={styles.paymentHint}>{t('empty')}</p>}
                    {drafts.map((draft) => (
                        <div className={styles.deliverySummary} key={draft.id}>
                            <div>
                                <p>
                                    <CloudOff size={16} /> {t('summary', { count: draft.payload.items.length, date: new Date(draft.createdAt).toLocaleString() })}
                                </p>
                                {draft.legacyUnowned && <p className={styles.paymentHint}>{t('legacyWarning')}</p>}
                            </div>
                            <div>
                                <button type="button" className={styles.continueButton} disabled={!isOnline || busy} onClick={() => review(draft)}>
                                    {t('review')}
                                </button>
                                <button type="button" className={styles.linkButton} onClick={() => discard(draft)}>
                                    {t('discard')}
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
}

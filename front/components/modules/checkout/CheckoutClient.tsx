'use client';
import React, { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import CheckoutSteps from './CheckoutSteps';
import CheckoutHeader from './CheckoutHeader';
import DeliveryStep from './DeliveryStep';
import styles from './checkout.module.scss';
import { CreditCard, WifiOff, QrCode } from 'lucide-react';
import { useTranslations } from 'next-intl';

// IMPORTANTE: Asegúrate de que las rutas de importación apunten a los archivos reales en tu proyecto
import { useAuth } from '@/hooks/useAuth';
import { useCart } from '@/hooks/useCart';
import { usePayment } from '@/hooks/usePayment';
import { useOrder } from '@/hooks/useOrder';
import { useBranches } from '@/hooks/useBranches';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { StripePaymentProvider, StripePaymentForm, StripePaymentPlaceholder } from './stripe-payment-form';
import PaymentMethodCard from './PaymentMethodCard'; // Debes tener este componente creado
import QrPaymentSection from './QrPaymentSection';
import { OrderItem, CreateOrderRequest } from '@/types/orders.types';
import { CartItem } from '@/types/cart.types';
import { FulfillmentType } from '@/types/branch.types';
import { DeliveryAddress, formatShippingAddress } from '@/types/address.types';
import { DELIVERY_SHIPPING_COST, round2 } from '@/utils/pricing';
import { addOfflineOrder } from '@/utils/offlineOrderQueue';
import { getApiErrorMessage } from '@/service/api/error.utils';
import { connectService } from '@/service/api/connect.service';
import { useStoreName } from '@/providers/StoreInfoProvider';

export const revalidate = false;

export default function CheckoutClient() {
    const { isAuthenticated } = useAuth()
    const router = useRouter();
    const t = useTranslations('Checkout');
    const storeName = useStoreName();
    useEffect(() => {
        if (!isAuthenticated) {
            router.push("/auth/login?redirect=/checkout")
        }
    }, [isAuthenticated, router])

    // Pasos: 1 = Entrega, 2 = Pago, 3 = Completado
    const [currentStep, setCurrentStep] = useState<number>(1);
    const [selectedPayment, setSelectedPayment] = useState<string>("");
    const [stripeError, setStripeError] = useState<string | null>(null);
    const [isCreatingOrder, setIsCreatingOrder] = useState(false);
    const [orderFailed, setOrderFailed] = useState(false);

    // Método de entrega
    const [fulfillmentType, setFulfillmentType] = useState<FulfillmentType>("DELIVERY");
    // Dirección de envío elegida (guardada o nueva) con su ubicación en el mapa
    const [deliveryAddress, setDeliveryAddress] = useState<DeliveryAddress | null>(null);

    const { totalPrice, totals, items, clearAllCart, syncCartProducts } = useCart();
    const { clientSecret, createPaymentIntent, error: paymentError } = usePayment();
    const { createOrder, order, error: orderError } = useOrder();
    const { selectedBranch, selectedBranchId } = useBranches();
    const { isOnline } = useNetworkStatus();
    // La tarjeta solo se ofrece si la tienda completó su cuenta de cobros (Stripe Connect); si no, el
    // backend rechaza el PaymentIntent. null = todavía no se sabe.
    const [cardEnabled, setCardEnabled] = useState<boolean | null>(null);
    useEffect(() => {
        connectService.isCardEnabled().then(setCardEnabled).catch(() => setCardEnabled(false));
    }, []);
    const [isSavingOffline, setIsSavingOffline] = useState(false);
    const [offlineError, setOfflineError] = useState<string | null>(null);

    const [stockError, setStockError] = useState<string | null>(null);

    const [orderId, setOrderId] = useState<string | undefined>(order?.id); // Extraemos el orderId de la orden creada
    // Total, descuento de empleado y costo de envío calculados por el backend al crear la orden
    const [orderTotal, setOrderTotal] = useState<number | null>(null);
    const [orderDiscount, setOrderDiscount] = useState<number | null>(null);
    const [orderShippingCost, setOrderShippingCost] = useState<number | null>(null);

    const isPickup = fulfillmentType === "PICKUP";
    // Antes de crear la orden, se previsualiza con la constante del frontend; ya creada, se usa el valor real del backend
    const shippingCost = orderShippingCost ?? (isPickup ? 0 : DELIVERY_SHIPPING_COST);
    const payableTotal = orderTotal ?? round2(totalPrice + shippingCost);
    const employeeDiscount = orderDiscount ?? totals.employeeDiscount;

    const handlePaymentMethodSelect = (method: string) => {
        setSelectedPayment(method);
        setStripeError(null);
        setOrderFailed(false);
    };

    useEffect(() => {
        if (items.length === 0 && !orderId) {
            router.push("/cart");
        }
    }, [items.length, orderId, router]);

    // Al llegar al paso 2, preseleccionar automáticamente el método según conectividad
    useEffect(() => {
        if (currentStep !== 2 || selectedPayment) return;
        if (!isOnline) setSelectedPayment("offline");
        else if (cardEnabled !== null) setSelectedPayment(cardEnabled ? "stripe" : "qr");
    }, [currentStep, selectedPayment, isOnline, cardEnabled]);

    const ensureOrderCreated = useCallback(async (forceRetry = false): Promise<string | null> => {
        let activeOrderId = orderId;

        // Crear la orden si no existe aún o si se fuerza reintento
        if (!activeOrderId || forceRetry) {
            setIsCreatingOrder(true);
            setStripeError(null);
            setOrderFailed(false);

            try {
                const cartItems: OrderItem[] = items.map((item: CartItem) => ({
                    productId: item.product?.id || item.productId,
                    quantity: item.quantity,
                    selectedSize: item.selectedSize,
                }));

                // createOrder (useOrder) ahora lanza con el mensaje EXACTO del backend en vez de
                // devolver null; si esta línea no lanza, createdOrder siempre viene con datos.
                const createdOrder = await createOrder({
                    items: cartItems,
                    fulfillmentType,
                    branchId: selectedBranchId ?? undefined,
                    // El backend solo acepta 'QR' explícito (@IsIn(['QR']) en CreateOrderDto); para
                    // Stripe hay que omitir el campo, no enviar 'STRIPE' (eso da 400 y aborta la orden).
                    ...(selectedPayment === 'qr' ? { paymentMethod: 'QR' as const } : {}),
                    ...(!isPickup && deliveryAddress
                        ? {
                            shippingAddress: formatShippingAddress(deliveryAddress),
                            latitude: deliveryAddress.latitude,
                            longitude: deliveryAddress.longitude,
                        }
                        : {}),
                });

                activeOrderId = createdOrder.id;
                setOrderId(createdOrder.id);
                setOrderTotal(Number(createdOrder.total));
                setOrderDiscount(Number(createdOrder.discountApplied ?? 0));
                setOrderShippingCost(Number(createdOrder.shippingCost ?? 0));
                return activeOrderId ?? null;
            } catch (error) {
                // error.message es ahora el texto EXACTO devuelto por NestJS (ej. "size should not
                // be empty"), no un texto genérico fijo — ver useOrder.createOrder.
                console.error("Error al preparar la orden:", error instanceof Error ? error.message : error);
                setOrderFailed(true);
                return null;
            } finally {
                setIsCreatingOrder(false);
            }
        }

        return activeOrderId ?? null;
    }, [orderId, items, createOrder, fulfillmentType, selectedBranchId, selectedPayment, isPickup, deliveryAddress]);

    const preparePayment = useCallback(async (forceRetry = false) => {
        if (currentStep !== 2 || selectedPayment !== 'stripe' || isCreatingOrder || clientSecret) {
            return;
        }

        const activeOrderId = await ensureOrderCreated(forceRetry);
        if (!activeOrderId) return;

        // Iniciar el PaymentIntent de Stripe para esta orden
        if (!clientSecret) {
            setIsCreatingOrder(true);
            try {
                const paymentCreated = await createPaymentIntent({
                    orderId: activeOrderId,
                    description: `Pago de orden en ${storeName}`,
                    currency: "usd"
                });

                if (!paymentCreated) {
                    throw new Error(t('payment.gatewayFailed'));
                }
            } catch (error) {
                console.error("Error al preparar Stripe:", error);
                setOrderFailed(true);
            } finally {
                setIsCreatingOrder(false);
            }
        }
    }, [currentStep, selectedPayment, isCreatingOrder, clientSecret, ensureOrderCreated, createPaymentIntent]);

    useEffect(() => {
        if (currentStep === 2 && selectedPayment === 'stripe' && !clientSecret && !orderFailed && !isCreatingOrder) {
            preparePayment();
        }
    }, [currentStep, selectedPayment, clientSecret, orderFailed, isCreatingOrder, preparePayment]);

    useEffect(() => {
        if (currentStep === 2 && selectedPayment === 'qr' && !orderId && !orderFailed && !isCreatingOrder) {
            ensureOrderCreated();
        }
    }, [currentStep, selectedPayment, orderId, orderFailed, isCreatingOrder, ensureOrderCreated]);

    const handleRetry = () => {
        setOrderFailed(false);
        setStripeError(null);
        if (selectedPayment === 'stripe') {
            preparePayment(true);
        } else if (selectedPayment === 'qr') {
            ensureOrderCreated(true);
        }
    };

    // La confirmación real del pago (idempotente) y la limpieza del carrito ocurren en /checkout/success:
    // así también funciona si Stripe redirige la página completa (ej. 3D Secure) en vez de resolver aquí mismo.
    const handlePaymentSuccess = (paymentIntentId: string) => {
        if (!orderId) return;
        router.push(`/checkout/success?orderId=${orderId}&payment_intent=${paymentIntentId}`);
    };

    const handlePaymentError = (error: string) => {
        setStripeError(error);
    };

    // Sin conexión no se puede llamar a POST /orders (ni a Stripe): se guarda el pedido tal cual en
    // IndexedDB y se sincroniza solo cuando vuelva el internet (useOfflineOrderSync, montado global
    // en OfflineSyncProvider). El stock recién se valida de verdad en ese momento, en el backend.
    const handleSaveOfflineOrder = async () => {
        if (isSavingOffline) return;
        setIsSavingOffline(true);
        setOfflineError(null);

        try {
            const cartItems: OrderItem[] = items.map((item: CartItem) => ({
                productId: item.product?.id || item.productId,
                quantity: item.quantity,
                selectedSize: item.selectedSize,
            }));

            const payload: CreateOrderRequest = {
                items: cartItems,
                fulfillmentType,
                branchId: selectedBranchId ?? undefined,
                paymentMethod: 'QR',
                ...(!isPickup && deliveryAddress
                    ? {
                        shippingAddress: formatShippingAddress(deliveryAddress),
                        latitude: deliveryAddress.latitude,
                        longitude: deliveryAddress.longitude,
                    }
                    : {}),
            };

            await addOfflineOrder(payload);
            if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('offline-order-added'));
            }
            clearAllCart();
            router.push('/checkout/offline-success');
        } catch (error) {
            setOfflineError(getApiErrorMessage(error, t('payment.offlineSaveFailed')));
        } finally {
            setIsSavingOffline(false);
        }
    };

    // Antes, un fallo al crear el payment intent quedaba en silencio (usePayment tenía su propio `error`,
    // pero nunca se leía aquí): se mostraba el placeholder para siempre sin explicar por qué.
    const displayedError = stripeError ?? paymentError ?? (orderFailed ? orderError : null);

    return (
        <section className={styles.section}>
            <div className={styles.container}>
                <CheckoutHeader />
                <CheckoutSteps currentStep={currentStep} />

                <div className={styles.panel}>
                    {currentStep === 1 && (
                        <div className={styles.paymentLayout}>
                            <DeliveryStep
                                fulfillmentType={fulfillmentType}
                                onFulfillmentChange={setFulfillmentType}
                                deliveryAddress={deliveryAddress}
                                onAddressChange={setDeliveryAddress}
                                onContinue={async () => {
                                    // Precios y stock definitivos de la sucursal elegida antes de pagar
                                    await syncCartProducts(selectedBranchId);
                                    const invalidItem = items.find(
                                        (item) => item.product.stock <= 0 || item.quantity > item.product.stock,
                                    );
                                    if (invalidItem) {
                                        setStockError(
                                            t('delivery.stockError', { name: invalidItem.product.name, stock: invalidItem.product.stock }),
                                        );
                                        return;
                                    }
                                    setStockError(null);
                                    setCurrentStep(2);
                                }}
                                stockError={stockError}
                            />

                            {renderSummary()}
                        </div>
                    )}

                    {currentStep === 2 && (
                        <div className={styles.paymentLayout}>
                            <div className={styles.stepContent}>
                                <h2>{t('payment.title')}</h2>

                                <div className={styles.deliverySummary}>
                                    <p>
                                        {isPickup
                                            ? t.rich('payment.pickupAt', {
                                                branch: selectedBranch?.name ?? t('payment.branchFallback'),
                                                strong: (chunks) => <strong>{chunks}</strong>,
                                            })
                                            : t.rich('payment.shipTo', {
                                                address: deliveryAddress ? formatShippingAddress(deliveryAddress) : '',
                                                branch: selectedBranch?.name ?? t('payment.branchFallback'),
                                                strong: (chunks) => <strong>{chunks}</strong>,
                                            })}
                                    </p>
                                    <button
                                        type="button"
                                        className={styles.linkButton}
                                        onClick={() => {
                                            setSelectedPayment("");
                                            setOrderFailed(false);
                                            setStripeError(null);
                                            setCurrentStep(1);
                                        }}
                                    >
                                        {t('payment.change')}
                                    </button>
                                </div>

                                <div className={styles.paymentMethods}>
                                    {!isOnline && (
                                        <div className={styles.offlineNotice}>
                                            <WifiOff size={18} />
                                            <span>{t('payment.offlineNotice')}</span>
                                        </div>
                                    )}

                                    {isOnline && cardEnabled === false && (
                                        <p className={styles.paymentHint}>{t('payment.cardUnavailable')}</p>
                                    )}

                                    {isOnline && cardEnabled ? (
                                        <PaymentMethodCard
                                            method="stripe"
                                            selectedMethod={selectedPayment}
                                            onSelect={handlePaymentMethodSelect}
                                            icon={<CreditCard />}
                                            title={t('payment.card')}
                                            description={t('payment.cardDescription')}
                                        >
                                            {displayedError && (
                                                <div className={styles.errorMessage}>
                                                    <span>{displayedError}</span>
                                                    <button
                                                        type="button"
                                                        onClick={handleRetry}
                                                        className={styles.retryButton}
                                                    >
                                                        {t('payment.retryPrepare')}
                                                    </button>
                                                </div>
                                            )}

                                            {clientSecret && orderId ? (
                                                <StripePaymentProvider
                                                    clientSecret={clientSecret}
                                                    amount={payableTotal}
                                                    onSuccess={handlePaymentSuccess}
                                                    onError={handlePaymentError}
                                                >
                                                    <StripePaymentForm
                                                        amount={payableTotal}
                                                        orderId={orderId}
                                                        onSuccess={handlePaymentSuccess}
                                                        onError={handlePaymentError}
                                                    />
                                                </StripePaymentProvider>
                                            ) : (
                                                <StripePaymentPlaceholder
                                                    amount={payableTotal}
                                                    isLoading={isCreatingOrder}
                                                    onRetry={orderFailed || displayedError ? handleRetry : undefined}
                                                />
                                            )}
                                        </PaymentMethodCard>
                                    ) : null}

                                    {isOnline && (
                                        <PaymentMethodCard
                                            method="qr"
                                            selectedMethod={selectedPayment}
                                            onSelect={handlePaymentMethodSelect}
                                            icon={<QrCode />}
                                            title={t('payment.qr')}
                                            description={t('payment.qrDescription')}
                                        >
                                            <QrPaymentSection
                                                orderId={orderId}
                                                amount={payableTotal}
                                                isLoadingOrder={isCreatingOrder}
                                                onSuccess={handlePaymentSuccess}
                                                onError={handlePaymentError}
                                            />
                                        </PaymentMethodCard>
                                    )}

                                    {!isOnline && (
                                        <PaymentMethodCard
                                            method="offline"
                                            selectedMethod={selectedPayment}
                                            onSelect={handlePaymentMethodSelect}
                                            icon={<WifiOff />}
                                            title={t('payment.offline')}
                                            description={t('payment.offlineDescription')}
                                        >
                                            {offlineError && <div className={styles.errorMessage}>{offlineError}</div>}
                                            <button
                                                type="button"
                                                className={styles.continueButton}
                                                disabled={isSavingOffline}
                                                onClick={handleSaveOfflineOrder}
                                            >
                                                {isSavingOffline ? t('payment.saving') : t('payment.saveOrder')}
                                            </button>
                                        </PaymentMethodCard>
                                    )}

                                    {isOnline && !selectedPayment && (
                                        <>
                                            <p className={styles.paymentHint}>{t('payment.selectHint')}</p>
                                            {cardEnabled && <StripePaymentPlaceholder amount={payableTotal} isLoading={false} />}
                                        </>
                                    )}
                                </div>
                            </div>

                            {renderSummary()}
                        </div>
                    )}
                </div>
            </div>
        </section>
    );

    // Resumen del pedido: descuentos de producto y de empleado, envío y total final
    function renderSummary() {
        return (
            <aside className={styles.summary}>
                <h3>{t('summary.title')}</h3>
                <div className={styles.summaryRow}>
                    <span>{t('summary.items', { count: items.length })}</span>
                    <span>Bs {totals.listSubtotal.toFixed(2)}</span>
                </div>
                {items.map((item) => (
                    <div className={styles.summaryRow} key={item.id}>
                        <span>
                            {item.product.name}
                            {item.selectedSize ? ` ${t('summary.size', { size: item.selectedSize })}` : ""} x{item.quantity}
                        </span>
                    </div>
                ))}
                <hr className={styles.divider} />
                {totals.productDiscount > 0 && (
                    <div className={`${styles.summaryRow} ${styles.discountRow}`}>
                        <span>{t('summary.productDiscount')}</span>
                        <span>-Bs {totals.productDiscount.toFixed(2)}</span>
                    </div>
                )}
                {employeeDiscount > 0 && (
                    <div className={`${styles.summaryRow} ${styles.discountRow}`}>
                        <span>{t('summary.employeeDiscount', { percent: totals.employeeDiscountPercent })}</span>
                        <span>-Bs {employeeDiscount.toFixed(2)}</span>
                    </div>
                )}
                {/* Recojo en sucursal no tiene costo de envío: la fila se oculta en vez de mostrar $0.00 */}
                {!isPickup && (
                    <div className={styles.summaryRow}>
                        <span>{t('summary.shipping')}</span>
                        <span>Bs {shippingCost.toFixed(2)}</span>
                    </div>
                )}
                <hr className={styles.divider} />
                <div className={styles.summaryTotal}>
                    <span>{t('summary.total')}</span>
                    <span>Bs {payableTotal.toFixed(2)}</span>
                </div>
            </aside>
        );
    }
}

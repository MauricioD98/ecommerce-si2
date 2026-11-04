'use client';
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import CheckoutSteps from './CheckoutSteps';
import CheckoutHeader from './CheckoutHeader';
import DeliveryStep from './DeliveryStep';
import styles from './checkout.module.scss';
import { CreditCard, WifiOff, QrCode, Landmark, Coins } from 'lucide-react';
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
import ManualPaymentSection from './ManualPaymentSection';
import { OrderItem } from '@/types/orders.types';
import { CartItem } from '@/types/cart.types';
import { FulfillmentType } from '@/types/branch.types';
import { DeliveryAddress, formatShippingAddress } from '@/types/address.types';
import { DELIVERY_SHIPPING_COST, round2 } from '@/utils/pricing';
import { addOrderDraft } from '@/utils/offlineOrderQueue';
import { ATTEMPTS_CHANGED_EVENT, CheckoutAttempt, forgetAttemptsOfOrder, getOwnAttempts } from '@/utils/checkoutAttempts';
import { OrderService } from '@/service/api/order.service';
import { OfflineStorageError } from '@/utils/offlineDb';
import { getApiErrorMessage } from '@/service/api/error.utils';
import { PaymentOptions, paymentSettingsService } from '@/service/api/paymentSettings.service';
import { useStoreName } from '@/providers/StoreInfoProvider';

export const revalidate = false;

export default function CheckoutClient() {
    const { isAuthenticated, user } = useAuth()
    const userId = user?.id ?? null;
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
    const { startCheckout, resumeCheckout, error: orderError, setError: setOrderError } = useOrder();
    const { selectedBranch, selectedBranchId } = useBranches();
    const { isOnline } = useNetworkStatus();
    // Medios de cobro activos de la tienda (Gestión de pagos). La tarjeta solo se ofrece si completó su
    // cuenta de cobros (Stripe Connect); si no, el backend rechaza el PaymentIntent. null = todavía no se sabe.
    const [paymentOptions, setPaymentOptions] = useState<PaymentOptions | null>(null);
    const [optionsLoaded, setOptionsLoaded] = useState(false);
    useEffect(() => {
        paymentSettingsService
            .getOptions()
            .then(setPaymentOptions)
            .catch(() => setPaymentOptions({ card: false, bankQr: null, usdt: null }))
            .finally(() => setOptionsLoaded(true));
    }, []);
    const cardEnabled = optionsLoaded ? Boolean(paymentOptions?.card) : null;
    const [isSavingOffline, setIsSavingOffline] = useState(false);
    const [offlineError, setOfflineError] = useState<string | null>(null);

    const [stockError, setStockError] = useState<string | null>(null);

    const [orderId, setOrderId] = useState<string | undefined>(undefined); // Orden creada por este intento
    // Compra enviada cuyo resultado se desconoce (corte de red, 5xx): se está verificando, no es un fallo
    const [verifying, setVerifying] = useState(false);
    const activeAttempt = useRef<CheckoutAttempt | null>(null);
    const [resumeChecked, setResumeChecked] = useState(false);
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

    const applyOrderTotals = useCallback((created: { id: string; total: number; discountApplied?: number; shippingCost?: number }) => {
        setOrderId(created.id);
        setOrderTotal(Number(created.total));
        setOrderDiscount(Number(created.discountApplied ?? 0));
        setOrderShippingCost(Number(created.shippingCost ?? 0));
    }, []);

    // Recuperación: volver a esta pantalla (recarga, app cerrada, retorno de otra pestaña) retoma el intento
    // de esta cuenta y esta tienda. La misma clave garantiza que no se crea otra compra.
    const syncActiveAttempt = useCallback(async () => {
        const own = await getOwnAttempts(userId).catch(() => [] as CheckoutAttempt[]);
        const attempt = own[0] ?? null;
        activeAttempt.current = attempt;
        if (attempt?.state === 'CONFIRMED' && attempt.orderId) {
            setVerifying(false);
            setCurrentStep(2);
            try {
                const response = await OrderService.getOrder(attempt.orderId);
                const current = (response.data ?? response) as unknown as { id: string; total: number; discountApplied?: number; shippingCost?: number; status?: string; paymentStatus?: string };
                if (current.status !== 'PENDIENTE' || current.paymentStatus === 'COMPLETADO') {
                    await forgetAttemptsOfOrder(userId, attempt.orderId);
                    activeAttempt.current = null;
                } else {
                    applyOrderTotals(current);
                }
            } catch {
                setOrderId(attempt.orderId);
            }
        } else if (attempt) {
            // Recién enviado todavía no es incierto: solo si quien lo enviaba ya no puede responder
            setVerifying(attempt.state === 'IN_DOUBT' || Date.now() - new Date(attempt.updatedAt).getTime() > 15_000);
            setCurrentStep(2);
        } else {
            setVerifying(false);
        }
        setResumeChecked(true);
    }, [userId, applyOrderTotals]);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        syncActiveAttempt();
        window.addEventListener(ATTEMPTS_CHANGED_EVENT, syncActiveAttempt);
        return () => window.removeEventListener(ATTEMPTS_CHANGED_EVENT, syncActiveAttempt);
    }, [syncActiveAttempt]);

    // Tras guardar un borrador el carrito queda vacío a propósito: no hay que competir con esa navegación
    const leavingForDraft = useRef(false);
    useEffect(() => {
        if (resumeChecked && items.length === 0 && !orderId && !verifying && !leavingForDraft.current) {
            router.push("/cart");
        }
    }, [resumeChecked, items.length, orderId, verifying, router]);

    // Al llegar al paso 2, preseleccionar automáticamente el método según conectividad
    useEffect(() => {
        if (currentStep !== 2 || selectedPayment) return;
        if (!isOnline) setSelectedPayment("offline");
        else if (cardEnabled !== null) {
            // Sin tarjeta se prefieren los medios reales de la tienda (no crean el pedido hasta enviar el
            // comprobante). El QR simulado solo existe en entornos de prueba explícitos.
            setSelectedPayment(
                cardEnabled ? "stripe" : paymentOptions?.bankQr ? "bank_qr" : paymentOptions?.usdt ? "usdt" : paymentOptions?.simulatedQr ? "qr" : "",
            );
        }
    }, [currentStep, selectedPayment, isOnline, cardEnabled, paymentOptions]);

    // Creación del pedido en curso: si dos caminos la piden a la vez (p. ej. el QR simple al
    // preseleccionarse y el envío de un comprobante), comparten la misma petición en vez de crear dos
    const orderInFlight = useRef<Promise<string | null> | null>(null);

    const ensureOrderCreated = useCallback(async (): Promise<string | null> => {
        if (orderInFlight.current) return orderInFlight.current;
        if (orderId) return orderId;

        const create = async (): Promise<string | null> => {
            setIsCreatingOrder(true);
            setStripeError(null);
            setOrderFailed(false);
            try {
                // Un intento sin resolver se retoma con su misma clave: jamás se inicia otra compra encima
                const pending = activeAttempt.current ?? (await getOwnAttempts(userId).catch(() => [] as CheckoutAttempt[]))[0] ?? null;
                let result;
                if (pending) {
                    result = await resumeCheckout(pending);
                } else {
                    const cartItems: OrderItem[] = items.map((item: CartItem) => ({
                        productId: item.product?.id || item.productId,
                        quantity: item.quantity,
                        selectedSize: item.selectedSize,
                    }));
                    result = await startCheckout({
                        items: cartItems,
                        fulfillmentType,
                        branchId: selectedBranchId ?? undefined,
                        // El total que el usuario está viendo: si el servidor calcula otro, responde
                        // PRICE_CHANGED sin efectos y se le muestra antes de cobrar nada.
                        expectedTotal: round2(totalPrice + (isPickup ? 0 : DELIVERY_SHIPPING_COST)),
                        // El backend acepta QR, BANK_QR o USDT (CreateOrderDto); para Stripe hay que omitir
                        // el campo, no enviar 'STRIPE' (eso da 400 y aborta la orden).
                        ...(selectedPayment === 'qr' ? { paymentMethod: 'QR' as const } : {}),
                        ...(selectedPayment === 'bank_qr' ? { paymentMethod: 'BANK_QR' as const } : {}),
                        ...(selectedPayment === 'usdt' ? { paymentMethod: 'USDT' as const } : {}),
                        ...(!isPickup && deliveryAddress
                            ? {
                                shippingAddress: formatShippingAddress(deliveryAddress),
                                latitude: deliveryAddress.latitude,
                                longitude: deliveryAddress.longitude,
                            }
                            : {}),
                    });
                }

                if (result.kind === 'created') {
                    activeAttempt.current = result.attempt;
                    setVerifying(false);
                    applyOrderTotals(result.order);
                    return result.order.id;
                }
                if (result.kind === 'uncertain') {
                    // No es un fracaso: el servidor pudo confirmar y perder la respuesta
                    activeAttempt.current = result.attempt;
                    setVerifying(true);
                    return null;
                }
                if (result.kind === 'not-saved') {
                    setOrderError(t(result.quota ? 'payment.storageFull' : 'payment.storageFailed'));
                }
                // Decisión definitiva: nada se creó. Comprar de nuevo es una intención nueva, revisada por el usuario
                activeAttempt.current = null;
                setOrderFailed(true);
                return null;
            } catch (error) {
                console.error("Error al preparar la orden:", error instanceof Error ? error.message : error);
                setOrderFailed(true);
                return null;
            } finally {
                setIsCreatingOrder(false);
                orderInFlight.current = null;
            }
        };
        orderInFlight.current = create();
        return orderInFlight.current;
    }, [orderId, items, startCheckout, resumeCheckout, applyOrderTotals, setOrderError, t, userId, fulfillmentType, selectedBranchId, selectedPayment, isPickup, deliveryAddress, totalPrice]);

    const preparePayment = useCallback(async () => {
        if (currentStep !== 2 || selectedPayment !== 'stripe' || isCreatingOrder || clientSecret) {
            return;
        }

        const activeOrderId = await ensureOrderCreated();
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
        if (currentStep === 2 && selectedPayment === 'stripe' && !clientSecret && !orderFailed && !isCreatingOrder && !verifying && !paymentError) {
            preparePayment();
        }
    }, [currentStep, selectedPayment, clientSecret, orderFailed, isCreatingOrder, verifying, paymentError, preparePayment]);

    useEffect(() => {
        if (currentStep === 2 && selectedPayment === 'qr' && !orderId && !orderFailed && !isCreatingOrder && !verifying) {
            ensureOrderCreated();
        }
    }, [currentStep, selectedPayment, orderId, orderFailed, isCreatingOrder, verifying, ensureOrderCreated]);

    const handleRetry = () => {
        setOrderFailed(false);
        setStripeError(null);
        if (selectedPayment === 'stripe') {
            preparePayment();
        } else if (selectedPayment === 'qr') {
            ensureOrderCreated();
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

    // Sin conexión no se puede comprar: se guarda un BORRADOR. No reserva stock ni es una orden, y al volver
    // la conexión se revalida y se pide confirmación (ver /checkout/drafts). Nunca se envía solo.
    const handleSaveOfflineOrder = async () => {
        if (isSavingOffline || !user?.id) return;
        setIsSavingOffline(true);
        setOfflineError(null);

        try {
            const cartItems: OrderItem[] = items.map((item: CartItem) => ({
                productId: item.product?.id || item.productId,
                quantity: item.quantity,
                selectedSize: item.selectedSize,
            }));

            await addOrderDraft(user.id, {
                items: cartItems,
                fulfillmentType,
                branchId: selectedBranchId ?? undefined,
                ...(!isPickup && deliveryAddress
                    ? {
                        shippingAddress: formatShippingAddress(deliveryAddress),
                        latitude: deliveryAddress.latitude,
                        longitude: deliveryAddress.longitude,
                    }
                    : {}),
            });
            window.dispatchEvent(new CustomEvent('offline-order-added'));
            leavingForDraft.current = true;
            clearAllCart();
            // Navegación completa: sin red, el router haría un fetch RSC que no llegaría a la página guardada
            window.location.assign('/checkout/offline-success');
        } catch (error) {
            setOfflineError(
                error instanceof OfflineStorageError && error.quota ? t('payment.storageFull') : getApiErrorMessage(error, t('payment.offlineSaveFailed')),
            );
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

                                {verifying && (
                                    <div className={styles.offlineNotice} role="status">
                                        <WifiOff size={18} />
                                        <span>{t('payment.verifying')}</span>
                                    </div>
                                )}

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

                                    {isOnline && paymentOptions?.simulatedQr && (
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

                                    {/* Medios manuales de la tienda: el pedido se crea recién al enviar el comprobante */}
                                    {isOnline && paymentOptions?.bankQr && (
                                        <PaymentMethodCard
                                            method="bank_qr"
                                            selectedMethod={selectedPayment}
                                            onSelect={handlePaymentMethodSelect}
                                            icon={<Landmark />}
                                            title={t('payment.bankQr')}
                                            description={t('payment.bankQrDescription')}
                                        >
                                            <ManualPaymentSection
                                                method="BANK_QR"
                                                options={paymentOptions}
                                                amount={payableTotal}
                                                ensureOrder={() => ensureOrderCreated()}
                                                onSubmitted={(submittedOrderId) => {
                                                    clearAllCart();
                                                    forgetAttemptsOfOrder(userId, submittedOrderId).catch(() => undefined);
                                                }}
                                            />
                                        </PaymentMethodCard>
                                    )}

                                    {isOnline && paymentOptions?.usdt && (
                                        <PaymentMethodCard
                                            method="usdt"
                                            selectedMethod={selectedPayment}
                                            onSelect={handlePaymentMethodSelect}
                                            icon={<Coins />}
                                            title={t('payment.usdt')}
                                            description={t('payment.usdtDescription', { network: paymentOptions.usdt.network })}
                                        >
                                            <ManualPaymentSection
                                                method="USDT"
                                                options={paymentOptions}
                                                amount={payableTotal}
                                                ensureOrder={() => ensureOrderCreated()}
                                                onSubmitted={(submittedOrderId) => {
                                                    clearAllCart();
                                                    forgetAttemptsOfOrder(userId, submittedOrderId).catch(() => undefined);
                                                }}
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

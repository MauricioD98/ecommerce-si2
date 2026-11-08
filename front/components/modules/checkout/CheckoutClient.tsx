'use client';
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import CheckoutSteps from './CheckoutSteps';
import CheckoutHeader from './CheckoutHeader';
import DeliveryStep from './DeliveryStep';
import styles from './checkout.module.scss';
import { CreditCard, WifiOff, QrCode, Landmark, Coins, Wallet as WalletIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { useAuth } from '@/hooks/useAuth';
import { useCart } from '@/hooks/useCart';
import { usePayment } from '@/hooks/usePayment';
import { useOrder } from '@/hooks/useOrder';
import { useBranches } from '@/hooks/useBranches';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { StripePaymentProvider, StripePaymentForm, StripePaymentPlaceholder } from './stripe-payment-form';
import PaymentMethodCard from './PaymentMethodCard';
import QrPaymentSection from './QrPaymentSection';
import ManualPaymentSection from './ManualPaymentSection';
import ManualOrderConfirmation from './ManualOrderConfirmation';
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
import { useStoreName, useStorePlan } from '@/providers/StoreInfoProvider';

// Moneda en la que el checkout muestra los importes ("Bs")
const DISPLAY_CURRENCY = 'bob';

export const revalidate = false;

// Pedido manual (QR bancario, USDT, billetera) ya avisado en esta pestaña: una recarga vuelve a mostrar la
// confirmación (con los datos del servidor) en lugar de mandar al carrito vacío. Por usuario.
const confirmedKey = (userId: string) => `sf_manual_confirmed:${userId}`;
const readConfirmed = (userId: string | null): string | null => {
    if (!userId || typeof sessionStorage === 'undefined') return null;
    try {
        return sessionStorage.getItem(confirmedKey(userId));
    } catch {
        return null;
    }
};
const writeConfirmed = (userId: string | null, orderId: string | null) => {
    if (!userId || typeof sessionStorage === 'undefined') return;
    try {
        if (orderId) sessionStorage.setItem(confirmedKey(userId), orderId);
        else sessionStorage.removeItem(confirmedKey(userId));
    } catch {
        // Almacenamiento bloqueado: solo se pierde el retomar tras recargar
    }
};

export default function CheckoutClient() {
    const { isAuthenticated, user } = useAuth();
    const userId = user?.id ?? null;
    const router = useRouter();
    const t = useTranslations('Checkout');
    const storeName = useStoreName();
    const { features } = useStorePlan();

    useEffect(() => {
        if (!isAuthenticated) {
            router.push("/auth/login?redirect=/checkout");
        }
    }, [isAuthenticated, router]);

    // Pasos: 1 = Entrega, 2 = Pago, 3 = Confirmación
    const [currentStep, setCurrentStep] = useState<number>(1);
    // Pedido manual cuyo aviso de pago el servidor ya registró (paso 3)
    const [confirmedOrderId, setConfirmedOrderId] = useState<string | null>(null);
    const justConfirmedRef = useRef<string | null>(null);
    const [selectedPayment, setSelectedPayment] = useState<string>("");
    const [stripeError, setStripeError] = useState<string | null>(null);
    const [isCreatingOrder, setIsCreatingOrder] = useState(false);
    const [orderFailed, setOrderFailed] = useState(false);

    // Método de entrega
    const [fulfillmentType, setFulfillmentType] = useState<FulfillmentType>("DELIVERY");
    // Dirección de envío elegida (guardada o nueva) con su ubicación en el mapa
    const [deliveryAddress, setDeliveryAddress] = useState<DeliveryAddress | null>(null);

    const { totalPrice, totals, items, clearAllCart, syncCartProducts } = useCart();
    // useCart devuelve funciones nuevas en cada render: se leen por ref para no reiniciar la recuperación
    const clearCartRef = useRef(clearAllCart);
    const itemsRef = useRef(items);
    useEffect(() => {
        clearCartRef.current = clearAllCart;
        itemsRef.current = items;
    });
    const { clientSecret, createPaymentIntent, error: paymentError } = usePayment();
    const { startCheckout, resumeCheckout, error: orderError, setError: setOrderError } = useOrder();
    const { selectedBranch, selectedBranchId } = useBranches();
    const { isOnline } = useNetworkStatus();

    const [paymentOptions, setPaymentOptions] = useState<PaymentOptions | null>(null);
    const [optionsLoaded, setOptionsLoaded] = useState(false);
    useEffect(() => {
        paymentSettingsService
            .getOptions()
            .then(setPaymentOptions)
            .catch(() => setPaymentOptions({ card: false, qrAllowed: false, bankQr: null, usdt: null, wallet: null }))
            .finally(() => setOptionsLoaded(true));
    }, []);
    // Los importes se muestran en Bs: la tarjeta solo se ofrece si la API cobra en esa misma moneda.
    // Una API sin el campo (versión anterior) cobraba en USD por defecto, así que tampoco coincide.
    const cardCurrencyMatches = (paymentOptions?.currency ?? "").toLowerCase() === DISPLAY_CURRENCY;
    const cardEnabled = optionsLoaded ? Boolean(paymentOptions?.card) && cardCurrencyMatches : null;
    // QR solo se ofrece si el plan de la tienda incluye pagos por QR (Starter, Growth, Pro).
    const qrAllowed = optionsLoaded ? Boolean(paymentOptions?.qrAllowed ?? features.qrPayments) : false;
    // Billetera digital (Airtm, Takenos, Wallbit) solo se ofrece desde el Plan Growth.
    const walletAllowed = optionsLoaded ? Boolean(paymentOptions?.walletAllowed ?? features.digitalWallet) : false;

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

        // Recarga en el paso 3: con el carrito vacío se vuelve a mostrar la confirmación de ese pedido.
        // Si el carrito tiene productos nuevos, es otra compra y la confirmación vieja se descarta.
        const storedConfirmed = readConfirmed(userId);
        // justConfirmed: el aviso se acaba de registrar en esta pantalla y el carrito todavía puede no haberse vaciado
        const justConfirmed = storedConfirmed !== null && justConfirmedRef.current === storedConfirmed;
        if (storedConfirmed && (justConfirmed || (itemsRef.current.length === 0 && (!attempt || attempt.orderId === storedConfirmed)))) {
            setConfirmedOrderId(storedConfirmed);
            setVerifying(false);
            setCurrentStep(3);
            setResumeChecked(true);
            return;
        }
        if (storedConfirmed) writeConfirmed(userId, null);

        if (attempt?.state === 'CONFIRMED' && attempt.orderId) {
            setVerifying(false);
            setCurrentStep(2);
            try {
                const response = await OrderService.getOrder(attempt.orderId);
                const current = (response.data ?? response) as unknown as { id: string; total: number; discountApplied?: number; shippingCost?: number; status?: string; paymentStatus?: string; paymentProof?: { status: string } | null };
                if (current.status === 'PENDIENTE' && current.paymentStatus === 'PENDIENTE' && current.paymentProof?.status === 'PENDIENTE') {
                    // El aviso de pago llegó al servidor pero se perdió la respuesta: no se vuelve a pedir
                    await forgetAttemptsOfOrder(userId, attempt.orderId);
                    activeAttempt.current = null;
                    justConfirmedRef.current = attempt.orderId;
                    writeConfirmed(userId, attempt.orderId);
                    clearCartRef.current();
                    setConfirmedOrderId(attempt.orderId);
                    setCurrentStep(3);
                } else if (current.status !== 'PENDIENTE' || current.paymentStatus === 'COMPLETADO') {
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
        if (resumeChecked && items.length === 0 && !orderId && !confirmedOrderId && !verifying && !leavingForDraft.current) {
            router.push("/cart");
        }
    }, [resumeChecked, items.length, orderId, confirmedOrderId, verifying, router]);

    // El servidor registró el aviso de pago (respuesta 2xx): recién entonces se pasa al paso 3. El pago sigue
    // pendiente; el carrito se vacía porque el pedido ya tiene su stock reservado.
    const handleManualSubmitted = useCallback((submittedOrderId: string) => {
        justConfirmedRef.current = submittedOrderId;
        writeConfirmed(userId, submittedOrderId);
        setConfirmedOrderId(submittedOrderId);
        setCurrentStep(3);
        clearCartRef.current();
        forgetAttemptsOfOrder(userId, submittedOrderId).catch(() => undefined);
        activeAttempt.current = null;
        if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
    }, [userId]);

    // Al llegar al paso 2, preseleccionar automáticamente solo medios habilitados y permitidos por el plan
    useEffect(() => {
        if (currentStep !== 2 || selectedPayment) return;
        if (!isOnline) {
            setSelectedPayment("offline");
        } else if (cardEnabled !== null) {
            if (cardEnabled) setSelectedPayment("stripe");
            else if (paymentOptions?.bankQr && qrAllowed) setSelectedPayment("bank_qr");
            else if (paymentOptions?.simulatedQr && qrAllowed) setSelectedPayment("qr");
            else if (paymentOptions?.wallet && walletAllowed) setSelectedPayment("wallet");
            else if (paymentOptions?.usdt) setSelectedPayment("usdt");
        }
    }, [currentStep, selectedPayment, isOnline, optionsLoaded, cardEnabled, paymentOptions, qrAllowed]);

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
                        ...(selectedPayment === 'qr' && qrAllowed ? { paymentMethod: 'QR' as const } : {}),
                        ...(selectedPayment === 'bank_qr' && qrAllowed ? { paymentMethod: 'BANK_QR' as const } : {}),
                        ...(selectedPayment === 'usdt' ? { paymentMethod: 'USDT' as const } : {}),
                        ...(selectedPayment === 'wallet' && walletAllowed ? { paymentMethod: 'WALLET' as const } : {}),
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

        if (!clientSecret) {
            setIsCreatingOrder(true);
            try {
                const paymentCreated = await createPaymentIntent({
                    orderId: activeOrderId,
                    // Importe y moneda los fija el servidor (PAYMENT_CURRENCY): el cliente no los envía
                    description: `Pago de orden en ${storeName}`,
                });

                if (!paymentCreated) {
                    throw new Error(t('payment.gatewayFailed'));
                }
            } catch (error) {
                console.warn("Error al preparar Stripe:", error);
                setOrderFailed(true);
            } finally {
                setIsCreatingOrder(false);
            }
        }
    }, [currentStep, selectedPayment, isCreatingOrder, clientSecret, ensureOrderCreated, createPaymentIntent, storeName, t]);

    useEffect(() => {
        if (currentStep === 2 && selectedPayment === 'stripe' && !clientSecret && !orderFailed && !isCreatingOrder && !verifying && !paymentError) {
            preparePayment();
        }
    }, [currentStep, selectedPayment, clientSecret, orderFailed, isCreatingOrder, verifying, paymentError, preparePayment]);

    useEffect(() => {
        if (currentStep === 2 && selectedPayment === 'qr' && qrAllowed && !orderId && !orderFailed && !isCreatingOrder && !verifying) {
            ensureOrderCreated();
        }
    }, [currentStep, selectedPayment, qrAllowed, orderId, orderFailed, isCreatingOrder, verifying, ensureOrderCreated]);

    const handleRetry = () => {
        setOrderFailed(false);
        setStripeError(null);
        if (selectedPayment === 'stripe') {
            preparePayment();
        } else if (selectedPayment === 'qr' && qrAllowed) {
            ensureOrderCreated();
        }
    };

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
                ...(qrAllowed ? { paymentMethod: 'QR' as const } : {}),
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

    const displayedError = stripeError ?? paymentError ?? (orderFailed ? orderError : null);
    const hasAnyOnlineMethod =
        Boolean(cardEnabled) ||
        Boolean(paymentOptions?.simulatedQr && qrAllowed) ||
        Boolean(paymentOptions?.bankQr && qrAllowed) ||
        Boolean(paymentOptions?.usdt) ||
        Boolean(paymentOptions?.wallet && walletAllowed);

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
                                        <p className={styles.paymentHint}>
                                            {paymentOptions?.card && !cardCurrencyMatches ? t('payment.cardCurrencyMismatch') : t('payment.cardUnavailable')}
                                        </p>
                                    )}

                                    {isOnline && optionsLoaded && !hasAnyOnlineMethod && (
                                        <div className={styles.errorMessage}>
                                            <span>Esta tienda aún no tiene métodos de cobro configurados. El administrador puede habilitarlos desde Gestión de pagos.</span>
                                        </div>
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

                                    {isOnline && qrAllowed && paymentOptions?.simulatedQr && (
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
                                    {isOnline && qrAllowed && paymentOptions?.bankQr && (
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
                                                onSubmitted={handleManualSubmitted}
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
                                                onSubmitted={handleManualSubmitted}
                                            />
                                        </PaymentMethodCard>
                                    )}

                                    {isOnline && walletAllowed && paymentOptions?.wallet && (
                                        <PaymentMethodCard
                                            method="wallet"
                                            selectedMethod={selectedPayment}
                                            onSelect={handlePaymentMethodSelect}
                                            icon={<WalletIcon />}
                                            title={t('payment.wallet')}
                                            description={t('payment.walletDescription')}
                                        >
                                            <ManualPaymentSection
                                                method="WALLET"
                                                options={paymentOptions}
                                                amount={payableTotal}
                                                ensureOrder={() => ensureOrderCreated()}
                                                onSubmitted={handleManualSubmitted}
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

                                    {isOnline && !selectedPayment && hasAnyOnlineMethod && (
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

                    {currentStep === 3 && confirmedOrderId && (
                        <ManualOrderConfirmation orderId={confirmedOrderId} onLeave={() => writeConfirmed(userId, null)} />
                    )}
                </div>
            </div>
        </section>
    );

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

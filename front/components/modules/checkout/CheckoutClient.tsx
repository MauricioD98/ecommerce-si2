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
import { OrderItem, CreateOrderRequest } from '@/types/orders.types';
import { CartItem } from '@/types/cart.types';
import { FulfillmentType } from '@/types/branch.types';
import { DeliveryAddress, formatShippingAddress } from '@/types/address.types';
import { DELIVERY_SHIPPING_COST, round2 } from '@/utils/pricing';
import { addOfflineOrder } from '@/utils/offlineOrderQueue';
import { getApiErrorMessage } from '@/service/api/error.utils';
import { PaymentOptions, paymentSettingsService } from '@/service/api/paymentSettings.service';
import { useStoreName, useStorePlan } from '@/providers/StoreInfoProvider';

export const revalidate = false;

export default function CheckoutClient() {
    const { isAuthenticated } = useAuth();
    const router = useRouter();
    const t = useTranslations('Checkout');
    const storeName = useStoreName();
    const { features } = useStorePlan();

    useEffect(() => {
        if (!isAuthenticated) {
            router.push("/auth/login?redirect=/checkout");
        }
    }, [isAuthenticated, router]);

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

    const [paymentOptions, setPaymentOptions] = useState<PaymentOptions | null>(null);
    const [optionsLoaded, setOptionsLoaded] = useState(false);
    useEffect(() => {
        paymentSettingsService
            .getOptions()
            .then(setPaymentOptions)
            .catch(() => setPaymentOptions({ card: false, qrAllowed: false, bankQr: null, usdt: null, wallet: null }))
            .finally(() => setOptionsLoaded(true));
    }, []);
    const cardEnabled = optionsLoaded ? Boolean(paymentOptions?.card) : null;
    // QR solo se ofrece si el plan de la tienda incluye pagos por QR (Starter, Growth, Pro).
    const qrAllowed = optionsLoaded ? Boolean(paymentOptions?.qrAllowed ?? features.qrPayments) : false;
    // Billetera digital (Airtm, Takenos, Wallbit) solo se ofrece desde el Plan Growth.
    const walletAllowed = optionsLoaded ? Boolean(paymentOptions?.walletAllowed ?? features.digitalWallet) : false;

    const [isSavingOffline, setIsSavingOffline] = useState(false);
    const [offlineError, setOfflineError] = useState<string | null>(null);

    const [stockError, setStockError] = useState<string | null>(null);

    const [orderId, setOrderId] = useState<string | undefined>(order?.id);
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

    useEffect(() => {
        if (items.length === 0 && !orderId) {
            router.push("/cart");
        }
    }, [items.length, orderId, router]);

    // Al llegar al paso 2, preseleccionar automáticamente solo medios habilitados y permitidos por el plan
    useEffect(() => {
        if (currentStep !== 2 || selectedPayment) return;
        if (!isOnline) {
            setSelectedPayment("offline");
        } else if (optionsLoaded && cardEnabled !== null) {
            if (cardEnabled) setSelectedPayment("stripe");
            else if (paymentOptions?.bankQr && qrAllowed) setSelectedPayment("bank_qr");
            else if (qrAllowed) setSelectedPayment("qr");
            else if (paymentOptions?.wallet && walletAllowed) setSelectedPayment("wallet");
            else if (paymentOptions?.usdt) setSelectedPayment("usdt");
        }
    }, [currentStep, selectedPayment, isOnline, optionsLoaded, cardEnabled, paymentOptions, qrAllowed]);

    const orderInFlight = useRef<Promise<string | null> | null>(null);

    const ensureOrderCreated = useCallback(async (forceRetry = false): Promise<string | null> => {
        if (orderInFlight.current) return orderInFlight.current;
        let activeOrderId = orderId;

        if (!activeOrderId || forceRetry) {
            const create = async (): Promise<string | null> => {
                setIsCreatingOrder(true);
                setStripeError(null);
                setOrderFailed(false);

                try {
                    const cartItems: OrderItem[] = items.map((item: CartItem) => ({
                        productId: item.product?.id || item.productId,
                        quantity: item.quantity,
                        selectedSize: item.selectedSize,
                    }));

                    const createdOrder = await createOrder({
                        items: cartItems,
                        fulfillmentType,
                        branchId: selectedBranchId ?? undefined,
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

                    activeOrderId = createdOrder.id;
                    setOrderId(createdOrder.id);
                    setOrderTotal(Number(createdOrder.total));
                    setOrderDiscount(Number(createdOrder.discountApplied ?? 0));
                    setOrderShippingCost(Number(createdOrder.shippingCost ?? 0));
                    return activeOrderId ?? null;
                } catch (error) {
                    console.warn("Error al preparar la orden:", error instanceof Error ? error.message : error);
                    setOrderFailed(true);
                    return null;
                } finally {
                    setIsCreatingOrder(false);
                    orderInFlight.current = null;
                }
            };
            orderInFlight.current = create();
            return orderInFlight.current;
        }

        return activeOrderId ?? null;
    }, [orderId, items, createOrder, fulfillmentType, selectedBranchId, selectedPayment, qrAllowed, isPickup, deliveryAddress]);

    const preparePayment = useCallback(async (forceRetry = false) => {
        if (currentStep !== 2 || selectedPayment !== 'stripe' || isCreatingOrder || clientSecret) {
            return;
        }

        const activeOrderId = await ensureOrderCreated(forceRetry);
        if (!activeOrderId) return;

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
                console.warn("Error al preparar Stripe:", error);
                setOrderFailed(true);
            } finally {
                setIsCreatingOrder(false);
            }
        }
    }, [currentStep, selectedPayment, isCreatingOrder, clientSecret, ensureOrderCreated, createPaymentIntent, storeName, t]);

    useEffect(() => {
        if (currentStep === 2 && selectedPayment === 'stripe' && !clientSecret && !orderFailed && !isCreatingOrder) {
            preparePayment();
        }
    }, [currentStep, selectedPayment, clientSecret, orderFailed, isCreatingOrder, preparePayment]);

    useEffect(() => {
        if (currentStep === 2 && selectedPayment === 'qr' && qrAllowed && !orderId && !orderFailed && !isCreatingOrder) {
            ensureOrderCreated();
        }
    }, [currentStep, selectedPayment, qrAllowed, orderId, orderFailed, isCreatingOrder, ensureOrderCreated]);

    const handleRetry = () => {
        setOrderFailed(false);
        setStripeError(null);
        if (selectedPayment === 'stripe') {
            preparePayment(true);
        } else if (selectedPayment === 'qr' && qrAllowed) {
            ensureOrderCreated(true);
        }
    };

    const handlePaymentSuccess = (paymentIntentId: string) => {
        if (!orderId) return;
        router.push(`/checkout/success?orderId=${orderId}&payment_intent=${paymentIntentId}`);
    };

    const handlePaymentError = (error: string) => {
        setStripeError(error);
    };

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
                ...(qrAllowed ? { paymentMethod: 'QR' as const } : {}),
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

    const displayedError = stripeError ?? paymentError ?? (orderFailed ? orderError : null);
    const hasAnyOnlineMethod =
        Boolean(cardEnabled) ||
        qrAllowed ||
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

                                    {isOnline && qrAllowed && (
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
                                                onSubmitted={clearAllCart}
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
                                                onSubmitted={clearAllCart}
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
                                                onSubmitted={clearAllCart}
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

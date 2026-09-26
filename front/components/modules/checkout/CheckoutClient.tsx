'use client';
import React, { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import CheckoutSteps from './CheckoutSteps';
import CheckoutHeader from './CheckoutHeader';
import DeliveryStep from './DeliveryStep';
import styles from './checkout.module.scss';
import { CreditCard, WifiOff } from 'lucide-react';

// IMPORTANTE: Asegúrate de que las rutas de importación apunten a los archivos reales en tu proyecto
import { useAuth } from '@/hooks/useAuth';
import { useCart } from '@/hooks/useCart';
import { usePayment } from '@/hooks/usePayment';
import { useOrder } from '@/hooks/useOrder';
import { useBranches } from '@/hooks/useBranches';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { StripePaymentProvider, StripePaymentForm, StripePaymentPlaceholder } from './stripe-payment-form';
import PaymentMethodCard from './PaymentMethodCard'; // Debes tener este componente creado
import { OrderItem, CreateOrderRequest } from '@/types/orders.types';
import { CartItem } from '@/types/cart.types';
import { FulfillmentType } from '@/types/branch.types';
import { DeliveryAddress, formatShippingAddress } from '@/types/address.types';
import { DELIVERY_SHIPPING_COST, round2 } from '@/utils/pricing';
import { addOfflineOrder } from '@/utils/offlineOrderQueue';
import { getApiErrorMessage } from '@/service/api/error.utils';

export const revalidate = false;

export default function CheckoutClient() {
    const { isAuthenticated } = useAuth()
    const router = useRouter();
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
        if (currentStep === 2 && !selectedPayment) {
            setSelectedPayment(isOnline ? "stripe" : "offline");
        }
    }, [currentStep, selectedPayment, isOnline]);

    const preparePayment = useCallback(async (forceRetry = false) => {
        if (currentStep !== 2 || selectedPayment !== 'stripe' || isCreatingOrder || clientSecret) {
            return;
        }

        setIsCreatingOrder(true);
        setStripeError(null);
        setOrderFailed(false);

        try {
            let activeOrderId = orderId;

            // 1. Crear la orden si no existe aún o si se fuerza reintento
            if (!activeOrderId || forceRetry) {
                const cartItems: OrderItem[] = items.map((item: CartItem) => ({
                    productId: item.product?.id || item.productId,
                    quantity: item.quantity,
                    selectedSize: item.selectedSize,
                }));

                const createdOrder = await createOrder({
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

                if (!createdOrder) {
                    throw new Error("No se pudo crear la orden en el servidor.");
                }

                activeOrderId = createdOrder.id;
                setOrderId(createdOrder.id);
                setOrderTotal(Number(createdOrder.total));
                setOrderDiscount(Number(createdOrder.discountApplied ?? 0));
                setOrderShippingCost(Number(createdOrder.shippingCost ?? 0));
            }

            // 2. Iniciar el PaymentIntent de Stripe para esta orden
            if (activeOrderId && !clientSecret) {
                const paymentCreated = await createPaymentIntent({
                    orderId: activeOrderId,
                    description: "Pago de orden en Stella Femme",
                    currency: "usd"
                });

                if (!paymentCreated) {
                    throw new Error("No se pudo inicializar la pasarela de pago.");
                }
            }
        } catch (error) {
            console.error("Error al preparar el pago:", error);
            setOrderFailed(true);
        } finally {
            setIsCreatingOrder(false);
        }
    }, [currentStep, selectedPayment, isCreatingOrder, clientSecret, orderId, items, createOrder, fulfillmentType, selectedBranchId, isPickup, deliveryAddress, createPaymentIntent]);

    useEffect(() => {
        if (currentStep === 2 && selectedPayment === 'stripe' && !clientSecret && !orderFailed && !isCreatingOrder) {
            preparePayment();
        }
    }, [currentStep, selectedPayment, clientSecret, orderFailed, isCreatingOrder, preparePayment]);

    const handleRetry = () => {
        setOrderFailed(false);
        setStripeError(null);
        preparePayment(true);
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
            clearAllCart();
            router.push('/checkout/offline-success');
        } catch (error) {
            setOfflineError(getApiErrorMessage(error, 'No se pudo guardar el pedido en este dispositivo.'));
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
                                            `"${invalidItem.product.name}" ya no tiene stock suficiente (disponible: ${invalidItem.product.stock}). Ajusta la cantidad en tu carrito antes de continuar.`,
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
                                <h2>Selecciona un método de pago</h2>

                                <div className={styles.deliverySummary}>
                                    <p>
                                        {isPickup
                                            ? <>Retiro en <strong>{selectedBranch?.name ?? "sucursal"}</strong></>
                                            : <>Envío a <strong>{deliveryAddress ? formatShippingAddress(deliveryAddress) : ""}</strong> (desde {selectedBranch?.name ?? "sucursal"})</>}
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
                                        Cambiar
                                    </button>
                                </div>

                                <div className={styles.paymentMethods}>
                                    {!isOnline && (
                                        <div className={styles.offlineNotice}>
                                            <WifiOff size={18} />
                                            <span>
                                                Estás sin conexión: el pago con tarjeta no está disponible. Guarda tu pedido
                                                y se enviará solo cuando vuelva el internet.
                                            </span>
                                        </div>
                                    )}

                                    {isOnline ? (
                                        <PaymentMethodCard
                                            method="stripe"
                                            selectedMethod={selectedPayment}
                                            onSelect={handlePaymentMethodSelect}
                                            icon={<CreditCard />}
                                            title="Tarjeta de crédito / débito"
                                            description="Pago seguro con Stripe"
                                        >
                                            {displayedError && (
                                                <div className={styles.errorMessage}>
                                                    <span>{displayedError}</span>
                                                    <button
                                                        type="button"
                                                        onClick={handleRetry}
                                                        className={styles.retryButton}
                                                    >
                                                        Reintentar preparar pago
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
                                    ) : (
                                        <PaymentMethodCard
                                            method="offline"
                                            selectedMethod={selectedPayment}
                                            onSelect={handlePaymentMethodSelect}
                                            icon={<WifiOff />}
                                            title="Pago por QR / contra entrega"
                                            description="Se confirma con el vendedor al recibir tu pedido"
                                        >
                                            {offlineError && <div className={styles.errorMessage}>{offlineError}</div>}
                                            <button
                                                type="button"
                                                className={styles.continueButton}
                                                disabled={isSavingOffline}
                                                onClick={handleSaveOfflineOrder}
                                            >
                                                {isSavingOffline ? 'Guardando...' : 'Guardar pedido'}
                                            </button>
                                        </PaymentMethodCard>
                                    )}

                                    {isOnline && !selectedPayment && (
                                        <>
                                            <p className={styles.paymentHint}>Selecciona un método de pago para continuar</p>
                                            <StripePaymentPlaceholder amount={payableTotal} isLoading={false} />
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
                <h3>Resumen del pedido</h3>
                <div className={styles.summaryRow}>
                    <span>Artículos ({items.length})</span>
                    <span>Bs {totals.listSubtotal.toFixed(2)}</span>
                </div>
                {items.map((item) => (
                    <div className={styles.summaryRow} key={item.id}>
                        <span>
                            {item.product.name}
                            {item.selectedSize ? ` (Talla: ${item.selectedSize})` : ""} x{item.quantity}
                        </span>
                    </div>
                ))}
                <hr className={styles.divider} />
                {totals.productDiscount > 0 && (
                    <div className={`${styles.summaryRow} ${styles.discountRow}`}>
                        <span>Descuento en productos</span>
                        <span>-Bs {totals.productDiscount.toFixed(2)}</span>
                    </div>
                )}
                {employeeDiscount > 0 && (
                    <div className={`${styles.summaryRow} ${styles.discountRow}`}>
                        <span>Descuento de empleado ({totals.employeeDiscountPercent}%)</span>
                        <span>-Bs {employeeDiscount.toFixed(2)}</span>
                    </div>
                )}
                {/* Recojo en sucursal no tiene costo de envío: la fila se oculta en vez de mostrar $0.00 */}
                {!isPickup && (
                    <div className={styles.summaryRow}>
                        <span>Costo de envío</span>
                        <span>Bs {shippingCost.toFixed(2)}</span>
                    </div>
                )}
                <hr className={styles.divider} />
                <div className={styles.summaryTotal}>
                    <span>Total</span>
                    <span>Bs {payableTotal.toFixed(2)}</span>
                </div>
            </aside>
        );
    }
}

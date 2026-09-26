import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Alert,
  Image,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../navigation/types';
import { paymentsApi } from '../../api/payments.api';
import { ordersApi } from '../../api/orders.api';
import { Header } from '../../components/Header';
import { Input } from '../../components/Input';
import { Button } from '../../components/Button';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { Colors, Shadows } from '../../theme/colors';
import { useCart } from '../../context/CartContext';
import { getErrorMessage } from '../../api/client';

type Props = NativeStackScreenProps<RootStackParamList, 'Payment'>;

export const PaymentScreen: React.FC<Props> = ({ route, navigation }) => {
  const { orderId, amount } = route.params;
  const { fetchCart, clearCart } = useCart();

  const [currentAmount, setCurrentAmount] = useState<number>(() => {
    const val = Number(amount);
    return isNaN(val) || val <= 0 ? 0 : val;
  });
  const [selectedMethod, setSelectedMethod] = useState<'stripe' | 'qr'>('stripe');
  const [clientSecret, setClientSecret] = useState<string>('');
  const [paymentIntentId, setPaymentIntentId] = useState<string>('');
  const [isLoadingIntent, setIsLoadingIntent] = useState<boolean>(true);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [isSuccess, setIsSuccess] = useState<boolean>(false);
  const [transactionRef, setTransactionRef] = useState<string>('');
  const [countdown, setCountdown] = useState<number>(4);
  const hasRedirectedRef = useRef<boolean>(false);

  // QR Payment State
  const [qrData, setQrData] = useState<any>(null);
  const [isLoadingQr, setIsLoadingQr] = useState<boolean>(false);
  const [isConfirmingQr, setIsConfirmingQr] = useState<boolean>(false);

  // Card Inputs
  const [cardHolder, setCardHolder] = useState<string>('Mauricio Daniel');
  const [cardNumber, setCardNumber] = useState<string>('4242 •••• •••• 4242');
  const [expiry, setExpiry] = useState<string>('12/28');
  const [cvc, setCvc] = useState<string>('123');

  const handleGoToCatalog = useCallback(() => {
    if (hasRedirectedRef.current) return;
    hasRedirectedRef.current = true;
    navigation.reset({
      index: 0,
      routes: [
        {
          name: 'Main',
          params: { screen: 'ShopTab' },
        },
      ],
    });
  }, [navigation]);

  useEffect(() => {
    if (!isSuccess) return;

    if (countdown <= 0) {
      handleGoToCatalog();
      return;
    }

    const timer = setTimeout(() => {
      setCountdown((prev) => prev - 1);
    }, 1000);

    return () => clearTimeout(timer);
  }, [isSuccess, countdown, handleGoToCatalog]);

  useEffect(() => {
    const initPayment = async () => {
      try {
        setIsLoadingIntent(true);
        let validAmount = Number(amount);
        if (isNaN(validAmount) || validAmount <= 0) {
          const orderData = await ordersApi.getById(orderId);
          validAmount = Number((orderData as any)?.total ?? orderData?.totalAmount ?? 0);
        }
        setCurrentAmount(validAmount);

        if (validAmount <= 0) {
          throw new Error('El monto del pedido no es válido para procesar el pago.');
        }

        const res = await paymentsApi.createIntent({
          orderId,
          currency: 'usd',
          description: `Pago de pedido ${orderId}`,
        });

        if (res.data?.clientSecret) {
          setClientSecret(res.data.clientSecret);
          const piId = res.data.clientSecret.split('_secret_')[0];
          setPaymentIntentId(piId);
        }
      } catch (err) {
        Alert.alert('Error', getErrorMessage(err));
      } finally {
        setIsLoadingIntent(false);
      }
    };

    initPayment();
  }, [orderId, amount]);

  const loadQr = useCallback(async () => {
    try {
      setIsLoadingQr(true);
      const res = await paymentsApi.generateQr(orderId);
      if (res.data) {
        setQrData(res.data);
      }
    } catch (err) {
      Alert.alert('Error QR', getErrorMessage(err));
    } finally {
      setIsLoadingQr(false);
    }
  }, [orderId]);

  useEffect(() => {
    if (selectedMethod === 'qr' && !qrData && !isLoadingQr) {
      loadQr();
    }
  }, [selectedMethod, qrData, isLoadingQr, loadQr]);

  // Polling para QR
  useEffect(() => {
    if (selectedMethod !== 'qr' || isSuccess) return;

    const interval = setInterval(async () => {
      try {
        const res = await paymentsApi.getQrStatus(orderId);
        if (res.isPaid || res.status === 'COMPLETADO') {
          clearInterval(interval);
          setTransactionRef(`QR-${orderId}`);
          setIsSuccess(true);
          try {
            await clearCart();
          } catch {
            await fetchCart();
          }
        }
      } catch {
        // Silencioso durante polling
      }
    }, 2500);

    return () => clearInterval(interval);
  }, [selectedMethod, orderId, isSuccess, clearCart, fetchCart]);

  const handleSimulateQrPayment = async () => {
    try {
      setIsConfirmingQr(true);
      await paymentsApi.confirmQrPayment({ orderId });
      setTransactionRef(`QR-${orderId}`);
      setIsSuccess(true);
      try {
        await clearCart();
      } catch {
        await fetchCart();
      }
    } catch (err) {
      Alert.alert('Error al simular pago', getErrorMessage(err));
    } finally {
      setIsConfirmingQr(false);
    }
  };

  const handleProcessPayment = async () => {
    if (!paymentIntentId) {
      Alert.alert('Error', 'No se ha inicializado la intención de pago.');
      return;
    }

    try {
      setIsProcessing(true);
      const res = await paymentsApi.confirmPayment({
        paymentIntentId,
        orderId,
      });

      setTransactionRef(res.data?.transactionId || paymentIntentId);
      setIsSuccess(true);
      try {
        await clearCart();
      } catch {
        await fetchCart();
      }
    } catch (err) {
      Alert.alert('Error de Pago', getErrorMessage(err));
    } finally {
      setIsProcessing(false);
    }
  };

  if (isLoadingIntent) {
    return <LoadingSpinner message="Preparando pasarela de pago segura..." fullScreen />;
  }

  if (isSuccess) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.successContainer}>
          <View style={styles.successIconCircle}>
            <Ionicons name="checkmark-circle" size={80} color={Colors.success} />
          </View>
          <Text style={styles.successTitle}>¡Pago Exitoso!</Text>
          <Text style={styles.successDesc}>
            Tu pago por un monto de Bs {currentAmount.toFixed(2)} ha sido procesado
            satisfactoriamente con {selectedMethod === 'qr' ? 'código QR' : 'Stripe'}. Tu pedido ya está en preparación.
          </Text>

          <View style={styles.receiptCard}>
            <View style={styles.receiptRow}>
              <Text style={styles.receiptLabel}>Método</Text>
              <Text style={styles.receiptValue}>
                {selectedMethod === 'qr' ? 'QR Simple' : 'Tarjeta Stripe'}
              </Text>
            </View>
            <View style={styles.receiptRow}>
              <Text style={styles.receiptLabel}>Referencia</Text>
              <Text style={styles.receiptValue} numberOfLines={1}>
                {transactionRef || (selectedMethod === 'qr' ? 'QR-PAGO' : 'STRIPE-OK')}
              </Text>
            </View>
            <View style={styles.receiptRow}>
              <Text style={styles.receiptLabel}>Estado en BD</Text>
              <Text style={[styles.receiptValue, { color: Colors.success }]}>
                Aprobado (Procesando)
              </Text>
            </View>
          </View>

          {/* Redirection Notice Box */}
          <View style={styles.redirectNoticeBox}>
            <Ionicons name="time-outline" size={18} color={Colors.primary} />
            <Text style={styles.redirectNoticeText}>
              Redirigiendo al catálogo en{' '}
              <Text style={styles.redirectCountdownBold}>{countdown}</Text> segundos...
            </Text>
          </View>

          <Button
            title="Volver al Catálogo Ahora"
            onPress={handleGoToCatalog}
            variant="primary"
            size="lg"
            style={{ width: '100%', marginBottom: 14 }}
            icon={<Ionicons name="bag-handle-outline" size={20} color={Colors.textWhite} />}
          />

          <TouchableOpacity
            style={styles.viewOrderBtn}
            onPress={() => navigation.replace('OrderDetail', { orderId })}
            activeOpacity={0.7}
          >
            <Text style={styles.viewOrderText}>Ver Estado de Mi Pedido</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <Header
        title="Pasarela de Pago"
        showBack
        onBack={() => navigation.goBack()}
      />

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Amount Box */}
        <View style={styles.amountCard}>
          <Text style={styles.amountLabel}>Monto a Facturar</Text>
          <Text style={styles.amountValue}>Bs ${currentAmount.toFixed(2)}</Text>
          <View style={styles.stripeBadge}>
            <Ionicons name="shield-checkmark" size={14} color={Colors.primary} />
            <Text style={styles.stripeBadgeText}>Pago Seguro Stella Femme</Text>
          </View>
        </View>

        {/* Method Selector Tabs */}
        <View style={styles.methodSelector}>
          <TouchableOpacity
            style={[styles.methodTab, selectedMethod === 'stripe' && styles.methodTabActive]}
            onPress={() => setSelectedMethod('stripe')}
            activeOpacity={0.7}
          >
            <Ionicons
              name="card-outline"
              size={18}
              color={selectedMethod === 'stripe' ? Colors.primary : Colors.textMuted}
            />
            <Text
              style={[
                styles.methodTabText,
                selectedMethod === 'stripe' && styles.methodTabTextActive,
              ]}
            >
              Tarjeta Stripe
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.methodTab, selectedMethod === 'qr' && styles.methodTabActive]}
            onPress={() => setSelectedMethod('qr')}
            activeOpacity={0.7}
          >
            <Ionicons
              name="qr-code-outline"
              size={18}
              color={selectedMethod === 'qr' ? Colors.primary : Colors.textMuted}
            />
            <Text
              style={[
                styles.methodTabText,
                selectedMethod === 'qr' && styles.methodTabTextActive,
              ]}
            >
              QR Simple
            </Text>
          </TouchableOpacity>
        </View>

        {selectedMethod === 'stripe' ? (
          <>
            {/* Credit Card Simulation Card */}
            <View style={styles.creditCard}>
              <View style={styles.cardChipRow}>
                <Ionicons name="hardware-chip-outline" size={32} color="#F8FAFC" />
                <Text style={styles.cardBrand}>VISA</Text>
              </View>

              <Text style={styles.cardNumberText}>{cardNumber}</Text>

              <View style={styles.cardFooter}>
                <View>
                  <Text style={styles.cardSubText}>TITULAR</Text>
                  <Text style={styles.cardHolderText}>{cardHolder}</Text>
                </View>
                <View>
                  <Text style={styles.cardSubText}>VENCE</Text>
                  <Text style={styles.cardHolderText}>{expiry}</Text>
                </View>
              </View>
            </View>

            {/* Card Inputs */}
            <View style={styles.inputsCard}>
              <Input
                label="Nombre del Titular"
                value={cardHolder}
                onChangeText={setCardHolder}
                icon="person-outline"
              />

              <Input
                label="Número de Tarjeta (Prueba)"
                value={cardNumber}
                onChangeText={setCardNumber}
                icon="card-outline"
                keyboardType="number-pad"
              />

              <View style={styles.row}>
                <View style={styles.col}>
                  <Input
                    label="Expiración"
                    value={expiry}
                    onChangeText={setExpiry}
                    placeholder="MM/AA"
                    icon="calendar-outline"
                  />
                </View>
                <View style={styles.col}>
                  <Input
                    label="CVC"
                    value={cvc}
                    onChangeText={setCvc}
                    placeholder="123"
                    icon="lock-closed-outline"
                    keyboardType="number-pad"
                    isPassword
                  />
                </View>
              </View>

              <Button
                title={`Pagar Bs ${currentAmount.toFixed(2)}`}
                onPress={handleProcessPayment}
                isLoading={isProcessing}
                variant="primary"
                size="lg"
                style={styles.payBtn}
                icon={
                  <Ionicons name="checkmark-circle-outline" size={20} color={Colors.textWhite} />
                }
              />
            </View>
          </>
        ) : (
          /* QR Payment Section */
          <View style={styles.qrCard}>
            <Text style={styles.qrTitle}>Escanea para pagar</Text>
            <Text style={styles.qrSubtitle}>
              Apunta la cámara de otro dispositivo al código QR o pulsa el botón para simular el pago instantáneo en la base de datos.
            </Text>

            {isLoadingQr ? (
              <View style={styles.qrLoadingBox}>
                <ActivityIndicator size="large" color={Colors.primary} />
                <Text style={styles.qrLoadingText}>Generando código QR seguro...</Text>
              </View>
            ) : qrData?.qrDataUrl ? (
              <>
                <View style={styles.qrFrame}>
                  <Image
                    source={{ uri: qrData.qrDataUrl }}
                    style={styles.qrImage}
                    resizeMode="contain"
                  />
                </View>

                <View style={styles.liveIndicator}>
                  <View style={styles.pulseDot} />
                  <Text style={styles.liveIndicatorText}>Esperando escaneo en tiempo real...</Text>
                </View>

                <Button
                  title="Simular Escaneo y Pago"
                  onPress={handleSimulateQrPayment}
                  isLoading={isConfirmingQr}
                  variant="primary"
                  size="lg"
                  style={styles.simulateBtn}
                  icon={<Ionicons name="flash" size={18} color={Colors.textWhite} />}
                />
              </>
            ) : (
              <Button
                title="Generar Código QR"
                onPress={loadQr}
                variant="primary"
                size="md"
                style={{ marginTop: 16 }}
              />
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};


const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  amountCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadows.sm,
  },
  amountLabel: {
    fontSize: 13,
    color: Colors.textMuted,
    textTransform: 'uppercase',
  },
  amountValue: {
    fontSize: 32,
    fontWeight: '800',
    color: Colors.primary,
    marginVertical: 4,
  },
  stripeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.primaryLight,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 6,
    marginTop: 4,
  },
  stripeBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.primary,
  },
  creditCard: {
    backgroundColor: '#1E1B4B', // Deep indigo/slate
    borderRadius: 20,
    padding: 24,
    marginBottom: 20,
    ...Shadows.md,
  },
  cardChipRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  cardBrand: {
    color: Colors.textWhite,
    fontSize: 20,
    fontWeight: '900',
    fontStyle: 'italic',
  },
  cardNumberText: {
    color: Colors.textWhite,
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: 2,
    marginBottom: 24,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  cardSubText: {
    color: '#94A3B8',
    fontSize: 10,
    fontWeight: '700',
  },
  cardHolderText: {
    color: Colors.textWhite,
    fontSize: 13,
    fontWeight: '600',
    marginTop: 2,
  },
  inputsCard: {
    backgroundColor: Colors.surface,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadows.sm,
  },
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  col: {
    flex: 1,
  },
  payBtn: {
    marginTop: 10,
  },
  successContainer: {
    flex: 1,
    padding: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  successIconCircle: {
    marginBottom: 16,
  },
  successTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: Colors.textPrimary,
    marginBottom: 8,
  },
  successDesc: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  receiptCard: {
    width: '100%',
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 20,
  },
  receiptRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  receiptLabel: {
    fontSize: 13,
    color: Colors.textMuted,
  },
  receiptValue: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textPrimary,
    maxWidth: '60%',
  },
  redirectNoticeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.primaryLight,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    gap: 8,
    marginBottom: 16,
    width: '100%',
    justifyContent: 'center',
  },
  redirectNoticeText: {
    fontSize: 13,
    color: Colors.primary,
    fontWeight: '600',
  },
  redirectCountdownBold: {
    fontSize: 15,
    fontWeight: '800',
    color: Colors.primary,
  },
  viewOrderBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  viewOrderText: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontWeight: '600',
    textAlign: 'center',
    textDecorationLine: 'underline',
  },
  methodSelector: {
    flexDirection: 'row',
    backgroundColor: '#E2E8F0',
    borderRadius: 12,
    padding: 4,
    marginBottom: 16,
  },
  methodTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 10,
    gap: 6,
  },
  methodTabActive: {
    backgroundColor: Colors.surface,
    ...Shadows.sm,
  },
  methodTabText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textMuted,
  },
  methodTabTextActive: {
    color: Colors.primary,
    fontWeight: '700',
  },
  qrCard: {
    backgroundColor: Colors.surface,
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadows.sm,
  },
  qrBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 999,
    gap: 6,
    marginBottom: 12,
  },
  qrBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#059669',
  },
  qrTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: Colors.textPrimary,
    marginBottom: 4,
    textAlign: 'center',
  },
  qrSubtitle: {
    fontSize: 13,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 16,
    paddingHorizontal: 8,
  },
  qrFrame: {
    backgroundColor: '#FFFFFF',
    padding: 12,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#E2E8F0',
    borderStyle: 'dashed',
    marginBottom: 16,
    ...Shadows.sm,
  },
  qrImage: {
    width: 220,
    height: 220,
  },
  liveIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 20,
  },
  pulseDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.success,
  },
  liveIndicatorText: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
  simulateBtn: {
    width: '100%',
  },
  qrLoadingBox: {
    paddingVertical: 40,
    alignItems: 'center',
    gap: 12,
  },
  qrLoadingText: {
    fontSize: 14,
    color: Colors.textMuted,
  },
});

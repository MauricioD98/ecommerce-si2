import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  Alert,
} from 'react-native';
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
import { getErrorMessage } from '../../api/client';

type Props = NativeStackScreenProps<RootStackParamList, 'Payment'>;

export const PaymentScreen: React.FC<Props> = ({ route, navigation }) => {
  const { orderId, amount } = route.params;

  const [currentAmount, setCurrentAmount] = useState<number>(() => {
    const val = Number(amount);
    return isNaN(val) || val <= 0 ? 0 : val;
  });
  const [clientSecret, setClientSecret] = useState<string>('');
  const [paymentIntentId, setPaymentIntentId] = useState<string>('');
  const [isLoadingIntent, setIsLoadingIntent] = useState<boolean>(true);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [isSuccess, setIsSuccess] = useState<boolean>(false);
  const [transactionRef, setTransactionRef] = useState<string>('');

  // Card Inputs
  const [cardHolder, setCardHolder] = useState<string>('Mauricio Daniel');
  const [cardNumber, setCardNumber] = useState<string>('4242 •••• •••• 4242');
  const [expiry, setExpiry] = useState<string>('12/28');
  const [cvc, setCvc] = useState<string>('123');

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
          amount: validAmount,
          currency: 'usd',
          description: `Pago de pedido ${orderId}`,
        });

        if (res.data?.clientSecret) {
          setClientSecret(res.data.clientSecret);
          // Stripe client_secret is formatted like "pi_3MtwBwLkdIwHu7ix28a3tqPa_secret_YrKJ..."
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

  const handleProcessPayment = async () => {
    if (!paymentIntentId) {
      Alert.alert('Error', 'No se ha inicializado la intención de pago.');
      return;
    }

    try {
      setIsProcessing(true);
      // In a real Stripe mobile SDK, the client secret is passed to Stripe PaymentSheet.
      // With our NestJS API, confirming the payment intent verifies and transitions order to PROCESANDO.
      const res = await paymentsApi.confirmPayment({
        paymentIntentId,
        orderId,
      });

      setTransactionRef(res.data?.transactionId || paymentIntentId);
      setIsSuccess(true);
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
            Tu pago por un monto de ${currentAmount.toFixed(2)} USD ha sido procesado
            satisfactoriamente con Stripe. Tu pedido ya está en preparación.
          </Text>

          <View style={styles.receiptCard}>
            <View style={styles.receiptRow}>
              <Text style={styles.receiptLabel}>Referencia</Text>
              <Text style={styles.receiptValue} numberOfLines={1}>
                {transactionRef || 'STRIPE-OK'}
              </Text>
            </View>
            <View style={styles.receiptRow}>
              <Text style={styles.receiptLabel}>Estado</Text>
              <Text style={[styles.receiptValue, { color: Colors.success }]}>
                Aprobado
              </Text>
            </View>
          </View>

          <Button
            title="Ver Estado de Mi Pedido"
            onPress={() => navigation.replace('OrderDetail', { orderId })}
            variant="primary"
            size="lg"
            style={{ width: '100%' }}
          />
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
          <Text style={styles.amountValue}>${currentAmount.toFixed(2)} USD</Text>
          <View style={styles.stripeBadge}>
            <Ionicons name="lock-closed" size={14} color={Colors.primary} />
            <Text style={styles.stripeBadgeText}>Conexión Segura con Stripe</Text>
          </View>
        </View>

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
            title={`Pagar $${currentAmount.toFixed(2)} USD`}
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
    marginBottom: 32,
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
});

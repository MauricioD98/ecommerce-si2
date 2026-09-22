import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  Alert,
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../navigation/types';
import { Order, PaymentDetails } from '../../types';
import { ordersApi } from '../../api/orders.api';
import { paymentsApi } from '../../api/payments.api';
import { Header } from '../../components/Header';
import { StatusBadge } from '../../components/StatusBadge';
import { Button } from '../../components/Button';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { Colors, Shadows } from '../../theme/colors';
import { getErrorMessage } from '../../api/client';

type Props = NativeStackScreenProps<RootStackParamList, 'OrderDetail'>;

export const OrderDetailScreen: React.FC<Props> = ({ route, navigation }) => {
  const { orderId } = route.params;

  const [order, setOrder] = useState<Order | null>(null);
  const [payment, setPayment] = useState<PaymentDetails | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isCancelling, setIsCancelling] = useState<boolean>(false);

  const fetchOrderDetails = async () => {
    try {
      setIsLoading(true);
      const [orderData, paymentData] = await Promise.all([
        ordersApi.getById(orderId),
        paymentsApi.getByOrderId(orderId),
      ]);
      setOrder(orderData);
      setPayment(paymentData);
    } catch (err) {
      Alert.alert('Error', getErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchOrderDetails();
  }, [orderId]);

  const handleCancelOrder = () => {
    Alert.alert(
      'Cancelar Pedido',
      '¿Estás seguro de que deseas cancelar este pedido? Se restaurará el stock de los productos.',
      [
        { text: 'No, mantener', style: 'cancel' },
        {
          text: 'Sí, cancelar pedido',
          style: 'destructive',
          onPress: async () => {
            try {
              setIsCancelling(true);
              const cancelled = await ordersApi.cancel(orderId);
              setOrder(cancelled);
              Alert.alert('Pedido Cancelado', 'El pedido ha sido cancelado con éxito.');
            } catch (err) {
              Alert.alert('Error', getErrorMessage(err));
            } finally {
              setIsCancelling(false);
            }
          },
        },
      ]
    );
  };

  if (isLoading || !order) {
    return <LoadingSpinner message="Cargando detalles del pedido..." fullScreen />;
  }

  const formattedDate = new Date(order.createdAt).toLocaleDateString('es-ES', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const orderAmount = Number(order.total ?? order.totalAmount ?? 0);
  const total = orderAmount.toFixed(2);
  const canPay = order.status === 'PENDIENTE' && (!payment || payment.status !== 'COMPLETADO');
  const canCancel = order.status === 'PENDIENTE';
  const itemsList = order.orderItems || order.items || [];

  return (
    <SafeAreaView style={styles.safeArea}>
      <Header
        title={`Pedido #${order.orderNumber || order.id.slice(0, 8)}`}
        showBack
        onBack={() => navigation.goBack()}
      />

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Status Card */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Estado del Pedido</Text>
            <StatusBadge status={order.status} />
          </View>
          <Text style={styles.dateText}>Registrado el: {formattedDate}</Text>
        </View>

        {/* Shipping Address */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={styles.rowAlign}>
              <Ionicons name="location-outline" size={18} color={Colors.primary} />
              <Text style={styles.cardTitle}>Dirección de Envío</Text>
            </View>
          </View>
          <Text style={styles.addressText}>
            {order.shippingAddress || 'Sin dirección registrada'}
          </Text>
        </View>

        {/* Items List */}
        <View style={styles.card}>
          <Text style={[styles.cardTitle, { marginBottom: 12 }]}>
            Artículos Comprados
          </Text>

          {itemsList.map((item) => {
            const price = Number(item.price).toFixed(2);
            const subtotal = (Number(item.price) * item.quantity).toFixed(2);
            const name = item.product?.name || item.productName || 'Producto';
            return (
              <View key={item.id} style={styles.itemRow}>
                <View style={styles.itemImageContainer}>
                  {item.product?.imageUrl ? (
                    <Image
                      source={{ uri: item.product.imageUrl }}
                      style={styles.itemImage}
                    />
                  ) : (
                    <Ionicons name="shirt-outline" size={24} color={Colors.textMuted} />
                  )}
                </View>

                <View style={styles.itemInfo}>
                  <Text style={styles.itemName}>{name}</Text>
                  <Text style={styles.itemMeta}>
                    Cant: {item.quantity} • ${price} c/u
                  </Text>
                </View>

                <Text style={styles.itemSubtotal}>${subtotal}</Text>
              </View>
            );
          })}

          <View style={styles.divider} />

          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total Facturado</Text>
            <Text style={styles.totalAmount}>${total}</Text>
          </View>
        </View>

        {/* Payment Details */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={styles.rowAlign}>
              <Ionicons name="card-outline" size={18} color={Colors.primary} />
              <Text style={styles.cardTitle}>Información de Pago</Text>
            </View>
            <StatusBadge
              status={payment?.status || (order.status === 'PROCESANDO' ? 'COMPLETADO' : 'PENDIENTE')}
            />
          </View>

          {payment?.transactionId && (
            <Text style={styles.transactionText}>
              ID Transacción: {payment.transactionId}
            </Text>
          )}

          {canPay && (
            <Button
              title="Pagar Ahora con Stripe"
              onPress={() =>
                navigation.navigate('Payment', {
                  orderId: order.id,
                  amount: orderAmount,
                })
              }
              variant="primary"
              size="md"
              style={{ marginTop: 12 }}
              icon={
                <Ionicons name="flash-outline" size={18} color={Colors.textWhite} />
              }
            />
          )}
        </View>

        {/* Cancel Order Option */}
        {canCancel && (
          <Button
            title="Cancelar este Pedido"
            onPress={handleCancelOrder}
            variant="outline"
            size="md"
            isLoading={isCancelling}
            style={styles.cancelBtn}
            textStyle={{ color: Colors.error }}
          />
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
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadows.sm,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  rowAlign: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  dateText: {
    fontSize: 13,
    color: Colors.textMuted,
  },
  addressText: {
    fontSize: 14,
    color: Colors.textSecondary,
    lineHeight: 20,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  itemImageContainer: {
    width: 48,
    height: 48,
    borderRadius: 8,
    backgroundColor: Colors.surfaceSubtle,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  itemImage: {
    width: '100%',
    height: '100%',
  },
  itemInfo: {
    flex: 1,
    marginLeft: 12,
  },
  itemName: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  itemMeta: {
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 2,
  },
  itemSubtotal: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  divider: {
    height: 1,
    backgroundColor: Colors.border,
    marginVertical: 12,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  totalLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  totalAmount: {
    fontSize: 20,
    fontWeight: '800',
    color: Colors.primary,
  },
  transactionText: {
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 4,
  },
  cancelBtn: {
    borderColor: Colors.error,
    marginTop: 8,
  },
});

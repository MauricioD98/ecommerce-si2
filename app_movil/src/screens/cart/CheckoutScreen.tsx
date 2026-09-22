import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../navigation/types';
import { useCart } from '../../context/CartContext';
import { ordersApi } from '../../api/orders.api';
import { Header } from '../../components/Header';
import { Input } from '../../components/Input';
import { Button } from '../../components/Button';
import { Colors, Shadows } from '../../theme/colors';
import { getErrorMessage } from '../../api/client';

type Props = NativeStackScreenProps<RootStackParamList, 'Checkout'>;

export const CheckoutScreen: React.FC<Props> = ({ navigation }) => {
  const { cart, totalAmount, fetchCart } = useCart();
  const [shippingAddress, setShippingAddress] = useState<string>('Av. Principal #123, Ciudad');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const cartItems = cart?.cartItems || [];

  const handleCreateOrder = async () => {
    if (!shippingAddress.trim()) {
      Alert.alert('Dirección requerida', 'Por favor ingresa la dirección de entrega.');
      return;
    }

    if (cartItems.length === 0) {
      Alert.alert('Carrito vacío', 'No tienes productos en tu carrito.');
      navigation.goBack();
      return;
    }

    try {
      setIsSubmitting(true);
      const itemsPayload = cartItems.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
        price: Number(item.product.price),
      }));

      const newOrder = await ordersApi.create({
        items: itemsPayload,
        shippingAddress: shippingAddress.trim(),
      });

      // Refresh cart to reflect new state
      await fetchCart();

      // Calculate amount safely (supports total from DTO and totalAmount from Prisma)
      const rawAmount = (newOrder as any)?.total ?? newOrder?.totalAmount ?? totalAmount;
      const orderAmount = Number(rawAmount);

      // Navigate to Payment screen with new order
      navigation.replace('Payment', {
        orderId: newOrder.id,
        amount: isNaN(orderAmount) || orderAmount <= 0 ? totalAmount : orderAmount,
      });
    } catch (err) {
      Alert.alert('Error al crear orden', getErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <Header
        title="Finalizar Compra"
        showBack
        onBack={() => navigation.goBack()}
      />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {/* Shipping Address Section */}
          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <Ionicons name="location-outline" size={20} color={Colors.primary} />
              <Text style={styles.sectionTitle}>Dirección de Entrega</Text>
            </View>
            <Text style={styles.sectionDesc}>
              Ingresa los datos del domicilio donde recibirás tu paquete.
            </Text>
            <Input
              placeholder="Ej. Calle Los Robles #45, Edif. Apto 3B"
              value={shippingAddress}
              onChangeText={setShippingAddress}
              icon="navigate-outline"
              multiline
              numberOfLines={2}
              containerStyle={{ marginBottom: 0 }}
            />
          </View>

          {/* Items Summary Section */}
          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <Ionicons name="basket-outline" size={20} color={Colors.primary} />
              <Text style={styles.sectionTitle}>Resumen del Pedido</Text>
            </View>

            {cartItems.map((item) => {
              const unitPrice = Number(item.product?.price || 0);
              const subtotal = (unitPrice * item.quantity).toFixed(2);
              return (
                <View key={item.id} style={styles.itemRow}>
                  <View style={styles.itemInfo}>
                    <Text style={styles.itemName} numberOfLines={1}>
                      {item.product?.name}
                    </Text>
                    <Text style={styles.itemMeta}>
                      Talla: {item.product?.size} • Cantidad: {item.quantity}
                    </Text>
                  </View>
                  <Text style={styles.itemPrice}>${subtotal}</Text>
                </View>
              );
            })}

            <View style={styles.divider} />

            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Total a Pagar</Text>
              <Text style={styles.totalAmount}>${totalAmount.toFixed(2)}</Text>
            </View>
          </View>

          {/* Info Badge */}
          <View style={styles.infoBox}>
            <Ionicons name="shield-checkmark-outline" size={20} color={Colors.success} />
            <Text style={styles.infoText}>
              Pago seguro y encriptado con tecnología Stripe.
            </Text>
          </View>

          <Button
            title="Confirmar Pedido y Pagar"
            onPress={handleCreateOrder}
            isLoading={isSubmitting}
            variant="primary"
            size="lg"
            style={styles.confirmBtn}
            icon={
              <Ionicons name="card-outline" size={20} color={Colors.textWhite} />
            }
          />
        </ScrollView>
      </KeyboardAvoidingView>
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
  sectionCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadows.sm,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  sectionDesc: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginBottom: 12,
  },
  itemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  itemInfo: {
    flex: 1,
    marginRight: 12,
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
  itemPrice: {
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
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  totalAmount: {
    fontSize: 20,
    fontWeight: '800',
    color: Colors.primary,
  },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.successLight,
    padding: 12,
    borderRadius: 12,
    gap: 8,
    marginBottom: 20,
  },
  infoText: {
    fontSize: 13,
    color: Colors.success,
    fontWeight: '600',
    flex: 1,
  },
  confirmBtn: {
    width: '100%',
  },
});

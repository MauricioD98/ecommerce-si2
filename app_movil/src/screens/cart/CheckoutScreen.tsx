import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  Alert,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../navigation/types';
import { useCart } from '../../context/CartContext';
import { ordersApi } from '../../api/orders.api';
import { branchesApi, Branch } from '../../api/branches.api';
import { Header } from '../../components/Header';
import { Input } from '../../components/Input';
import { Button } from '../../components/Button';
import { Colors, Shadows } from '../../theme/colors';
import { getErrorMessage } from '../../api/client';

type Props = NativeStackScreenProps<RootStackParamList, 'Checkout'>;

export const CheckoutScreen: React.FC<Props> = ({ navigation }) => {
  const { cart, totalAmount } = useCart();
  const [fulfillmentType, setFulfillmentType] = useState<'DELIVERY' | 'PICKUP'>('DELIVERY');
  const [shippingAddress, setShippingAddress] = useState<string>('Av. Principal #123, Ciudad');
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(null);
  const [isLoadingBranches, setIsLoadingBranches] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const cartItems = cart?.cartItems || [];
  const shippingCost = fulfillmentType === 'DELIVERY' ? 15.0 : 0.0;
  const payableTotal = totalAmount + shippingCost;

  useEffect(() => {
    const loadBranches = async () => {
      try {
        setIsLoadingBranches(true);
        const data = await branchesApi.getActive();
        setBranches(data);
        if (data && data.length > 0) {
          setSelectedBranchId(data[0].id);
        }
      } catch (err) {
        console.warn('Error loading branches:', err);
      } finally {
        setIsLoadingBranches(false);
      }
    };
    loadBranches();
  }, []);

  const handleCreateOrder = async () => {
    if (fulfillmentType === 'DELIVERY' && !shippingAddress.trim()) {
      Alert.alert('Dirección requerida', 'Por favor ingresa la dirección de entrega.');
      return;
    }

    if (fulfillmentType === 'PICKUP' && !selectedBranchId) {
      Alert.alert('Sucursal requerida', 'Por favor selecciona la sucursal donde retirarás tu pedido.');
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
        size: item.size || (item.product as any)?.sizes?.[0] || 'M',
      }));

      const newOrder = await ordersApi.create({
        items: itemsPayload,
        shippingAddress: fulfillmentType === 'DELIVERY' ? shippingAddress.trim() : undefined,
        fulfillmentType,
        branchId: fulfillmentType === 'PICKUP' ? (selectedBranchId || undefined) : undefined,
      });

      // Calculate amount safely (supports total from DTO and totalAmount from Prisma)
      const rawAmount = (newOrder as any)?.total ?? newOrder?.totalAmount ?? payableTotal;
      const orderAmount = Number(rawAmount);

      // Navigate to Payment screen (navigate preserves history so user can go back without losing cart)
      navigation.navigate('Payment', {
        orderId: newOrder.id,
        amount: isNaN(orderAmount) || orderAmount <= 0 ? payableTotal : orderAmount,
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
          {/* Method Selection (Delivery vs Pickup) */}
          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <Ionicons name="cube-outline" size={20} color={Colors.primary} />
              <Text style={styles.sectionTitle}>Método de Entrega</Text>
            </View>
            <View style={styles.methodRow}>
              <TouchableOpacity
                style={[
                  styles.methodBtn,
                  fulfillmentType === 'DELIVERY' && styles.methodBtnActive,
                ]}
                onPress={() => setFulfillmentType('DELIVERY')}
                activeOpacity={0.8}
              >
                <Ionicons
                  name="bicycle-outline"
                  size={20}
                  color={fulfillmentType === 'DELIVERY' ? Colors.primary : Colors.textSecondary}
                />
                <Text
                  style={[
                    styles.methodText,
                    fulfillmentType === 'DELIVERY' && styles.methodTextActive,
                  ]}
                >
                  Envío a Domicilio
                </Text>
                <Text style={styles.methodCost}>$15.00 USD</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.methodBtn,
                  fulfillmentType === 'PICKUP' && styles.methodBtnActive,
                ]}
                onPress={() => setFulfillmentType('PICKUP')}
                activeOpacity={0.8}
              >
                <Ionicons
                  name="storefront-outline"
                  size={20}
                  color={fulfillmentType === 'PICKUP' ? Colors.primary : Colors.textSecondary}
                />
                <Text
                  style={[
                    styles.methodText,
                    fulfillmentType === 'PICKUP' && styles.methodTextActive,
                  ]}
                >
                  Retiro en Tienda
                </Text>
                <Text style={[styles.methodCost, { color: Colors.success }]}>Gratis</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Shipping Address Section */}
          {fulfillmentType === 'DELIVERY' ? (
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
          ) : (
            <View style={styles.sectionCard}>
              <View style={styles.sectionHeader}>
                <Ionicons name="storefront-outline" size={20} color={Colors.primary} />
                <Text style={styles.sectionTitle}>Sucursal de Retiro</Text>
              </View>
              <Text style={styles.sectionDesc}>
                Elige la sucursal donde retirarás tu compra sin costo adicional:
              </Text>
              {isLoadingBranches ? (
                <ActivityIndicator color={Colors.primary} style={{ marginVertical: 14 }} />
              ) : branches.length === 0 ? (
                <Text style={styles.emptyBranchText}>No se encontraron sucursales disponibles.</Text>
              ) : (
                <View style={styles.branchesList}>
                  {branches.map((b) => {
                    const isSelected = selectedBranchId === b.id;
                    return (
                      <TouchableOpacity
                        key={b.id}
                        style={[
                          styles.branchItem,
                          isSelected && styles.branchItemSelected,
                        ]}
                        onPress={() => setSelectedBranchId(b.id)}
                        activeOpacity={0.8}
                      >
                        <Ionicons
                          name={isSelected ? 'radio-button-on' : 'radio-button-off'}
                          size={20}
                          color={isSelected ? Colors.primary : Colors.textMuted}
                          style={{ marginTop: 2 }}
                        />
                        <View style={{ flex: 1, marginLeft: 10 }}>
                          <Text style={[styles.branchName, isSelected && styles.branchNameSelected]}>
                            {b.name}
                          </Text>
                          {b.address ? (
                            <Text style={styles.branchAddress}>{b.address}</Text>
                          ) : null}
                          {b.phone ? (
                            <Text style={styles.branchPhone}>Tel: {b.phone}</Text>
                          ) : null}
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}
            </View>
          )}

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
                      Talla: {item.size || (item.product as any)?.sizes?.[0] || item.product?.size || '-'} • Cantidad: {item.quantity}
                    </Text>
                  </View>
                  <Text style={styles.itemPrice}>${subtotal}</Text>
                </View>
              );
            })}

            <View style={styles.divider} />

            <View style={styles.summaryLine}>
              <Text style={styles.summaryLabel}>Subtotal productos</Text>
              <Text style={styles.summaryValue}>${totalAmount.toFixed(2)}</Text>
            </View>

            <View style={styles.summaryLine}>
              <Text style={styles.summaryLabel}>Costo de envío</Text>
              <Text
                style={[
                  styles.summaryValue,
                  shippingCost === 0 && { color: Colors.success, fontWeight: '700' },
                ]}
              >
                {shippingCost === 0 ? 'Gratis ($0.00)' : `$${shippingCost.toFixed(2)}`}
              </Text>
            </View>

            <View style={styles.divider} />

            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Total a Pagar</Text>
              <Text style={styles.totalAmount}>${payableTotal.toFixed(2)}</Text>
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
            title={`Confirmar Pedido y Pagar ($${payableTotal.toFixed(2)})`}
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
  methodRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  methodBtn: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    backgroundColor: Colors.surface,
  },
  methodBtnActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primaryLight,
  },
  methodText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textSecondary,
    marginTop: 6,
    textAlign: 'center',
  },
  methodTextActive: {
    color: Colors.primary,
    fontWeight: '700',
  },
  methodCost: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginTop: 2,
  },
  summaryLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginVertical: 4,
  },
  summaryLabel: {
    fontSize: 14,
    color: Colors.textSecondary,
  },
  summaryValue: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textPrimary,
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
  branchesList: {
    gap: 10,
    marginTop: 4,
  },
  branchItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: 12,
    padding: 12,
    backgroundColor: Colors.surface,
  },
  branchItemSelected: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primaryLight,
  },
  branchName: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  branchNameSelected: {
    color: Colors.primary,
  },
  branchAddress: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2,
    lineHeight: 16,
  },
  branchPhone: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 3,
  },
  emptyBranchText: {
    fontSize: 13,
    color: Colors.textMuted,
    fontStyle: 'italic',
    marginVertical: 8,
  },
  confirmBtn: {
    width: '100%',
  },
});

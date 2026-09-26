import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  SafeAreaView,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../navigation/types';
import { useCart } from '../../context/CartContext';
import { CartItemRow } from '../../components/CartItemRow';
import { EmptyState } from '../../components/EmptyState';
import { Button } from '../../components/Button';
import { Header } from '../../components/Header';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { Colors, Shadows } from '../../theme/colors';
import { getErrorMessage } from '../../api/client';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

export const CartScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const {
    cart,
    isLoading,
    totalAmount,
    itemCount,
    fetchCart,
    updateQuantity,
    removeFromCart,
    clearCart,
  } = useCart();

  const [operatingItemId, setOperatingItemId] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      fetchCart();
    }, [fetchCart])
  );

  const handleIncrement = async (itemId: string, currentQty: number) => {
    try {
      setOperatingItemId(itemId);
      await updateQuantity(itemId, currentQty + 1);
    } catch (err) {
      Alert.alert('Error', getErrorMessage(err));
    } finally {
      setOperatingItemId(null);
    }
  };

  const handleDecrement = async (itemId: string, currentQty: number) => {
    try {
      setOperatingItemId(itemId);
      await updateQuantity(itemId, currentQty - 1);
    } catch (err) {
      Alert.alert('Error', getErrorMessage(err));
    } finally {
      setOperatingItemId(null);
    }
  };

  const handleRemove = (itemId: string, productName: string) => {
    Alert.alert(
      'Eliminar producto',
      `¿Deseas quitar "${productName}" del carrito?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: async () => {
            try {
              setOperatingItemId(itemId);
              await removeFromCart(itemId);
            } catch (err) {
              Alert.alert('Error', getErrorMessage(err));
            } finally {
              setOperatingItemId(null);
            }
          },
        },
      ]
    );
  };

  const handleClearCart = () => {
    if (itemCount === 0) return;
    Alert.alert(
      'Vaciar Carrito',
      '¿Estás seguro de que quieres eliminar todos los productos de tu carrito?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Vaciar',
          style: 'destructive',
          onPress: async () => {
            try {
              await clearCart();
            } catch (err) {
              Alert.alert('Error', getErrorMessage(err));
            }
          },
        },
      ]
    );
  };

  const cartItems = cart?.cartItems || [];

  return (
    <SafeAreaView style={styles.safeArea}>
      <Header
        title="Mi Carrito"
        subtitle={itemCount > 0 ? `${itemCount} productos` : undefined}
        rightAction={
          itemCount > 0 ? (
            <TouchableOpacity onPress={handleClearCart} style={styles.clearBtn}>
              <Ionicons name="trash-bin-outline" size={20} color={Colors.error} />
            </TouchableOpacity>
          ) : null
        }
      />

      {isLoading && cartItems.length === 0 ? (
        <LoadingSpinner message="Cargando tu carrito..." fullScreen />
      ) : cartItems.length === 0 ? (
        <EmptyState
          icon="cart-outline"
          title="Tu carrito está vacío"
          description="Explora nuestro catálogo y agrega los productos que te gusten."
          actionTitle="Explorar Productos"
          onAction={() => navigation.navigate('Main', { screen: 'ShopTab' } as any)}
        />
      ) : (
        <View style={styles.container}>
          <FlatList
            data={cartItems}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) => (
              <CartItemRow
                item={item}
                onIncrement={() => handleIncrement(item.id, item.quantity)}
                onDecrement={() => handleDecrement(item.id, item.quantity)}
                onRemove={() => handleRemove(item.id, item.product?.name || 'Producto')}
                isUpdating={operatingItemId === item.id}
              />
            )}
          />

          {/* Bottom Summary & Checkout */}
          <View style={styles.summaryCard}>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Subtotal</Text>
              <Text style={styles.summaryValue}>Bs ${totalAmount.toFixed(2)}</Text>
            </View>

            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Envío estimado</Text>
              <Text style={[styles.summaryValue, { color: Colors.success }]}>Gratis</Text>
            </View>

            <View style={styles.divider} />

            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Total a Pagar</Text>
              <Text style={styles.totalValue}>Bs ${totalAmount.toFixed(2)}</Text>
            </View>

            <Button
              title="Proceder al Checkout"
              onPress={() => navigation.navigate('Checkout')}
              variant="primary"
              size="lg"
              style={styles.checkoutBtn}
              icon={
                <Ionicons
                  name="arrow-forward-circle-outline"
                  size={22}
                  color={Colors.textWhite}
                />
              }
            />
          </View>
        </View>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  container: {
    flex: 1,
  },
  clearBtn: {
    padding: 6,
  },
  listContent: {
    padding: 16,
    paddingBottom: 200,
  },
  summaryCard: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: Colors.surface,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 24,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    ...Shadows.lg,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
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
  divider: {
    height: 1,
    backgroundColor: Colors.border,
    marginVertical: 10,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  totalLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  totalValue: {
    fontSize: 22,
    fontWeight: '800',
    color: Colors.primary,
  },
  checkoutBtn: {
    width: '100%',
  },
});

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../navigation/types';
import { Product } from '../../types';
import { productsApi } from '../../api/products.api';
import { useCart } from '../../context/CartContext';
import { Header } from '../../components/Header';
import { Button } from '../../components/Button';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { Colors, Shadows } from '../../theme/colors';
import { getErrorMessage } from '../../api/client';

type Props = NativeStackScreenProps<RootStackParamList, 'ProductDetail'>;

export const ProductDetailScreen: React.FC<Props> = ({ route, navigation }) => {
  const { productId } = route.params;
  const { addToCart, itemCount } = useCart();

  const [product, setProduct] = useState<Product | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [quantity, setQuantity] = useState<number>(1);
  const [selectedSize, setSelectedSize] = useState<string>('');
  const [isAdding, setIsAdding] = useState<boolean>(false);

  useEffect(() => {
    const fetchProduct = async () => {
      try {
        setIsLoading(true);
        const data = await productsApi.getById(productId);
        setProduct(data);
        const availableSizes =
          Array.isArray(data.sizes) && data.sizes.length > 0
            ? data.sizes
            : data.size
            ? [data.size]
            : [];
        if (availableSizes.length > 0) {
          setSelectedSize(availableSizes[0]);
        }
      } catch (err) {
        Alert.alert('Error', getErrorMessage(err));
        navigation.goBack();
      } finally {
        setIsLoading(false);
      }
    };
    fetchProduct();
  }, [productId, navigation]);

  const handleAddToCart = async () => {
    if (!product) return;
    try {
      setIsAdding(true);
      const chosenSize = selectedSize || (product as any)?.sizes?.[0] || 'M';
      await addToCart(product.id, quantity, chosenSize);
      Alert.alert(
        '¡Producto añadido!',
        `Se agregaron ${quantity} unidad(es) de ${product.name} (Talla: ${chosenSize}) al carrito.`,
        [
          { text: 'Seguir Comprando', style: 'cancel' },
          {
            text: 'Ir al Carrito',
            onPress: () => navigation.navigate('Main', { screen: 'CartTab' } as any),
          },
        ]
      );
    } catch (err) {
      Alert.alert('Error', getErrorMessage(err));
    } finally {
      setIsAdding(false);
    }
  };

  if (isLoading || !product) {
    return <LoadingSpinner message="Cargando detalles del producto..." fullScreen />;
  }

  const isOutOfStock = product.stock <= 0;
  const unitPrice = Number(product.price);
  const total = (unitPrice * quantity).toFixed(2);

  return (
    <SafeAreaView style={styles.safeArea}>
      <Header
        title="Detalles del Producto"
        showBack
        onBack={() => navigation.goBack()}
        rightAction={
          <TouchableOpacity
            style={styles.cartIconBtn}
            onPress={() => navigation.navigate('Main', { screen: 'CartTab' } as any)}
          >
            <Ionicons name="cart-outline" size={22} color={Colors.textPrimary} />
            {itemCount > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{itemCount}</Text>
              </View>
            )}
          </TouchableOpacity>
        }
      />

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Product Image */}
        <View style={styles.imageContainer}>
          {product.imageUrl ? (
            <Image
              source={{ uri: product.imageUrl }}
              style={styles.image}
              resizeMode="contain"
            />
          ) : (
            <View style={styles.placeholderContainer}>
              <Ionicons name="shirt-outline" size={72} color={Colors.textMuted} />
            </View>
          )}
        </View>

        {/* Product Info */}
        <View style={styles.infoCard}>
          <View style={styles.tagsRow}>
            {product.sku ? (
              <View style={styles.skuPill}>
                <Text style={styles.skuText}>SKU: {product.sku}</Text>
              </View>
            ) : null}
            {product.category ? (
              <View style={styles.catPill}>
                <Text style={styles.catText}>
                  {typeof product.category === 'object' && product.category !== null
                    ? (product.category as any).name
                    : String(product.category)}
                </Text>
              </View>
            ) : null}
          </View>

          <Text style={styles.title}>{product.name}</Text>

          <View style={styles.priceStockRow}>
            <Text style={styles.price}>${unitPrice.toFixed(2)}</Text>
            <View
              style={[
                styles.stockPill,
                { backgroundColor: isOutOfStock ? Colors.errorLight : Colors.successLight },
              ]}
            >
              <View
                style={[
                  styles.stockDot,
                  { backgroundColor: isOutOfStock ? Colors.error : Colors.success },
                ]}
              />
              <Text
                style={[
                  styles.stockLabel,
                  { color: isOutOfStock ? Colors.error : Colors.success },
                ]}
              >
                {isOutOfStock ? 'Sin existencias' : `${product.stock} disponibles`}
              </Text>
            </View>
          </View>

          <View style={styles.divider} />

          {/* Size Selector */}
          {(() => {
            const availableSizes =
              Array.isArray((product as any).sizes) && (product as any).sizes.length > 0
                ? (product as any).sizes
                : product.size
                ? [product.size]
                : [];
            if (availableSizes.length === 0) return null;
            return (
              <View style={{ marginBottom: 16 }}>
                <Text style={styles.sectionTitle}>Talla</Text>
                <View style={{ flexDirection: 'row', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
                  {availableSizes.map((s: string) => {
                    const isSelected = (selectedSize || availableSizes[0]) === s;
                    return (
                      <TouchableOpacity
                        key={s}
                        onPress={() => setSelectedSize(s)}
                        style={{
                          paddingHorizontal: 16,
                          paddingVertical: 8,
                          borderRadius: 8,
                          borderWidth: 1.5,
                          borderColor: isSelected ? Colors.primary : Colors.border,
                          backgroundColor: isSelected ? Colors.primaryLight : Colors.surface,
                        }}
                      >
                        <Text
                          style={{
                            fontWeight: isSelected ? '700' : '500',
                            color: isSelected ? Colors.primary : Colors.textPrimary,
                          }}
                        >
                          {s}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            );
          })()}

          <Text style={styles.sectionTitle}>Descripción</Text>
          <Text style={styles.description}>
            {product.description ||
              'Sin descripción detallada disponible para este producto.'}
          </Text>

          {/* Quantity Stepper */}
          {!isOutOfStock && (
            <View style={styles.quantitySection}>
              <Text style={styles.sectionTitle}>Cantidad</Text>
              <View style={styles.stepperContainer}>
                <TouchableOpacity
                  style={[styles.stepperBtn, quantity <= 1 && styles.stepperBtnDisabled]}
                  onPress={() => setQuantity((prev) => Math.max(1, prev - 1))}
                  disabled={quantity <= 1}
                >
                  <Ionicons name="remove" size={18} color={Colors.textPrimary} />
                </TouchableOpacity>

                <Text style={styles.stepperValue}>{quantity}</Text>

                <TouchableOpacity
                  style={[
                    styles.stepperBtn,
                    quantity >= product.stock && styles.stepperBtnDisabled,
                  ]}
                  onPress={() => setQuantity((prev) => Math.min(product.stock, prev + 1))}
                  disabled={quantity >= product.stock}
                >
                  <Ionicons name="add" size={18} color={Colors.textPrimary} />
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      </ScrollView>

      {/* Sticky Bottom Actions */}
      <View style={styles.bottomBar}>
        <View style={styles.totalBox}>
          <Text style={styles.totalLabel}>Total Estimado</Text>
          <Text style={styles.totalValue}>${total}</Text>
        </View>

        <Button
          title={isOutOfStock ? 'Agotado' : 'Agregar al Carrito'}
          onPress={handleAddToCart}
          variant={isOutOfStock ? 'secondary' : 'primary'}
          size="lg"
          isLoading={isAdding}
          disabled={isOutOfStock}
          style={styles.addBtn}
          icon={
            !isOutOfStock && (
              <Ionicons name="cart-outline" size={20} color={Colors.textWhite} />
            )
          }
        />
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  cartIconBtn: {
    position: 'relative',
    padding: 4,
  },
  badge: {
    position: 'absolute',
    top: -2,
    right: -4,
    backgroundColor: Colors.primary,
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 2,
  },
  badgeText: {
    color: Colors.textWhite,
    fontSize: 10,
    fontWeight: '800',
  },
  scrollContent: {
    paddingBottom: 100,
  },
  imageContainer: {
    width: '100%',
    height: 280,
    backgroundColor: Colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  placeholderContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  infoCard: {
    backgroundColor: Colors.surface,
    margin: 16,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadows.sm,
  },
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  tagPill: {
    backgroundColor: Colors.primaryLight,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  tagText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.primary,
  },
  skuPill: {
    backgroundColor: Colors.surfaceSubtle,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  skuText: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontWeight: '600',
  },
  catPill: {
    backgroundColor: '#F3E8FF',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  catText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#8B5CF6',
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: Colors.textPrimary,
    marginBottom: 12,
  },
  priceStockRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  price: {
    fontSize: 26,
    fontWeight: '800',
    color: Colors.primary,
  },
  stockPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    gap: 6,
  },
  stockDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  stockLabel: {
    fontSize: 13,
    fontWeight: '700',
  },
  divider: {
    height: 1,
    backgroundColor: Colors.border,
    marginVertical: 16,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: 8,
  },
  description: {
    fontSize: 14,
    color: Colors.textSecondary,
    lineHeight: 22,
  },
  quantitySection: {
    marginTop: 20,
  },
  stepperContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surfaceSubtle,
    borderRadius: 12,
    alignSelf: 'flex-start',
    padding: 4,
  },
  stepperBtn: {
    width: 38,
    height: 38,
    borderRadius: 8,
    backgroundColor: Colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    ...Shadows.sm,
  },
  stepperBtnDisabled: {
    opacity: 0.3,
  },
  stepperValue: {
    paddingHorizontal: 16,
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: Colors.surface,
    paddingHorizontal: 20,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    ...Shadows.lg,
  },
  totalBox: {
    flex: 1,
  },
  totalLabel: {
    fontSize: 11,
    color: Colors.textMuted,
    textTransform: 'uppercase',
  },
  totalValue: {
    fontSize: 22,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  addBtn: {
    flex: 1.5,
    marginLeft: 16,
  },
});

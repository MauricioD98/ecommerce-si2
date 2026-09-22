import React from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Product } from '../types';
import { Colors, Shadows } from '../theme/colors';

interface ProductCardProps {
  product: Product;
  onPress: () => void;
  onAddToCart?: () => void;
  isAddingToCart?: boolean;
}

const { width } = Dimensions.get('window');
const CARD_WIDTH = (width - 48) / 2;

export const ProductCard: React.FC<ProductCardProps> = ({
  product,
  onPress,
  onAddToCart,
  isAddingToCart = false,
}) => {
  const isOutOfStock = product.stock <= 0;
  const formattedPrice = Number(product.price).toFixed(2);

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <View style={styles.imageContainer}>
        {product.imageUrl ? (
          <Image
            source={{ uri: product.imageUrl }}
            style={styles.image}
            resizeMode="cover"
          />
        ) : (
          <View style={styles.placeholderContainer}>
            <Ionicons name="shirt-outline" size={42} color={Colors.textMuted} />
          </View>
        )}
        {(() => {
          const displaySize =
            Array.isArray((product as any).sizes) && (product as any).sizes.length > 0
              ? (product as any).sizes.join('/')
              : product.size;
          return displaySize ? (
            <View style={styles.sizeTag}>
              <Text style={styles.sizeText}>{displaySize}</Text>
            </View>
          ) : null;
        })()}
        {isOutOfStock && (
          <View style={styles.outOfStockOverlay}>
            <Text style={styles.outOfStockText}>Agotado</Text>
          </View>
        )}
      </View>

      <View style={styles.content}>
        <Text style={styles.productName} numberOfLines={2}>
          {product.name}
        </Text>

        <View style={styles.stockRow}>
          <View
            style={[
              styles.stockDot,
              { backgroundColor: isOutOfStock ? Colors.error : Colors.success },
            ]}
          />
          <Text style={styles.stockText}>
            {isOutOfStock ? 'Sin stock' : `${product.stock} disponibles`}
          </Text>
        </View>

        <View style={styles.footerRow}>
          <Text style={styles.price}>${formattedPrice}</Text>

          {onAddToCart && (
            <TouchableOpacity
              style={[
                styles.addCartBtn,
                isOutOfStock && styles.addCartBtnDisabled,
              ]}
              onPress={(e) => {
                e.stopPropagation();
                if (!isOutOfStock) onAddToCart();
              }}
              disabled={isOutOfStock || isAddingToCart}
              activeOpacity={0.7}
            >
              <Ionicons
                name={isAddingToCart ? 'hourglass-outline' : 'cart-outline'}
                size={18}
                color={isOutOfStock ? Colors.textMuted : Colors.textWhite}
              />
            </TouchableOpacity>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    width: CARD_WIDTH,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 16,
    ...Shadows.sm,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  imageContainer: {
    width: '100%',
    height: 150,
    backgroundColor: Colors.surfaceSubtle,
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  placeholderContainer: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.surfaceSubtle,
  },
  sizeTag: {
    position: 'absolute',
    top: 8,
    left: 8,
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  sizeText: {
    color: Colors.textWhite,
    fontSize: 11,
    fontWeight: '700',
  },
  outOfStockOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  outOfStockText: {
    color: Colors.textWhite,
    fontWeight: '800',
    fontSize: 13,
    textTransform: 'uppercase',
  },
  content: {
    padding: 12,
  },
  productName: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textPrimary,
    minHeight: 36,
  },
  stockRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    marginBottom: 8,
  },
  stockDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 6,
  },
  stockText: {
    fontSize: 11,
    color: Colors.textMuted,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  price: {
    fontSize: 16,
    fontWeight: '800',
    color: Colors.primary,
  },
  addCartBtn: {
    backgroundColor: Colors.primary,
    width: 34,
    height: 34,
    borderRadius: 17,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addCartBtnDisabled: {
    backgroundColor: Colors.surfaceSubtle,
  },
});

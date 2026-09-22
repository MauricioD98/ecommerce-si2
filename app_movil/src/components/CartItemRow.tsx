import React from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { CartItem } from '../types';
import { Colors } from '../theme/colors';

interface CartItemRowProps {
  item: CartItem;
  onIncrement: () => void;
  onDecrement: () => void;
  onRemove: () => void;
  isUpdating?: boolean;
}

export const CartItemRow: React.FC<CartItemRowProps> = ({
  item,
  onIncrement,
  onDecrement,
  onRemove,
  isUpdating = false,
}) => {
  const product = item.product;
  const unitPrice = Number(product?.price || 0);
  const itemTotal = (unitPrice * item.quantity).toFixed(2);
  const maxStock = product?.stock || 0;
  const canIncrement = item.quantity < maxStock;

  return (
    <View style={styles.container}>
      <View style={styles.imageBox}>
        {product?.imageUrl ? (
          <Image
            source={{ uri: product.imageUrl }}
            style={styles.image}
            resizeMode="cover"
          />
        ) : (
          <Ionicons name="shirt-outline" size={28} color={Colors.textMuted} />
        )}
      </View>

      <View style={styles.detailsBox}>
        <View style={styles.topRow}>
          <Text style={styles.title} numberOfLines={1}>
            {product?.name || 'Producto'}
          </Text>
          <TouchableOpacity
            onPress={onRemove}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            disabled={isUpdating}
          >
            <Ionicons name="trash-outline" size={18} color={Colors.error} />
          </TouchableOpacity>
        </View>

        <View style={styles.metaRow}>
          <View style={styles.sizeTag}>
            <Text style={styles.sizeText}>Talla: {product?.size || '-'}</Text>
          </View>
          <Text style={styles.unitPrice}>${unitPrice.toFixed(2)} c/u</Text>
        </View>

        <View style={styles.bottomRow}>
          <View style={styles.stepper}>
            <TouchableOpacity
              style={styles.stepperBtn}
              onPress={onDecrement}
              disabled={isUpdating}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            >
              <Ionicons
                name={item.quantity === 1 ? 'trash-outline' : 'remove'}
                size={14}
                color={item.quantity === 1 ? Colors.error : Colors.textPrimary}
              />
            </TouchableOpacity>

            <Text style={styles.quantityText}>{item.quantity}</Text>

            <TouchableOpacity
              style={[styles.stepperBtn, !canIncrement && styles.stepperBtnDisabled]}
              onPress={onIncrement}
              disabled={isUpdating || !canIncrement}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            >
              <Ionicons
                name="add"
                size={14}
                color={!canIncrement ? Colors.textMuted : Colors.textPrimary}
              />
            </TouchableOpacity>
          </View>

          <Text style={styles.totalPrice}>${itemTotal}</Text>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    padding: 12,
    borderRadius: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
  },
  imageBox: {
    width: 76,
    height: 76,
    borderRadius: 10,
    backgroundColor: Colors.surfaceSubtle,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  detailsBox: {
    flex: 1,
    marginLeft: 12,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.textPrimary,
    flex: 1,
    marginRight: 8,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    marginBottom: 8,
  },
  sizeTag: {
    backgroundColor: Colors.surfaceSubtle,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginRight: 8,
  },
  sizeText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  unitPrice: {
    fontSize: 12,
    color: Colors.textMuted,
  },
  bottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surfaceSubtle,
    borderRadius: 8,
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  stepperBtn: {
    width: 26,
    height: 26,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.surface,
  },
  stepperBtnDisabled: {
    opacity: 0.4,
  },
  quantityText: {
    paddingHorizontal: 10,
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  totalPrice: {
    fontSize: 15,
    fontWeight: '800',
    color: Colors.primary,
  },
});

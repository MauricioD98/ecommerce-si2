import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Order } from '../types';
import { StatusBadge } from './StatusBadge';
import { Colors, Shadows } from '../theme/colors';

interface OrderCardProps {
  order: Order;
  onPress: () => void;
}

export const OrderCard: React.FC<OrderCardProps> = ({ order, onPress }) => {
  const items = order.orderItems || order.items || [];
  const itemsCount = items.reduce((acc, item) => acc + item.quantity, 0);
  const formattedDate = new Date(order.createdAt).toLocaleDateString('es-ES', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  const total = Number(order.total ?? order.totalAmount ?? 0).toFixed(2);

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={styles.topRow}>
        <View style={styles.orderIdBox}>
          <Ionicons name="receipt-outline" size={16} color={Colors.primary} />
          <Text style={styles.orderNumber}>
            #{order.orderNumber || order.id.slice(0, 8)}
          </Text>
        </View>
        <StatusBadge status={order.status} />
      </View>

      <View style={styles.divider} />

      <View style={styles.detailsRow}>
        <View>
          <Text style={styles.dateText}>{formattedDate}</Text>
          <Text style={styles.itemsText}>
            {itemsCount} {itemsCount === 1 ? 'artículo' : 'artículos'}
          </Text>
        </View>

        <View style={styles.totalBox}>
          <Text style={styles.totalLabel}>Total</Text>
          <Text style={styles.totalAmount}>${total}</Text>
        </View>
      </View>

      <View style={styles.footerRow}>
        <Text style={styles.viewDetailsText}>Ver detalles</Text>
        <Ionicons name="chevron-forward" size={16} color={Colors.primary} />
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadows.sm,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  orderIdBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  orderNumber: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  divider: {
    height: 1,
    backgroundColor: Colors.border,
    marginVertical: 12,
  },
  detailsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  dateText: {
    fontSize: 12,
    color: Colors.textMuted,
    marginBottom: 4,
  },
  itemsText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  totalBox: {
    alignItems: 'flex-end',
  },
  totalLabel: {
    fontSize: 11,
    color: Colors.textMuted,
    textTransform: 'uppercase',
  },
  totalAmount: {
    fontSize: 17,
    fontWeight: '800',
    color: Colors.primary,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: 10,
    gap: 2,
  },
  viewDetailsText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.primary,
  },
});

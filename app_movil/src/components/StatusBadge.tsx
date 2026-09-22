import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { Colors } from '../theme/colors';
import { OrderStatus } from '../types';

interface StatusBadgeProps {
  status: OrderStatus | string;
  type?: 'order' | 'payment';
  style?: ViewStyle;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, style }) => {
  const getBadgeColors = () => {
    switch (status) {
      case 'PENDIENTE':
        return { bg: Colors.warningLight, text: Colors.statusPending, label: 'Pendiente' };
      case 'PROCESANDO':
        return { bg: Colors.infoLight, text: Colors.statusProcessing, label: 'Procesando' };
      case 'ENVIADO':
        return { bg: '#F3E8FF', text: Colors.statusShipped, label: 'Enviado' };
      case 'ENTREGADO':
      case 'COMPLETADO':
        return { bg: Colors.successLight, text: Colors.success, label: status === 'COMPLETADO' ? 'Completado' : 'Entregado' };
      case 'CANCELADO':
      case 'FALLIDO':
        return { bg: Colors.errorLight, text: Colors.error, label: status === 'FALLIDO' ? 'Fallido' : 'Cancelado' };
      case 'REEMBOLSADO':
        return { bg: Colors.surfaceSubtle, text: Colors.textSecondary, label: 'Reembolsado' };
      default:
        return { bg: Colors.surfaceSubtle, text: Colors.textSecondary, label: status };
    }
  };

  const { bg, text, label } = getBadgeColors();

  return (
    <View style={[styles.badge, { backgroundColor: bg }, style]}>
      <View style={[styles.dot, { backgroundColor: text }]} />
      <Text style={[styles.text, { color: text }]}>{label}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    alignSelf: 'flex-start',
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 6,
  },
  text: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
});

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  SafeAreaView,
  Platform,
  StatusBar,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../navigation/types';
import { Order, OrderStatus } from '../../types';
import { ordersApi } from '../../api/orders.api';
import { OrderCard } from '../../components/OrderCard';
import { EmptyState } from '../../components/EmptyState';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { Colors } from '../../theme/colors';
import { getErrorMessage } from '../../api/client';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

const FILTER_TABS: Array<{ label: string; value: string | null }> = [
  { label: 'Todos', value: null },
  { label: 'Pendientes', value: 'PENDIENTE' },
  { label: 'Procesando', value: 'PROCESANDO' },
  { label: 'Enviados', value: 'ENVIADO' },
  { label: 'Entregados', value: 'ENTREGADO' },
];

export const OrdersScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const [orders, setOrders] = useState<Order[]>([]);
  const [selectedStatus, setSelectedStatus] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  const loadOrders = useCallback(async (isRefresh = false) => {
    try {
      if (isRefresh) {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }

      const res = await ordersApi.getAll({
        status: selectedStatus || undefined,
        limit: 50,
      });

      // Response might be { data: Order[] } or Order[]
      if ('data' in res && Array.isArray(res.data)) {
        setOrders(res.data);
      } else if (Array.isArray(res)) {
        setOrders(res);
      } else {
        setOrders([]);
      }
    } catch (err) {
      Alert.alert('Error al cargar pedidos', getErrorMessage(err));
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [selectedStatus]);

  useFocusEffect(
    useCallback(() => {
      loadOrders();
    }, [loadOrders])
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <Text style={styles.title}>Mis Pedidos</Text>
        <Text style={styles.subtitle}>Historial y seguimiento de tus compras</Text>
      </View>

      {/* Filter Tabs */}
      <View style={styles.tabsContainer}>
        {FILTER_TABS.map((tab) => {
          const isActive = selectedStatus === tab.value;
          return (
            <TouchableOpacity
              key={tab.label}
              style={[styles.tab, isActive && styles.tabActive]}
              onPress={() => setSelectedStatus(tab.value)}
              activeOpacity={0.7}
            >
              <Text style={[styles.tabText, isActive && styles.tabTextActive]}>
                {tab.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {isLoading ? (
        <LoadingSpinner message="Cargando pedidos..." fullScreen />
      ) : (
        <FlatList
          data={orders}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={() => loadOrders(true)}
              colors={[Colors.primary]}
            />
          }
          renderItem={({ item }) => (
            <OrderCard
              order={item}
              onPress={() => navigation.navigate('OrderDetail', { orderId: item.id })}
            />
          )}
          ListEmptyComponent={
            <EmptyState
              icon="receipt-outline"
              title="No hay pedidos para mostrar"
              description={
                selectedStatus
                  ? `No tienes pedidos con el estado "${selectedStatus}".`
                  : 'Aún no has realizado ninguna compra. ¡Empieza a explorar el catálogo!'
              }
              actionTitle={selectedStatus ? 'Ver Todos' : 'Ir a la Tienda'}
              onAction={() => {
                if (selectedStatus) {
                  setSelectedStatus(null);
                } else {
                  navigation.navigate('Main', { screen: 'ShopTab' } as any);
                }
              }}
            />
          }
        />
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background,
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0,
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  subtitle: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  tabsContainer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
  },
  tab: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  tabActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  tabText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  tabTextActive: {
    color: Colors.textWhite,
  },
  listContent: {
    padding: 16,
    flexGrow: 1,
  },
});

import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { MainTabParamList } from './types';
import { ProductsScreen } from '../screens/shop/ProductsScreen';
import { CartScreen } from '../screens/cart/CartScreen';
import { OrdersScreen } from '../screens/orders/OrdersScreen';
import { ProfileScreen } from '../screens/profile/ProfileScreen';
import { useCart } from '../context/CartContext';
import { Colors } from '../theme/colors';

const Tab = createBottomTabNavigator<MainTabParamList>();

export const MainTabNavigator: React.FC = () => {
  const { itemCount } = useCart();
  const { t } = useTranslation();

  return (
    <Tab.Navigator
      safeAreaInsets={{ bottom: 0 }}
      screenOptions={{
        headerShown: false,
        tabBarHideOnKeyboard: true,
        tabBarActiveTintColor: Colors.primary,
        tabBarInactiveTintColor: Colors.textMuted,
        tabBarStyle: {
          backgroundColor: Colors.surface,
          borderTopColor: Colors.border,
          height: 60,
          paddingBottom: 8,
          paddingTop: 8,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
        },
      }}
    >
      <Tab.Screen
        name="ShopTab"
        component={ProductsScreen}
        options={{
          tabBarLabel: t('tabs.shop'),
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? 'bag-handle' : 'bag-handle-outline'}
              size={22}
              color={color}
            />
          ),
        }}
      />

      <Tab.Screen
        name="CartTab"
        component={CartScreen}
        options={{
          tabBarLabel: t('tabs.cart'),
          tabBarBadge: itemCount > 0 ? itemCount : undefined,
          tabBarBadgeStyle: {
            backgroundColor: Colors.primary,
            fontSize: 10,
            fontWeight: '800',
          },
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? 'cart' : 'cart-outline'}
              size={22}
              color={color}
            />
          ),
        }}
      />

      <Tab.Screen
        name="OrdersTab"
        component={OrdersScreen}
        options={{
          tabBarLabel: t('tabs.orders'),
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? 'receipt' : 'receipt-outline'}
              size={22}
              color={color}
            />
          ),
        }}
      />

      <Tab.Screen
        name="ProfileTab"
        component={ProfileScreen}
        options={{
          tabBarLabel: t('tabs.profile'),
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? 'person' : 'person-outline'}
              size={22}
              color={color}
            />
          ),
        }}
      />
    </Tab.Navigator>
  );
};

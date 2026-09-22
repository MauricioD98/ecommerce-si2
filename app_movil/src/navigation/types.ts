import { NavigatorScreenParams } from '@react-navigation/native';

export type AuthStackParamList = {
  Login: undefined;
  Register: undefined;
};

export type MainTabParamList = {
  ShopTab: undefined;
  CartTab: undefined;
  OrdersTab: undefined;
  ProfileTab: undefined;
};

export type RootStackParamList = {
  Auth: NavigatorScreenParams<AuthStackParamList>;
  Main: NavigatorScreenParams<MainTabParamList>;
  ProductDetail: { productId: string };
  Checkout: undefined;
  OrderDetail: { orderId: string };
  Payment: { orderId: string; amount: number };
  EditProfile: undefined;
  ChangePassword: undefined;
};

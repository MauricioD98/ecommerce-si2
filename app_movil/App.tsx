import React, { useEffect, useState } from 'react';
import { LogBox } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { TenantProvider } from './src/context/TenantContext';
import { AuthProvider } from './src/context/AuthContext';
import { BranchProvider } from './src/context/BranchContext';
import { CartProvider } from './src/context/CartContext';
import { AppNavigator } from './src/navigation/AppNavigator';
import { initI18n } from './src/i18n';

LogBox.ignoreLogs([
  'SafeAreaView has been deprecated',
  'Cannot connect to Expo CLI',
]);

export default function App() {
  // Se espera al idioma guardado (AsyncStorage) antes de pintar: si no, la primera pantalla se
  // vería un instante en el idioma del teléfono y después saltaría al elegido por el usuario.
  const [i18nReady, setI18nReady] = useState(false);
  useEffect(() => {
    initI18n()
      .catch(() => undefined) // sin traducciones guardadas se sigue con el idioma del dispositivo
      .finally(() => setI18nReady(true));
  }, []);

  if (!i18nReady) return null;

  return (
    <SafeAreaProvider style={{ flex: 1 }}>
      <TenantProvider>
        <AuthProvider>
          <BranchProvider>
            <CartProvider>
              <StatusBar style="dark" />
              <AppNavigator />
            </CartProvider>
          </BranchProvider>
        </AuthProvider>
      </TenantProvider>
    </SafeAreaProvider>
  );
}

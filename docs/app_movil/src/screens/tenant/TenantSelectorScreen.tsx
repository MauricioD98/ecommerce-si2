import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from '../../../node_modules/react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { StorePicker } from '../../components/StorePicker';
import { Colors } from '../../theme/colors';

// Se muestra cuando el backend rechazó la tienda guardada (TENANT_REQUIRED o el plan ya no incluye la
// app). Sin tienda elegida NO aparece: el login trae su propio selector. Usa el mismo buscador del
// directorio público (GET /platform/tenants/public), así que no hace falta escribir el identificador.
// onSelect llega por prop (no useTenant) para no crear un ciclo de imports con TenantContext.
export const TenantSelectorScreen: React.FC<{
  rejected?: boolean;
  onSelect: (tenant: { id: string; name: string; slug: string; logoUrl?: string | null } | string) => Promise<void>;
}> = ({ rejected = false, onSelect }) => {
  const { t } = useTranslation();

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <View style={styles.card}>
          <Ionicons name="storefront-outline" size={40} color={Colors.primary} />
          <Text style={styles.title}>{t('storePicker.screenTitle')}</Text>
          <Text style={styles.subtitle}>{rejected ? t('mobileAccess.storeUnavailable') : t('storePicker.screenSubtitle')}</Text>
          <View style={styles.picker}>
            <StorePicker
              selected={null}
              onSelect={(store) => onSelect({ id: store.id, name: store.name, slug: store.slug, logoUrl: store.logoUrl })}
            />
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  container: { flex: 1, justifyContent: 'center', padding: 24 },
  card: {
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 24,
  },
  title: {
    marginTop: 12,
    fontSize: 20,
    fontWeight: '700',
    color: Colors.textPrimary,
    textAlign: 'center',
  },
  subtitle: {
    marginTop: 8,
    fontSize: 14,
    lineHeight: 20,
    color: Colors.textSecondary,
    textAlign: 'center',
  },
  picker: { alignSelf: 'stretch', marginTop: 20 },
});

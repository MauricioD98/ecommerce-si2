import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import apiClient, { getErrorMessage } from '../../api/client';
import { Input } from '../../components/Input';
import { Button } from '../../components/Button';
import { Colors } from '../../theme/colors';

interface ResolvedTenant {
  id: string;
  slug: string;
  name: string;
}

// Se muestra cuando el dispositivo no tiene tienda o el backend la rechazó (TENANT_REQUIRED).
// Resuelve el slug contra GET /platform/tenants/resolve/:slug (ruta sin tenant) y la activa.
// onSelect llega por prop (no useTenant) para no crear un ciclo de imports con TenantContext.
export const TenantSelectorScreen: React.FC<{
  rejected?: boolean;
  onSelect: (tenantId: string) => Promise<void>;
}> = ({ rejected = false, onSelect }) => {
  const [slug, setSlug] = useState('');
  const [error, setError] = useState<string | null>(
    rejected ? 'La tienda guardada ya no está disponible. Elige otra para continuar.' : null
  );
  const [isLoading, setIsLoading] = useState(false);

  const handleContinue = async () => {
    const value = slug.trim().toLowerCase();
    if (!value) return;

    setIsLoading(true);
    setError(null);
    try {
      const { data } = await apiClient.get<{ data: ResolvedTenant }>(
        `/platform/tenants/resolve/${encodeURIComponent(value)}`
      );
      await onSelect(data.data.id);
    } catch (err) {
      setError(getErrorMessage(err));
      setIsLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.card}>
          <Ionicons name="storefront-outline" size={40} color={Colors.primary} />
          <Text style={styles.title}>¿En qué tienda quieres comprar?</Text>
          <Text style={styles.subtitle}>
            Escribe el nombre de la tienda tal como aparece en su enlace (por ejemplo, mi-tienda).
          </Text>

          <Input
            label="Tienda"
            icon="search-outline"
            value={slug}
            onChangeText={setSlug}
            placeholder="nombre-de-la-tienda"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!isLoading}
            error={error ?? undefined}
            returnKeyType="go"
            onSubmitEditing={handleContinue}
            containerStyle={styles.input}
          />

          <Button
            title="Continuar"
            onPress={handleContinue}
            isLoading={isLoading}
            disabled={!slug.trim()}
            size="lg"
            style={styles.button}
          />
        </View>
      </KeyboardAvoidingView>
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
  input: { alignSelf: 'stretch', marginTop: 20 },
  button: { alignSelf: 'stretch', marginTop: 8 },
});

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Modal, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from '../../node_modules/react-i18next';
import { Colors, Shadows } from '../theme/colors';
import { describeDirectoryFailure, storesApi } from '../api/stores.api';
import { searchStores, storeInitials, type DirectoryError, type DirectoryStore } from '../tenant/storeDirectory';

export interface SelectedStore {
  id: string;
  name: string | null;
  logoUrl?: string | null;
}

// Logo de la tienda; si no tiene o no carga, sus iniciales
export const StoreLogo: React.FC<{ name: string | null; logoUrl?: string | null; size?: number }> = ({ name, logoUrl, size = 40 }) => {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [logoUrl]);
  const box = { width: size, height: size, borderRadius: size / 4 };
  if (logoUrl && !failed) {
    return <Image source={{ uri: logoUrl }} style={[styles.logoImage, box]} resizeMode="contain" onError={() => setFailed(true)} />;
  }
  return (
    <View style={[styles.logoFallback, box]}>
      <Text style={[styles.logoInitials, { fontSize: size * 0.38 }]}>{storeInitials(name ?? '')}</Text>
    </View>
  );
};

/**
 * Campo «Seleccionar tienda» del login: muestra la tienda elegida (logo + nombre) y abre un buscador
 * del directorio público de tiendas. Elegir una tienda solo fija a qué tienda se envía el inicio de
 * sesión; el backend comprueba que la cuenta le pertenece.
 */
export const StorePicker: React.FC<{
  selected: SelectedStore | null;
  onSelect: (store: DirectoryStore) => void | Promise<void>;
  disabled?: boolean;
  notice?: string | null;
}> = ({ selected, onSelect, disabled = false, notice }) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [stores, setStores] = useState<DirectoryStore[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<DirectoryError | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setStores(await storesApi.list());
    } catch (err) {
      setError(await describeDirectoryFailure(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const openPicker = () => {
    if (disabled) return;
    setQuery('');
    setOpen(true);
    // Siempre se recarga al abrir: la lista cambia (tiendas nuevas, planes) y es pequeña
    void load();
  };

  const results = useMemo(() => searchStores(stores ?? [], query), [stores, query]);

  const choose = async (store: DirectoryStore) => {
    if (!store.mobileApp) return;
    setOpen(false);
    await onSelect(store);
  };

  return (
    <View style={styles.wrapper}>
      <Text style={styles.label}>{t('storePicker.label')}</Text>
      <TouchableOpacity
        style={[styles.field, !selected && styles.fieldEmpty, disabled && styles.fieldDisabled]}
        onPress={openPicker}
        activeOpacity={0.75}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={selected?.name ? t('storePicker.selectedA11y', { name: selected.name }) : t('storePicker.placeholder')}
        testID="store-picker-field"
      >
        {selected ? (
          <>
            <StoreLogo name={selected.name} logoUrl={selected.logoUrl} size={36} />
            <View style={styles.fieldTextBox}>
              <Text style={styles.fieldName} numberOfLines={1}>
                {selected.name ?? t('storePicker.unnamed')}
              </Text>
              <Text style={styles.fieldHint}>{t('storePicker.selectedHint')}</Text>
            </View>
            <Text style={styles.changeText}>{t('storePicker.change')}</Text>
          </>
        ) : (
          <>
            <Ionicons name="storefront-outline" size={20} color={Colors.textMuted} />
            <Text style={styles.placeholder}>{t('storePicker.placeholder')}</Text>
            <Ionicons name="chevron-down" size={18} color={Colors.textMuted} />
          </>
        )}
      </TouchableOpacity>
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}

      <Modal
        visible={open}
        animationType="slide"
        presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : 'fullScreen'}
        onRequestClose={() => setOpen(false)}
      >
        <SafeAreaView style={styles.sheet} edges={['top', 'bottom']}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{t('storePicker.title')}</Text>
            <TouchableOpacity onPress={() => setOpen(false)} accessibilityLabel={t('storePicker.close')} style={styles.closeBtn}>
              <Ionicons name="close" size={24} color={Colors.textPrimary} />
            </TouchableOpacity>
          </View>

          <View style={styles.searchBox}>
            <Ionicons name="search" size={18} color={Colors.textMuted} />
            <TextInput
              style={styles.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder={t('storePicker.searchPlaceholder')}
              placeholderTextColor={Colors.textMuted}
              autoFocus
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="search"
              testID="store-picker-search"
            />
            {query ? (
              <TouchableOpacity onPress={() => setQuery('')} accessibilityLabel={t('storePicker.clear')}>
                <Ionicons name="close-circle" size={18} color={Colors.textMuted} />
              </TouchableOpacity>
            ) : null}
          </View>

          {loading && !stores ? (
            <View style={styles.state}>
              <ActivityIndicator color={Colors.primary} />
              <Text style={styles.stateText}>{t('storePicker.loading')}</Text>
            </View>
          ) : error ? (
            <View style={styles.state}>
              <Ionicons name={error === 'offline' ? 'cloud-offline-outline' : 'alert-circle-outline'} size={36} color={Colors.error} />
              <Text style={styles.stateText}>{t(`storePicker.errors.${error}`)}</Text>
              <TouchableOpacity style={styles.retryBtn} onPress={load}>
                <Text style={styles.retryText}>{t('storePicker.retry')}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <FlatList
              data={results}
              keyExtractor={(store) => store.id}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.list}
              ListEmptyComponent={
                <View style={styles.state}>
                  <Ionicons name="search-outline" size={32} color={Colors.textMuted} />
                  <Text style={styles.stateText}>
                    {query.trim() ? t('storePicker.noResults', { query: query.trim() }) : t('storePicker.empty')}
                  </Text>
                </View>
              }
              renderItem={({ item }: { item: DirectoryStore }) => {
                const isSelected = item.id === selected?.id;
                return (
                  <TouchableOpacity
                    style={[styles.row, isSelected && styles.rowSelected, !item.mobileApp && styles.rowDisabled]}
                    onPress={() => choose(item)}
                    disabled={!item.mobileApp}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: !item.mobileApp, selected: isSelected }}
                  >
                    <StoreLogo name={item.name} logoUrl={item.logoUrl} size={44} />
                    <View style={styles.rowText}>
                      <Text style={styles.rowName} numberOfLines={1}>
                        {item.name}
                      </Text>
                      <Text style={styles.rowSub} numberOfLines={1}>
                        {item.mobileApp ? `/${item.slug}` : t('storePicker.noMobileApp')}
                      </Text>
                    </View>
                    {isSelected ? (
                      <Ionicons name="checkmark-circle" size={22} color={Colors.primary} />
                    ) : item.mobileApp ? (
                      <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
                    ) : null}
                  </TouchableOpacity>
                );
              }}
            />
          )}
        </SafeAreaView>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: { marginBottom: 16 },
  label: { fontSize: 14, fontWeight: '600', color: Colors.textSecondary, marginBottom: 8 },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 56,
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: Colors.surface,
  },
  fieldEmpty: { borderStyle: 'dashed', borderColor: Colors.primary },
  fieldDisabled: { opacity: 0.6 },
  fieldTextBox: { flex: 1 },
  fieldName: { fontSize: 15, fontWeight: '700', color: Colors.textPrimary },
  fieldHint: { fontSize: 12, color: Colors.textMuted, marginTop: 1 },
  changeText: { fontSize: 14, fontWeight: '700', color: Colors.primary },
  placeholder: { flex: 1, fontSize: 15, color: Colors.textMuted },
  notice: { marginTop: 6, fontSize: 13, color: Colors.error, lineHeight: 18 },
  logoImage: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border },
  logoFallback: { backgroundColor: Colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  logoInitials: { color: Colors.primary, fontWeight: '800' },
  sheet: { flex: 1, backgroundColor: Colors.background },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
  },
  sheetTitle: { fontSize: 20, fontWeight: '800', color: Colors.textPrimary },
  closeBtn: { padding: 6 },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 14,
    height: 48,
    borderRadius: 14,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadows.sm,
  },
  searchInput: { flex: 1, fontSize: 16, color: Colors.textPrimary },
  list: { paddingHorizontal: 16, paddingBottom: 32, gap: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    minHeight: 64,
    borderRadius: 14,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  rowSelected: { borderColor: Colors.primary, backgroundColor: Colors.primaryLight },
  rowDisabled: { opacity: 0.55 },
  rowText: { flex: 1 },
  rowName: { fontSize: 15, fontWeight: '700', color: Colors.textPrimary },
  rowSub: { fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  state: { alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 48, paddingHorizontal: 32 },
  stateText: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center', lineHeight: 20 },
  retryBtn: { marginTop: 4, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 10, backgroundColor: Colors.primary },
  retryText: { color: Colors.textWhite, fontWeight: '700' },
});

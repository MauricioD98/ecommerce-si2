import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Colors, Shadows } from '../theme/colors';
import { LANGUAGES, LANGUAGE_LABELS, changeLanguage, getCurrentLanguage, type Language } from '../i18n';

// Fila "Idioma" del menú de Perfil: muestra el idioma actual y abre la lista para cambiarlo.
// El cambio aplica en caliente (react-i18next re-renderiza) y se recuerda en AsyncStorage.
// Las pantallas que ya trajeron productos de la API los muestran en el idioma nuevo al recargarlos:
// cada petición sale con Accept-Language del idioma elegido.
export const LanguageSelector: React.FC = () => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const current = getCurrentLanguage();

  const select = async (language: Language) => {
    setOpen(false);
    if (language !== current) await changeLanguage(language);
  };

  return (
    <>
      <TouchableOpacity
        style={styles.menuItem}
        onPress={() => setOpen(true)}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={`${t('language.title')}: ${LANGUAGE_LABELS[current]}`}
      >
        <View style={[styles.menuIconBox, { backgroundColor: '#DCFCE7' }]}>
          <Ionicons name="language-outline" size={20} color="#16A34A" />
        </View>
        <View style={styles.menuTextContainer}>
          <Text style={styles.menuTitle}>{t('language.title')}</Text>
          <Text style={styles.menuDesc}>{LANGUAGE_LABELS[current]}</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.overlay} onPress={() => setOpen(false)}>
          {/* Pressable interno: tocar la tarjeta no la cierra, solo tocar fuera */}
          <Pressable style={styles.card}>
            <Text style={styles.title}>{t('language.subtitle')}</Text>
            <Text style={styles.hint}>{t('language.deviceHint')}</Text>

            {LANGUAGES.map((language) => {
              const selected = language === current;
              return (
                <TouchableOpacity
                  key={language}
                  style={[styles.option, selected && styles.optionSelected]}
                  onPress={() => select(language)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                >
                  <Text style={[styles.optionText, selected && styles.optionTextSelected]}>
                    {LANGUAGE_LABELS[language]}
                  </Text>
                  {selected && <Ionicons name="checkmark-circle" size={20} color={Colors.primary} />}
                </TouchableOpacity>
              );
            })}

            <TouchableOpacity style={styles.closeBtn} onPress={() => setOpen(false)}>
              <Text style={styles.closeText}>{t('common.close')}</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  // Mismos estilos que las filas de ProfileScreen para que se vea como una opción más del menú
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  menuIconBox: {
    width: 40,
    height: 40,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  menuTextContainer: {
    flex: 1,
  },
  menuTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  menuDesc: {
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 2,
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  card: {
    width: '100%',
    backgroundColor: Colors.surface,
    borderRadius: 20,
    padding: 20,
    ...Shadows.lg,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  hint: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: 4,
    marginBottom: 14,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 8,
  },
  optionSelected: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primaryLight,
  },
  optionText: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  optionTextSelected: {
    color: Colors.primary,
  },
  closeBtn: {
    alignItems: 'center',
    paddingVertical: 10,
    marginTop: 4,
  },
  closeText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
});

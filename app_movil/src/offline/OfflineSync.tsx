import React, { useEffect, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { Colors } from '../theme/colors';
import { onOffline } from './events';
import { onNetworkChange, useIsOnline } from './network';
import { syncProfileNow } from './profileSync';
import { formatSavedAt } from './format';

const POLL_MS = 30_000;

/**
 * Envía los cambios de perfil hechos sin conexión de la cuenta ACTIVA: al abrir la app o iniciar sesión, al
 * volver la red, al volver a primer plano y cada 30 s mientras haya algo pendiente. Sin tareas en segundo
 * plano (el sistema puede matarlas): la garantía es que al reabrir la app se vuelve a intentar.
 */
export const OfflineSyncManager = () => {
  const { user, isAuthenticated } = useAuth();
  const userId = isAuthenticated ? user?.id : undefined;

  useEffect(() => {
    if (!userId) return;
    const run = () => {
      if (AppState.currentState === 'active') void syncProfileNow();
    };
    run();
    const offNetwork = onNetworkChange((online) => online && run());
    const subscription = AppState.addEventListener('change', (state) => state === 'active' && run());
    const timer = setInterval(run, POLL_MS);
    return () => {
      offNetwork();
      subscription.remove();
      clearInterval(timer);
    };
  }, [userId]);

  return null;
};

/** Aviso flotante: sin conexión, y de cuándo son los datos guardados que se están mostrando */
export const OfflineBanner = () => {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const online = useIsOnline();
  const [copy, setCopy] = useState<{ savedAt: string; seenAt: number } | null>(null);

  useEffect(() => onOffline('copy', (savedAt) => setCopy({ savedAt: String(savedAt), seenAt: Date.now() })), []);
  useEffect(() => {
    // Con red y sin copias nuevas en 20 s, el aviso de "datos guardados" desaparece
    if (!online || !copy) return;
    const timer = setTimeout(() => setCopy(null), Math.max(0, 20_000 - (Date.now() - copy.seenAt)));
    return () => clearTimeout(timer);
  }, [online, copy]);

  if (online && !copy) return null;

  return (
    <View pointerEvents="none" style={[styles.wrap, { bottom: insets.bottom + 68 }]} testID="offline-banner">
      <View style={styles.banner}>
        <Ionicons name="cloud-offline-outline" size={16} color={Colors.textWhite} />
        <Text style={styles.text}>
          {online ? t('offline.serverUnreachable') : t('offline.noConnection')}
          {copy ? ` · ${t('offline.showingCopy', { date: formatSavedAt(copy.savedAt, i18n.language) })}` : ''}
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 12,
    right: 12,
    alignItems: 'center',
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(15, 23, 42, 0.88)',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  text: {
    color: Colors.textWhite,
    fontSize: 12,
    fontWeight: '600',
    flexShrink: 1,
  },
});

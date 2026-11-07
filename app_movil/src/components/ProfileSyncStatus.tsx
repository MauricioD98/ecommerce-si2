import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Colors } from '../theme/colors';
import type { useProfileSync } from '../offline/profileSync';
import type { ProfileField } from '../offline/offlineCore';
import { formatSavedAt } from '../offline/format';

type Sync = ReturnType<typeof useProfileSync>;

const SYNCED_VISIBLE_MS = 10 * 60_000;

const show = (value: string | null | undefined) => (value === null || value === undefined || value === '' ? '—' : value);

/** Estado del cambio de perfil hecho sin conexión, con la revisión de conflictos y errores */
export const ProfileSyncStatus: React.FC<{ sync: Sync; showOfflineHint?: boolean }> = ({ sync, showOfflineHint }) => {
  const { t, i18n } = useTranslation();
  const { change, isOnline, syncing } = sync;
  const fieldName = (field: string) => t(`offline.fields.${field}`, { defaultValue: field });

  if (!change || (change.status === 'synced' && Date.now() - new Date(change.syncedAt ?? 0).getTime() > SYNCED_VISIBLE_MS)) {
    if (!isOnline && showOfflineHint) {
      return (
        <View style={[styles.box, styles.neutral]} testID="profile-sync-status" accessibilityLabel="offline">
          <Row icon="cloud-offline-outline" color={Colors.textSecondary} title={t('offline.noConnection')} />
          <Text style={styles.body}>{t('offline.profile.offlineHint')}</Text>
        </View>
      );
    }
    return null;
  }

  const status = syncing || change.status === 'syncing' ? 'syncing' : change.status;
  const fields = Object.keys(change.changes).map(fieldName).join(', ');

  return (
    <View style={[styles.box, BOX[status]]} testID="profile-sync-status" accessibilityLabel={status}>
      {status === 'syncing' && (
        <View style={styles.row}>
          <ActivityIndicator size="small" color={Colors.info} />
          <Text style={[styles.title, { color: Colors.info }]}>{t('offline.profile.status.syncing')}</Text>
        </View>
      )}
      {status === 'pending' && (
        <>
          <Row icon="time-outline" color={Colors.warning} title={t('offline.profile.status.pending')} />
          <Text style={styles.body}>
            {fields} · {isOnline ? t('offline.profile.willSyncSoon') : t('offline.profile.willSyncOnline')}
          </Text>
          {isOnline && <Action label={t('offline.profile.syncNow')} onPress={sync.syncNow} />}
        </>
      )}
      {status === 'synced' && (
        <Row
          icon="checkmark-circle-outline"
          color={Colors.success}
          title={`${t('offline.profile.status.synced')}${change.syncedAt ? ` · ${formatSavedAt(change.syncedAt, i18n.language)}` : ''}`}
        />
      )}
      {status === 'needs-login' && (
        <>
          <Row icon="log-in-outline" color={Colors.warning} title={t('offline.profile.status.needs-login')} />
          <Text style={styles.body}>{t('offline.profile.needsLogin')}</Text>
        </>
      )}
      {status === 'error' && (
        <>
          <Row icon="alert-circle-outline" color={Colors.error} title={t('offline.profile.status.error')} />
          <Text style={styles.body}>{change.lastError}</Text>
          <View style={styles.actions}>
            <Action label={t('offline.profile.retry')} onPress={() => void sync.retry()} disabled={!isOnline} />
            <Action label={t('offline.profile.discard')} onPress={() => void sync.discard()} danger />
          </View>
        </>
      )}
      {status === 'conflict' && change.conflict && (
        <>
          <Row icon="git-compare-outline" color={Colors.error} title={t('offline.profile.status.conflict')} />
          <Text style={styles.body}>{t('offline.profile.conflictDescription')}</Text>
          <View style={styles.table}>
            <View style={styles.tr}>
              <Text style={[styles.th, styles.cellField]}>{t('offline.profile.field')}</Text>
              <Text style={styles.th}>{t('offline.profile.yourChange')}</Text>
              <Text style={styles.th}>{t('offline.profile.serverValue')}</Text>
            </View>
            {change.conflict.fields.map((field: ProfileField) => (
              <View key={field} style={styles.tr} testID={`conflict-${field}`}>
                <Text style={[styles.td, styles.cellField]}>{fieldName(field)}</Text>
                <Text style={styles.td}>{show(change.changes[field])}</Text>
                <Text style={styles.td}>{show(change.conflict!.server[field])}</Text>
              </View>
            ))}
          </View>
          <View style={styles.actions}>
            <Action label={t('offline.profile.keepMine')} onPress={() => void sync.resolveConflict('mine')} disabled={!isOnline} />
            <Action label={t('offline.profile.keepServer')} onPress={() => void sync.resolveConflict('server')} />
          </View>
        </>
      )}
    </View>
  );
};

const Row: React.FC<{ icon: keyof typeof Ionicons.glyphMap; color: string; title: string }> = ({ icon, color, title }) => (
  <View style={styles.row}>
    <Ionicons name={icon} size={18} color={color} />
    <Text style={[styles.title, { color }]}>{title}</Text>
  </View>
);

const Action: React.FC<{ label: string; onPress: () => void; disabled?: boolean; danger?: boolean }> = ({ label, onPress, disabled, danger }) => (
  <TouchableOpacity
    onPress={onPress}
    disabled={disabled}
    style={[styles.action, danger && styles.actionDanger, disabled && { opacity: 0.45 }]}
    accessibilityRole="button"
  >
    <Text style={[styles.actionText, danger && { color: Colors.error }]}>{label}</Text>
  </TouchableOpacity>
);

const BOX = {
  pending: { backgroundColor: Colors.warningLight, borderColor: '#FDE68A' },
  syncing: { backgroundColor: Colors.infoLight, borderColor: '#BFDBFE' },
  synced: { backgroundColor: Colors.successLight, borderColor: '#A7F3D0' },
  conflict: { backgroundColor: Colors.errorLight, borderColor: '#FECACA' },
  error: { backgroundColor: Colors.errorLight, borderColor: '#FECACA' },
  'needs-login': { backgroundColor: Colors.warningLight, borderColor: '#FDE68A' },
} as const;

const styles = StyleSheet.create({
  box: { borderRadius: 16, borderWidth: 1, padding: 14, marginBottom: 16, gap: 6 },
  neutral: { backgroundColor: Colors.surfaceSubtle, borderColor: Colors.border },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 14, fontWeight: '700', flexShrink: 1 },
  body: { fontSize: 13, color: Colors.textSecondary, lineHeight: 18 },
  table: { marginTop: 4, borderRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface },
  tr: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: Colors.border },
  th: { flex: 1, padding: 8, fontSize: 12, fontWeight: '700', color: Colors.textSecondary },
  td: { flex: 1, padding: 8, fontSize: 13, color: Colors.textPrimary },
  cellField: { flex: 0.8 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 6, flexWrap: 'wrap' },
  action: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.borderDark },
  actionDanger: { borderColor: '#FECACA' },
  actionText: { fontSize: 13, fontWeight: '700', color: Colors.primary },
});

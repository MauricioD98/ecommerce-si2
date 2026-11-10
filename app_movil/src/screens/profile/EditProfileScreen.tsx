import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import axios from 'axios';
import { useTranslation } from '../../../node_modules/react-i18next';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../navigation/types';
import { useAuth } from '../../context/AuthContext';
import { Header } from '../../components/Header';
import { Input } from '../../components/Input';
import { Button } from '../../components/Button';
import { ProfileSyncStatus } from '../../components/ProfileSyncStatus';
import { Colors, Shadows } from '../../theme/colors';
import { getErrorMessage } from '../../api/client';
import { saveProfileOffline, syncProfileNow, useProfileSync } from '../../offline/profileSync';
import { checkOnline } from '../../offline/network';

type Props = NativeStackScreenProps<RootStackParamList, 'EditProfile'>;

export const EditProfileScreen: React.FC<Props> = ({ navigation }) => {
  const { t } = useTranslation();
  const { user, updateProfile } = useAuth();
  const sync = useProfileSync(user);
  const shown = sync.displayUser;

  const [firstName, setFirstName] = useState<string>(shown?.firstName || '');
  const [lastName, setLastName] = useState<string>(shown?.lastName || '');
  const [email, setEmail] = useState<string>(user?.email || '');
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const touched = useRef(false);

  // El cambio guardado en SQLite se lee después del primer render: el formulario lo muestra si no se tocó
  useEffect(() => {
    if (touched.current) return;
    setFirstName(shown?.firstName || '');
    setLastName(shown?.lastName || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sync.change?.changeId, sync.change?.status, shown?.firstName, shown?.lastName]);

  const edit = (setter: (v: string) => void) => (value: string) => {
    touched.current = true;
    setter(value);
  };

  const unsynced = !!sync.change && sync.change.status !== 'synced';
  // El correo cambia la identidad de acceso: solo con conexión y sin cambios pendientes que ordenar antes
  const emailLocked = !sync.isOnline || unsynced;

  const saveOnDevice = async () => {
    if (!user) return;
    if (sync.change?.status === 'conflict') {
      Alert.alert(t('offline.profile.status.conflict'), t('offline.profile.resolveFirst'));
      return;
    }
    const saved = await saveProfileOffline(user, { firstName, lastName });
    if (!saved) {
      navigation.goBack();
      return;
    }
    const online = await checkOnline();
    Alert.alert(t('offline.profile.savedTitle'), online ? t('offline.profile.savedOnline') : t('offline.profile.savedOffline'), [
      { text: 'OK', onPress: () => navigation.goBack() },
    ]);
    void syncProfileNow();
  };

  const handleSave = async () => {
    if (!email.trim()) {
      Alert.alert('Error', 'El correo electrónico no puede estar vacío.');
      return;
    }
    if (!firstName.trim()) {
      Alert.alert('Error', t('offline.profile.firstNameRequired'));
      return;
    }
    const emailChanged = email.trim().toLowerCase() !== (user?.email || '').toLowerCase();

    try {
      setIsSaving(true);
      if (emailLocked) {
        if (emailChanged) {
          Alert.alert(t('offline.requiresConnectionTitle'), t('offline.profile.emailRequiresConnection'));
          return;
        }
        await saveOnDevice();
        return;
      }

      try {
        await updateProfile({
          firstName: firstName.trim() || undefined,
          lastName: lastName.trim() || undefined,
          email: email.trim().toLowerCase(),
        });
      } catch (err) {
        // Se cortó la red al guardar: nombre y apellido se guardan en el dispositivo; el correo no
        if (axios.isAxiosError(err) && !err.response && !emailChanged) {
          await saveOnDevice();
          return;
        }
        throw err;
      }
      Alert.alert('Éxito', 'Tus datos de perfil han sido actualizados.', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (err) {
      Alert.alert('Error al actualizar', getErrorMessage(err));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <Header
        title="Editar Perfil"
        showBack
        onBack={() => navigation.goBack()}
      />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <ProfileSyncStatus sync={sync} showOfflineHint />

          <View style={styles.card}>
            <Input
              label="Nombre"
              placeholder="Ingresa tu nombre"
              value={firstName}
              onChangeText={edit(setFirstName)}
              icon="person-outline"
              testID="profile-first-name"
            />

            <Input
              label="Apellido"
              placeholder="Ingresa tu apellido"
              value={lastName}
              onChangeText={edit(setLastName)}
              icon="person-outline"
              testID="profile-last-name"
            />

            <Input
              label="Correo Electrónico"
              placeholder="correo@ejemplo.com"
              value={email}
              onChangeText={edit(setEmail)}
              keyboardType="email-address"
              autoCapitalize="none"
              icon="mail-outline"
              editable={!emailLocked}
              testID="profile-email"
            />
            {emailLocked && <Text style={styles.hint}>{t('offline.profile.emailRequiresConnection')}</Text>}

            <Button
              title="Guardar Cambios"
              onPress={handleSave}
              isLoading={isSaving}
              variant="primary"
              size="lg"
              style={{ marginTop: 12 }}
              testID="profile-save"
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scrollContent: {
    padding: 16,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadows.sm,
  },
  hint: {
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: -6,
    marginBottom: 6,
  },
});

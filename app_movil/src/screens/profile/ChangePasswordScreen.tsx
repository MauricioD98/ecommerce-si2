import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../navigation/types';
import { usersApi } from '../../api/users.api';
import { Header } from '../../components/Header';
import { Input } from '../../components/Input';
import { Button } from '../../components/Button';
import { Colors, Shadows } from '../../theme/colors';
import { getErrorMessage } from '../../api/client';

type Props = NativeStackScreenProps<RootStackParamList, 'ChangePassword'>;

export const ChangePasswordScreen: React.FC<Props> = ({ navigation }) => {
  const [oldPassword, setOldPassword] = useState<string>('');
  const [newPassword, setNewPassword] = useState<string>('');
  const [confirmPassword, setConfirmPassword] = useState<string>('');
  const [isSaving, setIsSaving] = useState<boolean>(false);

  const handleChangePassword = async () => {
    if (!oldPassword || !newPassword) {
      Alert.alert('Campos requeridos', 'Por favor completa todos los campos.');
      return;
    }

    if (newPassword.length < 8) {
      Alert.alert('Contraseña débil', 'La nueva contraseña debe tener al menos 8 caracteres.');
      return;
    }

    if (newPassword !== confirmPassword) {
      Alert.alert('Error', 'La nueva contraseña y la confirmación no coinciden.');
      return;
    }

    try {
      setIsSaving(true);
      const res = await usersApi.changePassword({
        oldPassword,
        newPassword,
      });
      Alert.alert('Éxito', res.message || 'Contraseña cambiada con éxito.', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (err) {
      Alert.alert('Error', getErrorMessage(err));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <Header
        title="Cambiar Contraseña"
        showBack
        onBack={() => navigation.goBack()}
      />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <View style={styles.card}>
            <Input
              label="Contraseña Actual"
              placeholder="Ingresa tu contraseña actual"
              value={oldPassword}
              onChangeText={setOldPassword}
              isPassword
              icon="lock-closed-outline"
            />

            <Input
              label="Nueva Contraseña"
              placeholder="Mínimo 8 caracteres"
              value={newPassword}
              onChangeText={setNewPassword}
              isPassword
              icon="key-outline"
            />

            <Input
              label="Confirmar Nueva Contraseña"
              placeholder="Repite la nueva contraseña"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              isPassword
              icon="key-outline"
            />

            <Button
              title="Actualizar Contraseña"
              onPress={handleChangePassword}
              isLoading={isSaving}
              variant="primary"
              size="lg"
              style={{ marginTop: 12 }}
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
});

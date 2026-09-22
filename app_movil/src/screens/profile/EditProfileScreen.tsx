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
import { useAuth } from '../../context/AuthContext';
import { Header } from '../../components/Header';
import { Input } from '../../components/Input';
import { Button } from '../../components/Button';
import { Colors, Shadows } from '../../theme/colors';
import { getErrorMessage } from '../../api/client';

type Props = NativeStackScreenProps<RootStackParamList, 'EditProfile'>;

export const EditProfileScreen: React.FC<Props> = ({ navigation }) => {
  const { user, updateProfile } = useAuth();

  const [firstName, setFirstName] = useState<string>(user?.firstName || '');
  const [lastName, setLastName] = useState<string>(user?.lastName || '');
  const [email, setEmail] = useState<string>(user?.email || '');
  const [isSaving, setIsSaving] = useState<boolean>(false);

  const handleSave = async () => {
    if (!email.trim()) {
      Alert.alert('Error', 'El correo electrónico no puede estar vacío.');
      return;
    }

    try {
      setIsSaving(true);
      await updateProfile({
        firstName: firstName.trim() || undefined,
        lastName: lastName.trim() || undefined,
        email: email.trim().toLowerCase(),
      });
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
          <View style={styles.card}>
            <Input
              label="Nombre"
              placeholder="Ingresa tu nombre"
              value={firstName}
              onChangeText={setFirstName}
              icon="person-outline"
            />

            <Input
              label="Apellido"
              placeholder="Ingresa tu apellido"
              value={lastName}
              onChangeText={setLastName}
              icon="person-outline"
            />

            <Input
              label="Correo Electrónico"
              placeholder="correo@ejemplo.com"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              icon="mail-outline"
            />

            <Button
              title="Guardar Cambios"
              onPress={handleSave}
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

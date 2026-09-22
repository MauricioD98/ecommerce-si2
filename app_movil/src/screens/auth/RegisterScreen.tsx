import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AuthStackParamList } from '../../navigation/types';
import { useAuth } from '../../context/AuthContext';
import { Input } from '../../components/Input';
import { Button } from '../../components/Button';
import { Colors, Shadows } from '../../theme/colors';
import { getErrorMessage } from '../../api/client';

type Props = NativeStackScreenProps<AuthStackParamList, 'Register'>;

export const RegisterScreen: React.FC<Props> = ({ navigation }) => {
  const { register } = useAuth();
  const [firstName, setFirstName] = useState<string>('');
  const [lastName, setLastName] = useState<string>('');
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [confirmPassword, setConfirmPassword] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  const validatePassword = (pass: string) => {
    // Min 8 chars, 1 uppercase, 1 lowercase, 1 digit, 1 special char
    const regex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
    return regex.test(pass);
  };

  const handleRegister = async () => {
    if (!email.trim() || !password) {
      setError('El correo y la contraseña son obligatorios.');
      return;
    }

    if (!validatePassword(password)) {
      setError(
        'La contraseña debe tener al menos 8 caracteres, una mayúscula, una minúscula, un número y un símbolo (@$!%*?&).'
      );
      return;
    }

    if (password !== confirmPassword) {
      setError('Las contraseñas no coinciden.');
      return;
    }

    setError('');
    setIsLoading(true);

    try {
      await register({
        email: email.trim().toLowerCase(),
        password,
        firstName: firstName.trim() || undefined,
        lastName: lastName.trim() || undefined,
      });
      // AuthContext will automatically update user & token
    } catch (err) {
      const msg = getErrorMessage(err);
      setError(msg);
      Alert.alert('Error de Registro', msg);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.keyboardView}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Ionicons name="arrow-back" size={24} color={Colors.textPrimary} />
        </TouchableOpacity>

        <View style={styles.headerBox}>
          <Text style={styles.title}>Crear Cuenta</Text>
          <Text style={styles.subtitle}>
            Regístrate para comprar y seguir tus pedidos
          </Text>
        </View>

        <View style={styles.formCard}>
          {error ? (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle" size={18} color={Colors.error} />
              <Text style={styles.errorMessage}>{error}</Text>
            </View>
          ) : null}

          <View style={styles.row}>
            <View style={styles.col}>
              <Input
                label="Nombre"
                placeholder="Ej. Juan"
                value={firstName}
                onChangeText={setFirstName}
                icon="person-outline"
              />
            </View>
            <View style={styles.col}>
              <Input
                label="Apellido"
                placeholder="Ej. Pérez"
                value={lastName}
                onChangeText={setLastName}
                icon="person-outline"
              />
            </View>
          </View>

          <Input
            label="Correo Electrónico"
            placeholder="juan.perez@correo.com"
            value={email}
            onChangeText={(text) => {
              setEmail(text);
              setError('');
            }}
            autoCapitalize="none"
            keyboardType="email-address"
            icon="mail-outline"
          />

          <Input
            label="Contraseña"
            placeholder="Min. 8 carácteres, mayús, num y @"
            value={password}
            onChangeText={(text) => {
              setPassword(text);
              setError('');
            }}
            isPassword
            icon="lock-closed-outline"
          />

          <Input
            label="Confirmar Contraseña"
            placeholder="Repite tu contraseña"
            value={confirmPassword}
            onChangeText={(text) => {
              setConfirmPassword(text);
              setError('');
            }}
            isPassword
            icon="lock-closed-outline"
          />

          <View style={styles.passwordHintBox}>
            <Ionicons name="information-circle-outline" size={16} color={Colors.info} />
            <Text style={styles.passwordHintText}>
              Debe contener: 8+ carácteres, mayúscula, minúscula, número y símbolo (@$!%*?&).
            </Text>
          </View>

          <Button
            title="Crear Mi Cuenta"
            onPress={handleRegister}
            isLoading={isLoading}
            variant="primary"
            size="lg"
            style={styles.registerButton}
          />

          <View style={styles.loginPrompt}>
            <Text style={styles.loginPromptText}>¿Ya tienes cuenta? </Text>
            <TouchableOpacity onPress={() => navigation.navigate('Login')}>
              <Text style={styles.loginLink}>Inicia sesión</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  keyboardView: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingVertical: 24,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    ...Shadows.sm,
  },
  headerBox: {
    marginBottom: 20,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  subtitle: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginTop: 4,
  },
  formCard: {
    backgroundColor: Colors.surface,
    borderRadius: 20,
    padding: 20,
    ...Shadows.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  col: {
    flex: 1,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.errorLight,
    padding: 12,
    borderRadius: 10,
    marginBottom: 16,
    gap: 8,
  },
  errorMessage: {
    flex: 1,
    color: Colors.error,
    fontSize: 13,
    fontWeight: '500',
  },
  passwordHintBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.infoLight,
    padding: 10,
    borderRadius: 8,
    marginBottom: 16,
    gap: 6,
  },
  passwordHintText: {
    flex: 1,
    fontSize: 11,
    color: Colors.info,
    fontWeight: '500',
  },
  registerButton: {
    marginTop: 8,
  },
  loginPrompt: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 20,
  },
  loginPromptText: {
    fontSize: 14,
    color: Colors.textSecondary,
  },
  loginLink: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.primary,
  },
});

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AuthStackParamList } from '../../navigation/types';
import { useAuth } from '../../context/AuthContext';
import { Input } from '../../components/Input';
import { Button } from '../../components/Button';
import { Colors, Shadows } from '../../theme/colors';
import { getErrorMessage } from '../../api/client';
import {
  getApiBaseUrl,
  setCustomApiBaseUrl,
  resetApiBaseUrl,
} from '../../config/env';

type Props = NativeStackScreenProps<AuthStackParamList, 'Login'>;

export const LoginScreen: React.FC<Props> = ({ navigation }) => {
  const { login } = useAuth();
  const [email, setEmail] = useState<string>('admin@gmail.com');
  const [password, setPassword] = useState<string>('Admin123*');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  // API Config Modal state
  const [showConfigModal, setShowConfigModal] = useState<boolean>(false);
  const [apiUrlInput, setApiUrlInput] = useState<string>('');
  const [currentUrlDisplay, setCurrentUrlDisplay] = useState<string>('');

  useEffect(() => {
    getApiBaseUrl().then((url) => {
      setApiUrlInput(url);
      setCurrentUrlDisplay(url);
    });
  }, []);

  const handleLogin = async () => {
    if (!email.trim() || !password.trim()) {
      setError('Por favor ingresa tu correo y contraseña');
      return;
    }
    setError('');
    setIsLoading(true);
    try {
      await login({ email: email.trim(), password });
    } catch (err) {
      const msg = getErrorMessage(err);
      setError(msg);
      Alert.alert('Error de Inicio de Sesión', msg);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveApiUrl = async () => {
    if (!apiUrlInput.trim()) return;
    await setCustomApiBaseUrl(apiUrlInput.trim());
    const updated = await getApiBaseUrl();
    setCurrentUrlDisplay(updated);
    setShowConfigModal(false);
    Alert.alert('URL Actualizada', `Conectando con: ${updated}`);
  };

  const handleResetApiUrl = async () => {
    const def = await resetApiBaseUrl();
    setApiUrlInput(def);
    setCurrentUrlDisplay(def);
    setShowConfigModal(false);
    Alert.alert('URL Restaurada', `URL por defecto: ${def}`);
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
        <View style={styles.topActionsBar}>
          <TouchableOpacity
            style={styles.settingsBtn}
            onPress={() => {
              getApiBaseUrl().then((url) => {
                setApiUrlInput(url);
                setCurrentUrlDisplay(url);
                setShowConfigModal(true);
              });
            }}
          >
            <Ionicons name="settings-outline" size={22} color={Colors.textSecondary} />
          </TouchableOpacity>
        </View>

        <View style={styles.headerBox}>
          <View style={styles.logoBadge}>
            <Ionicons name="bag-handle" size={40} color={Colors.primary} />
          </View>
          <Text style={styles.appTitle}>E-Commerce Móvil</Text>
          <Text style={styles.subtitle}>Inicia sesión para gestionar tus compras</Text>
        </View>

        {/* Existing Neon DB Users Quick-Fill */}
        <View style={styles.quickFillContainer}>
          <Text style={styles.quickFillTitle}>⚡ Acceso Rápido (Base de Datos Neon):</Text>
          <View style={styles.quickButtonsRow}>
            <TouchableOpacity
              style={styles.quickBtn}
              onPress={() => {
                setEmail('admin@gmail.com');
                setPassword('Admin123*');
              }}
            >
              <Ionicons name="shield-checkmark" size={14} color={Colors.primary} />
              <Text style={styles.quickBtnText}>admin@gmail.com</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.quickBtn}
              onPress={() => {
                setEmail('john.doe@example.com');
                setPassword('StrongP@ssw0rd!');
              }}
            >
              <Ionicons name="person" size={14} color={Colors.secondary} />
              <Text style={styles.quickBtnText}>john.doe@example.com</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.formCard}>
          {error ? (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle" size={18} color={Colors.error} />
              <Text style={styles.errorMessage}>{error}</Text>
            </View>
          ) : null}

          <Input
            label="Correo Electrónico"
            placeholder="ejemplo@correo.com"
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
            placeholder="Ingresa tu contraseña"
            value={password}
            onChangeText={(text) => {
              setPassword(text);
              setError('');
            }}
            isPassword
            icon="lock-closed-outline"
          />

          <Button
            title="Iniciar Sesión"
            onPress={handleLogin}
            isLoading={isLoading}
            variant="primary"
            size="lg"
            style={styles.loginButton}
          />

          <View style={styles.registerPrompt}>
            <Text style={styles.registerPromptText}>¿No tienes una cuenta? </Text>
            <TouchableOpacity onPress={() => navigation.navigate('Register')}>
              <Text style={styles.registerLink}>Regístrate aquí</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* API Host Config trigger */}
        <TouchableOpacity
          style={styles.apiConfigTrigger}
          onPress={() => setShowConfigModal(true)}
        >
          <Ionicons name="server-outline" size={14} color={Colors.textMuted} />
          <Text style={styles.apiConfigTriggerText}>
            Servidor: {currentUrlDisplay}
          </Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Modal for setting custom API URL */}
      <Modal
        visible={showConfigModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowConfigModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Ionicons name="settings-outline" size={22} color={Colors.primary} />
              <Text style={styles.modalTitle}>Configurar Servidor API</Text>
            </View>
            <Text style={styles.modalDesc}>
              Ajusta la URL base si estás probando desde un emulador Android (10.0.2.2:3001) o celular físico en la red local.
            </Text>

            <Input
              label="URL Base de la API"
              value={apiUrlInput}
              onChangeText={setApiUrlInput}
              placeholder="http://192.168.100.240:3001/api/v1"
              autoCapitalize="none"
            />

            <TouchableOpacity
              style={styles.presetIpBtn}
              onPress={() => setApiUrlInput('http://192.168.100.240:3001/api/v1')}
            >
              <Ionicons name="wifi-outline" size={16} color={Colors.primary} />
              <Text style={styles.presetIpText}>
                Fijar IP de mi PC: 192.168.100.240:3001
              </Text>
            </TouchableOpacity>

            <View style={styles.modalButtonsRow}>
              <Button
                title="Restaurar"
                onPress={handleResetApiUrl}
                variant="outline"
                size="sm"
                style={styles.modalBtn}
              />
              <Button
                title="Guardar"
                onPress={handleSaveApiUrl}
                variant="primary"
                size="sm"
                style={styles.modalBtn}
              />
            </View>

            <Button
              title="Cerrar"
              onPress={() => setShowConfigModal(false)}
              variant="ghost"
              size="sm"
              style={{ marginTop: 8 }}
            />
          </View>
        </View>
      </Modal>
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
    paddingVertical: 20,
    justifyContent: 'center',
  },
  topActionsBar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: 8,
  },
  settingsBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadows.sm,
  },
  headerBox: {
    alignItems: 'center',
    marginBottom: 24,
  },
  logoBadge: {
    width: 80,
    height: 80,
    borderRadius: 24,
    backgroundColor: Colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    ...Shadows.sm,
  },
  appTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: Colors.textPrimary,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginTop: 6,
    textAlign: 'center',
  },
  quickFillContainer: {
    backgroundColor: Colors.surfaceSubtle,
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  quickFillTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.textSecondary,
    marginBottom: 8,
  },
  quickButtonsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  quickBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 6,
  },
  quickBtnText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  formCard: {
    backgroundColor: Colors.surface,
    borderRadius: 20,
    padding: 20,
    ...Shadows.md,
    borderWidth: 1,
    borderColor: Colors.border,
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
  loginButton: {
    marginTop: 8,
  },
  registerPrompt: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 20,
  },
  registerPromptText: {
    fontSize: 14,
    color: Colors.textSecondary,
  },
  registerLink: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.primary,
  },
  apiConfigTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 24,
    gap: 6,
  },
  apiConfigTriggerText: {
    fontSize: 11,
    color: Colors.textMuted,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    width: '100%',
    backgroundColor: Colors.surface,
    borderRadius: 20,
    padding: 20,
    ...Shadows.lg,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  modalDesc: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginBottom: 16,
    lineHeight: 18,
  },
  modalButtonsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 10,
  },
  modalBtn: {
    flex: 1,
  },
  presetIpBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.primaryLight,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    marginBottom: 14,
    gap: 8,
  },
  presetIpText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.primary,
  },
});

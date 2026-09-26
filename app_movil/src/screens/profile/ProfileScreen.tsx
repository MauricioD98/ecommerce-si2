import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  TouchableOpacity,
  Alert,
  Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../navigation/types';
import { useAuth } from '../../context/AuthContext';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { Colors, Shadows } from '../../theme/colors';
import {
  getApiBaseUrl,
  setCustomApiBaseUrl,
  resetApiBaseUrl,
  CLOUD_API_URL,
  LOCAL_DEV_API_URL,
} from '../../config/env';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

export const ProfileScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const { user, logout, refreshUser } = useAuth();

  const [showConfigModal, setShowConfigModal] = useState<boolean>(false);
  const [apiUrlInput, setApiUrlInput] = useState<string>('');
  const [currentUrlDisplay, setCurrentUrlDisplay] = useState<string>('');

  useEffect(() => {
    getApiBaseUrl().then((url) => {
      setApiUrlInput(url);
      setCurrentUrlDisplay(url);
    });
  }, []);

  const handleLogout = () => {
    Alert.alert(
      'Cerrar Sesión',
      '¿Estás seguro de que deseas salir de tu cuenta?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Cerrar Sesión',
          style: 'destructive',
          onPress: async () => {
            await logout();
          },
        },
      ]
    );
  };

  const handleSaveApiUrl = async () => {
    if (!apiUrlInput.trim()) return;
    await setCustomApiBaseUrl(apiUrlInput.trim());
    const updated = await getApiBaseUrl();
    setCurrentUrlDisplay(updated);
    setShowConfigModal(false);
    Alert.alert('URL Guardada', `Conectando con: ${updated}`);
  };

  const handleResetApiUrl = async () => {
    const def = await resetApiBaseUrl();
    setApiUrlInput(def);
    setCurrentUrlDisplay(def);
    setShowConfigModal(false);
    Alert.alert('URL Restaurada', `URL por defecto: ${def}`);
  };

  const initials =
    ((user?.firstName?.[0] || '') + (user?.lastName?.[0] || '')) ||
    user?.email?.[0]?.toUpperCase() ||
    'U';

  const fullName =
    user?.firstName || user?.lastName
      ? `${user.firstName || ''} ${user.lastName || ''}`.trim()
      : 'Usuario';

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Profile Card */}
        <View style={styles.profileCard}>
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarInitials}>{initials}</Text>
          </View>

          <Text style={styles.userName}>{fullName}</Text>
          <Text style={styles.userEmail}>{user?.email}</Text>

          {(() => {
            const roleName =
              typeof user?.role === 'object' && user?.role !== null
                ? (user.role as any).name
                : typeof user?.role === 'string'
                ? user.role
                : 'CLIENTE';
            const isAdmin =
              roleName === 'ADMIN' ||
              roleName === 'Super Admin' ||
              roleName === 'Admin Sucursal';
            return (
              <View style={styles.roleBadge}>
                <Ionicons
                  name={isAdmin ? 'shield-checkmark' : 'person'}
                  size={14}
                  color={Colors.primary}
                />
                <Text style={styles.roleText}>{roleName || 'CLIENTE'}</Text>
              </View>
            );
          })()}
        </View>

        {/* Menu Items */}
        <View style={styles.menuCard}>
          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => navigation.navigate('EditProfile')}
            activeOpacity={0.7}
          >
            <View style={[styles.menuIconBox, { backgroundColor: Colors.primaryLight }]}>
              <Ionicons name="person-outline" size={20} color={Colors.primary} />
            </View>
            <View style={styles.menuTextContainer}>
              <Text style={styles.menuTitle}>Editar Perfil</Text>
              <Text style={styles.menuDesc}>Nombre, apellido y correo</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
          </TouchableOpacity>

          <View style={styles.menuDivider} />

          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => navigation.navigate('ChangePassword')}
            activeOpacity={0.7}
          >
            <View style={[styles.menuIconBox, { backgroundColor: '#FEF3C7' }]}>
              <Ionicons name="lock-closed-outline" size={20} color="#D97706" />
            </View>
            <View style={styles.menuTextContainer}>
              <Text style={styles.menuTitle}>Seguridad y Contraseña</Text>
              <Text style={styles.menuDesc}>Actualizar contraseña</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
          </TouchableOpacity>

          <View style={styles.menuDivider} />

          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => navigation.navigate('Main', { screen: 'OrdersTab' } as any)}
            activeOpacity={0.7}
          >
            <View style={[styles.menuIconBox, { backgroundColor: '#F3E8FF' }]}>
              <Ionicons name="receipt-outline" size={20} color="#8B5CF6" />
            </View>
            <View style={styles.menuTextContainer}>
              <Text style={styles.menuTitle}>Mis Pedidos</Text>
              <Text style={styles.menuDesc}>Historial y seguimiento de compras</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
          </TouchableOpacity>

          <View style={styles.menuDivider} />

          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => setShowConfigModal(true)}
            activeOpacity={0.7}
          >
            <View style={[styles.menuIconBox, { backgroundColor: Colors.surfaceSubtle }]}>
              <Ionicons name="server-outline" size={20} color={Colors.textSecondary} />
            </View>
            <View style={styles.menuTextContainer}>
              <Text style={styles.menuTitle}>Servidor API</Text>
              <Text style={styles.menuDesc} numberOfLines={1}>
                {currentUrlDisplay}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
          </TouchableOpacity>
        </View>

        {/* Logout Button */}
        <Button
          title="Cerrar Sesión"
          onPress={handleLogout}
          variant="outline"
          size="lg"
          style={styles.logoutBtn}
          textStyle={{ color: Colors.error }}
          icon={<Ionicons name="log-out-outline" size={20} color={Colors.error} />}
        />
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
              Conéctate a la API en la nube (Azure) o ajusta la URL para desarrollo local.
            </Text>

            <Input
              label="URL Base de la API"
              value={apiUrlInput}
              onChangeText={setApiUrlInput}
              placeholder={CLOUD_API_URL}
              autoCapitalize="none"
            />

            <TouchableOpacity
              style={styles.presetIpBtn}
              onPress={() => setApiUrlInput(CLOUD_API_URL)}
            >
              <Ionicons name="cloud-outline" size={16} color={Colors.primary} />
              <Text style={styles.presetIpText}>
                Servidor en la Nube (Azure Producción)
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.presetIpBtn, { marginTop: 6, marginBottom: 12 }]}
              onPress={() => setApiUrlInput(LOCAL_DEV_API_URL)}
            >
              <Ionicons name="laptop-outline" size={16} color={Colors.textSecondary} />
              <Text style={[styles.presetIpText, { color: Colors.textSecondary }]}>
                Servidor Local (PC): 192.168.100.240:3001
              </Text>
            </TouchableOpacity>

            <View style={styles.modalButtonsRow}>
              <Button
                title="Restaurar"
                onPress={handleResetApiUrl}
                variant="outline"
                size="sm"
                style={{ flex: 1 }}
              />
              <Button
                title="Guardar"
                onPress={handleSaveApiUrl}
                variant="primary"
                size="sm"
                style={{ flex: 1 }}
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
    paddingBottom: 40,
  },
  profileCard: {
    backgroundColor: Colors.surface,
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadows.sm,
  },
  avatarCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  avatarInitials: {
    fontSize: 28,
    fontWeight: '800',
    color: Colors.textWhite,
  },
  userName: {
    fontSize: 20,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  userEmail: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginTop: 4,
    marginBottom: 12,
  },
  roleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.primaryLight,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
    gap: 6,
  },
  roleText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.primary,
  },
  menuCard: {
    backgroundColor: Colors.surface,
    borderRadius: 20,
    paddingVertical: 6,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadows.sm,
  },
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
  menuDivider: {
    height: 1,
    backgroundColor: Colors.border,
    marginLeft: 70,
  },
  logoutBtn: {
    borderColor: Colors.error,
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
    gap: 10,
    marginTop: 10,
  },
  presetIpBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: Colors.primaryLight,
    borderRadius: 10,
  },
  presetIpText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.primary,
  },
});

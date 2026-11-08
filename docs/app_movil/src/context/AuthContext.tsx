import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { appStorage } from '../utils/storage';
import { User, LoginPayload, RegisterPayload, UpdateUserPayload } from '../types';
import { authApi } from '../api/auth.api';
import { usersApi } from '../api/users.api';
import { ACCESS_TOKEN_KEY, REFRESH_TOKEN_KEY, USER_DATA_KEY, setOnAuthFailureCallback } from '../api/client';
import { clearOfflineUserData, resumeAfterLogin, saveProfileSnapshot } from '../offline/profileSync';
import { isTokenExpired } from '../offline/offlineCore';
import { onOffline } from '../offline/events';

interface AuthContextType {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (payload: LoginPayload) => Promise<void>;
  register: (payload: RegisterPayload) => Promise<void>;
  logout: () => Promise<void>;
  updateProfile: (payload: UpdateUserPayload) => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const userRef = useRef<User | null>(null);
  userRef.current = user;

  // Escuchar fallos de autenticación (401 sin refresh posible) desde apiClient para resetear la sesión
  useEffect(() => {
    setOnAuthFailureCallback(() => {
      // Sesión perdida: fuera los datos privados guardados (los cambios de perfil sin enviar se conservan)
      void clearOfflineUserData(userRef.current?.id);
      setToken(null);
      setUser(null);
    });
    return () => {
      setOnAuthFailureCallback(null);
    };
  }, []);

  // El servidor confirmó (o rechazó por conflicto) un cambio de perfil hecho sin conexión: se muestra su versión
  useEffect(
    () =>
      onOffline('server-profile', (payload) => {
        const server = payload as Partial<User> | undefined;
        const current = userRef.current;
        if (!server?.id || !current || current.id !== server.id) return;
        const merged = { ...current, ...server } as User;
        setUser(merged);
        void appStorage.setItem(USER_DATA_KEY, JSON.stringify(merged));
      }),
    []
  );

  // Restore session from AsyncStorage
  const loadStoredSession = useCallback(async () => {
    try {
      setIsLoading(true);
      const [storedToken, storedRefreshToken, storedUser] = await Promise.all([
        appStorage.getItem(ACCESS_TOKEN_KEY),
        appStorage.getItem(REFRESH_TOKEN_KEY),
        appStorage.getItem(USER_DATA_KEY),
      ]);

      // Si falta el token de acceso o el de refresco, o el de refresco ya venció (la sesión no se puede
      // renovar), no es válida: limpiar y pedir login. Sin esto, sin conexión se abrirían datos guardados
      // de una sesión muerta.
      if (!storedToken || !storedRefreshToken || isTokenExpired(storedRefreshToken)) {
        if (storedRefreshToken && isTokenExpired(storedRefreshToken)) {
          let storedId: string | undefined;
          try {
            storedId = storedUser ? (JSON.parse(storedUser) as User).id : undefined;
          } catch {
            storedId = undefined;
          }
          await clearOfflineUserData(storedId);
        }
        await Promise.all([
          appStorage.removeItem(ACCESS_TOKEN_KEY),
          appStorage.removeItem(REFRESH_TOKEN_KEY),
          appStorage.removeItem(USER_DATA_KEY),
        ]);
        setToken(null);
        setUser(null);
        return;
      }

      if (storedToken && storedUser) {
        setToken(storedToken);
        setUser(JSON.parse(storedUser));
        // Verify token in background
        try {
          const profile = await usersApi.getProfile();
          setUser(profile);
          await appStorage.setItem(USER_DATA_KEY, JSON.stringify(profile));
          await saveProfileSnapshot(profile);
        } catch (profileErr: any) {
          if (profileErr?.response?.status === 401) {
            await Promise.all([
              appStorage.removeItem(ACCESS_TOKEN_KEY),
              appStorage.removeItem(REFRESH_TOKEN_KEY),
              appStorage.removeItem(USER_DATA_KEY),
            ]);
            setToken(null);
            setUser(null);
          }
        }
      }
    } catch {
      // Clear on error
      await Promise.all([
        appStorage.removeItem(ACCESS_TOKEN_KEY),
        appStorage.removeItem(REFRESH_TOKEN_KEY),
        appStorage.removeItem(USER_DATA_KEY),
      ]);
      setToken(null);
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStoredSession();
  }, [loadStoredSession]);

  const login = async (payload: LoginPayload) => {
    const data = await authApi.login(payload);
    await appStorage.setItem(ACCESS_TOKEN_KEY, data.accessToken);
    await appStorage.setItem(REFRESH_TOKEN_KEY, data.refreshToken);
    await appStorage.setItem(USER_DATA_KEY, JSON.stringify(data.user));
    await saveProfileSnapshot(data.user);

    setToken(data.accessToken);
    setUser(data.user);
    // Cambios de perfil que esta misma cuenta dejó sin enviar (p. ej. la sesión venció sin conexión)
    void resumeAfterLogin(data.user.id);
  };

  const register = async (payload: RegisterPayload) => {
    const data = await authApi.register(payload);
    await appStorage.setItem(ACCESS_TOKEN_KEY, data.accessToken);
    await appStorage.setItem(REFRESH_TOKEN_KEY, data.refreshToken);
    await appStorage.setItem(USER_DATA_KEY, JSON.stringify(data.user));
    await saveProfileSnapshot(data.user);

    setToken(data.accessToken);
    setUser(data.user);
    // Cambios de perfil que esta misma cuenta dejó sin enviar (p. ej. la sesión venció sin conexión)
    void resumeAfterLogin(data.user.id);
  };

  const logout = async () => {
    const userId = user?.id;
    try {
      await authApi.logout();
    } catch {
      // Ignore API logout failures (e.g. offline)
    } finally {
      await Promise.all([
        appStorage.removeItem(ACCESS_TOKEN_KEY),
        appStorage.removeItem(REFRESH_TOKEN_KEY),
        appStorage.removeItem(USER_DATA_KEY),
      ]);
      await clearOfflineUserData(userId);
      setToken(null);
      setUser(null);
    }
  };

  const updateProfile = async (payload: UpdateUserPayload) => {
    const updated = await usersApi.updateProfile(payload);
    setUser(updated);
    await appStorage.setItem(USER_DATA_KEY, JSON.stringify(updated));
    await saveProfileSnapshot(updated);
  };

  const refreshUser = async () => {
    const profile = await usersApi.getProfile();
    setUser(profile);
    await appStorage.setItem(USER_DATA_KEY, JSON.stringify(profile));
    await saveProfileSnapshot(profile);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isLoading,
        isAuthenticated: !!token && !!user,
        login,
        register,
        logout,
        updateProfile,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

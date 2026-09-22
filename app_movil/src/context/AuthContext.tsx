import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { appStorage } from '../utils/storage';
import { User, LoginPayload, RegisterPayload, UpdateUserPayload } from '../types';
import { authApi } from '../api/auth.api';
import { usersApi } from '../api/users.api';
import { ACCESS_TOKEN_KEY, REFRESH_TOKEN_KEY, USER_DATA_KEY } from '../api/client';

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

  // Restore session from AsyncStorage
  const loadStoredSession = useCallback(async () => {
    try {
      setIsLoading(true);
      const [storedToken, storedUser] = await Promise.all([
        appStorage.getItem(ACCESS_TOKEN_KEY),
        appStorage.getItem(USER_DATA_KEY),
      ]);

      if (storedToken && storedUser) {
        setToken(storedToken);
        setUser(JSON.parse(storedUser));
        // Verify token in background
        try {
          const profile = await usersApi.getProfile();
          setUser(profile);
          await appStorage.setItem(USER_DATA_KEY, JSON.stringify(profile));
        } catch {
          // Token might still be refreshed by interceptor on next call
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

    setToken(data.accessToken);
    setUser(data.user);
  };

  const register = async (payload: RegisterPayload) => {
    const data = await authApi.register(payload);
    await appStorage.setItem(ACCESS_TOKEN_KEY, data.accessToken);
    await appStorage.setItem(REFRESH_TOKEN_KEY, data.refreshToken);
    await appStorage.setItem(USER_DATA_KEY, JSON.stringify(data.user));

    setToken(data.accessToken);
    setUser(data.user);
  };

  const logout = async () => {
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
      setToken(null);
      setUser(null);
    }
  };

  const updateProfile = async (payload: UpdateUserPayload) => {
    const updated = await usersApi.updateProfile(payload);
    setUser(updated);
    await appStorage.setItem(USER_DATA_KEY, JSON.stringify(updated));
  };

  const refreshUser = async () => {
    const profile = await usersApi.getProfile();
    setUser(profile);
    await appStorage.setItem(USER_DATA_KEY, JSON.stringify(profile));
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

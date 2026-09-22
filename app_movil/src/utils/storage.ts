import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// In-memory fallback in case native storage is unavailable
const memoryStorage: Record<string, string> = {};

export const appStorage = {
  getItem: async (key: string): Promise<string | null> => {
    // 1. Web browser fallback
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.localStorage) {
      try {
        return window.localStorage.getItem(key);
      } catch {
        return memoryStorage[key] || null;
      }
    }

    // 2. Native AsyncStorage with catch fallback
    try {
      const val = await AsyncStorage.getItem(key);
      return val !== null ? val : memoryStorage[key] || null;
    } catch {
      return memoryStorage[key] || null;
    }
  },

  setItem: async (key: string, value: string): Promise<void> => {
    memoryStorage[key] = value;

    // 1. Web browser fallback
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.localStorage) {
      try {
        window.localStorage.setItem(key, value);
        return;
      } catch {
        return;
      }
    }

    // 2. Native AsyncStorage with catch fallback
    try {
      await AsyncStorage.setItem(key, value);
    } catch {
      // In-memory fallback already set
    }
  },

  removeItem: async (key: string): Promise<void> => {
    delete memoryStorage[key];

    // 1. Web browser fallback
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.localStorage) {
      try {
        window.localStorage.removeItem(key);
        return;
      } catch {
        return;
      }
    }

    // 2. Native AsyncStorage with catch fallback
    try {
      await AsyncStorage.removeItem(key);
    } catch {
      // In-memory fallback already cleared
    }
  },
};

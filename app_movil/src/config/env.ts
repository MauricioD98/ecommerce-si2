import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { appStorage } from '../utils/storage';

const STORAGE_API_URL_KEY = '@custom_api_url';

export const getDefaultApiBaseUrl = (): string => {
  // 1. Try to auto-detect the host machine IP from Expo Go / Metro connection
  const hostUri =
    Constants.expoConfig?.hostUri ||
    (Constants as any).manifest2?.extra?.expoGo?.debuggerHost ||
    (Constants as any).manifest?.debuggerHost;

  if (hostUri) {
    const host = hostUri.split(':')[0];
    if (host && host !== 'localhost' && host !== '127.0.0.1') {
      return `http://${host}:3001/api/v1`;
    }
  }

  // 2. Physical Android device fallback (your PC's local LAN IP)
  if (Platform.OS === 'android') {
    return 'http://192.168.100.240:3001/api/v1';
  }

  // 3. Web or desktop
  return 'http://localhost:3001/api/v1';
};

let currentApiUrl = getDefaultApiBaseUrl();

export const getApiBaseUrl = async (): Promise<string> => {
  try {
    const saved = await appStorage.getItem(STORAGE_API_URL_KEY);
    if (saved) {
      currentApiUrl = saved;
      return saved;
    }
  } catch {
    // fallback
  }
  currentApiUrl = getDefaultApiBaseUrl();
  return currentApiUrl;
};

export const setCustomApiBaseUrl = async (url: string): Promise<void> => {
  currentApiUrl = url.trim().replace(/\/+$/, '');
  await appStorage.setItem(STORAGE_API_URL_KEY, currentApiUrl);
};

export const resetApiBaseUrl = async (): Promise<string> => {
  currentApiUrl = getDefaultApiBaseUrl();
  await appStorage.removeItem(STORAGE_API_URL_KEY);
  return currentApiUrl;
};

export const getCurrentApiBaseUrl = (): string => currentApiUrl;

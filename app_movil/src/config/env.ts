import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { appStorage } from '../utils/storage';

const STORAGE_API_URL_KEY = '@custom_api_url';

// URL del backend desplegado en Microsoft Azure y en desarrollo local
export const CLOUD_API_URL = 'https://stella-api.wonderfulriver-db5286cd.eastus.azurecontainerapps.io/api/v1';
export const LOCAL_DEV_API_URL = 'http://192.168.100.240:3001/api/v1';

export const getDefaultApiBaseUrl = (): string => {
  if (process.env.EXPO_PUBLIC_API_URL) {
    return process.env.EXPO_PUBLIC_API_URL.trim().replace(/\/+$/, '');
  }
  const hostUri = Constants.expoConfig?.hostUri || (Constants as any).manifest2?.extra?.expoClient?.hostUri;
  if (hostUri) {
    const ip = hostUri.split(':')[0];
    if (ip && ip !== 'localhost' && ip !== '127.0.0.1') {
      return `http://${ip}:3001/api/v1`;
    }
  }
  return LOCAL_DEV_API_URL;
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


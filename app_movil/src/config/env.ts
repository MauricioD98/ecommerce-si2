import { Platform } from 'react-native';
import { appStorage } from '../utils/storage';

const STORAGE_API_URL_KEY = '@custom_api_url';

// URL del backend desplegado en Microsoft Azure
export const CLOUD_API_URL = 'https://stella-api.wonderfulriver-db5286cd.eastus.azurecontainerapps.io/api/v1';
export const LOCAL_DEV_API_URL = 'http://10.238.40.128:3001/api/v1';

export const getDefaultApiBaseUrl = (): string => {
  return CLOUD_API_URL;
};

let currentApiUrl = getDefaultApiBaseUrl();

export const getApiBaseUrl = async (): Promise<string> => {
  try {
    const saved = await appStorage.getItem(STORAGE_API_URL_KEY);
    if (saved) {
      // Si la URL guardada previamente en el dispositivo era una IP local anterior, migrar a la nube
      if (saved.includes('192.168.') || saved.includes('10.0.2.2') || saved.includes('localhost') || saved.includes(':3001')) {
        await appStorage.removeItem(STORAGE_API_URL_KEY);
        currentApiUrl = CLOUD_API_URL;
        return currentApiUrl;
      }
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


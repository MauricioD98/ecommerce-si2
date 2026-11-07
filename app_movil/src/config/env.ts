import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { appStorage } from '../utils/storage';
import { API_PREFIX, parseApiBaseUrl } from './apiUrl';

const STORAGE_API_URL_KEY = '@custom_api_url';
const LOCAL_API_PORT = 3001;

// Build de release (expo export / eas build): la URL de la API es obligatoria y debe ser pública.
export const IS_PRODUCTION_BUILD = !__DEV__;

// Expo solo sustituye EXPO_PUBLIC_* escritas así, con punto (ni process.env['...'] ni destructuring).
// Es un valor público embebido en el bundle: nunca poner secretos en variables EXPO_PUBLIC_.
const parsedEnvUrl = process.env.EXPO_PUBLIC_API_URL
  ? parseApiBaseUrl(process.env.EXPO_PUBLIC_API_URL, { production: IS_PRODUCTION_BUILD })
  : null;

// URL de EXPO_PUBLIC_API_URL ya normalizada (con /api/v1), o null si no hay una válida
export const CONFIGURED_API_URL: string | null = parsedEnvUrl?.ok ? parsedEnvUrl.url : null;

// Respaldo en ejecución de la validación de app.config.js: si un build de producción llega sin
// URL válida, no se cae a una IP de desarrollo; las peticiones fallan con este mensaje.
export const API_URL_CONFIG_ERROR: string | null = (() => {
  if (parsedEnvUrl && !parsedEnvUrl.ok) return `EXPO_PUBLIC_API_URL inválida: ${parsedEnvUrl.error}`;
  if (IS_PRODUCTION_BUILD && !parsedEnvUrl) {
    return 'Esta versión de la app se compiló sin EXPO_PUBLIC_API_URL y no sabe a qué servidor conectarse.';
  }
  return null;
})();

if (API_URL_CONFIG_ERROR) {
  console.error(`[config] ${API_URL_CONFIG_ERROR}`);
}

/**
 * API local en desarrollo (solo si no hay EXPO_PUBLIC_API_URL):
 * - Dispositivo físico con Expo Go: la IP de la PC que corre Metro (hostUri), puerto 3001.
 * - Emulador Android: 10.0.2.2 es la PC anfitriona (localhost sería el propio emulador).
 * - Simulador iOS / web: localhost.
 */
const getLocalDevApiUrl = (): string => {
  const hostUri = Constants.expoConfig?.hostUri || (Constants as any).manifest2?.extra?.expoClient?.hostUri;
  const ip = typeof hostUri === 'string' ? hostUri.split(':')[0] : '';
  if (ip && ip !== 'localhost' && ip !== '127.0.0.1') {
    return `http://${ip}:${LOCAL_API_PORT}${API_PREFIX}`;
  }
  const host = Platform.OS === 'android' ? '10.0.2.2' : 'localhost';
  return `http://${host}:${LOCAL_API_PORT}${API_PREFIX}`;
};

// Sugerencia de "servidor local" en el modal de configuración; en producción no se ofrece
export const LOCAL_DEV_API_URL: string | null = IS_PRODUCTION_BUILD ? null : getLocalDevApiUrl();

export const getDefaultApiBaseUrl = (): string => {
  if (CONFIGURED_API_URL) return CONFIGURED_API_URL;
  if (IS_PRODUCTION_BUILD) return ''; // ver API_URL_CONFIG_ERROR
  return getLocalDevApiUrl();
};

let currentApiUrl = getDefaultApiBaseUrl();

export const getApiBaseUrl = async (): Promise<string> => {
  try {
    const saved = await appStorage.getItem(STORAGE_API_URL_KEY);
    if (saved) {
      // Una URL guardada en desarrollo (IP local) no debe sobrevivir en un build de producción
      const parsed = parseApiBaseUrl(saved, { production: IS_PRODUCTION_BUILD });
      if (parsed.ok) {
        currentApiUrl = parsed.url;
        return parsed.url;
      }
      await appStorage.removeItem(STORAGE_API_URL_KEY);
    }
  } catch {
    // fallback
  }
  currentApiUrl = getDefaultApiBaseUrl();
  return currentApiUrl;
};

// Lanza un Error con el motivo si la URL no es válida (en producción: https y host público)
export const setCustomApiBaseUrl = async (url: string): Promise<void> => {
  const parsed = parseApiBaseUrl(url, { production: IS_PRODUCTION_BUILD });
  if (!parsed.ok) {
    throw new Error(`URL no válida: ${parsed.error}`);
  }
  currentApiUrl = parsed.url;
  await appStorage.setItem(STORAGE_API_URL_KEY, currentApiUrl);
};

export const resetApiBaseUrl = async (): Promise<string> => {
  currentApiUrl = getDefaultApiBaseUrl();
  await appStorage.removeItem(STORAGE_API_URL_KEY);
  return currentApiUrl;
};

export const getCurrentApiBaseUrl = (): string => currentApiUrl;

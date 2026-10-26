import axios, { AxiosError, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { appStorage } from '../utils/storage';
import { getCurrentApiBaseUrl, getApiBaseUrl } from '../config/env';
import { TENANT_HEADER, TENANT_REQUIRED, getTenantId, notifyTenantRequired } from '../config/tenant';
import { getCurrentLanguage } from '../i18n';

export const ACCESS_TOKEN_KEY = '@access_token';
export const REFRESH_TOKEN_KEY = '@refresh_token';
export const USER_DATA_KEY = '@user_data';

const apiClient = axios.create({
  baseURL: getCurrentApiBaseUrl(),
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
});

// Sync base URL dynamically
apiClient.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
  const currentBase = await getApiBaseUrl();
  config.baseURL = currentBase;

  const token = await appStorage.getItem(ACCESS_TOKEN_KEY);
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  // Idioma elegido en Perfil (o el del teléfono): la API traduce con él los errores y el
  // nombre/descripción de los productos. Se lee en cada petición para que el cambio aplique ya.
  if (config.headers) {
    config.headers['Accept-Language'] = getCurrentLanguage();
  }

  // Se resuelve en cada petición (no al crear el cliente) para que un cambio de tienda aplique
  // de inmediato. Los reintentos de la cola pasan otra vez por acá, así que también lo llevan.
  const tenantId = await getTenantId();
  if (tenantId && config.headers && !config.headers.has(TENANT_HEADER)) {
    config.headers.set(TENANT_HEADER, tenantId);
  }

  // Sin tienda no se sale a la red: el 401 caería en el refresh y en el auto-logout. /platform/*
  // es la excepción (el selector de tienda lo usa para resolver el slug).
  if (!tenantId && !config.url?.startsWith('/platform/')) {
    notifyTenantRequired();
    return Promise.reject(tenantRequiredError(config));
  }
  return config;
}, (error) => Promise.reject(error));

const isTenantRequiredError = (error: AxiosError): boolean =>
  error.response?.status === 401 &&
  (error.response.data as { code?: string } | undefined)?.code === TENANT_REQUIRED;

// Mismo shape que el 401 real del backend: getErrorMessage devuelve data.message
const tenantRequiredError = (config: InternalAxiosRequestConfig) =>
  new AxiosError('Selecciona una tienda para continuar.', 'ERR_TENANT_REQUIRED', config, undefined, {
    status: 401,
    statusText: 'Unauthorized',
    headers: {},
    config,
    data: { statusCode: 401, code: TENANT_REQUIRED, message: 'Selecciona una tienda para continuar.' },
  } as AxiosResponse);

let isRefreshing = false;
let failedQueue: Array<{
  resolve: (value?: unknown) => void;
  reject: (reason?: unknown) => void;
}> = [];

const processQueue = (error: unknown, token: string | null = null) => {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token);
    }
  });
  failedQueue = [];
};

let onAuthFailureCallback: (() => void) | null = null;

export const setOnAuthFailureCallback = (callback: (() => void) | null) => {
  onAuthFailureCallback = callback;
};

// Response interceptor for auto-refresh
apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

    // 401 por falta de tienda ≠ sesión vencida: ni refresh, ni cola, ni auto-logout (los tokens
    // siguen guardados por si la tienda vuelve a estar disponible). Se pide elegir tienda.
    if (isTenantRequiredError(error)) {
      notifyTenantRequired();
      return Promise.reject(error);
    }

    // Don't retry auth endpoints
    if (
      originalRequest?.url?.includes('/auth/login') ||
      originalRequest?.url?.includes('/auth/register') ||
      originalRequest?.url?.includes('/auth/refresh')
    ) {
      return Promise.reject(error);
    }

    if (error.response?.status === 401 && !originalRequest._retry) {
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        })
          .then((token) => {
            if (originalRequest.headers) {
              originalRequest.headers.Authorization = `Bearer ${token}`;
            }
            return apiClient(originalRequest);
          })
          .catch((err) => Promise.reject(err));
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const refreshToken = await appStorage.getItem(REFRESH_TOKEN_KEY);
        if (!refreshToken) {
          throw new Error('Tu sesión ha expirado. Por favor inicia sesión nuevamente.');
        }

        const currentBase = await getApiBaseUrl();
        // axios "limpio" (sin interceptores): el header de tienda va explícito. Sin él el backend
        // rechaza el refresh y caería al auto-logout aunque la sesión fuera válida.
        const tenantId = await getTenantId();
        const refreshResponse = await axios.post(
          `${currentBase}/auth/refresh`,
          {},
          {
            headers: {
              Authorization: `Bearer ${refreshToken}`,
              ...(tenantId ? { [TENANT_HEADER]: tenantId } : {}),
            },
          }
        );

        const { accessToken: newAccessToken, refreshToken: newRefreshToken, user } = refreshResponse.data;

        await appStorage.setItem(ACCESS_TOKEN_KEY, newAccessToken);
        if (newRefreshToken) {
          await appStorage.setItem(REFRESH_TOKEN_KEY, newRefreshToken);
        }
        if (user) {
          await appStorage.setItem(USER_DATA_KEY, JSON.stringify(user));
        }

        processQueue(null, newAccessToken);

        if (originalRequest.headers) {
          originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
        }
        return apiClient(originalRequest);
      } catch (refreshErr) {
        const friendlyErr = new Error('Tu sesión ha expirado. Por favor inicia sesión nuevamente.');
        processQueue(friendlyErr, null);
        await Promise.all([
          appStorage.removeItem(ACCESS_TOKEN_KEY),
          appStorage.removeItem(REFRESH_TOKEN_KEY),
          appStorage.removeItem(USER_DATA_KEY),
        ]);
        if (onAuthFailureCallback) {
          try {
            onAuthFailureCallback();
          } catch {
            // ignore
          }
        }
        return Promise.reject(friendlyErr);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  }
);

export const getErrorMessage = (error: unknown): string => {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data;
    if (typeof data === 'string') {
      const match = data.match(/<pre>([\s\S]*?)<\/pre>/i);
      if (match) {
        return match[1].trim();
      }
      if (data.includes('<html')) {
        return `Error del servidor (${error.response?.status || 500}).`;
      }
      return data;
    }
    if (data?.message) {
      if (Array.isArray(data.message)) {
        return data.message.join(', ');
      }
      const msgLower = String(data.message).toLowerCase();
      if (msgLower.includes('refresh') || msgLower.includes('jwt') || msgLower === 'unauthorized') {
        return 'Tu sesión ha expirado. Por favor inicia sesión nuevamente.';
      }
      return data.message;
    }
    if (error.response?.status === 401) {
      return 'Tu sesión ha expirado. Por favor inicia sesión nuevamente.';
    }
    if (error.code === 'ECONNABORTED') {
      return 'Tiempo de espera agotado. Verifica tu conexión.';
    }
    if (error.message === 'Network Error') {
      return 'No se pudo conectar con el servidor. Verifica que la API esté corriendo y la URL sea correcta.';
    }
    if (error.message?.toLowerCase().includes('refresh token') || error.message === 'No refresh token') {
      return 'Tu sesión ha expirado. Por favor inicia sesión nuevamente.';
    }
    return error.message;
  }
  if (error instanceof Error) {
    if (error.message?.toLowerCase().includes('refresh token') || error.message === 'No refresh token') {
      return 'Tu sesión ha expirado. Por favor inicia sesión nuevamente.';
    }
    return error.message;
  }
  return 'Ha ocurrido un error inesperado';
};

export default apiClient;

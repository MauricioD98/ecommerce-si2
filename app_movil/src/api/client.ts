import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { appStorage } from '../utils/storage';
import { getCurrentApiBaseUrl, getApiBaseUrl } from '../config/env';

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
  return config;
}, (error) => Promise.reject(error));

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

// Response interceptor for auto-refresh
apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

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
          throw new Error('No refresh token');
        }

        const currentBase = await getApiBaseUrl();
        const refreshResponse = await axios.post(
          `${currentBase}/auth/refresh`,
          {},
          {
            headers: {
              Authorization: `Bearer ${refreshToken}`,
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
        processQueue(refreshErr, null);
        await Promise.all([
          appStorage.removeItem(ACCESS_TOKEN_KEY),
          appStorage.removeItem(REFRESH_TOKEN_KEY),
          appStorage.removeItem(USER_DATA_KEY),
        ]);
        return Promise.reject(refreshErr);
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
    if (typeof data === 'string') return data;
    if (data?.message) {
      if (Array.isArray(data.message)) {
        return data.message.join(', ');
      }
      return data.message;
    }
    if (error.code === 'ECONNABORTED') {
      return 'Tiempo de espera agotado. Verifica tu conexión.';
    }
    if (error.message === 'Network Error') {
      return 'No se pudo conectar con el servidor. Verifica que la API esté corriendo y la URL sea correcta.';
    }
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return 'Ha ocurrido un error inesperado';
};

export default apiClient;

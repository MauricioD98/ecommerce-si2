import axios from 'axios';
import apiClient, { ACCESS_TOKEN_KEY } from './client';
import { appStorage } from '../utils/storage';
import { checkOnline } from '../offline/network';
import type { ApiFailure, LiveSession } from '../tryOn/tryOnCore';

export interface StoreFeatures {
  virtualTryOn?: boolean;
  [feature: string]: unknown;
}

// Probador Virtual en vivo (api/src/modules/try-on). Sesión (Bearer), tienda (x-tenant-id), idioma y
// renovación del token los pone apiClient. Son escrituras: nunca se responden desde la copia sin conexión
// ni se encolan. La respuesta trae un token de cliente de Decart de corta vida: no se guarda ni se registra.
export const tryOnApi = {
  // Solo para decidir si se muestra el botón; la API vuelve a exigir el plan al iniciar
  getStoreFeatures: async (): Promise<StoreFeatures | null> => {
    const { data } = await apiClient.get<{ data?: { features?: StoreFeatures } }>('/store');
    return data?.data?.features ?? null;
  },

  getLiveConfig: async (): Promise<{ maxSessionSeconds: number }> => {
    const { data } = await apiClient.get<{ data: { maxSessionSeconds: number } }>('/try-on/live-config');
    return data.data;
  },

  createLiveSession: async (productId: string, signal?: AbortSignal): Promise<LiveSession> => {
    // clientTime: si el reloj del teléfono va adelantado, el backend alarga el token esa diferencia
    // (el SDK compara el vencimiento con la hora del teléfono)
    const { data } = await apiClient.post<{ data: LiveSession }>(
      '/try-on/live-session',
      { productId, clientTime: Date.now() },
      { timeout: 20_000, signal }
    );
    return data.data;
  },

  // Sin await en la pantalla: si falla, el cupo vence solo en el backend
  endLiveSession: async (sessionId: string): Promise<void> => {
    await apiClient.post(`/try-on/live-session/${encodeURIComponent(sessionId)}/end`, {}, { timeout: 10_000 });
  },
};

/** Datos del fallo que necesita classifyApiFailure, sin copiar la petición ni la respuesta. */
export async function describeTryOnFailure(error: unknown): Promise<ApiFailure> {
  if (axios.isCancel(error) || (axios.isAxiosError(error) && error.code === 'ERR_CANCELED')) {
    return { canceled: true };
  }
  if (axios.isAxiosError(error)) {
    const body = error.response?.data as { code?: string; message?: unknown; retryAfterSeconds?: number } | undefined;
    if (!error.response) {
      const timedOut = error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT';
      return { timedOut, networkError: !timedOut, online: await checkOnline() };
    }
    return {
      status: error.response.status,
      code: body?.code,
      message: typeof body?.message === 'string' ? body.message : undefined,
      retryAfterSeconds: typeof body?.retryAfterSeconds === 'number' ? body.retryAfterSeconds : undefined,
    };
  }
  // El interceptor de apiClient no pudo renovar la sesión: ya borró los tokens y avisa al AuthContext
  const token = await appStorage.getItem(ACCESS_TOKEN_KEY);
  return token ? {} : { sessionExpired: true };
}

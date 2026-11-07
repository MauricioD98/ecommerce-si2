import type { AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { getOfflineStore } from './database';
import { emitOffline } from './events';
import { jwtPayload, readCacheKey, readScopeOf } from './offlineCore';

// Copias de lectura para abrir catálogo, carrito y pedidos sin conexión. Las usa el cliente HTTP:
//   - GET exitoso de una ruta permitida → se guarda (catálogo por tienda; carrito/pedidos por tienda y usuario).
//   - GET sin respuesta (sin red) → se devuelve la copia, marcada con OFFLINE_COPY_HEADER.
// Son solo para mirar: precios y stock pueden estar desactualizados y nada de esto confirma una compra.
export const OFFLINE_COPY_HEADER = 'x-offline-copy';

const pathOf = (config: InternalAxiosRequestConfig) => (config.url || '').replace(/^https?:\/\/[^/]+/, '').replace(/^\/api\/v1/, '');

const headerOf = (config: InternalAxiosRequestConfig, name: string): string | null => {
  const value = (config.headers as any)?.get?.(name) ?? (config.headers as any)?.[name];
  return typeof value === 'string' ? value : null;
};

/** Dónde se guarda esta petición (tienda + usuario + clave), o null si no se guarda */
function targetOf(config: InternalAxiosRequestConfig) {
  if ((config.method || 'get').toLowerCase() !== 'get') return null;
  const path = pathOf(config);
  const scope = readScopeOf(path);
  if (!scope) return null;
  const tenantId = headerOf(config, 'x-tenant-id');
  if (!tenantId) return null;
  let userId: string | null = null;
  if (scope === 'private') {
    // Dueño = el del token con el que se pidió (y de esta tienda): nunca se mezcla con otra cuenta
    const auth = headerOf(config, 'Authorization') || headerOf(config, 'authorization');
    const payload = jwtPayload(auth?.replace(/^Bearer\s+/i, ''));
    if (!payload?.sub || String(payload.tenantId || '').toLowerCase() !== tenantId.toLowerCase()) return null;
    userId = payload.sub;
  }
  const language = headerOf(config, 'Accept-Language') || '';
  return { tenantId, userId, key: readCacheKey(path, config.params, language) };
}

// Diagnóstico solo en desarrollo (Metro muestra estos registros); en release no imprime nada
const debug = (...args: unknown[]) => {
  if (__DEV__) console.log('[offline]', ...args);
};

export async function rememberRead(response: AxiosResponse): Promise<void> {
  try {
    if (response.headers?.[OFFLINE_COPY_HEADER]) return;
    const target = targetOf(response.config);
    if (!target) {
      debug('no se guarda', response.config?.method, response.config?.url);
      return;
    }
    const store = await getOfflineStore();
    if (!store) debug('sin base SQLite: no se guarda', target.key);
    await store?.saveRead(target.tenantId, target.userId, target.key, response.data);
    if (store) debug('copia guardada', target.key, target.userId ? 'privada' : 'pública');
  } catch (error) {
    // guardar la copia nunca rompe la respuesta real
    debug('error al guardar la copia', String(error));
  }
}

/** Respuesta armada con la copia guardada, o null si no hay copia para esta petición */
export async function offlineCopyFor(config: InternalAxiosRequestConfig): Promise<AxiosResponse | null> {
  try {
    // Lecturas que deciden una compra o un pago piden { offlineCopy: false }: sin red fallan, no se inventan
    if ((config as { offlineCopy?: boolean }).offlineCopy === false) return null;
    const target = targetOf(config);
    if (!target) {
      debug('sin copia posible para', config.method, config.url);
      return null;
    }
    const store = await getOfflineStore();
    const copy = await store?.getRead(target.tenantId, target.userId, target.key);
    debug(copy ? 'copia usada' : 'no hay copia', target.key, store ? '' : '(sin base SQLite)');
    if (!copy) return null;
    emitOffline('copy', copy.savedAt);
    return {
      data: copy.data,
      status: 200,
      statusText: 'OK (offline copy)',
      headers: { [OFFLINE_COPY_HEADER]: copy.savedAt },
      config,
    } as AxiosResponse;
  } catch (error) {
    debug('error al leer la copia', String(error));
    return null;
  }
}

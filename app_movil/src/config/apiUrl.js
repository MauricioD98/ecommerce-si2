// Validación de la URL base de la API. Es JS plano (CommonJS, sin dependencias de React Native)
// porque la usan dos lados: app.config.js (Node, al validar/compilar) y src/config/env.ts (app).
// No usa `URL`: en React Native su soporte de hostname/pathname es parcial.

// La API NestJS publica todo bajo este prefijo (api/src/main.ts → setGlobalPrefix('api/v1')).
const API_PREFIX = '/api/v1';

// http(s)://host[:puerto][/ruta] — sin usuario:clave@, query ni fragmento.
const URL_PATTERN = /^(https?):\/\/(\[[0-9a-f:.]+\]|[a-z0-9.-]+)(?::(\d{1,5}))?(\/[^\s?#]*)?$/i;

const isPrivateIPv4 = (host) => {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
};

// localhost, IPs privadas/loopback y nombres que solo existen en la red local.
const isLocalHost = (host) => {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local')) return true;
  if (h.includes(':')) return h === '::1' || h === '::' || /^f[cd]/.test(h) || h.startsWith('fe80');
  if (isPrivateIPv4(h)) return true;
  return !h.includes('.'); // nombre sin dominio (ej. "mi-pc")
};

/**
 * Normaliza y valida una URL base de la API.
 * - Quita espacios y barras finales.
 * - Agrega /api/v1 si falta; nunca lo duplica.
 * - `production: true` exige https y un host público (ni localhost ni IP privada).
 * @returns {{ ok: true, url: string } | { ok: false, error: string }}
 */
const parseApiBaseUrl = (raw, { production = false } = {}) => {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) return { ok: false, error: 'la URL está vacía' };

  const m = value.match(URL_PATTERN);
  if (!m) {
    return {
      ok: false,
      error: `"${value}" no es una URL http(s) válida (formato: https://host[:puerto]${API_PREFIX})`,
    };
  }
  const [, scheme, host, port, rawPath = ''] = m;
  if (port && Number(port) > 65535) return { ok: false, error: `puerto inválido: ${port}` };

  let path = rawPath.replace(/\/+$/, '');
  if (path.includes(`${API_PREFIX}/`)) {
    return { ok: false, error: `la ruta "${rawPath}" debe terminar en ${API_PREFIX} (sin endpoints ni prefijo duplicado)` };
  }
  if (!path.endsWith(API_PREFIX)) path += API_PREFIX;

  if (production) {
    if (scheme.toLowerCase() !== 'https') {
      return { ok: false, error: `en producción la URL debe usar https (recibido: ${value})` };
    }
    if (isLocalHost(host)) {
      return { ok: false, error: `en producción la URL no puede apuntar a localhost ni a una IP/red local (${host})` };
    }
  }

  const url = `${scheme.toLowerCase()}://${host.toLowerCase()}${port ? `:${port}` : ''}${path}`;
  return { ok: true, url };
};

module.exports = { API_PREFIX, parseApiBaseUrl, isLocalHost };

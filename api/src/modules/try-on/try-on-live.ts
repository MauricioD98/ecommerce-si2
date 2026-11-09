import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

// Reglas del Probador Virtual EN VIVO de la app móvil (Decart lucy-2.5 en tiempo real). Sin dependencias
// de Nest para poder probarlas aparte.
//
// La app abre la cámara frontal y transmite el video directo a Decart por WebRTC (LiveKit); el backend
// nunca ve el video. Lo que sí hace el backend: validar sesión, tienda, plan y prenda, entregar la foto
// de la prenda como referencia y firmar un token de cliente de corta vida, limitado a lucy-2.5 y con
// maxSessionDuration (Decart corta la sesión aunque el token siga vigente o ya haya vencido).

export const LIVE_MODEL = 'lucy-2.5';

// Duración máxima de cada sesión en vivo (la aplica Decart con constraints.realtime.maxSessionDuration).
// Decart exige un mínimo de 10 s.
export const LIVE_DEFAULTS = {
  maxSessionSeconds: 60,
  // El token solo sirve para ABRIR la sesión: se firma justo antes de conectar (después del permiso de
  // cámara), así que alcanza con poco. No es revocable, por eso se mantiene corto.
  tokenTtlSeconds: 30,
  sessionsPerHourPerUser: 10,
  concurrentPerTenant: 3,
} as const;

const intEnv = (name: string, fallback: number, min: number, max: number): number => {
  const raw = Number.parseInt(process.env[name] ?? '', 10);
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(max, Math.max(min, raw));
};

export interface LiveLimits {
  maxSessionSeconds: number;
  tokenTtlSeconds: number;
  sessionsPerHourPerUser: number;
  concurrentPerTenant: number;
}

// El SDK rechaza el token con TOKEN_EXPIRED comparando su vencimiento con el reloj DEL DISPOSITIVO
// (5 s de tolerancia). Un teléfono adelantado vería vencido un token recién firmado: la app manda su
// hora y el token se alarga exactamente lo que el dispositivo va adelantado, hasta este tope.
export const MAX_CLOCK_SKEW_SECONDS = 300;

/** Segundos que el reloj del dispositivo va ADELANTADO (0 si va atrasado o no informó su hora). */
export function deviceClockAheadSeconds(clientTime: unknown, now = Date.now()): number {
  const t = typeof clientTime === 'number' ? clientTime : typeof clientTime === 'string' ? Number(clientTime) : NaN;
  if (!Number.isFinite(t) || Math.abs(t - now) > 86_400_000) return 0;
  return Math.max(0, Math.round((t - now) / 1000));
}

/**
 * Segundos que el dispositivo va adelantado respecto al reloj de DECART (que es contra el que vence el
 * token). Decart responde expiresAt en su hora: su "ahora" al firmar ≈ expiresAt − expiresIn.
 *   clientTime: hora del dispositivo al pedir la sesión; receivedAt/mintedAt: hora del backend al
 *   recibir la petición y al recibir el token (el desfase del backend se cancela en la resta).
 */
export function deviceAheadOfProviderSeconds(params: {
  clientTime: unknown;
  receivedAt: number;
  mintedAt: number;
  expiresAt: string;
  expiresInSeconds: number;
}): number {
  const client = typeof params.clientTime === 'number' ? params.clientTime : Number(params.clientTime);
  const exp = Date.parse(params.expiresAt);
  if (!Number.isFinite(client) || !Number.isFinite(exp)) return 0;
  const providerNowAtMint = exp - params.expiresInSeconds * 1000;
  const deviceAtMint = client + (params.mintedAt - params.receivedAt);
  return Math.round((deviceAtMint - providerNowAtMint) / 1000);
}

/** Límites configurables por entorno (api/.env); se leen en cada petición. */
export function liveLimits(): LiveLimits {
  return {
    maxSessionSeconds: intEnv('TRY_ON_LIVE_MAX_SECONDS', LIVE_DEFAULTS.maxSessionSeconds, 10, 600),
    tokenTtlSeconds: intEnv('TRY_ON_LIVE_TOKEN_TTL_SECONDS', LIVE_DEFAULTS.tokenTtlSeconds, 10, 120),
    sessionsPerHourPerUser: intEnv('TRY_ON_LIVE_SESSIONS_PER_HOUR', LIVE_DEFAULTS.sessionsPerHourPerUser, 1, 1000),
    concurrentPerTenant: intEnv('TRY_ON_LIVE_MAX_CONCURRENT_PER_TENANT', LIVE_DEFAULTS.concurrentPerTenant, 1, 100),
  };
}

// Plantilla de la guía de Decart para lucy-2.5 ("Change <object> with <replacement>", con imagen de
// referencia). enhance deja que Decart reescriba el nombre del producto, que suele venir en español.
export function buildLivePrompt(product: { name: string; colors?: string[] | null }): string {
  const color = product.colors?.[0];
  const garment = [color, product.name].filter(Boolean).join(' ');
  return (
    `Change the person's outfit to the ${garment} from the reference image. ` +
    `Keep the exact fabric texture, color and shape of the reference garment. ` +
    `Keep the person's face, hair, body and the background unchanged.`
  );
}

// ---- Imagen de la prenda ------------------------------------------------------------------------

export const GARMENT_MAX_BYTES = 8 * 1024 * 1024;
export const GARMENT_FETCH_TIMEOUT_MS = 10_000;
// Decart recomienda ≥512×512; por debajo de esto el modelo no distingue la prenda
export const GARMENT_MIN_SIDE = 256;

export type ImageType = 'image/jpeg' | 'image/png' | 'image/webp';

/** Tipo real por los primeros bytes (no por el Content-Type del servidor). */
export function sniffImageType(bytes: Uint8Array): ImageType | null {
  const b = bytes;
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) {
    return 'image/png';
  }
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 12 && String.fromCharCode(b[0], b[1], b[2], b[3]) === 'RIFF' && String.fromCharCode(b[8], b[9], b[10], b[11]) === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

/** Ancho y alto leyendo solo la cabecera (PNG, JPEG, WebP). null si no se pudo leer. */
export function imageSize(bytes: Uint8Array, type: ImageType): { width: number; height: number } | null {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  try {
    if (type === 'image/png') return b.length >= 24 ? { width: b.readUInt32BE(16), height: b.readUInt32BE(20) } : null;
    if (type === 'image/webp') {
      const chunk = b.toString('ascii', 12, 16);
      if (chunk === 'VP8X') return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
      if (chunk === 'VP8 ') return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
      if (chunk === 'VP8L') {
        const bits = b.readUInt32LE(21);
        return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
      }
      return null;
    }
    // JPEG: se recorren los segmentos hasta un SOFn
    let offset = 2;
    while (offset + 9 < b.length) {
      if (b[offset] !== 0xff) return null;
      const marker = b[offset + 1];
      const length = b.readUInt16BE(offset + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: b.readUInt16BE(offset + 5), width: b.readUInt16BE(offset + 7) };
      }
      offset += 2 + length;
    }
    return null;
  } catch {
    return null;
  }
}

// La URL la carga el dueño de la tienda en el catálogo, pero igual se valida: el servidor no debe
// poder usarse para leer la red interna (SSRF).
const isPrivateIPv4 = (ip: string) =>
  /^(127|10|0)\./.test(ip) ||
  /^192\.168\./.test(ip) ||
  /^169\.254\./.test(ip) ||
  /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ||
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip);

const isPrivateIPv6 = (ip: string) => {
  const v = ip.toLowerCase();
  if (v === '::1' || v === '::') return true;
  if (v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80')) return true;
  const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return mapped ? isPrivateIPv4(mapped[1]) : false;
};

export const isPrivateAddress = (ip: string) => (isIP(ip) === 6 ? isPrivateIPv6(ip) : isPrivateIPv4(ip));

async function assertPublicHost(hostname: string): Promise<void> {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) {
    throw new GarmentUnavailableError('host no permitido');
  }
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) throw new GarmentUnavailableError('host no permitido');
}

export class GarmentUnavailableError extends Error {}
export class GarmentTooSmallError extends Error {}

export interface GarmentImage {
  bytes: Uint8Array;
  type: ImageType;
}

function checked(bytes: Uint8Array): GarmentImage {
  if (bytes.byteLength > GARMENT_MAX_BYTES) throw new GarmentUnavailableError('imagen demasiado grande');
  const type = sniffImageType(bytes);
  if (!type) throw new GarmentUnavailableError('no es JPEG, PNG ni WebP');
  const size = imageSize(bytes, type);
  if (size && Math.min(size.width, size.height) < GARMENT_MIN_SIDE) throw new GarmentTooSmallError(`${size.width}x${size.height}`);
  return { bytes, type };
}

/** Descarga la foto de la prenda del catálogo (http/https público o data URL) y la valida. */
export async function loadGarmentImage(imageUrl: string, fetchImpl: typeof fetch = fetch): Promise<GarmentImage> {
  if (imageUrl.startsWith('data:')) {
    const match = imageUrl.match(/^data:([^;,]+);base64,(.*)$/s);
    if (!match) throw new GarmentUnavailableError('data URL inválida');
    return checked(new Uint8Array(Buffer.from(match[2], 'base64')));
  }

  let current: URL;
  try {
    current = new URL(imageUrl);
  } catch {
    throw new GarmentUnavailableError('URL inválida');
  }

  // Las redirecciones se siguen a mano para validar cada destino
  for (let hop = 0; hop < 4; hop++) {
    if (!['http:', 'https:'].includes(current.protocol)) throw new GarmentUnavailableError('protocolo no permitido');
    await assertPublicHost(current.hostname);

    const response = await fetchImpl(current.toString(), {
      headers: { Accept: 'image/*' },
      redirect: 'manual',
      signal: AbortSignal.timeout(GARMENT_FETCH_TIMEOUT_MS),
    }).catch(() => {
      throw new GarmentUnavailableError('no se pudo descargar');
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new GarmentUnavailableError('redirección sin destino');
      current = new URL(location, current);
      continue;
    }
    if (!response.ok) throw new GarmentUnavailableError(`HTTP ${response.status}`);

    const declared = Number(response.headers.get('content-length') ?? 0);
    if (declared > GARMENT_MAX_BYTES) throw new GarmentUnavailableError('imagen demasiado grande');
    return checked(new Uint8Array(await response.arrayBuffer()));
  }
  throw new GarmentUnavailableError('demasiadas redirecciones');
}

// ---- Control de abuso -------------------------------------------------------------------------
// En memoria (una instancia de la API). Con varias réplicas habría que moverlo a la base o a Redis;
// el techo real del gasto lo pone igual maxSessionDuration en Decart.

export interface LiveSlot {
  id: string;
  tenantId: string;
  userId: string;
  // Hasta cuándo puede seguir abierta como máximo: TTL del token + duración máxima + margen
  until: number;
  // El token no se puede revocar: aunque el cliente avise que terminó, sigue sirviendo hasta acá
  tokenExpiresAt: number;
  startedAt: number;
  maxSessionSeconds: number;
}

export type AcquireResult = { ok: true; slot: LiveSlot } | { ok: false; reason: 'user_active' | 'tenant_busy' | 'hourly_limit'; retryAfterSeconds: number };

export class LiveSessionRegistry {
  private readonly slots = new Map<string, LiveSlot>(); // id → slot
  private readonly history = new Map<string, number[]>(); // tenant:user → inicios en la última hora

  constructor(private readonly now: () => number = Date.now) {}

  private prune() {
    const t = this.now();
    for (const [id, slot] of this.slots) if (slot.until <= t) this.slots.delete(id);
    for (const [key, starts] of this.history) {
      const recent = starts.filter((s) => t - s < 3_600_000);
      if (recent.length) this.history.set(key, recent);
      else this.history.delete(key);
    }
  }

  acquire(params: { id: string; tenantId: string; userId: string; limits: LiveLimits }): AcquireResult {
    this.prune();
    const t = this.now();
    const { tenantId, userId, limits } = params;
    const mine = [...this.slots.values()].find((s) => s.tenantId === tenantId && s.userId === userId);
    if (mine) return { ok: false, reason: 'user_active', retryAfterSeconds: Math.ceil((mine.until - t) / 1000) };

    const tenantActive = [...this.slots.values()].filter((s) => s.tenantId === tenantId);
    if (tenantActive.length >= limits.concurrentPerTenant) {
      const soonest = Math.min(...tenantActive.map((s) => s.until));
      return { ok: false, reason: 'tenant_busy', retryAfterSeconds: Math.ceil((soonest - t) / 1000) };
    }

    const key = `${tenantId}:${userId}`;
    const starts = this.history.get(key) ?? [];
    if (starts.length >= limits.sessionsPerHourPerUser) {
      return { ok: false, reason: 'hourly_limit', retryAfterSeconds: Math.ceil((starts[0] + 3_600_000 - t) / 1000) };
    }

    const slot: LiveSlot = {
      id: params.id,
      tenantId,
      userId,
      tokenExpiresAt: t + limits.tokenTtlSeconds * 1000,
      until: t + (limits.tokenTtlSeconds + limits.maxSessionSeconds + 15) * 1000,
      startedAt: t,
      maxSessionSeconds: limits.maxSessionSeconds,
    };
    this.slots.set(slot.id, slot);
    this.history.set(key, [...starts, t]);
    return { ok: true, slot };
  }

  /** Se volvió a firmar el token con otra duración (compensación de reloj): el cupo dura acorde. */
  setTokenTtl(id: string, ttlSeconds: number) {
    const slot = this.slots.get(id);
    if (!slot) return;
    slot.tokenExpiresAt = slot.startedAt + ttlSeconds * 1000;
    slot.until = slot.startedAt + (ttlSeconds + slot.maxSessionSeconds + 15) * 1000;
  }

  /** El token no se pudo emitir: se devuelve el cupo y no cuenta para el límite por hora. */
  cancel(id: string) {
    const slot = this.slots.get(id);
    if (!slot) return;
    this.slots.delete(id);
    const key = `${slot.tenantId}:${slot.userId}`;
    const starts = this.history.get(key) ?? [];
    starts.pop();
    if (starts.length) this.history.set(key, starts);
    else this.history.delete(key);
  }

  /**
   * El cliente terminó. Solo el dueño puede cerrarla. El cupo queda ocupado hasta que vence el token
   * (no es revocable): así un token viejo no se usa para abrir una segunda sesión en paralelo.
   */
  end(id: string, tenantId: string, userId: string): boolean {
    this.prune();
    const slot = this.slots.get(id);
    if (!slot || slot.tenantId !== tenantId || slot.userId !== userId) return false;
    const t = this.now();
    if (slot.tokenExpiresAt <= t) this.slots.delete(id);
    else slot.until = slot.tokenExpiresAt;
    return true;
  }

  activeCount(tenantId?: string): number {
    this.prune();
    return [...this.slots.values()].filter((s) => !tenantId || s.tenantId === tenantId).length;
  }
}

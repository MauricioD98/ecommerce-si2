import { appStorage } from './storage';
import { getTenantId } from '../config/tenant';
import { ordersApi } from '../api/orders.api';
import { CreateOrderPayload } from '../types';

// Intento de compra ya autorizado por el usuario. Misma regla que la web: la clave nace UNA vez, antes del
// primer envío, y un timeout o un 5xx no prueban que la compra falló. Se guarda por tienda y por usuario, con
// el snapshot del pedido: nunca tarjetas, secretos de Stripe, JWT ni client_secret.
export type AttemptState = 'SENDING' | 'IN_DOUBT' | 'CONFIRMED';

export interface CheckoutAttempt {
  attemptId: string;
  userId: string;
  tenantId: string;
  payload: CreateOrderPayload;
  state: AttemptState;
  orderId?: string;
  amount?: number;
  retries: number;
  nextRetryAt?: number;
  createdAt: string;
  updatedAt: string;
}

export type SubmitResult =
  | { kind: 'created'; attempt: CheckoutAttempt; amount: number }
  | { kind: 'rejected'; code?: string; message: string }
  | { kind: 'uncertain'; attempt: CheckoutAttempt };

const storageKey = (tenantId: string, userId: string) => `@checkout_attempts:${tenantId}:${userId}`;
const RETENTION_MS = 3 * 24 * 60 * 60 * 1000;

// AsyncStorage no tiene transacciones: las escrituras de este módulo se encolan para no pisarse
let queue: Promise<unknown> = Promise.resolve();
function serialized<T>(work: () => Promise<T>): Promise<T> {
  const run = queue.then(work, work);
  queue = run.catch(() => undefined);
  return run;
}

const read = async (key: string): Promise<CheckoutAttempt[]> => {
  const raw = await appStorage.getItem(key);
  return raw ? (JSON.parse(raw) as CheckoutAttempt[]) : [];
};

// RFC 4122 v4 con Math.random: es una clave de idempotencia, no un secreto, y evita sumar dependencias nativas
export function newAttemptId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// Si esto falla, el llamador NO envía: una compra que no se pudo guardar no sería recuperable
export async function createAttempt(userId: string, payload: CreateOrderPayload): Promise<CheckoutAttempt> {
  const tenantId = await getTenantId();
  if (!tenantId) throw new Error('No hay una tienda seleccionada');
  const now = new Date().toISOString();
  const attempt: CheckoutAttempt = { attemptId: newAttemptId(), userId, tenantId, payload, state: 'SENDING', retries: 0, createdAt: now, updatedAt: now };
  await serialized(async () => {
    const key = storageKey(tenantId, userId);
    const list = await read(key);
    await appStorage.setItem(key, JSON.stringify([attempt, ...list]));
  });
  return attempt;
}

export async function getOwnAttempts(userId: string | null | undefined): Promise<CheckoutAttempt[]> {
  const tenantId = await getTenantId();
  if (!tenantId || !userId) return [];
  return read(storageKey(tenantId, userId));
}

async function patch(attempt: CheckoutAttempt, changes: Partial<CheckoutAttempt>): Promise<CheckoutAttempt> {
  const saved = { ...attempt, ...changes, updatedAt: new Date().toISOString() };
  await serialized(async () => {
    const key = storageKey(attempt.tenantId, attempt.userId);
    const list = await read(key);
    await appStorage.setItem(key, JSON.stringify(list.map((item) => (item.attemptId === attempt.attemptId ? saved : item))));
  });
  return saved;
}

export async function removeAttempt(attempt: Pick<CheckoutAttempt, 'attemptId' | 'tenantId' | 'userId'>): Promise<void> {
  await serialized(async () => {
    const key = storageKey(attempt.tenantId, attempt.userId);
    const list = await read(key);
    await appStorage.setItem(key, JSON.stringify(list.filter((item) => item.attemptId !== attempt.attemptId)));
  });
}

// El pago terminó: ya no hay nada que recuperar de esta orden
export async function forgetAttemptsOfOrder(userId: string | null | undefined, orderId: string): Promise<void> {
  const own = await getOwnAttempts(userId).catch(() => []);
  await Promise.all(own.filter((attempt) => attempt.orderId === orderId).map(removeAttempt));
}

const isUncertain = (error: any): boolean => {
  if (!error?.response) return true;
  const { status, data } = error.response;
  return status >= 500 || status === 408 || status === 429 || data?.code === 'ATTEMPT_IN_PROGRESS';
};

const retryDelay = (retries: number) => {
  const base = Math.min(5 * 60_000, 2_000 * 2 ** Math.min(retries, 8));
  return base / 2 + Math.random() * base;
};

// Misma clave + mismo snapshot: reintentar es parte del mismo intento, nunca una compra nueva
export async function submitAttempt(attempt: CheckoutAttempt): Promise<SubmitResult> {
  try {
    const order = await ordersApi.create(attempt.payload, attempt.attemptId);
    const amount = Number((order as any)?.total ?? order?.totalAmount ?? 0);
    const saved = await patch(attempt, { state: 'CONFIRMED', orderId: order.id, amount, nextRetryAt: undefined });
    return { kind: 'created', attempt: saved, amount };
  } catch (error: any) {
    if (isUncertain(error)) {
      const retries = attempt.retries + 1;
      const saved = await patch(attempt, { state: 'IN_DOUBT', retries, nextRetryAt: Date.now() + retryDelay(retries) });
      return { kind: 'uncertain', attempt: saved };
    }
    await removeAttempt(attempt);
    const data = error.response?.data;
    return { kind: 'rejected', code: data?.code, message: Array.isArray(data?.message) ? data.message.join('. ') : data?.message ?? error.message };
  }
}

// Una pasada de recuperación. Un 404 de la consulta NO prueba que no se compró: se reenvía con la misma clave.
export async function recoverAttempts(userId: string | null | undefined): Promise<void> {
  const now = Date.now();
  for (const attempt of await getOwnAttempts(userId)) {
    if (attempt.state === 'CONFIRMED') {
      if (now - new Date(attempt.createdAt).getTime() > RETENTION_MS) await removeAttempt(attempt);
      continue;
    }
    if (attempt.nextRetryAt && attempt.nextRetryAt > now) continue;
    if (attempt.state === 'SENDING' && now - new Date(attempt.updatedAt).getTime() < 15_000) continue;
    try {
      const state = await ordersApi.getAttempt(attempt.attemptId);
      if (state.status === 'SUCCEEDED' && state.orderId) {
        await patch(attempt, { state: 'CONFIRMED', orderId: state.orderId, nextRetryAt: undefined });
        continue;
      }
      if (state.status === 'REJECTED') {
        await removeAttempt(attempt);
        continue;
      }
    } catch (error: any) {
      if (error?.response?.status !== 404) {
        // Sesión vencida o API inaccesible: se reintenta después, sin perder el intento
        const retries = attempt.retries + 1;
        await patch(attempt, { retries, nextRetryAt: now + retryDelay(retries) });
        continue;
      }
    }
    await submitAttempt(attempt);
  }
}

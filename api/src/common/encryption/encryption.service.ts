import { Injectable, Logger } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // tamaño recomendado para GCM
const TAG_BYTES = 16;
const KEY_BYTES = 32;

export interface EncryptedPayload {
  // "<versión>:<base64(ciphertext ‖ auth tag)>"
  encryptedData: string;
  // base64 de 12 bytes aleatorios
  iv: string;
}

/**
 * Cifrado simétrico autenticado (AES-256-GCM) con el módulo crypto nativo.
 *
 * Llave maestra: TENANT_SECRETS_KEYS="1:<base64 de 32 bytes>[,2:<base64>…]"
 *   - encrypt usa siempre la versión más alta; decrypt usa la que viene en encryptedData
 *   - rotar: agregar "2:…", re-guardar los registros (quedan en v2) y recién después quitar "1:…"
 *   - generar una: node -e "console.log('1:'+require('crypto').randomBytes(32).toString('base64'))"
 *
 * aad (opcional): contexto que no se cifra pero se autentica. Si al descifrar no es el mismo, falla.
 * Sirve para atar un valor a su dueño (p. ej. "<tenantId>:<provider>").
 */
@Injectable()
export class EncryptionService {
  private readonly logger = new Logger(EncryptionService.name);
  private readonly keys: Map<number, Buffer>;
  private readonly currentVersion: number | null;

  constructor() {
    // Una llave mal formada tira al arrancar: mejor que descubrirlo al primer descifrado en producción
    this.keys = parseKeyring(process.env.TENANT_SECRETS_KEYS);
    this.currentVersion = this.keys.size > 0 ? Math.max(...this.keys.keys()) : null;
    if (this.currentVersion === null) {
      this.logger.warn('TENANT_SECRETS_KEYS no configurada: encrypt/decrypt van a fallar');
    }
  }

  encrypt(payload: object, aad?: string): EncryptedPayload {
    if (this.currentVersion === null) throw new Error('TENANT_SECRETS_KEYS no configurada');
    const key = this.keys.get(this.currentVersion)!;

    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    if (aad) cipher.setAAD(Buffer.from(aad, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
    const sealed = Buffer.concat([ciphertext, cipher.getAuthTag()]);

    return {
      encryptedData: `${this.currentVersion}:${sealed.toString('base64')}`,
      iv: iv.toString('base64'),
    };
  }

  decrypt<T = Record<string, unknown>>(encryptedData: string, iv: string, aad?: string): T {
    const separator = encryptedData.indexOf(':');
    const version = Number(encryptedData.slice(0, separator));
    const key = this.keys.get(version);
    if (separator <= 0 || !key) {
      throw new Error(`No hay llave v${encryptedData.slice(0, separator) || '?'} en TENANT_SECRETS_KEYS`);
    }

    const sealed = Buffer.from(encryptedData.slice(separator + 1), 'base64');
    const nonce = Buffer.from(iv, 'base64');
    if (nonce.length !== IV_BYTES || sealed.length < TAG_BYTES) throw new Error('Datos cifrados inválidos');

    const decipher = createDecipheriv(ALGORITHM, key, nonce);
    if (aad) decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(sealed.subarray(sealed.length - TAG_BYTES));
    // final() lanza si el tag no coincide: datos alterados, llave equivocada o aad distinto
    const plain = Buffer.concat([decipher.update(sealed.subarray(0, sealed.length - TAG_BYTES)), decipher.final()]);
    return JSON.parse(plain.toString('utf8')) as T;
  }

  /** Versión de llave con la que se cifró un valor (para saber qué registros falta re-cifrar al rotar). */
  keyVersionOf(encryptedData: string): number {
    return Number(encryptedData.slice(0, encryptedData.indexOf(':')));
  }
}

function parseKeyring(raw?: string): Map<number, Buffer> {
  const keys = new Map<number, Buffer>();
  for (const entry of (raw ?? '').split(',').map((e) => e.trim()).filter(Boolean)) {
    const separator = entry.indexOf(':');
    const version = entry.slice(0, separator);
    const key = Buffer.from(entry.slice(separator + 1), 'base64');
    if (separator <= 0 || !/^\d+$/.test(version) || key.length !== KEY_BYTES) {
      throw new Error(`TENANT_SECRETS_KEYS: entrada inválida "${version || entry.slice(0, 4)}:…" (formato "1:<base64 de 32 bytes>")`);
    }
    if (keys.has(Number(version))) throw new Error(`TENANT_SECRETS_KEYS: versión ${version} repetida`);
    keys.set(Number(version), key);
  }
  return keys;
}

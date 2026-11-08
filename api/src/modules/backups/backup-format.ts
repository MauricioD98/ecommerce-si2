import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import type { BackupKeyring } from './backup-config';

/**
 * Formato de archivo de respaldo, versión 1 (.sfbk):
 *
 *   "SFBK" | 0x01 | uint32 BE largo del encabezado | encabezado JSON (UTF-8) | ciphertext | tag GCM (16 bytes)
 *
 * - El encabezado va en claro (permite saber de qué tienda y fecha es sin descifrar) pero es el AAD de
 *   AES-256-GCM: cambiar un solo byte (tienda, alcance, fecha, versión de clave) hace fallar el descifrado.
 * - La clave de cada archivo se deriva con HKDF-SHA256 de la clave maestra (BACKUP_ENCRYPTION_KEYS) con
 *   una sal aleatoria y el alcance/tienda como contexto. La clave maestra no viaja en el archivo.
 * - El contenido cifrado es gzip(JSON) con el manifiesto y los datos (BackupPayload).
 * - GCM autentica: solo quien tiene la clave pudo generar el archivo → origen e integridad verificables.
 *   Nunca se ejecuta SQL que venga en un respaldo: los datos son filas JSON que se cargan con parámetros.
 */
const MAGIC = Buffer.from('SFBK', 'ascii');
export const FORMAT_VERSION = 1;
const PREFIX_LEN = MAGIC.length + 1 + 4;
const TAG_LEN = 16;
const MAX_HEADER_LEN = 16 * 1024;

export type BackupScopeValue = 'TENANT' | 'PLATFORM';

export interface BackupHeader {
  format: 'stella-femme-backup';
  formatVersion: number;
  backupId: string;
  scope: BackupScopeValue;
  tenantId: string | null;
  createdAt: string;
  keyVersion: number;
  cipher: 'aes-256-gcm';
  kdf: 'hkdf-sha256';
  compression: 'gzip';
  salt: string;
  iv: string;
}

export interface TableManifest {
  name: string;
  columns: string[];
  rows: number;
  sha256: string;
}

export interface SchemaSnapshot {
  migrations: string[];
  tables: TableManifest[];
  data: Record<string, Record<string, unknown>[]>;
}

export interface TenantIdentity {
  id: string;
  slug: string;
  name: string;
  schemaName: string;
  plan: string;
  status: string;
}

export interface ComponentInfo {
  id: string;
  detail?: string;
}

export interface BackupManifest {
  format: 'stella-femme-backup';
  formatVersion: number;
  backupId: string;
  scope: BackupScopeValue;
  createdAt: string;
  app: { name: string; version: string };
  createdBy: { type: string; id: string | null; email: string | null };
  tenant?: TenantIdentity;
  tenants?: (TenantIdentity & { schemaIncluded: boolean })[];
  controlMigrations?: string[];
  included: ComponentInfo[];
  excluded: ComponentInfo[];
}

export interface BackupPayload {
  manifest: BackupManifest;
  // Alcance TENANT: el schema de la tienda
  tenant?: SchemaSnapshot;
  // Alcance PLATFORM: plano de control + schema de cada tienda (clave = tenantId)
  control?: SchemaSnapshot;
  tenants?: Record<string, SchemaSnapshot>;
}

export class BackupFormatError extends Error {
  constructor(
    readonly code: 'BACKUP_NOT_A_BACKUP' | 'BACKUP_UNSUPPORTED_VERSION' | 'BACKUP_INTEGRITY_FAILED' | 'BACKUP_KEY_UNKNOWN',
    message: string,
  ) {
    super(message);
  }
}

function deriveKey(master: Buffer, salt: Buffer, scope: BackupScopeValue, tenantId: string | null): Buffer {
  return Buffer.from(hkdfSync('sha256', master, salt, `stella-femme-backup:v1:${scope}:${tenantId ?? 'platform'}`, 32));
}

export function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

export function encodeBackup(payload: BackupPayload, keyring: BackupKeyring): { file: Buffer; header: BackupHeader } {
  const { manifest } = payload;
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const header: BackupHeader = {
    format: 'stella-femme-backup',
    formatVersion: FORMAT_VERSION,
    backupId: manifest.backupId,
    scope: manifest.scope,
    tenantId: manifest.tenant?.id ?? null,
    createdAt: manifest.createdAt,
    keyVersion: keyring.activeVersion,
    cipher: 'aes-256-gcm',
    kdf: 'hkdf-sha256',
    compression: 'gzip',
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
  };
  const headerBytes = Buffer.from(JSON.stringify(header), 'utf8');
  const key = deriveKey(keyring.keys.get(keyring.activeVersion)!, salt, header.scope, header.tenantId);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(headerBytes);
  const plain = gzipSync(Buffer.from(JSON.stringify(payload), 'utf8'));
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  const lengthBytes = Buffer.alloc(4);
  lengthBytes.writeUInt32BE(headerBytes.length);
  const file = Buffer.concat([MAGIC, Buffer.from([FORMAT_VERSION]), lengthBytes, headerBytes, encrypted, cipher.getAuthTag()]);
  return { file, header };
}

/** Lee el encabezado sin descifrar (no prueba nada por sí solo: la autenticación la da decodeBackup). */
export function readHeader(file: Buffer): { header: BackupHeader; headerBytes: Buffer; bodyStart: number } {
  if (file.length < PREFIX_LEN + TAG_LEN || !file.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new BackupFormatError('BACKUP_NOT_A_BACKUP', 'El archivo no es un respaldo de Stella Femme');
  }
  const version = file[MAGIC.length];
  if (version !== FORMAT_VERSION) {
    throw new BackupFormatError('BACKUP_UNSUPPORTED_VERSION', `Versión de formato no soportada: ${version}`);
  }
  const headerLen = file.readUInt32BE(MAGIC.length + 1);
  if (headerLen === 0 || headerLen > MAX_HEADER_LEN || PREFIX_LEN + headerLen + TAG_LEN > file.length) {
    throw new BackupFormatError('BACKUP_NOT_A_BACKUP', 'Encabezado de respaldo inválido');
  }
  const headerBytes = file.subarray(PREFIX_LEN, PREFIX_LEN + headerLen);
  let header: BackupHeader;
  try {
    header = JSON.parse(headerBytes.toString('utf8'));
  } catch {
    throw new BackupFormatError('BACKUP_NOT_A_BACKUP', 'Encabezado de respaldo ilegible');
  }
  if (
    header?.format !== 'stella-femme-backup' ||
    header.formatVersion !== FORMAT_VERSION ||
    (header.scope !== 'TENANT' && header.scope !== 'PLATFORM') ||
    (header.scope === 'TENANT') !== (typeof header.tenantId === 'string') ||
    typeof header.salt !== 'string' ||
    typeof header.iv !== 'string' ||
    !Number.isInteger(header.keyVersion)
  ) {
    throw new BackupFormatError('BACKUP_NOT_A_BACKUP', 'Encabezado de respaldo incompleto');
  }
  return { header, headerBytes, bodyStart: PREFIX_LEN + headerLen };
}

/** Verifica (GCM) y descifra. Cualquier byte alterado → BACKUP_INTEGRITY_FAILED. */
export function decodeBackup(file: Buffer, keyring: BackupKeyring): { header: BackupHeader; payload: BackupPayload } {
  const { header, headerBytes, bodyStart } = readHeader(file);
  const master = keyring.keys.get(header.keyVersion);
  if (!master) throw new BackupFormatError('BACKUP_KEY_UNKNOWN', `La clave de respaldo versión ${header.keyVersion} no está configurada`);
  const salt = Buffer.from(header.salt, 'base64');
  const iv = Buffer.from(header.iv, 'base64');
  if (salt.length !== 16 || iv.length !== 12) throw new BackupFormatError('BACKUP_NOT_A_BACKUP', 'Encabezado de respaldo inválido');

  let plain: Buffer;
  try {
    const decipher = createDecipheriv('aes-256-gcm', deriveKey(master, salt, header.scope, header.tenantId), iv);
    decipher.setAAD(headerBytes);
    decipher.setAuthTag(file.subarray(file.length - TAG_LEN));
    plain = Buffer.concat([decipher.update(file.subarray(bodyStart, file.length - TAG_LEN)), decipher.final()]);
  } catch {
    throw new BackupFormatError('BACKUP_INTEGRITY_FAILED', 'El respaldo fue alterado, está dañado o no se generó con esta clave');
  }

  let payload: BackupPayload;
  try {
    payload = JSON.parse(gunzipSync(plain).toString('utf8'));
  } catch {
    throw new BackupFormatError('BACKUP_INTEGRITY_FAILED', 'Contenido del respaldo ilegible');
  }
  const m = payload?.manifest;
  // El manifiesto cifrado debe decir lo mismo que el encabezado autenticado
  if (!m || m.backupId !== header.backupId || m.scope !== header.scope || (m.tenant?.id ?? null) !== header.tenantId || m.createdAt !== header.createdAt) {
    throw new BackupFormatError('BACKUP_INTEGRITY_FAILED', 'El manifiesto no coincide con el encabezado');
  }
  // Integridad por tabla (filas y hash), además de la del archivo completo
  const snapshots = header.scope === 'TENANT' ? [payload.tenant] : [payload.control, ...Object.values(payload.tenants ?? {})];
  for (const snapshot of snapshots) {
    if (!snapshot) throw new BackupFormatError('BACKUP_INTEGRITY_FAILED', 'Faltan datos en el respaldo');
    verifySnapshot(snapshot);
  }
  return { header, payload };
}

export function tableHash(rows: Record<string, unknown>[]): string {
  return sha256Hex(JSON.stringify(rows));
}

function verifySnapshot(snapshot: SchemaSnapshot): void {
  if (!Array.isArray(snapshot.tables) || !Array.isArray(snapshot.migrations) || typeof snapshot.data !== 'object') {
    throw new BackupFormatError('BACKUP_INTEGRITY_FAILED', 'Estructura de datos inválida');
  }
  for (const table of snapshot.tables) {
    const rows = snapshot.data[table.name];
    if (!Array.isArray(rows) || rows.length !== table.rows || tableHash(rows) !== table.sha256) {
      throw new BackupFormatError('BACKUP_INTEGRITY_FAILED', `La tabla ${table.name} no coincide con su manifiesto`);
    }
  }
  const declared = new Set(snapshot.tables.map((t) => t.name));
  for (const name of Object.keys(snapshot.data)) {
    if (!declared.has(name)) throw new BackupFormatError('BACKUP_INTEGRITY_FAILED', `Tabla no declarada: ${name}`);
  }
}

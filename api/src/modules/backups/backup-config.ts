import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';

// Configuración de copias de seguridad. Todo sale del entorno: la clave NUNCA se escribe en el código,
// en la base ni dentro de un respaldo.
//
//   BACKUP_ENCRYPTION_KEYS  "1:<base64 de 32 bytes>[,2:<…>]"  (obligatoria; distinta de TENANT_SECRETS_KEYS)
//   BACKUP_ACTIVE_KEY_VERSION  versión con la que se cifran los respaldos nuevos (default: la mayor)
//   BACKUP_DIR              carpeta de los archivos .sfbk (default: ~/.stella-femme/backups, fuera del repo)
//   BACKUP_MAX_BYTES        tope del archivo cifrado y de lo que se acepta al subir (default 200 MB)

export const BACKUP_FILE_EXTENSION = '.sfbk';

export interface BackupKeyring {
  activeVersion: number;
  keys: Map<number, Buffer>;
}

export class BackupKeyUnavailableError extends Error {
  constructor(message: string) {
    super(message);
  }
}

/** Lanza BackupKeyUnavailableError si falta la clave o el formato es inválido. No loguea su valor. */
export function loadBackupKeyring(env: NodeJS.ProcessEnv = process.env): BackupKeyring {
  const raw = env.BACKUP_ENCRYPTION_KEYS?.trim();
  if (!raw) throw new BackupKeyUnavailableError('Falta BACKUP_ENCRYPTION_KEYS');
  const keys = new Map<number, Buffer>();
  for (const part of raw.split(',')) {
    const match = /^\s*(\d{1,4}):([A-Za-z0-9+/=]+)\s*$/.exec(part);
    if (!match) throw new BackupKeyUnavailableError('BACKUP_ENCRYPTION_KEYS tiene un formato inválido (esperado "1:<base64>")');
    const key = Buffer.from(match[2], 'base64');
    if (key.length !== 32) throw new BackupKeyUnavailableError(`La clave de respaldo versión ${match[1]} no mide 32 bytes`);
    keys.set(Number(match[1]), key);
  }
  const requested = env.BACKUP_ACTIVE_KEY_VERSION ? Number(env.BACKUP_ACTIVE_KEY_VERSION) : Math.max(...keys.keys());
  if (!keys.has(requested)) throw new BackupKeyUnavailableError(`BACKUP_ACTIVE_KEY_VERSION=${requested} no está en BACKUP_ENCRYPTION_KEYS`);
  return { activeVersion: requested, keys };
}

export function backupDir(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.BACKUP_DIR?.trim();
  const dir = configured ? resolve(configured) : join(homedir(), '.stella-femme', 'backups');
  return dir;
}

/** true si la carpeta queda dentro del proyecto (riesgo de versionar respaldos por error). */
export function isInsideProject(dir: string, projectRoot = resolve(process.cwd(), '..')): boolean {
  const rel = relative(projectRoot, dir);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

export function backupMaxBytes(env: NodeJS.ProcessEnv = process.env): number {
  const value = Number(env.BACKUP_MAX_BYTES ?? 200 * 1024 * 1024);
  return Number.isFinite(value) && value > 0 ? value : 200 * 1024 * 1024;
}

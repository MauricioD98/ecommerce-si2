// Núcleo del modo sin conexión de la app móvil: base SQLite local, cola de cambios del perfil y copias de
// lectura. Es JS plano (CommonJS) y no importa nada de React Native, igual que src/config/apiUrl.js: así lo
// usa la app (con expo-sqlite, ver ./database.ts) y lo prueban Node y la suite de la API con SQLite real.
//
// Qué se guarda y qué NO:
//   - profile_snapshot: la última versión del perfil que confirmó el servidor (id, nombre, correo...).
//   - profile_change:   lo que el usuario editó sin conexión, por tienda y por usuario, con los valores que
//                       esperaba encontrar en el servidor (para detectar conflictos, nunca sobrescribir a ciegas).
//   - read_cache:       respuestas GET de catálogo (públicas, por tienda) y de carrito/pedidos (por usuario).
//   Nunca contraseñas, tokens, tarjetas, client_secret ni claves: los tokens siguen donde ya estaban
//   (AsyncStorage) y este módulo no los persiste.

// Campos del perfil que la app edita sin conexión. Subconjunto de OFFLINE_PROFILE_FIELDS de la API
// (api/src/modules/users/dto/sync-profile.dto.ts): el correo NO (cambia la identidad de acceso) ni la contraseña.
const PROFILE_FIELDS = ['firstName', 'lastName'];

const STATUSES = ['pending', 'syncing', 'synced', 'conflict', 'error', 'needs-login'];
const SCHEMA_VERSION = 1;
const READ_CACHE_LIMIT = 300; // filas por tienda+usuario; las más viejas se descartan

const MIGRATIONS = [
  // v1
  `
  CREATE TABLE IF NOT EXISTS profile_snapshot (
    tenant_id TEXT NOT NULL,
    user_id   TEXT NOT NULL,
    data      TEXT NOT NULL,
    saved_at  TEXT NOT NULL,
    PRIMARY KEY (tenant_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS profile_change (
    tenant_id  TEXT NOT NULL,
    user_id    TEXT NOT NULL,
    change_id  TEXT NOT NULL UNIQUE,
    changes    TEXT NOT NULL,
    expected   TEXT NOT NULL,
    sent       INTEGER NOT NULL DEFAULT 0,
    attempts   INTEGER NOT NULL DEFAULT 0,
    status     TEXT NOT NULL CHECK (status IN ('pending','syncing','synced','conflict','error','needs-login')),
    last_error TEXT,
    conflict   TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    synced_at  TEXT,
    PRIMARY KEY (tenant_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS read_cache (
    tenant_id TEXT NOT NULL,
    user_id   TEXT NOT NULL DEFAULT '',
    cache_key TEXT NOT NULL,
    data      TEXT NOT NULL,
    saved_at  TEXT NOT NULL,
    PRIMARY KEY (tenant_id, user_id, cache_key)
  );
  CREATE INDEX IF NOT EXISTS read_cache_age ON read_cache (tenant_id, user_id, saved_at);
  `,
];

// Igual que el DTO del servidor: texto recortado y vacío = null
function normalizeProfileValue(value) {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed === '' ? null : trimmed;
}

function profileValuesOf(user) {
  const out = {};
  for (const field of PROFILE_FIELDS) out[field] = normalizeProfileValue(user ? user[field] : null);
  return out;
}

/** Lo que se muestra: el perfil del servidor con los cambios todavía no confirmados encima */
function applyPendingValues(user, change) {
  if (!user || !change || change.status === 'synced') return user;
  const out = { ...user };
  for (const field of PROFILE_FIELDS) {
    if (change.changes[field] !== undefined) out[field] = change.changes[field];
  }
  return out;
}

// ─── Sesión (solo lectura de claims; la firma la valida el servidor) ────────────────────────────────

function base64UrlDecode(part) {
  const b64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
  if (typeof atob === 'function') {
    const binary = atob(b64);
    // UTF-8 (nombres con tildes en el payload)
    let encoded = '';
    for (let i = 0; i < binary.length; i += 1) encoded += `%${binary.charCodeAt(i).toString(16).padStart(2, '0')}`;
    return decodeURIComponent(encoded);
  }
  return Buffer.from(b64, 'base64').toString('utf8');
}

function jwtPayload(token) {
  if (typeof token !== 'string') return null;
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    return JSON.parse(base64UrlDecode(part));
  } catch {
    return null;
  }
}

/** ¿El token es de esta persona y de esta tienda? (sin `sub` o sin tienda no se puede afirmar) */
function tokenBelongsTo(token, userId, tenantId) {
  const payload = jwtPayload(token);
  if (!payload || !payload.sub || payload.sub !== userId) return false;
  if (!payload.tenantId || String(payload.tenantId).toLowerCase() !== String(tenantId).toLowerCase()) return false;
  return true;
}

/** El refresh token ya venció: la sesión no se puede renovar y no debe abrirse con datos guardados */
function isTokenExpired(token, now = Date.now()) {
  const payload = jwtPayload(token);
  return !!payload && typeof payload.exp === 'number' && payload.exp * 1000 <= now;
}

// ─── Utilidades ─────────────────────────────────────────────────────────────────────────────────

function defaultNewId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // RFC 4122 v4: es una clave de idempotencia, no un secreto (mismo criterio que utils/checkoutAttempts.ts)
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

const sameValues = (a, b) => !!a && a.length === b.length && a.every((value, i) => value === b[i]);
const unique = (values) => [...new Set(values)];

function requireIds(tenantId, userId) {
  if (!tenantId || !userId) throw new Error('Se necesita la tienda y el usuario');
}

function rowToChange(row) {
  if (!row) return null;
  return {
    tenantId: row.tenant_id,
    userId: row.user_id,
    changeId: row.change_id,
    changes: JSON.parse(row.changes),
    expected: JSON.parse(row.expected),
    sent: !!row.sent,
    attempts: Number(row.attempts),
    status: row.status,
    lastError: row.last_error ?? null,
    conflict: row.conflict ? JSON.parse(row.conflict) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    syncedAt: row.synced_at ?? null,
  };
}

/**
 * @param {{ db: { exec(sql: string): Promise<void>, run(sql: string, params?: unknown[]): Promise<unknown>,
 *   get(sql: string, params?: unknown[]): Promise<any>, all(sql: string, params?: unknown[]): Promise<any[]> },
 *   now?: () => Date, newId?: () => string }} options
 */
function createOfflineStore({ db, now = () => new Date(), newId = defaultNewId }) {
  // Una sola escritura a la vez: cada operación lee y reescribe la fila de la persona (sin carreras entre
  // la pantalla, el sincronizador y los interceptores)
  let queue = Promise.resolve();
  const serialized = (work) => {
    const run = queue.then(work, work);
    queue = run.catch(() => undefined);
    return run;
  };
  const iso = () => now().toISOString();

  let ready = null;
  const init = () => {
    ready ??= (async () => {
      const row = await db.get('PRAGMA user_version');
      const version = Number(row ? row.user_version : 0);
      for (let v = version; v < SCHEMA_VERSION; v += 1) {
        await db.exec(MIGRATIONS[v]);
        await db.exec(`PRAGMA user_version = ${v + 1}`);
      }
    })().catch((error) => {
      ready = null;
      throw error;
    });
    return ready;
  };

  const readChange = async (tenantId, userId) =>
    rowToChange(await db.get('SELECT * FROM profile_change WHERE tenant_id = ? AND user_id = ?', [tenantId, userId]));

  const writeChange = (change) =>
    db.run(
      `INSERT INTO profile_change (tenant_id, user_id, change_id, changes, expected, sent, attempts, status, last_error, conflict, created_at, updated_at, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (tenant_id, user_id) DO UPDATE SET
         change_id = excluded.change_id, changes = excluded.changes, expected = excluded.expected, sent = excluded.sent,
         attempts = excluded.attempts, status = excluded.status, last_error = excluded.last_error, conflict = excluded.conflict,
         created_at = excluded.created_at, updated_at = excluded.updated_at, synced_at = excluded.synced_at`,
      [
        change.tenantId,
        change.userId,
        change.changeId,
        JSON.stringify(change.changes),
        JSON.stringify(change.expected),
        change.sent ? 1 : 0,
        change.attempts,
        change.status,
        change.lastError ?? null,
        change.conflict ? JSON.stringify(change.conflict) : null,
        change.createdAt,
        change.updatedAt,
        change.syncedAt ?? null,
      ]
    );

  const deleteChange = (tenantId, userId) => db.run('DELETE FROM profile_change WHERE tenant_id = ? AND user_id = ?', [tenantId, userId]);

  // Lee-modifica-escribe la fila de (tienda, usuario). `fn` devuelve: objeto = guardar, null = borrar, undefined = nada
  const upsertChange = (tenantId, userId, fn) =>
    serialized(async () => {
      await init();
      const current = await readChange(tenantId, userId);
      const next = fn(current);
      if (next === undefined) return current;
      if (next === null) {
        await deleteChange(tenantId, userId);
        return null;
      }
      if (!STATUSES.includes(next.status)) throw new Error(`Estado inválido: ${next.status}`);
      await writeChange(next);
      return next;
    });

  return {
    init,

    // ─── Copia del perfil ───────────────────────────────────────────────────────────────────────
    async saveProfileSnapshot(tenantId, user) {
      requireIds(tenantId, user && user.id);
      // Solo datos de perfil: si la API agregara algo sensible a /users/me no se guarda por accidente
      const { id, email, firstName, lastName, phone, preferredBranchId, role, createdAt, updatedAt } = user;
      const data = JSON.stringify({ id, email, firstName, lastName, phone, preferredBranchId, role, createdAt, updatedAt });
      await serialized(async () => {
        await init();
        await db.run(
          `INSERT INTO profile_snapshot (tenant_id, user_id, data, saved_at) VALUES (?, ?, ?, ?)
           ON CONFLICT (tenant_id, user_id) DO UPDATE SET data = excluded.data, saved_at = excluded.saved_at`,
          [tenantId, id, data, iso()]
        );
      });
    },

    async getProfileSnapshot(tenantId, userId) {
      await init();
      const row = await db.get('SELECT data, saved_at FROM profile_snapshot WHERE tenant_id = ? AND user_id = ?', [tenantId, userId]);
      return row ? { user: JSON.parse(row.data), savedAt: row.saved_at } : null;
    },

    // ─── Cambio pendiente del perfil (uno por tienda y usuario) ────────────────────────────────
    async getProfileChange(tenantId, userId) {
      if (!tenantId || !userId) return null;
      await init();
      return readChange(tenantId, userId);
    },

    /**
     * Registra lo que el usuario guardó. `serverValues`: la última versión conocida del servidor (de ahí sale
     * el valor esperado de cada campo que se cambia por primera vez). Devuelve el cambio resultante, o null si
     * el formulario quedó igual al servidor. Mismas reglas que la PWA (front/utils/offlineProfile.ts).
     */
    recordProfileEdit(tenantId, userId, serverValues, form) {
      requireIds(tenantId, userId);
      const at = iso();
      return upsertChange(tenantId, userId, (stored) => {
        // Un cambio ya confirmado no es "el anterior": la edición nueva parte de lo que hay en el servidor
        const current = stored && stored.status !== 'synced' ? stored : null;
        const changes = {};
        const expected = {};
        for (const field of PROFILE_FIELDS) {
          if (form[field] === undefined) continue;
          const next = normalizeProfileValue(form[field]);
          const previous = current ? current.expected[field] : undefined;
          if (previous) {
            // El valor ya enviado también puede estar aplicado en el servidor
            const accepted = current.sent && current.changes[field] !== undefined ? unique([...previous, current.changes[field]]) : previous;
            // Volver al valor original solo descarta el campo si nunca se envió nada distinto
            if (accepted.length === 1 && accepted[0] === next) continue;
            changes[field] = next;
            expected[field] = accepted;
          } else if (next !== normalizeProfileValue(serverValues[field])) {
            changes[field] = next;
            expected[field] = [normalizeProfileValue(serverValues[field])];
          }
        }

        if (Object.keys(changes).length === 0) return current ? null : undefined;

        const unchanged =
          current &&
          PROFILE_FIELDS.every((f) => current.changes[f] === changes[f]) &&
          PROFILE_FIELDS.every((f) => (current.expected[f] === undefined) === (expected[f] === undefined)) &&
          PROFILE_FIELDS.every((f) => !expected[f] || sameValues(current.expected[f], expected[f]));
        // Igual a lo ya registrado: mismo changeId (un reintento es el mismo cambio)
        if (current && unchanged && current.status !== 'error' && current.status !== 'conflict') return { ...current, updatedAt: at };

        return {
          tenantId,
          userId,
          // Otro contenido = otro cambio: reusar un changeId ya enviado haría que el servidor lo tome por aplicado
          changeId: current && !current.sent ? current.changeId : newId(),
          changes,
          expected,
          sent: false,
          attempts: 0,
          status: 'pending',
          lastError: null,
          conflict: null,
          createdAt: current ? current.createdAt : at,
          updatedAt: at,
          syncedAt: null,
        };
      });
    },

    /** Modifica el cambio solo si sigue siendo el mismo changeId (si el usuario editó encima, manda lo nuevo) */
    patchProfileChange(tenantId, userId, changeId, patch) {
      return upsertChange(tenantId, userId, (current) => {
        if (!current || current.changeId !== changeId) return undefined;
        return typeof patch === 'function' ? patch(current) : { ...current, ...patch, updatedAt: iso() };
      });
    },

    discardProfileChange(tenantId, userId) {
      return upsertChange(tenantId, userId, (current) => (current ? null : undefined));
    },

    /**
     * Conflicto con otro dispositivo:
     *   "mine":   se reintenta lo mío sabiendo lo que hay ahora en el servidor (esperado = valor actual).
     *   "server": los campos en conflicto quedan como en el servidor; lo demás que cambié sigue pendiente.
     * Siempre con un changeId nuevo: es una decisión nueva del usuario, no un reintento.
     */
    resolveProfileConflict(tenantId, userId, choice) {
      return upsertChange(tenantId, userId, (current) => {
        if (!current || current.status !== 'conflict' || !current.conflict) return undefined;
        const { server, fields } = current.conflict;
        const changes = {};
        const expected = {};
        for (const field of PROFILE_FIELDS) {
          const mine = current.changes[field];
          if (mine === undefined) continue;
          const conflicting = fields.includes(field);
          if (choice === 'server' && conflicting) continue;
          if (mine === server[field]) continue;
          changes[field] = mine;
          expected[field] = conflicting ? [server[field]] : unique([...(current.expected[field] || []), server[field]]);
        }
        if (Object.keys(changes).length === 0) return null;
        return { ...current, changeId: newId(), changes, expected, sent: false, attempts: 0, status: 'pending', lastError: null, conflict: null, updatedAt: iso() };
      });
    },

    /** Volvió a iniciar sesión la misma persona (o pidió reintentar): lo bloqueado vuelve a la cola */
    requeueProfileChange(tenantId, userId, from) {
      return upsertChange(tenantId, userId, (current) => {
        if (!current || !from.includes(current.status)) return undefined;
        return { ...current, status: 'pending', lastError: null, updatedAt: iso() };
      });
    },

    /** Cambios sin confirmar de esta tienda, por usuario (para avisar en el login sin revelar su contenido) */
    async unsyncedUsers(tenantId) {
      if (!tenantId) return [];
      await init();
      const rows = await db.all("SELECT user_id FROM profile_change WHERE tenant_id = ? AND status <> 'synced'", [tenantId]);
      return rows.map((r) => r.user_id);
    },

    // ─── Copias de lectura (catálogo público por tienda; carrito/pedidos por usuario) ─────────────
    async saveRead(tenantId, userId, key, data) {
      if (!tenantId || !key) return;
      const scope = userId || '';
      await serialized(async () => {
        await init();
        await db.run(
          `INSERT INTO read_cache (tenant_id, user_id, cache_key, data, saved_at) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (tenant_id, user_id, cache_key) DO UPDATE SET data = excluded.data, saved_at = excluded.saved_at`,
          [tenantId, scope, key, JSON.stringify(data), iso()]
        );
        await db.run(
          `DELETE FROM read_cache WHERE tenant_id = ? AND user_id = ? AND cache_key NOT IN (
             SELECT cache_key FROM read_cache WHERE tenant_id = ? AND user_id = ? ORDER BY saved_at DESC LIMIT ${READ_CACHE_LIMIT})`,
          [tenantId, scope, tenantId, scope]
        );
      });
    },

    async getRead(tenantId, userId, key) {
      if (!tenantId || !key) return null;
      await init();
      const row = await db.get('SELECT data, saved_at FROM read_cache WHERE tenant_id = ? AND user_id = ? AND cache_key = ?', [tenantId, userId || '', key]);
      return row ? { data: JSON.parse(row.data), savedAt: row.saved_at } : null;
    },

    /**
     * Cierre de sesión: se borran los datos privados guardados de esa persona en esa tienda (copia del perfil,
     * carrito, pedidos). Los cambios de perfil sin confirmar se CONSERVAN hasta que esa misma cuenta vuelva.
     */
    clearUserData(tenantId, userId) {
      return serialized(async () => {
        await init();
        await db.run('DELETE FROM profile_snapshot WHERE tenant_id = ? AND user_id = ?', [tenantId, userId]);
        await db.run('DELETE FROM read_cache WHERE tenant_id = ? AND user_id = ?', [tenantId, userId]);
      });
    },

    /** Sin usuario conocido (sesión perdida): se borra todo lo privado de la tienda; el catálogo público queda */
    clearPrivateData(tenantId) {
      return serialized(async () => {
        await init();
        await db.run('DELETE FROM profile_snapshot WHERE tenant_id = ?', [tenantId]);
        await db.run("DELETE FROM read_cache WHERE tenant_id = ? AND user_id <> ''", [tenantId]);
      });
    },
  };
}

// ─── Sincronización del perfil ──────────────────────────────────────────────────────────────────

/**
 * Envía el cambio pendiente de la sesión activa. Nunca lanza. Reglas:
 *   - Solo el cambio de (tienda, usuario) de la sesión ACTIVA, y solo si el token es de esa misma persona y
 *     tienda. El cambio de otra cuenta queda guardado hasta que esa cuenta vuelva a iniciar sesión.
 *   - Se marca "sincronizando" (y enviado) ANTES de salir a la red.
 *   - "sincronizado" únicamente cuando el servidor responde 200 con el perfil de ese usuario.
 *   - Sin red / 5xx: sigue pendiente con el MISMO changeId (el recibo del servidor hace el reintento idempotente).
 *   - 409 PROFILE_CONFLICT: conflicto para revisar. 401 / sesión perdida: pide iniciar sesión, conserva el cambio.
 *
 * @param {object} deps
 * @param {ReturnType<typeof createOfflineStore>} deps.store
 * @param {() => Promise<{ tenantId: string|null, userId: string|null, accessToken: string|null }>} deps.getSession
 * @param {(change: object, session: object) => Promise<{ status: number, data: any }>} deps.send  Resuelve con la
 *   respuesta HTTP (cualquier status) o lanza si no hubo respuesta.
 * @param {() => Promise<boolean>} [deps.sessionStillValid]  ¿Sigue la sesión tras un fallo? (el cliente HTTP la
 *   borra si no pudo renovarla)
 * @param {(error: any) => string} [deps.errorMessage]
 */
async function syncProfileOnce({ store, getSession, send, sessionStillValid = async () => true, errorMessage = defaultErrorMessage }) {
  const session = await getSession();
  const { tenantId, userId, accessToken } = session || {};
  if (!tenantId || !userId) return 'skipped';

  const change = await store.getProfileChange(tenantId, userId);
  if (!change || !['pending', 'syncing'].includes(change.status)) return 'skipped';

  // Jamás se envía el cambio de A con la sesión de B (ni el de una tienda con el token de otra)
  if (!accessToken || !tokenBelongsTo(accessToken, userId, tenantId)) {
    await store.patchProfileChange(tenantId, userId, change.changeId, { status: 'needs-login' });
    return 'needs-login';
  }

  const at = new Date().toISOString();
  const sending = await store.patchProfileChange(tenantId, userId, change.changeId, (current) => ({
    ...current,
    sent: true,
    attempts: current.attempts + 1,
    status: 'syncing',
    updatedAt: at,
  }));
  if (!sending) return 'skipped';

  let response;
  try {
    response = await send(sending, session);
  } catch (error) {
    if (!(await sessionStillValid())) {
      await store.patchProfileChange(tenantId, userId, sending.changeId, { status: 'needs-login', lastError: null });
      return 'needs-login';
    }
    // Sin respuesta: pudo aplicarse o no. Queda pendiente con el mismo changeId
    await store.patchProfileChange(tenantId, userId, sending.changeId, { status: 'pending', lastError: 'network' });
    return 'pending';
  }

  const { status, data } = response;
  if (status >= 200 && status < 300) {
    if (!data || data.id !== userId) {
      await store.patchProfileChange(tenantId, userId, sending.changeId, { status: 'pending', lastError: 'unexpected-response' });
      return 'pending';
    }
    await store.saveProfileSnapshot(tenantId, data);
    await store.patchProfileChange(tenantId, userId, sending.changeId, (current) => ({
      ...current,
      status: 'synced',
      lastError: null,
      conflict: null,
      syncedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
    return 'synced';
  }

  if (status === 409 && data && data.code === 'PROFILE_CONFLICT' && data.current && data.current.id === userId) {
    const server = profileValuesOf(data.current);
    // Conflicto real: el servidor tiene algo que no es ni lo que leí ni lo que quiero poner
    const fields = PROFILE_FIELDS.filter((field) => {
      if (sending.changes[field] === undefined) return false;
      const accepted = [...(sending.expected[field] || []), sending.changes[field]];
      return !accepted.includes(server[field]);
    });
    await store.saveProfileSnapshot(tenantId, data.current);
    await store.patchProfileChange(tenantId, userId, sending.changeId, { status: 'conflict', conflict: { server, fields }, lastError: null });
    return 'conflict';
  }
  if (status === 401 || !(await sessionStillValid())) {
    await store.patchProfileChange(tenantId, userId, sending.changeId, { status: 'needs-login', lastError: null });
    return 'needs-login';
  }
  if (status >= 500 || status === 429 || status === 408) {
    await store.patchProfileChange(tenantId, userId, sending.changeId, { status: 'pending', lastError: 'server' });
    return 'pending';
  }
  // 400/403/404/otro 409: el servidor lo rechazó con sus reglas. No se reintenta solo
  await store.patchProfileChange(tenantId, userId, sending.changeId, { status: 'error', lastError: errorMessage({ status, data }) });
  return 'error';
}

function defaultErrorMessage({ status, data }) {
  if (data && Array.isArray(data.message)) return data.message.join(', ');
  if (data && typeof data.message === 'string') return data.message;
  return `HTTP ${status}`;
}

// ─── Copias de lectura: qué GET se guardan ──────────────────────────────────────────────────────

// Catálogo: público, se guarda por tienda. Carrito y pedidos: privados, por tienda y usuario.
const PUBLIC_READS = [/^\/products(\/[^/]+)?$/, /^\/categories(\/[^/]+)?$/, /^\/branches$/];
const PRIVATE_READS = [/^\/cart$/, /^\/orders$/, /^\/orders\/(?!attempts\/)[^/]+$/, /^\/payments\/order\/[^/]+$/];

/** 'public' | 'private' | null para una ruta GET relativa a /api/v1 (sin query) */
function readScopeOf(path) {
  const clean = String(path || '').split('?')[0].replace(/\/+$/, '');
  if (PUBLIC_READS.some((re) => re.test(clean))) return 'public';
  if (PRIVATE_READS.some((re) => re.test(clean))) return 'private';
  return null;
}

/** Clave estable de una petición: ruta + parámetros ordenados + idioma (los productos vienen traducidos) */
function readCacheKey(path, params, language) {
  const clean = String(path || '').replace(/\/+$/, '');
  const entries = Object.entries(params || {})
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return `${language || ''}|${clean}${entries.length ? `?${entries.join('&')}` : ''}`;
}

module.exports = {
  PROFILE_FIELDS,
  STATUSES,
  SCHEMA_VERSION,
  createOfflineStore,
  syncProfileOnce,
  normalizeProfileValue,
  profileValuesOf,
  applyPendingValues,
  jwtPayload,
  tokenBelongsTo,
  isTokenExpired,
  readScopeOf,
  readCacheKey,
};

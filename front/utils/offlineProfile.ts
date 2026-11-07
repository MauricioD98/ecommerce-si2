import type { User } from "@/types/auth.types";
import {
    PROFILE_CHANGES_STORE,
    PROFILE_SNAPSHOT_STORE,
    isOfflineDbSupported,
    upsertInOfflineStore,
    withOfflineStore,
} from "./offlineDb";
import { getCurrentTenantId } from "./tenant";

// Perfil del cliente sin conexión. Todo vive en la base IndexedDB de la tienda activa (offlineDb.ts) y cada
// registro lleva el id del usuario: una tienda nunca ve lo de otra y una cuenta nunca ve lo de otra.
//
//   profile_snapshots: lo último que el SERVIDOR dijo del perfil (para mostrarlo offline). Se borra al cerrar
//                      sesión: no es de nadie más que de esa sesión.
//   profile_changes:   la edición hecha sin confirmar. Sobrevive al cierre de sesión (no se pierde trabajo),
//                      pero solo se envía con la sesión de su propio dueño (ver profileSync.ts).
//
// Nada de esto pasa por Cache Storage del service worker. Contraseñas y datos de pago no se guardan nunca.

// Lo mismo que acepta PATCH /users/me/sync (api: OFFLINE_PROFILE_FIELDS). El correo no se edita desde el perfil
export const PROFILE_FIELDS = ["firstName", "lastName", "phone", "preferredBranchId"] as const;
export type ProfileField = (typeof PROFILE_FIELDS)[number];
export type ProfileValues = Record<ProfileField, string | null>;

export const PROFILE_SYNC_EVENT = "sf-profile-sync";

export interface ProfileSnapshot {
    userId: string;
    tenantId: string;
    email: string;
    values: ProfileValues;
    // Para elegir la sucursal favorita sin red. Datos públicos de la tienda
    branches: { id: string; name: string; address?: string | null }[];
    savedAt: string;
}

export type PendingStatus = "pending" | "error" | "conflict" | "needs-login";

export interface PendingProfileChange {
    userId: string;
    tenantId: string;
    // El servidor guarda un recibo por changeId: reenviar el mismo nunca aplica el cambio dos veces
    changeId: string;
    changes: Partial<ProfileValues>;
    // Por campo: valores que se aceptan encontrar en el servidor. El que había antes de editar y, si este
    // cambio ya se envió alguna vez (quizá se aplicó sin que viéramos la respuesta), lo que se envió.
    expected: Partial<Record<ProfileField, (string | null)[]>>;
    // true desde que el changeId actual salió hacia el servidor: editar después obliga a un changeId nuevo
    sent: boolean;
    attempts: number;
    status: PendingStatus;
    lastError?: string | null;
    conflict?: { server: ProfileValues; fields: ProfileField[] } | null;
    createdAt: string;
    updatedAt: string;
}

const newId = () =>
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
              (Number(c) ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (Number(c) / 4)))).toString(16),
          );

// Igual que el DTO del servidor: texto recortado y vacío = null
export function normalizeProfileValue(value: string | null | undefined): string | null {
    if (value === null || value === undefined) return null;
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
}

export function profileValuesOf(user: Partial<User>): ProfileValues {
    return {
        firstName: normalizeProfileValue(user.firstName),
        lastName: normalizeProfileValue(user.lastName),
        phone: normalizeProfileValue(user.phone),
        preferredBranchId: normalizeProfileValue(user.preferredBranchId),
    };
}

const isSupported = () => isOfflineDbSupported() && getCurrentTenantId() !== null;

function notify(): void {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent(PROFILE_SYNC_EVENT));
    try {
        // Las otras pestañas de la misma tienda refrescan su estado (no viaja ningún dato)
        const channel = new BroadcastChannel(PROFILE_SYNC_EVENT);
        channel.postMessage(getCurrentTenantId());
        channel.close();
    } catch {}
}

// ─── Sesión ──────────────────────────────────────────────────────────────────────────────────────

function jwtPayload(token: string | null | undefined): { sub?: string; tenantId?: string; exp?: number } | null {
    if (!token) return null;
    const part = token.split(".")[1];
    if (!part) return null;
    try {
        const json = atob(part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "="));
        return JSON.parse(json);
    } catch {
        return null;
    }
}

/** Id del usuario dueño del token, o null si no se puede leer */
export function tokenSubject(token: string | null | undefined): string | null {
    return jwtPayload(token)?.sub ?? null;
}

/**
 * ¿Se puede mostrar el perfil guardado sin conexión? Sin red no hay cómo preguntarle al servidor, así que
 * se exige una sesión que todavía podría renovarse: refresh token vigente, del mismo usuario y de esta tienda.
 * Con la sesión vencida (o de otra cuenta) se pide iniciar sesión, aunque haya copia local.
 */
export function canUseOfflineSession(auth: { esAutenticado: boolean; refreshToken: string | null; user: User | null }): boolean {
    if (!auth.esAutenticado || !auth.user?.id) return false;
    const payload = jwtPayload(auth.refreshToken);
    if (!payload?.exp || payload.exp * 1000 <= Date.now()) return false;
    if (payload.sub && payload.sub !== auth.user.id) return false;
    const tenantId = getCurrentTenantId();
    if (payload.tenantId && tenantId && payload.tenantId.toLowerCase() !== tenantId) return false;
    return true;
}

// ─── Copia del perfil ─────────────────────────────────────────────────────────────────────────────

export async function getProfileSnapshot(userId: string): Promise<ProfileSnapshot | null> {
    if (!isSupported() || !userId) return null;
    try {
        const snapshot = await withOfflineStore<ProfileSnapshot | undefined>(PROFILE_SNAPSHOT_STORE, "readonly", (store) => store.get(userId));
        // Defensa extra: la base ya es de la tienda, pero un registro con otra tienda no se muestra
        return snapshot && snapshot.userId === userId && snapshot.tenantId === getCurrentTenantId() ? snapshot : null;
    } catch {
        return null;
    }
}

/** Guarda lo que respondió el servidor. `branches` undefined = conservar las que ya había */
export async function saveProfileSnapshot(user: User, branches?: ProfileSnapshot["branches"]): Promise<void> {
    const tenantId = getCurrentTenantId();
    if (!isSupported() || !tenantId || !user?.id) return;
    try {
        await upsertInOfflineStore<ProfileSnapshot>(PROFILE_SNAPSHOT_STORE, user.id, (current) => ({
            userId: user.id,
            tenantId,
            email: user.email,
            values: profileValuesOf(user),
            branches: (branches ?? current?.branches ?? []).map((b) => ({ id: b.id, name: b.name, address: b.address ?? null })),
            savedAt: new Date().toISOString(),
        }));
        notify();
    } catch {}
}

/** Al cerrar sesión: ninguna copia de perfil queda para la próxima persona. Los cambios pendientes NO se tocan */
export async function clearProfileSnapshots(): Promise<void> {
    if (!isSupported()) return;
    try {
        await withOfflineStore(PROFILE_SNAPSHOT_STORE, "readwrite", (store) => store.clear());
        notify();
    } catch {}
}

/** Copias de otras cuentas en esta tienda (p. ej. inició sesión otra persona sin cerrar la anterior) */
export async function dropOtherProfileSnapshots(userId: string): Promise<void> {
    if (!isSupported()) return;
    try {
        const keys = await withOfflineStore<IDBValidKey[]>(PROFILE_SNAPSHOT_STORE, "readonly", (store) => store.getAllKeys());
        for (const key of keys) {
            if (key !== userId) await withOfflineStore(PROFILE_SNAPSHOT_STORE, "readwrite", (store) => store.delete(key));
        }
    } catch {}
}

// ─── Cambio pendiente ─────────────────────────────────────────────────────────────────────────────

export async function getPendingProfileChange(userId: string): Promise<PendingProfileChange | null> {
    if (!isSupported() || !userId) return null;
    try {
        const change = await withOfflineStore<PendingProfileChange | undefined>(PROFILE_CHANGES_STORE, "readonly", (store) => store.get(userId));
        return change && change.userId === userId && change.tenantId === getCurrentTenantId() ? change : null;
    } catch {
        return null;
    }
}

/** ¿Hay cambios de perfil sin enviar en esta tienda? (sin decir de quién: para el aviso del login) */
export async function countPendingProfileChanges(): Promise<number> {
    if (!isSupported()) return 0;
    try {
        return await withOfflineStore<number>(PROFILE_CHANGES_STORE, "readonly", (store) => store.count());
    } catch {
        return 0;
    }
}

const sameValues = (a: (string | null)[] | undefined, b: (string | null)[]) =>
    !!a && a.length === b.length && a.every((value, i) => value === b[i]);

/**
 * Registra lo que el usuario guardó en el formulario. `serverValues` es la última versión conocida del
 * servidor (la copia local): de ahí sale el valor esperado de cada campo que se cambia por primera vez.
 * Devuelve el cambio pendiente resultante, o null si el formulario quedó igual al servidor.
 */
export async function recordProfileEdit(
    userId: string,
    serverValues: ProfileValues,
    form: ProfileValues,
): Promise<PendingProfileChange | null> {
    const tenantId = getCurrentTenantId();
    if (!isOfflineDbSupported() || !tenantId) throw new Error("IndexedDB no disponible");
    const now = new Date().toISOString();

    const result = await upsertInOfflineStore<PendingProfileChange>(PROFILE_CHANGES_STORE, userId, (current) => {
        const changes: Partial<ProfileValues> = {};
        const expected: PendingProfileChange["expected"] = {};
        for (const field of PROFILE_FIELDS) {
            const next = normalizeProfileValue(form[field]);
            const previous = current?.expected[field];
            if (previous) {
                // Ya estaba en el cambio. Si salió hacia el servidor, el valor enviado también puede estar aplicado
                const accepted = current!.sent && current!.changes[field] !== undefined
                    ? [...new Set([...previous, current!.changes[field] ?? null])]
                    : previous;
                // Volver al valor original solo descarta el campo si nunca se envió nada distinto
                if (accepted.length === 1 && accepted[0] === next) continue;
                changes[field] = next;
                expected[field] = accepted;
            } else if (next !== serverValues[field]) {
                changes[field] = next;
                expected[field] = [serverValues[field]];
            }
        }

        if (Object.keys(changes).length === 0) return current ? null : undefined;

        const unchanged =
            current &&
            PROFILE_FIELDS.every((f) => current.changes[f] === changes[f] && (current.expected[f] === undefined) === (expected[f] === undefined)) &&
            PROFILE_FIELDS.every((f) => !expected[f] || sameValues(current.expected[f], expected[f]!));
        // Igual a lo ya registrado: se conserva el mismo changeId (un reintento es el mismo cambio)
        if (current && unchanged && current.status !== "error") return { ...current, updatedAt: now };

        return {
            userId,
            tenantId,
            // Otro contenido = otro cambio. Reusar un changeId ya enviado haría que el servidor lo tome por aplicado
            changeId: current && !current.sent ? current.changeId : newId(),
            changes,
            expected,
            sent: false,
            attempts: 0,
            status: "pending",
            lastError: null,
            conflict: null,
            createdAt: current?.createdAt ?? now,
            updatedAt: now,
        };
    });
    notify();
    return result ?? null;
}

export async function patchPendingProfileChange(
    userId: string,
    changeId: string,
    patch: Partial<PendingProfileChange> | ((current: PendingProfileChange) => PendingProfileChange | null),
): Promise<PendingProfileChange | null> {
    if (!isSupported()) return null;
    // Solo si sigue siendo el mismo cambio: si el usuario editó mientras tanto, la edición nueva manda
    const result = await upsertInOfflineStore<PendingProfileChange>(PROFILE_CHANGES_STORE, userId, (current) => {
        if (!current || current.changeId !== changeId) return undefined;
        return typeof patch === "function" ? patch(current) : { ...current, ...patch, updatedAt: new Date().toISOString() };
    });
    notify();
    return result ?? null;
}

/** El servidor confirmó este changeId: se borra solo si no hubo otra edición encima */
export async function removePendingProfileChange(userId: string, changeId: string): Promise<boolean> {
    if (!isSupported()) return false;
    const result = await upsertInOfflineStore<PendingProfileChange>(PROFILE_CHANGES_STORE, userId, (current) =>
        current && current.changeId === changeId ? null : undefined,
    );
    notify();
    return result === null;
}

/** El usuario decide descartar sus cambios (desde el aviso de conflicto o de error) */
export async function discardPendingProfileChange(userId: string): Promise<void> {
    if (!isSupported()) return;
    await withOfflineStore(PROFILE_CHANGES_STORE, "readwrite", (store) => store.delete(userId));
    notify();
}

/**
 * Resolución de un conflicto:
 *   "mine":   se reintenta lo mío sabiendo lo que hay ahora en el servidor (esperado = valor actual).
 *   "server": los campos en conflicto quedan como en el servidor; lo demás que cambié sigue pendiente.
 * Siempre con un changeId nuevo: es una decisión nueva del usuario, no un reintento.
 */
export async function resolveProfileConflict(userId: string, choice: "mine" | "server"): Promise<PendingProfileChange | null> {
    if (!isSupported()) return null;
    const result = await upsertInOfflineStore<PendingProfileChange>(PROFILE_CHANGES_STORE, userId, (current) => {
        if (!current || current.status !== "conflict" || !current.conflict) return undefined;
        const { server, fields } = current.conflict;
        const changes: Partial<ProfileValues> = {};
        const expected: PendingProfileChange["expected"] = {};
        for (const field of PROFILE_FIELDS) {
            const mine = current.changes[field];
            if (mine === undefined) continue;
            const conflicting = fields.includes(field);
            if (choice === "server" && conflicting) continue;
            if (mine === server[field]) continue;
            changes[field] = mine;
            expected[field] = conflicting ? [server[field]] : [...new Set([...(current.expected[field] ?? []), server[field]])];
        }
        if (Object.keys(changes).length === 0) return null;
        return {
            ...current,
            changeId: newId(),
            changes,
            expected,
            sent: false,
            attempts: 0,
            status: "pending",
            lastError: null,
            conflict: null,
            updatedAt: new Date().toISOString(),
        };
    });
    notify();
    return result ?? null;
}

/** Lo que se ve en el formulario: el servidor con los cambios pendientes encima */
export function applyPendingValues(base: ProfileValues, change: PendingProfileChange | null): ProfileValues {
    if (!change) return base;
    const out = { ...base };
    for (const field of PROFILE_FIELDS) {
        if (change.changes[field] !== undefined) out[field] = change.changes[field] ?? null;
    }
    return out;
}

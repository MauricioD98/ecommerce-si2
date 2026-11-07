import { store } from "@/store";
import { ADMIN_CHANGES_STORE, ADMIN_READ_STORE, isOfflineDbSupported, upsertInOfflineStore, withOfflineStore } from "./offlineDb";
import { getCurrentTenantId } from "./tenant";
import { canAccessAdmin } from "./permissions";

// Panel de administración sin conexión. Todo en la base IndexedDB de la tienda activa:
//
//   admin_read_cache: última respuesta del servidor de cada lista del panel que el usuario abrió (productos,
//                     categorías, colecciones, pedidos, sucursales), por usuario. Datos privados (pedidos con
//                     datos de clientes): se borra al cerrar sesión y nunca pasa por Cache Storage.
//   admin_changes:    cambios hechos sin conexión, en orden. Cada uno lleva lo que cambió y el valor que tenía
//                     cada campo cuando se editó: el servidor solo lo aplica si sigue igual (POST
//                     /admin/offline-sync). Sobrevive al cierre de sesión y solo lo envía su dueño.
//
// Qué se puede hacer sin conexión: editar productos (sin crear), crear y editar categorías y colecciones, cambiar
// el estado de un pedido (no cancelarlo) y ajustar inventario (cola propia, useInventory). Borrar, cancelar, POS,
// pagos, personal, roles y configuración exigen conexión.

export type AdminEntity = "product" | "category" | "collection" | "order";
export type AdminOp = "create" | "update";
export type AdminChangeStatus = "pending" | "error" | "conflict" | "needs-login";

export interface AdminChange {
    changeId: string;
    seq: number;
    userId: string;
    tenantId: string;
    entity: AdminEntity;
    op: AdminOp;
    entityId: string;
    label: string;
    changes: Record<string, unknown>;
    expected: Record<string, unknown>;
    sent: boolean;
    attempts: number;
    status: AdminChangeStatus;
    lastError?: string | null;
    conflict?: { fields: string[]; current: Record<string, unknown> } | null;
    createdAt: string;
    updatedAt: string;
}

interface ReadEntry {
    key: string;
    userId: string;
    tenantId: string;
    url: string;
    data: unknown;
    savedAt: string;
}

export const ADMIN_SYNC_EVENT = "sf-admin-offline-sync";
export const ADMIN_COPY_EVENT = "sf-admin-offline-copy";

const UPDATABLE: Record<AdminEntity, readonly string[]> = {
    product: ["name", "description", "categoryId", "sku", "price", "sizes", "imageUrl", "isActive", "branchId", "collectionIds", "translations"],
    category: ["name", "description", "slug", "imageUrl", "isActive"],
    collection: ["name", "description", "slug", "bannerImageUrl", "isActive"],
    order: ["status"],
};
const CREATE_FIELDS: Partial<Record<AdminEntity, readonly string[]>> = {
    category: ["name", "description", "slug", "imageUrl", "isActive"],
    collection: ["name", "description", "slug", "bannerImageUrl", "isActive"],
};
const MAX_READ_ENTRIES = 150;
const PLACEHOLDER_IMAGE = "https://upload.wikimedia.org/wikipedia/commons/a/a3/Image-not-found.png";

const currentUserId = () => {
    const { auth } = store.getState();
    return auth.esAutenticado ? auth.user?.id ?? null : null;
};
const isSupported = () => isOfflineDbSupported() && getCurrentTenantId() !== null;

export const newId = () =>
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
              (Number(c) ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (Number(c) / 4)))).toString(16),
          );

function notify(): void {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent(ADMIN_SYNC_EVENT));
    try {
        const channel = new BroadcastChannel(ADMIN_SYNC_EVENT);
        channel.postMessage(getCurrentTenantId());
        channel.close();
    } catch {}
}

// Misma forma canónica que el servidor (offline-sync.service.ts → canonical): "" = null, números por valor,
// objetos con claves ordenadas y sin vacíos, collectionIds sin orden. La imagen "no encontrada" = sin imagen.
export function canonical(field: string, value: unknown): string {
    const clean = (v: unknown): unknown => {
        if (v === undefined || v === null) return null;
        if (typeof v === "string") return v.trim() === "" ? null : v.trim();
        if (typeof v === "number") return Number.isFinite(v) ? v : null;
        if (Array.isArray(v)) {
            const items = v.map(clean);
            return field === "collectionIds" ? [...items].map(String).sort() : items;
        }
        if (typeof v === "object") {
            const entries = Object.entries(v as Record<string, unknown>)
                .map(([k, inner]) => [k, clean(inner)] as const)
                .filter(([, inner]) => inner !== null && !(typeof inner === "object" && !Array.isArray(inner) && Object.keys(inner as object).length === 0))
                .sort(([a], [b]) => a.localeCompare(b));
            return entries.length ? Object.fromEntries(entries) : null;
        }
        return v;
    };
    let input = value;
    if (field === "price" && value !== null && value !== undefined && value !== "") input = Number(value);
    if (field === "imageUrl" && value === PLACEHOLDER_IMAGE) input = null;
    return JSON.stringify(clean(input));
}

// ─── Qué URL corresponde a qué entidad ───────────────────────────────────────────────────────────

const READ_PATTERNS: { re: RegExp; entity: AdminEntity | null }[] = [
    { re: /^\/products\/?$/, entity: "product" },
    { re: /^\/categories\/?$/, entity: "category" },
    { re: /^\/collections\/?$/, entity: "collection" },
    { re: /^\/orders\/admin\/all\/?$/, entity: "order" },
    { re: /^\/branches(\/manage\/all)?\/?$/, entity: null },
];

const pathOf = (url?: string) => (url ?? "").replace(/^https?:\/\/[^/]+/, "").replace(/^\/api\/v1/, "").split("?")[0];

export function readEntityOf(url?: string): { cacheable: boolean; entity: AdminEntity | null } {
    const path = pathOf(url);
    const match = READ_PATTERNS.find((p) => p.re.test(path));
    return match ? { cacheable: true, entity: match.entity } : { cacheable: false, entity: null };
}

export type MutationTarget = { entity: AdminEntity; op: AdminOp; entityId: string | null } | { blocked: true };

/**
 * Para una petición que modifica datos: si es un cambio del panel que se puede hacer sin conexión, cuál.
 * `{ blocked: true }`: acción del panel que exige conexión. null: no es del panel (se deja pasar tal cual).
 */
export function mutationTargetOf(method: string, url?: string): MutationTarget | null {
    const m = method.toUpperCase();
    const path = pathOf(url);
    let match: RegExpMatchArray | null;
    if (m === "PATCH" && (match = path.match(/^\/products\/([0-9a-f-]{36})\/?$/))) return { entity: "product", op: "update", entityId: match[1] };
    if (m === "PATCH" && (match = path.match(/^\/categories\/([0-9a-f-]{36})\/?$/))) return { entity: "category", op: "update", entityId: match[1] };
    if (m === "PATCH" && (match = path.match(/^\/collections\/([0-9a-f-]{36})\/?$/))) return { entity: "collection", op: "update", entityId: match[1] };
    if (m === "PATCH" && (match = path.match(/^\/orders\/admin\/([0-9a-f-]{36})\/?$/))) return { entity: "order", op: "update", entityId: match[1] };
    if (m === "POST" && /^\/categories\/?$/.test(path)) return { entity: "category", op: "create", entityId: null };
    if (m === "POST" && /^\/collections\/?$/.test(path)) return { entity: "collection", op: "create", entityId: null };
    // Del panel pero con stock, dinero o borrado de por medio: siempre con conexión
    if (
        /^\/(products|categories|collections|branches|roles|users\/staff)(\/|$)/.test(path) ||
        /^\/orders\/admin(\/|$)/.test(path) ||
        /^\/payment-settings|^\/payments\/proofs|^\/returns|^\/pos|^\/store\/appearance/.test(path)
    ) {
        // El inventario tiene su propia cola sin conexión (useInventory): no se toca
        if (/^\/branches\/[^/]+\/inventory/.test(path)) return null;
        return { blocked: true };
    }
    return null;
}

// ─── Copia de lectura ────────────────────────────────────────────────────────────────────────────

const stableParams = (params: unknown): string => {
    if (!params || typeof params !== "object") return "";
    return Object.entries(params as Record<string, unknown>)
        .filter(([, v]) => v !== undefined && v !== null && v !== "")
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join(",") : String(v)}`)
        .join("&");
};
const readKey = (userId: string, url: string | undefined, params: unknown) => `${userId}|${pathOf(url)}?${stableParams(params)}`;

export async function saveAdminRead(url: string | undefined, params: unknown, data: unknown): Promise<void> {
    // Solo para quien usa el panel: el catálogo de la tienda usa las mismas URL y no hace falta guardarlo aquí
    if (!canAccessAdmin(store.getState().auth.user)) return;
    const userId = currentUserId();
    const tenantId = getCurrentTenantId();
    if (!userId || !tenantId || !isOfflineDbSupported()) return;
    try {
        const entry: ReadEntry = { key: readKey(userId, url, params), userId, tenantId, url: pathOf(url), data, savedAt: new Date().toISOString() };
        await withOfflineStore(ADMIN_READ_STORE, "readwrite", (s) => s.put(entry));
        const all = await withOfflineStore<ReadEntry[]>(ADMIN_READ_STORE, "readonly", (s) => s.getAll());
        if (all.length > MAX_READ_ENTRIES) {
            const oldest = all.sort((a, b) => a.savedAt.localeCompare(b.savedAt)).slice(0, all.length - MAX_READ_ENTRIES);
            for (const e of oldest) await withOfflineStore(ADMIN_READ_STORE, "readwrite", (s) => s.delete(e.key));
        }
    } catch {}
}

export async function getAdminRead(url: string | undefined, params: unknown): Promise<{ data: unknown; savedAt: string } | null> {
    const userId = currentUserId();
    if (!userId || !isSupported()) return null;
    try {
        const entry = await withOfflineStore<ReadEntry | undefined>(ADMIN_READ_STORE, "readonly", (s) => s.get(readKey(userId, url, params)));
        return entry && entry.userId === userId && entry.tenantId === getCurrentTenantId() ? { data: entry.data, savedAt: entry.savedAt } : null;
    } catch {
        return null;
    }
}

/** Al cerrar sesión: nada de lo leído en el panel queda para la próxima persona */
export async function clearAdminReadCache(): Promise<void> {
    if (!isSupported()) return;
    try {
        await withOfflineStore(ADMIN_READ_STORE, "readwrite", (s) => s.clear());
    } catch {}
}

const itemsOf = (data: unknown): Record<string, unknown>[] | null => {
    if (Array.isArray(data)) return data as Record<string, unknown>[];
    const inner = (data as { data?: unknown } | null)?.data;
    return Array.isArray(inner) ? (inner as Record<string, unknown>[]) : null;
};

/** El elemento tal como lo vio el usuario por última vez (la lista guardada más reciente que lo contiene) */
async function lastSeenItem(userId: string, entity: AdminEntity, entityId: string): Promise<Record<string, unknown> | null> {
    const all = await withOfflineStore<ReadEntry[]>(ADMIN_READ_STORE, "readonly", (s) => s.getAll());
    const lists = all
        .filter((e) => e.userId === userId && e.tenantId === getCurrentTenantId() && readEntityOf(e.url).entity === entity)
        .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
    for (const e of lists) {
        const found = itemsOf(e.data)?.find((item) => item?.id === entityId);
        if (found) return found;
    }
    return null;
}

// Valores comparables de un elemento de lista (forma del endpoint de escritura)
function baseValuesOf(entity: AdminEntity, item: Record<string, unknown>): Record<string, unknown> {
    if (entity === "product") {
        return {
            name: item.baseName ?? item.name,
            description: item.baseDescription ?? item.description,
            categoryId: item.categoryId,
            sku: item.sku,
            price: item.price,
            sizes: item.sizes,
            imageUrl: item.imageUrl,
            isActive: item.isActive,
            branchId: item.branchId ?? null,
            collectionIds: Array.isArray(item.collections) ? (item.collections as { id: string }[]).map((c) => c.id) : [],
            translations: item.translations,
        };
    }
    return Object.fromEntries(UPDATABLE[entity].map((f) => [f, item[f]]));
}

// ─── Cola de cambios ─────────────────────────────────────────────────────────────────────────────

async function allChanges(): Promise<AdminChange[]> {
    if (!isSupported()) return [];
    try {
        const all = await withOfflineStore<AdminChange[]>(ADMIN_CHANGES_STORE, "readonly", (s) => s.getAll());
        return all.filter((c) => c.tenantId === getCurrentTenantId()).sort((a, b) => a.seq - b.seq);
    } catch {
        return [];
    }
}

/** Cambios del usuario con sesión (los de otras cuentas no se muestran ni se envían) */
export async function getAdminChanges(userId = currentUserId()): Promise<AdminChange[]> {
    if (!userId) return [];
    return (await allChanges()).filter((c) => c.userId === userId);
}

export async function countOtherUsersAdminChanges(userId: string | null): Promise<number> {
    return (await allChanges()).filter((c) => c.userId !== userId).length;
}

export class AdminOfflineError extends Error {
    constructor(readonly reason: "requires-connection" | "not-cached" | "storage") {
        super(reason);
    }
}

/**
 * Registra un cambio hecho sin conexión y devuelve cómo queda el elemento (para que la pantalla lo muestre).
 * Solo se guarda lo que de verdad cambió respecto de lo que el usuario veía, con ese valor como "esperado".
 */
export async function enqueueAdminChange(
    entity: AdminEntity,
    op: AdminOp,
    entityId: string | null,
    payload: Record<string, unknown>,
): Promise<{ item: Record<string, unknown>; change: AdminChange | null }> {
    const userId = currentUserId();
    const tenantId = getCurrentTenantId();
    if (!userId || !tenantId || !isOfflineDbSupported()) throw new AdminOfflineError("storage");
    const now = new Date().toISOString();
    const queue = await allChanges();
    const seq = (queue.at(-1)?.seq ?? 0) + 1;

    if (op === "create") {
        const fields = CREATE_FIELDS[entity];
        if (!fields) throw new AdminOfflineError("requires-connection");
        const changes = Object.fromEntries(Object.entries(payload).filter(([k, v]) => fields.includes(k) && v !== undefined));
        const change: AdminChange = {
            changeId: newId(), seq, userId, tenantId, entity, op, entityId: newId(),
            label: String(changes.name ?? ""), changes, expected: {}, sent: false, attempts: 0, status: "pending", createdAt: now, updatedAt: now,
        };
        await withOfflineStore(ADMIN_CHANGES_STORE, "readwrite", (s) => s.put(change));
        notify();
        return { item: { id: change.entityId, ...changes, productCount: 0, __offlinePending: true }, change };
    }

    const id = entityId!;
    const forEntity = queue.filter((c) => c.userId === userId && c.entity === entity && c.entityId === id);
    const latest = forEntity.at(-1);

    // Creado sin conexión y todavía sin enviar: se edita la misma creación
    if (latest && latest.op === "create" && !latest.sent) {
        const fields = CREATE_FIELDS[entity] ?? [];
        const merged = { ...latest.changes, ...Object.fromEntries(Object.entries(payload).filter(([k, v]) => fields.includes(k) && v !== undefined)) };
        await withOfflineStore(ADMIN_CHANGES_STORE, "readwrite", (s) => s.put({ ...latest, changes: merged, label: String(merged.name ?? latest.label), updatedAt: now }));
        notify();
        return { item: { id, ...merged, productCount: 0, __offlinePending: true }, change: latest };
    }

    const seen = await lastSeenItem(userId, entity, id);
    // Sin saber qué había, no se puede comprobar después que nadie lo cambió: se exige conexión
    if (!seen && !latest) throw new AdminOfflineError("not-cached");
    const base = seen ? baseValuesOf(entity, seen) : {};
    // Lo pendiente de antes cuenta como "lo que el usuario veía" (se envía primero, en orden)
    for (const c of forEntity) Object.assign(base, c.changes);

    const changes: Record<string, unknown> = {};
    const expected: Record<string, unknown> = {};
    for (const field of UPDATABLE[entity]) {
        if (!(field in payload) || payload[field] === undefined) continue;
        const value = field === "imageUrl" && payload[field] === PLACEHOLDER_IMAGE ? null : payload[field];
        if (canonical(field, value) === canonical(field, base[field])) continue;
        changes[field] = value;
        expected[field] = base[field] ?? null;
    }
    const optimistic = { ...(seen ?? { id }), ...displayFields(entity, { ...changes }), __offlinePending: true };
    if (Object.keys(changes).length === 0) return { item: optimistic, change: null };

    let change: AdminChange;
    if (latest && latest.op === "update" && !latest.sent && latest.status === "pending") {
        // Misma edición sin enviar: se suman los campos; el esperado de cada campo es el de la primera vez
        change = {
            ...latest,
            changes: { ...latest.changes, ...changes },
            expected: { ...expected, ...latest.expected },
            label: labelOf(entity, seen, latest.label),
            updatedAt: now,
        };
    } else {
        change = {
            changeId: newId(), seq, userId, tenantId, entity, op: "update", entityId: id, label: labelOf(entity, seen, latest?.label ?? ""),
            changes, expected, sent: false, attempts: 0, status: "pending", createdAt: now, updatedAt: now,
        };
    }
    await withOfflineStore(ADMIN_CHANGES_STORE, "readwrite", (s) => s.put(change));
    notify();
    return { item: optimistic, change };
}

const labelOf = (entity: AdminEntity, seen: Record<string, unknown> | null, fallback: string) => {
    if (!seen) return fallback;
    if (entity === "order") return `#${String(seen.id).slice(0, 8).toUpperCase()}`;
    return String(seen.baseName ?? seen.name ?? fallback);
};

// Campos del elemento de lista que reflejan cada cambio (la lista muestra name/description traducidos)
function displayFields(entity: AdminEntity, changes: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = { ...changes };
    if (entity === "product") {
        if ("name" in changes) out.baseName = changes.name;
        if ("description" in changes) out.baseDescription = changes.description;
        if ("price" in changes) out.effectivePrice = changes.price;
        delete out.collectionIds;
    }
    return out;
}

/** Superpone lo pendiente a una lista del panel (con o sin conexión), para que se vea lo que se editó */
export async function overlayAdminList(url: string | undefined, params: unknown, data: unknown): Promise<unknown> {
    const { entity } = readEntityOf(url);
    const userId = currentUserId();
    if (!entity || !userId) return data;
    const pending = (await getAdminChanges(userId)).filter((c) => c.entity === entity);
    if (pending.length === 0) return data;
    const items = itemsOf(data);
    if (!items) return data;

    const byId = new Map<string, AdminChange[]>();
    for (const c of pending) byId.set(c.entityId, [...(byId.get(c.entityId) ?? []), c]);
    const patched = items.map((item) => {
        const changes = byId.get(String(item.id));
        if (!changes) return item;
        return changes.reduce((acc, c) => ({ ...acc, ...displayFields(entity, c.changes), __offlinePending: true }), { ...item });
    });
    // Lo creado sin conexión aparece al principio de la primera página (sin búsqueda)
    const p = (params ?? {}) as { page?: number; search?: string };
    const created =
        (p.page ?? 1) === 1 && !p.search
            ? pending
                  .filter((c) => c.op === "create" && !items.some((i) => i.id === c.entityId))
                  .map((c) => ({ id: c.entityId, isActive: true, productCount: 0, ...c.changes, __offlinePending: true }))
            : [];
    const list = [...created, ...patched];
    return Array.isArray(data) ? list : { ...(data as object), data: list };
}

// ─── Estado de cada cambio ───────────────────────────────────────────────────────────────────────

export async function patchAdminChange(changeId: string, patch: Partial<AdminChange>): Promise<void> {
    if (!isSupported()) return;
    await upsertInOfflineStore<AdminChange>(ADMIN_CHANGES_STORE, changeId, (current) =>
        current ? { ...current, ...patch, updatedAt: new Date().toISOString() } : undefined,
    );
    notify();
}

export async function removeAdminChange(changeId: string): Promise<void> {
    if (!isSupported()) return;
    await withOfflineStore(ADMIN_CHANGES_STORE, "readwrite", (s) => s.delete(changeId));
    notify();
}

/**
 * Conflicto: "mine" reintenta lo mío sabiendo lo que hay ahora en el servidor; "server" deja los campos en
 * conflicto como están y mantiene el resto. Siempre con changeId nuevo: es una decisión nueva del usuario.
 */
export async function resolveAdminConflict(changeId: string, choice: "mine" | "server"): Promise<void> {
    const change = (await allChanges()).find((c) => c.changeId === changeId);
    if (!change || change.status !== "conflict" || !change.conflict) return;
    const { fields, current } = change.conflict;
    const changes: Record<string, unknown> = {};
    const expected: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(change.changes)) {
        const conflicting = fields.includes(field);
        if (choice === "server" && conflicting) continue;
        changes[field] = value;
        expected[field] = field in current ? current[field] : change.expected[field];
    }
    await withOfflineStore(ADMIN_CHANGES_STORE, "readwrite", (s) => s.delete(changeId));
    if (Object.keys(changes).length > 0) {
        const next: AdminChange = { ...change, changeId: newId(), changes, expected, sent: false, attempts: 0, status: "pending", lastError: null, conflict: null, updatedAt: new Date().toISOString() };
        await withOfflineStore(ADMIN_CHANGES_STORE, "readwrite", (s) => s.put(next));
    }
    notify();
}

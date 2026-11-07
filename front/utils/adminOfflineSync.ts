import axios from "axios";
import { store } from "@/store";
import { apiClient } from "@/service/api/axios.config";
import { getApiErrorMessage } from "@/service/api/error.utils";
import { getAdminChanges, patchAdminChange, removeAdminChange, type AdminChange } from "./adminOfflineStore";
import { tokenSubject } from "./offlineProfile";
import { getCurrentTenantId } from "./tenant";

// Envío de los cambios del panel hechos sin conexión, de a uno y en el orden en que se hicieron.
//   - Solo los del usuario con sesión, y solo si el token es de ese mismo usuario.
//   - Se marca "enviado" antes de salir a la red: una edición posterior va con otro changeId.
//   - Se borra solo cuando el servidor responde 200.
//   - Sin red / 5xx: queda pendiente y se detiene la cola (se reintenta después). 409: conflicto para revisar.
//     401: pide iniciar sesión. Otro 4xx: error; los cambios posteriores del MISMO dato esperan.
// Los borradores de compra y el inventario tienen sus propias colas: aquí no se tocan.

let inFlight: Promise<number> | null = null;
let syncingId: string | null = null;
export const currentlySyncingAdminChange = () => syncingId;

/** Intenta enviar todo lo pendiente. Devuelve cuántos cambios se confirmaron. Nunca lanza. */
export function syncAdminChanges(): Promise<number> {
    inFlight ??= (async () => {
        const run = () => syncAll();
        try {
            const locks = typeof navigator !== "undefined" ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
            if (locks?.request) return (await locks.request(`sf-admin-sync:${getCurrentTenantId()}`, run)) as number;
            return await run();
        } catch {
            return 0;
        }
    })().finally(() => {
        inFlight = null;
    });
    return inFlight;
}

async function syncAll(): Promise<number> {
    const { auth } = store.getState();
    const userId = auth.user?.id;
    if (!auth.esAutenticado || !userId) return 0;
    if (typeof navigator !== "undefined" && !navigator.onLine) return 0;

    let confirmed = 0;
    const blocked = new Set<string>();
    for (const change of await getAdminChanges(userId)) {
        const key = `${change.entity}:${change.entityId}`;
        if (change.status !== "pending" || blocked.has(key)) {
            if (change.status !== "pending") blocked.add(key);
            continue;
        }
        const subject = tokenSubject(store.getState().auth.accessToken);
        if (!store.getState().auth.accessToken || (subject && subject !== userId)) {
            await patchAdminChange(change.changeId, { status: "needs-login" });
            return confirmed;
        }
        const outcome = await sendOne(change);
        if (outcome === "synced") confirmed += 1;
        else if (outcome === "stop") return confirmed;
        else blocked.add(key);
    }
    return confirmed;
}

async function sendOne(change: AdminChange): Promise<"synced" | "stop" | "blocked"> {
    await patchAdminChange(change.changeId, { sent: true, attempts: change.attempts + 1 });
    syncingId = change.changeId;
    window.dispatchEvent(new CustomEvent("sf-admin-offline-sync"));
    try {
        await apiClient.post("/admin/offline-sync", {
            changeId: change.changeId,
            entity: change.entity,
            op: change.op,
            entityId: change.entityId,
            changes: change.changes,
            expected: change.expected,
        });
        await removeAdminChange(change.changeId);
        return "synced";
    } catch (error) {
        if (!axios.isAxiosError(error) || !error.response) {
            // Sin respuesta: puede haberse aplicado o no. Mismo changeId: el recibo del servidor lo resuelve
            await patchAdminChange(change.changeId, { status: "pending", lastError: "network" });
            return "stop";
        }
        const { status, data } = error.response as { status: number; data?: { code?: string; fields?: string[]; current?: Record<string, unknown> } };
        if (status === 409 && data?.code === "OFFLINE_CONFLICT") {
            await patchAdminChange(change.changeId, { status: "conflict", conflict: { fields: data.fields ?? [], current: data.current ?? {} }, lastError: null });
            return "blocked";
        }
        if (status === 401) {
            await patchAdminChange(change.changeId, { status: "needs-login", lastError: null });
            return "stop";
        }
        if (status >= 500 || status === 429 || status === 408) {
            await patchAdminChange(change.changeId, { status: "pending", lastError: "server" });
            return "stop";
        }
        await patchAdminChange(change.changeId, { status: "error", lastError: getApiErrorMessage(error, "error") });
        return "blocked";
    } finally {
        syncingId = null;
        window.dispatchEvent(new CustomEvent("sf-admin-offline-sync"));
    }
}

/** Reintentar (a pedido del usuario o al volver a iniciar sesión): lo que estaba en error o esperando sesión */
export async function requeueAdminChanges(from: ("error" | "needs-login")[]): Promise<void> {
    for (const change of await getAdminChanges()) {
        if (from.includes(change.status as "error" | "needs-login")) {
            await patchAdminChange(change.changeId, { status: "pending", lastError: null });
        }
    }
}

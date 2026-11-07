import axios from "axios";
import { store } from "@/store";
import { setUser } from "@/store/slices/authSlices";
import { apiClient } from "@/service/api/axios.config";
import { getApiErrorMessage } from "@/service/api/error.utils";
import type { User } from "@/types/auth.types";
import {
    PROFILE_FIELDS,
    PROFILE_SYNC_EVENT,
    getPendingProfileChange,
    patchPendingProfileChange,
    profileValuesOf,
    removePendingProfileChange,
    saveProfileSnapshot,
    tokenSubject,
    type PendingProfileChange,
    type ProfileField,
} from "./offlineProfile";
import { getCurrentTenantId } from "./tenant";

// Envío de los cambios de perfil hechos sin conexión. Reglas:
//   - Solo el cambio del usuario con la sesión ACTIVA, y solo si el token es de ese mismo usuario. El cambio
//     de otra cuenta se queda guardado hasta que esa cuenta vuelva a iniciar sesión.
//   - Se marca "enviado" ANTES de salir a la red: si el usuario edita después, va con otro changeId.
//   - Se borra únicamente cuando el servidor responde 200 con el perfil de ese usuario.
//   - Sin red / 5xx: sigue pendiente y se reintenta. 409: conflicto para revisar. 401: pide iniciar sesión.
// Nada de esto toca los borradores de compra: esos nunca se envían solos.

type Outcome = "synced" | "pending" | "conflict" | "error" | "needs-login" | "skipped";

let inFlight: Promise<Outcome> | null = null;
// Cambios enviándose ahora mismo en esta pestaña (para el estado "sincronizando")
const syncing = new Set<string>();
const lastSynced = new Map<string, number>();

const key = (userId: string) => `${getCurrentTenantId() ?? "no-tenant"}:${userId}`;
export const isProfileSyncing = (userId: string) => syncing.has(key(userId));
export const lastProfileSyncAt = (userId: string) => lastSynced.get(key(userId)) ?? null;

const emit = () => {
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(PROFILE_SYNC_EVENT));
};

/** Intenta enviar el cambio pendiente del usuario con sesión. Nunca lanza. */
export function syncPendingProfile(): Promise<Outcome> {
    // Una sola sincronización a la vez por pestaña; entre pestañas, navigator.locks si existe
    inFlight ??= (async () => {
        const run = () => syncOnce();
        try {
            const locks = typeof navigator !== "undefined" ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
            if (locks?.request) {
                return (await locks.request(`sf-profile-sync:${getCurrentTenantId()}`, run)) as Outcome;
            }
            return await run();
        } catch {
            return "pending" as Outcome;
        }
    })().finally(() => {
        inFlight = null;
    });
    return inFlight;
}

async function syncOnce(): Promise<Outcome> {
    const { auth } = store.getState();
    const userId = auth.user?.id;
    if (!auth.esAutenticado || !userId) return "skipped";
    if (typeof navigator !== "undefined" && !navigator.onLine) return "skipped";

    const change = await getPendingProfileChange(userId);
    if (!change || change.status === "conflict" || change.status === "error") return "skipped";

    // El token tiene que ser de la misma persona: jamás se envía el cambio de A con la sesión de B
    const subject = tokenSubject(auth.accessToken);
    if (!auth.accessToken || (subject && subject !== userId)) {
        await patchPendingProfileChange(userId, change.changeId, { status: "needs-login" });
        return "needs-login";
    }

    const sending = await patchPendingProfileChange(userId, change.changeId, (current) => ({
        ...current,
        sent: true,
        attempts: current.attempts + 1,
        status: "pending",
        updatedAt: new Date().toISOString(),
    }));
    if (!sending) return "skipped";

    const k = key(userId);
    syncing.add(k);
    emit();
    try {
        const response = await apiClient.patch<User>("/users/me/sync", {
            changeId: sending.changeId,
            changes: sending.changes,
            expected: sending.expected,
        });
        const profile = response.data;
        if (!profile || profile.id !== userId) {
            await patchPendingProfileChange(userId, sending.changeId, { status: "pending", lastError: "unexpected-response" });
            return "pending";
        }
        await saveProfileSnapshot(profile);
        await removePendingProfileChange(userId, sending.changeId);
        // La sesión pudo cambiar mientras tanto: solo se actualiza el usuario en pantalla si sigue siendo el mismo
        if (store.getState().auth.user?.id === userId) store.dispatch(setUser({ ...store.getState().auth.user, ...profile }));
        lastSynced.set(k, Date.now());
        return "synced";
    } catch (error) {
        return await handleFailure(userId, sending, error);
    } finally {
        syncing.delete(k);
        emit();
    }
}

async function handleFailure(userId: string, change: PendingProfileChange, error: unknown): Promise<Outcome> {
    if (!axios.isAxiosError(error) || !error.response) {
        // Sin respuesta: puede haberse aplicado o no. Queda pendiente con el MISMO changeId; el recibo del
        // servidor resuelve el reintento
        await patchPendingProfileChange(userId, change.changeId, { status: "pending", lastError: "network" });
        return "pending";
    }
    const { status, data } = error.response as { status: number; data?: { code?: string; current?: User } };

    if (status === 409 && data?.code === "PROFILE_CONFLICT" && data.current?.id === userId) {
        const server = profileValuesOf(data.current);
        // Conflicto real: el servidor tiene algo que no es ni lo que leí ni lo que quiero poner
        const fields = PROFILE_FIELDS.filter((field: ProfileField) => {
            if (change.changes[field] === undefined) return false;
            const accepted = [...(change.expected[field] ?? []), change.changes[field] ?? null];
            return !accepted.includes(server[field]);
        });
        await saveProfileSnapshot(data.current);
        await patchPendingProfileChange(userId, change.changeId, {
            status: "conflict",
            conflict: { server, fields },
            lastError: null,
        });
        return "conflict";
    }
    if (status === 401) {
        // El interceptor ya intentó renovar la sesión y no pudo. El cambio se conserva tal cual
        await patchPendingProfileChange(userId, change.changeId, { status: "needs-login", lastError: null });
        return "needs-login";
    }
    if (status >= 500 || status === 429 || status === 408) {
        await patchPendingProfileChange(userId, change.changeId, { status: "pending", lastError: "server" });
        return "pending";
    }
    // 400/403/404/409 ajeno: el servidor lo rechazó con sus reglas. No se reintenta solo; el usuario corrige o descarta
    await patchPendingProfileChange(userId, change.changeId, {
        status: "error",
        lastError: getApiErrorMessage(error, "error"),
    });
    return "error";
}

/** El usuario volvió a iniciar sesión (o pidió reintentar): lo que esperaba sesión o corrección vuelve a la cola */
export async function requeuePendingProfile(userId: string, from: ("needs-login" | "error")[]): Promise<void> {
    const change = await getPendingProfileChange(userId);
    if (!change || !from.includes(change.status as "needs-login" | "error")) return;
    await patchPendingProfileChange(userId, change.changeId, { status: "pending", lastError: null });
}

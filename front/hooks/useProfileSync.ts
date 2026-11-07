import { useCallback, useEffect, useState } from "react";
import { useSelector } from "react-redux";
import type { IRootState } from "@/store";
import { useNetworkStatus } from "./useNetworkStatus";
import {
    PROFILE_SYNC_EVENT,
    getPendingProfileChange,
    getProfileSnapshot,
    type PendingProfileChange,
    type ProfileSnapshot,
} from "@/utils/offlineProfile";
import { isProfileSyncing, lastProfileSyncAt, requeuePendingProfile, syncPendingProfile } from "@/utils/profileSync";
import { getCurrentTenantId } from "@/utils/tenant";

const RETRY_MS = 30_000;

/**
 * Montado una vez (OfflineSyncProvider): envía el cambio de perfil pendiente al abrir la app, al volver la
 * conexión, al volver a la pestaña y cada 30 s mientras siga pendiente. Al iniciar sesión el mismo usuario,
 * lo que esperaba una sesión nueva vuelve a la cola. Solo actúa sobre el cambio de la cuenta con sesión.
 */
export function useProfileSyncRunner(): void {
    const userId = useSelector((state: IRootState) => (state.auth.esAutenticado ? state.auth.user?.id ?? null : null));
    const accessToken = useSelector((state: IRootState) => state.auth.accessToken);

    useEffect(() => {
        if (!userId || !getCurrentTenantId()) return;
        let cancelled = false;
        const run = () => {
            if (!cancelled) void syncPendingProfile();
        };
        // Sesión nueva (o renovada) del dueño del cambio: si esperaba iniciar sesión, se reintenta ya
        void requeuePendingProfile(userId, ["needs-login"]).then(run);

        const onVisible = () => document.visibilityState === "visible" && run();
        window.addEventListener("online", run);
        document.addEventListener("visibilitychange", onVisible);
        const timer = window.setInterval(async () => {
            const change = await getPendingProfileChange(userId);
            if (change?.status === "pending" && navigator.onLine) run();
        }, RETRY_MS);
        return () => {
            cancelled = true;
            window.removeEventListener("online", run);
            document.removeEventListener("visibilitychange", onVisible);
            window.clearInterval(timer);
        };
    }, [userId, accessToken]);
}

export type ProfileSyncView = "idle" | "offline" | "pending" | "syncing" | "synced" | "error" | "conflict" | "needs-login";

export interface OfflineProfileState {
    loaded: boolean;
    snapshot: ProfileSnapshot | null;
    pending: PendingProfileChange | null;
    view: ProfileSyncView;
    isOnline: boolean;
    reload: () => Promise<void>;
}

/** Copia local + cambio pendiente del usuario indicado, y el estado a mostrar. Se actualiza solo */
export function useOfflineProfile(userId: string | null | undefined): OfflineProfileState {
    const { isOnline } = useNetworkStatus();
    const [loaded, setLoaded] = useState(false);
    const [snapshot, setSnapshot] = useState<ProfileSnapshot | null>(null);
    const [pending, setPending] = useState<PendingProfileChange | null>(null);
    const [syncing, setSyncing] = useState(false);
    const [syncedAt, setSyncedAt] = useState<number | null>(null);

    const reload = useCallback(async () => {
        if (!userId) {
            setSnapshot(null);
            setPending(null);
            setLoaded(true);
            return;
        }
        const [s, p] = await Promise.all([getProfileSnapshot(userId), getPendingProfileChange(userId)]);
        setSnapshot(s);
        setPending(p);
        setSyncing(isProfileSyncing(userId));
        setSyncedAt(lastProfileSyncAt(userId));
        setLoaded(true);
    }, [userId]);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        void reload();
        const onChange = () => void reload();
        window.addEventListener(PROFILE_SYNC_EVENT, onChange);
        let channel: BroadcastChannel | null = null;
        try {
            channel = new BroadcastChannel(PROFILE_SYNC_EVENT);
            channel.onmessage = (event) => event.data === getCurrentTenantId() && onChange();
        } catch {}
        return () => {
            window.removeEventListener(PROFILE_SYNC_EVENT, onChange);
            channel?.close();
        };
    }, [reload]);

    let view: ProfileSyncView = "idle";
    if (syncing) view = "syncing";
    else if (pending?.status === "conflict") view = "conflict";
    else if (pending?.status === "needs-login") view = "needs-login";
    else if (pending?.status === "error") view = "error";
    else if (pending) view = isOnline ? "pending" : "offline";
    else if (!isOnline) view = "offline";
    else if (syncedAt) view = "synced";

    return { loaded, snapshot, pending, view, isOnline, reload };
}

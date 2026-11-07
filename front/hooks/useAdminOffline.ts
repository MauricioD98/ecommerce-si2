import { useCallback, useEffect, useState } from "react";
import { useSelector } from "react-redux";
import type { IRootState } from "@/store";
import { useNetworkStatus } from "./useNetworkStatus";
import { ADMIN_COPY_EVENT, ADMIN_SYNC_EVENT, getAdminChanges, type AdminChange } from "@/utils/adminOfflineStore";
import { currentlySyncingAdminChange, requeueAdminChanges, syncAdminChanges } from "@/utils/adminOfflineSync";
import { canAccessAdmin } from "@/utils/permissions";
import { getCurrentTenantId } from "@/utils/tenant";

const RETRY_MS = 30_000;

/**
 * Montado una vez (OfflineSyncProvider), solo para usuarios del panel: envía los cambios pendientes al abrir la
 * app, al volver la conexión, al volver a la pestaña y cada 30 s mientras haya pendientes. Con una sesión nueva
 * del mismo usuario, lo que esperaba iniciar sesión vuelve a la cola.
 */
export function useAdminSyncRunner(): void {
    const user = useSelector((state: IRootState) => (state.auth.esAutenticado ? state.auth.user : null));
    const accessToken = useSelector((state: IRootState) => state.auth.accessToken);
    const userId = user && canAccessAdmin(user) ? user.id : null;

    useEffect(() => {
        if (!userId || !getCurrentTenantId()) return;
        let cancelled = false;
        const run = () => {
            if (!cancelled) void syncAdminChanges();
        };
        void requeueAdminChanges(["needs-login"]).then(run);
        const onVisible = () => document.visibilityState === "visible" && run();
        window.addEventListener("online", run);
        document.addEventListener("visibilitychange", onVisible);
        const timer = window.setInterval(async () => {
            if (navigator.onLine && (await getAdminChanges(userId)).some((c) => c.status === "pending")) run();
        }, RETRY_MS);
        return () => {
            cancelled = true;
            window.removeEventListener("online", run);
            document.removeEventListener("visibilitychange", onVisible);
            window.clearInterval(timer);
        };
    }, [userId, accessToken]);
}

/** Cambios pendientes del usuario con sesión, cuál se está enviando y desde cuándo es la copia mostrada */
export function useAdminOfflineState() {
    const { isOnline } = useNetworkStatus();
    const userId = useSelector((state: IRootState) => state.auth.user?.id ?? null);
    const [changes, setChanges] = useState<AdminChange[]>([]);
    const [syncingId, setSyncingId] = useState<string | null>(null);
    const [copyAt, setCopyAt] = useState<string | null>(null);

    const reload = useCallback(async () => {
        setChanges(userId ? await getAdminChanges(userId) : []);
        setSyncingId(currentlySyncingAdminChange());
    }, [userId]);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        void reload();
        const onChange = () => void reload();
        const onCopy = (event: Event) => setCopyAt((event as CustomEvent<string>).detail ?? null);
        window.addEventListener(ADMIN_SYNC_EVENT, onChange);
        window.addEventListener(ADMIN_COPY_EVENT, onCopy);
        let channel: BroadcastChannel | null = null;
        try {
            channel = new BroadcastChannel(ADMIN_SYNC_EVENT);
            channel.onmessage = (event) => event.data === getCurrentTenantId() && onChange();
        } catch {}
        return () => {
            window.removeEventListener(ADMIN_SYNC_EVENT, onChange);
            window.removeEventListener(ADMIN_COPY_EVENT, onCopy);
            channel?.close();
        };
    }, [reload]);

    // Con conexión, la copia deja de ser lo que se muestra
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (isOnline) setCopyAt(null);
    }, [isOnline]);

    return { changes, syncingId, isOnline, copyAt, reload };
}

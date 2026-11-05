import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { useSelector } from "react-redux";
import type { IRootState } from "@/store";
import { InventoryService } from "@/service/api/inventory.service";
import { useTranslations } from "next-intl";
import { getApiErrorMessage } from "@/service/api/error.utils";
import {
    getOfflineInventoryUpdates,
    removeOfflineInventoryUpdate,
    updateOfflineInventoryUpdate,
    OfflineInventoryUpdate,
} from "@/utils/offlineInventoryQueue";
import { getCurrentTenantId } from "@/utils/tenant";

export function useOfflineInventorySync() {
    const t = useTranslations("Offline");
    const userId = useSelector((state: IRootState) => state.auth.user?.id ?? null);
    const [pendingCount, setPendingCount] = useState(0);
    const [pendingUpdates, setPendingUpdates] = useState<OfflineInventoryUpdate[]>([]);
    const [isSyncing, setIsSyncing] = useState(false);
    const [lastSyncError, setLastSyncError] = useState<string | null>(null);
    const [lastSyncSuccess, setLastSyncSuccess] = useState<string | null>(null);
    const syncingRef = useRef(false);

    // Cola aislada por cuenta (además de por tienda): la de otra persona ni se muestra ni se envía
    const ownUpdates = useCallback(async () => {
        const updates = await getOfflineInventoryUpdates();
        return updates.filter((update) => update.userId === userId || update.userId === undefined || update.userId === null);
    }, [userId]);

    const refreshCount = useCallback(async () => {
        const updates = await ownUpdates();
        setPendingUpdates(updates);
        setPendingCount(updates.length);
    }, [ownUpdates]);

    const sendAll = useCallback(async () => {
        let failureMessage: string | null = null;
        let successCount = 0;
        const updates = await ownUpdates();
        for (const update of updates) {
            // Colas antiguas sin versión esperada: no se pueden aplicar sin riesgo de resucitar stock vendido
            const isLegacy = !update.userId || !update.payload.operationId || update.payload.sizes.some((size) => size.expectedVersion === undefined);
            if (isLegacy) {
                if (update.status !== "conflict") await updateOfflineInventoryUpdate(update.id, { status: "conflict", lastError: t("inventoryNeedsReview") });
                continue;
            }
            // Conflicto o rechazo permanente: no se reintenta indefinidamente, espera una decisión
            if (update.status !== "pending") continue;
            try {
                await InventoryService.saveInventory(update.branchId, update.productId, update.payload);
                await removeOfflineInventoryUpdate(update.id);
                successCount += 1;
            } catch (error) {
                const response = axios.isAxiosError(error) ? error.response : undefined;
                const message = getApiErrorMessage(error, t("syncError", { name: update.productName || update.productId }));
                if (response?.data?.code === "INVENTORY_VERSION_CONFLICT") {
                    await updateOfflineInventoryUpdate(update.id, { status: "conflict", conflicts: response.data.conflicts, lastError: message });
                } else if (response && response.status < 500) {
                    await updateOfflineInventoryUpdate(update.id, { status: "failed", lastError: message });
                } else {
                    // Sin respuesta: la misma operationId hace seguro reintentarlo después
                    await updateOfflineInventoryUpdate(update.id, { lastError: message });
                }
                failureMessage = message;
            }
        }
        return { failureMessage, successCount };
    }, [ownUpdates, t]);

    const syncNow = useCallback(async () => {
        if (typeof navigator === "undefined" || !navigator.onLine || syncingRef.current || !userId) return;

        syncingRef.current = true;
        setIsSyncing(true);
        setLastSyncError(null);
        setLastSyncSuccess(null);

        try {
            let result = { failureMessage: null as string | null, successCount: 0 };
            if (navigator.locks) {
                await navigator.locks.request(`sf-inventory-sync:${getCurrentTenantId()}:${userId}`, { ifAvailable: true }, async (lock) => {
                    if (lock) result = await sendAll();
                });
            } else {
                result = await sendAll();
            }

            setLastSyncError(result.failureMessage);
            if (result.successCount > 0) {
                setLastSyncSuccess(t("syncSuccess", { count: result.successCount }));
                navigator.serviceWorker?.controller?.postMessage({ type: "CLEAR_API_CACHE" });
                window.dispatchEvent(new CustomEvent("inventory-changed"));
                window.dispatchEvent(new CustomEvent("inventory-synced"));
            }
        } finally {
            await refreshCount();
            syncingRef.current = false;
            setIsSyncing(false);
        }
    }, [refreshCount, sendAll, t, userId]);

    // Resolución explícita de un conflicto: aplica el valor propuesto sobre la versión ACTUAL, con una
    // operación nueva. Si el stock volvió a cambiar, habrá otro conflicto.
    const resolveConflict = useCallback(
        async (update: OfflineInventoryUpdate) => {
            const conflicts = new Map((update.conflicts ?? []).map((conflict) => [conflict.size, conflict]));
            await updateOfflineInventoryUpdate(update.id, {
                status: "pending",
                conflicts: undefined,
                lastError: undefined,
                payload: {
                    ...update.payload,
                    operationId: crypto.randomUUID(),
                    sizes: update.payload.sizes.map((size) => ({ ...size, expectedVersion: conflicts.get(size.size)?.currentVersion ?? size.expectedVersion })),
                },
            });
            await syncNow();
        },
        [syncNow],
    );

    const discardUpdate = useCallback(
        async (update: OfflineInventoryUpdate) => {
            await removeOfflineInventoryUpdate(update.id);
            await refreshCount();
            window.dispatchEvent(new CustomEvent("inventory-changed"));
        },
        [refreshCount],
    );

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        refreshCount();
        syncNow();

        window.addEventListener("online", syncNow);
        window.addEventListener("offline-inventory-added", refreshCount);

        return () => {
            window.removeEventListener("online", syncNow);
            window.removeEventListener("offline-inventory-added", refreshCount);
        };
    }, [refreshCount, syncNow]);

    return {
        pendingCount,
        pendingUpdates,
        isSyncing,
        lastSyncError,
        lastSyncSuccess,
        syncNow,
        refreshCount,
        resolveConflict,
        discardUpdate,
    };
}

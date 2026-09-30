import { useCallback, useEffect, useRef, useState } from "react";
import { InventoryService } from "@/service/api/inventory.service";
import { getApiErrorMessage } from "@/service/api/error.utils";
import {
    getOfflineInventoryUpdates,
    removeOfflineInventoryUpdate,
    updateOfflineInventoryUpdate,
    OfflineInventoryUpdate,
} from "@/utils/offlineInventoryQueue";

export function useOfflineInventorySync() {
    const [pendingCount, setPendingCount] = useState(0);
    const [pendingUpdates, setPendingUpdates] = useState<OfflineInventoryUpdate[]>([]);
    const [isSyncing, setIsSyncing] = useState(false);
    const [lastSyncError, setLastSyncError] = useState<string | null>(null);
    const [lastSyncSuccess, setLastSyncSuccess] = useState<string | null>(null);
    const syncingRef = useRef(false);

    const refreshCount = useCallback(async () => {
        const updates = await getOfflineInventoryUpdates();
        setPendingUpdates(updates);
        setPendingCount(updates.length);
    }, []);

    const syncNow = useCallback(async () => {
        if (typeof navigator === "undefined" || !navigator.onLine || syncingRef.current) return;

        syncingRef.current = true;
        setIsSyncing(true);
        setLastSyncError(null);
        setLastSyncSuccess(null);
        let failureMessage: string | null = null;
        let successCount = 0;

        try {
            const updates = await getOfflineInventoryUpdates();
            for (const update of updates) {
                try {
                    await InventoryService.saveInventory(update.branchId, update.productId, update.payload);
                    await removeOfflineInventoryUpdate(update.id);
                    successCount += 1;
                } catch (error) {
                    const message = getApiErrorMessage(
                        error,
                        `Error al actualizar stock de ${update.productName || update.productId}`
                    );
                    await updateOfflineInventoryUpdate(update.id, { status: "failed", lastError: message });
                    failureMessage = message;
                }
            }

            if (successCount > 0) {
                setLastSyncSuccess(
                    `¡Se sincronizaron exitosamente ${successCount} cambio(s) de stock con la base de datos en Neon!`
                );
                if (typeof window !== "undefined") {
                    if (navigator.serviceWorker?.controller) {
                        navigator.serviceWorker.controller.postMessage({ type: "CLEAR_API_CACHE" });
                    }
                    window.dispatchEvent(new CustomEvent("inventory-changed"));
                    window.dispatchEvent(new CustomEvent("inventory-synced"));
                }
            }
        } finally {
            setLastSyncError(failureMessage);
            await refreshCount();
            syncingRef.current = false;
            setIsSyncing(false);
        }
    }, [refreshCount]);

    useEffect(() => {
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
    };
}

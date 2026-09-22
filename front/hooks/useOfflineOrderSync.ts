import { useCallback, useEffect, useRef, useState } from "react";
import { OrderService } from "@/service/api/order.service";
import { getApiErrorMessage } from "@/service/api/error.utils";
import { getOfflineOrders, removeOfflineOrder, updateOfflineOrder } from "@/utils/offlineOrderQueue";

// Cola y sincronización de pedidos guardados offline (checkout web del cliente final).
// Se dispara: al montar (por si se cerró la app con pedidos pendientes y ya hay conexión),
// y cada vez que el navegador emite el evento "online". Nunca se ejecuta si no hay red.
export function useOfflineOrderSync() {
    const [pendingCount, setPendingCount] = useState(0);
    const [isSyncing, setIsSyncing] = useState(false);
    const [lastSyncError, setLastSyncError] = useState<string | null>(null);
    // Ref (no state) para el guard de "ya hay una sincronización en curso": si fuera state, el
    // listener de "online" (agregado una sola vez) quedaría con un closure viejo y el guard no serviría
    const syncingRef = useRef(false);

    const refreshCount = useCallback(async () => {
        const orders = await getOfflineOrders();
        setPendingCount(orders.length);
    }, []);

    const syncNow = useCallback(async () => {
        if (typeof navigator === "undefined" || !navigator.onLine || syncingRef.current) return;

        syncingRef.current = true;
        setIsSyncing(true);
        let failureMessage: string | null = null;

        try {
            const orders = await getOfflineOrders();
            // Uno por uno: si un pedido falla (ej. sin stock), no debe bloquear el envío de los demás
            for (const offlineOrder of orders) {
                try {
                    await OrderService.createOrder(offlineOrder.payload);
                    await removeOfflineOrder(offlineOrder.id);
                } catch (error) {
                    const message = getApiErrorMessage(error, "No se pudo enviar un pedido guardado en este dispositivo.");
                    await updateOfflineOrder(offlineOrder.id, { status: "failed", lastError: message });
                    failureMessage = message;
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
        // Efecto legítimo (no un sustituto de estado inicial): suscribe al evento "online" del
        // navegador y dispara una carga/sincronización async al montar; el setState real ocurre
        // después de un await dentro de refreshCount/syncNow, nunca de forma síncrona acá.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        refreshCount();
        syncNow();
        window.addEventListener("online", syncNow);
        return () => window.removeEventListener("online", syncNow);
    }, [refreshCount, syncNow]);

    return { pendingCount, isSyncing, lastSyncError, syncNow };
}

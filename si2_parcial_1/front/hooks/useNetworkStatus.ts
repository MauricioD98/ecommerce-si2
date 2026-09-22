import { useEffect, useState } from "react";

// navigator.onLine no existe en SSR: se asume "online" en el render del servidor (evita mismatch de
// hidratación) y se corrige apenas monta en el cliente.
export function useNetworkStatus(): { isOnline: boolean } {
    // Lazy initializer (no un setState dentro del efecto): en el cliente lee el valor real desde
    // el primer render; en SSR sigue asumiendo "online" porque navigator no existe ahí.
    const [isOnline, setIsOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));

    useEffect(() => {
        const handleOnline = () => setIsOnline(true);
        const handleOffline = () => setIsOnline(false);

        window.addEventListener("online", handleOnline);
        window.addEventListener("offline", handleOffline);

        return () => {
            window.removeEventListener("online", handleOnline);
            window.removeEventListener("offline", handleOffline);
        };
    }, []);

    return { isOnline };
}

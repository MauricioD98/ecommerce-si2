"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { getCurrentTenantId, onTenantSelectionRequested } from "@/utils/tenant";
import { isPlatformPath } from "@/utils/platformPaths";
import { migrateLegacyOfflineDb } from "@/utils/legacyStorageMigration";
import { TenantSelector } from "./TenantSelector";

// Muestra el selector de tienda encima de la página cuando:
//   - este navegador no tiene tienda (ni ?tenant=, ni guardada, ni NEXT_PUBLIC_TENANT_ID), o
//   - el backend respondió 401 TENANT_REQUIRED (la tienda guardada ya no existe o está suspendida).
// Los hijos se renderizan siempre: así el HTML del servidor y el primer render del cliente coinciden
// (el servidor no conoce el localStorage) y la página no queda en blanco para SEO.
// En las páginas del SaaS (/planes, /contacto) nunca: ahí el visitante todavía no tiene tienda.
export default function TenantGate({ children }: { children: React.ReactNode }) {
    const [needsTenant, setNeedsTenant] = useState(false);
    const onPlatformPage = isPlatformPath(usePathname() ?? "/");

    useEffect(() => {
        // Lectura de localStorage: solo en el cliente y después de hidratar
        if (!getCurrentTenantId()) setNeedsTenant(true);
        void migrateLegacyOfflineDb();
        return onTenantSelectionRequested(() => setNeedsTenant(true));
    }, []);

    return (
        <>
            {children}
            {needsTenant && !onPlatformPage && <TenantSelector />}
        </>
    );
}

import { Suspense } from "react";
import PlatformBranchesSection from "@/components/modules/platform-admin/PlatformBranchesSection";

// Supervisión de sucursales de todas las tiendas (solo lectura). Suspense: lee los filtros de la URL.
export default function PlataformaSucursalesPage() {
    return (
        <Suspense>
            <PlatformBranchesSection />
        </Suspense>
    );
}

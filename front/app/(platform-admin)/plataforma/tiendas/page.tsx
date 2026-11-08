import { Suspense } from "react";
import PlatformTenantsSection from "@/components/modules/platform-admin/PlatformTenantsSection";

// Suspense: la lista lee los filtros de la URL (useSearchParams)
export default function PlataformaTiendasPage() {
    return (
        <Suspense>
            <PlatformTenantsSection />
        </Suspense>
    );
}

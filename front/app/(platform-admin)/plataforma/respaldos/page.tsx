import { Suspense } from "react";
import PlatformBackupsPage from "@/components/modules/platform-admin/PlatformBackupsPage";

// Suspense: el historial puede abrirse filtrado por tienda (?tienda=<id>)
export default function PlataformaRespaldosPage() {
    return (
        <Suspense>
            <PlatformBackupsPage />
        </Suspense>
    );
}

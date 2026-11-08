import { Suspense } from "react";
import PlatformSubscriptionsSection from "@/components/modules/platform-admin/PlatformSubscriptionsSection";

// Planes y suscripciones del SaaS (supervisión). Suspense: lee los filtros de la URL.
export default function PlataformaPlanesPage() {
    return (
        <Suspense>
            <PlatformSubscriptionsSection />
        </Suspense>
    );
}

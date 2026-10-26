import { Suspense } from "react";
import SuperAdminGate from "@/components/modules/admin/SuperAdminGate";
import SubscriptionClient from "@/components/modules/admin/SubscriptionClient";

// Suspense: SubscriptionClient usa useSearchParams (?checkout= que agrega la vuelta de Stripe)
export default function AdminSubscriptionPage() {
    return (
        <SuperAdminGate>
            <Suspense fallback={null}>
                <SubscriptionClient />
            </Suspense>
        </SuperAdminGate>
    );
}

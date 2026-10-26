import { Suspense } from "react";
import SuperAdminGate from "@/components/modules/admin/SuperAdminGate";
import PaymentsSetupClient from "@/components/modules/admin/PaymentsSetupClient";

// Suspense: PaymentsSetupClient lee ?connect= (vuelta del formulario de Stripe)
export default function AdminPaymentsPage() {
    return (
        <SuperAdminGate>
            <Suspense fallback={null}>
                <PaymentsSetupClient />
            </Suspense>
        </SuperAdminGate>
    );
}

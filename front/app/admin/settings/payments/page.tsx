import { Suspense } from "react";
import PaymentSettingsClient from "@/components/modules/admin/PaymentSettingsClient";

// Suspense: PaymentSettingsClient lee ?connect= (vuelta del formulario de Stripe). El permiso
// MANAGE_PAYMENTS lo exige el backend; el menú solo muestra el ítem a quien lo tiene.
export default function AdminPaymentSettingsPage() {
    return (
        <Suspense fallback={null}>
            <PaymentSettingsClient />
        </Suspense>
    );
}

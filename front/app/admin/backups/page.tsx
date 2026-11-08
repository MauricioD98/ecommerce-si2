import SuperAdminGate from "@/components/modules/admin/SuperAdminGate";
import StoreBackupsClient from "@/components/modules/backups/StoreBackupsClient";

// Copias de seguridad de la tienda: solo el Super Admin (dueño). La API lo vuelve a verificar.
export default function AdminBackupsPage() {
    return (
        <SuperAdminGate>
            <StoreBackupsClient />
        </SuperAdminGate>
    );
}

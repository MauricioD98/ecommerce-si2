import PermissionGate from "@/components/modules/admin/PermissionGate";
import InventoryClient from "@/components/modules/admin/InventoryClient";
import { Permission } from "@/utils/permissions";

export default function AdminInventoryPage() {
    return (
        <PermissionGate permission={Permission.MANAGE_INVENTORY}>
            <InventoryClient />
        </PermissionGate>
    );
}

import PermissionGate from "@/components/modules/admin/PermissionGate";
import OrdersClient from "@/components/modules/admin/OrdersClient";
import { Permission } from "@/utils/permissions";

export default function AdminOrdersPage() {
    return (
        <PermissionGate permission={Permission.VIEW_ORDERS}>
            <OrdersClient />
        </PermissionGate>
    );
}

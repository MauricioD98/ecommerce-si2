import PermissionGate from "@/components/modules/admin/PermissionGate";
import MarketingClient from "@/components/modules/admin/MarketingClient";
import { Permission } from "@/utils/permissions";

export default function AdminNotificationsPage() {
    return (
        <PermissionGate permission={Permission.SEND_MARKETING}>
            <MarketingClient />
        </PermissionGate>
    );
}

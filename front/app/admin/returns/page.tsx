import PermissionGate from "@/components/modules/admin/PermissionGate";
import ReturnsClient from "@/components/modules/admin/ReturnsClient";
import { Permission } from "@/utils/permissions";

export default function AdminReturnsPage() {
    return (
        <PermissionGate permission={Permission.PROCESS_RETURNS}>
            <ReturnsClient />
        </PermissionGate>
    );
}

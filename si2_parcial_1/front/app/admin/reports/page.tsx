import PermissionGate from "@/components/modules/admin/PermissionGate";
import ReportsClient from "@/components/modules/admin/ReportsClient";
import { Permission } from "@/utils/permissions";

export default function AdminReportsPage() {
    return (
        <PermissionGate permission={Permission.VIEW_REPORTS}>
            <ReportsClient />
        </PermissionGate>
    );
}

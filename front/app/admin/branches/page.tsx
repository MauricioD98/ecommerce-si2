import PermissionGate from "@/components/modules/admin/PermissionGate";
import BranchesClient from "@/components/modules/admin/BranchesClient";
import { Permission } from "@/utils/permissions";

export default function AdminBranchesPage() {
    return (
        <PermissionGate permission={Permission.MANAGE_BRANCHES}>
            <BranchesClient />
        </PermissionGate>
    );
}

import PermissionGate from "@/components/modules/admin/PermissionGate";
import RolesClient from "@/components/modules/admin/RolesClient";
import { Permission } from "@/utils/permissions";

export default function AdminRolesPage() {
    return (
        <PermissionGate permission={Permission.MANAGE_ROLES}>
            <RolesClient />
        </PermissionGate>
    );
}

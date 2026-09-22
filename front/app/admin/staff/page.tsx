import PermissionGate from "@/components/modules/admin/PermissionGate";
import StaffClient from "@/components/modules/admin/StaffClient";
import { Permission } from "@/utils/permissions";

export default function AdminStaffPage() {
    return (
        <PermissionGate permission={Permission.MANAGE_USERS}>
            <StaffClient />
        </PermissionGate>
    );
}

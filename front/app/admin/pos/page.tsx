import PermissionGate from "@/components/modules/admin/PermissionGate";
import PosClient from "@/components/modules/admin/PosClient";
import { Permission } from "@/utils/permissions";

export default function AdminPosPage() {
    return (
        <PermissionGate permission={Permission.USE_POS}>
            <PosClient />
        </PermissionGate>
    );
}

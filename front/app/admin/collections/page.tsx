import PermissionGate from "@/components/modules/admin/PermissionGate";
import CollectionsClient from "@/components/modules/admin/CollectionsClient";
import { Permission } from "@/utils/permissions";

export default function AdminCollectionsPage() {
    return (
        <PermissionGate permission={Permission.MANAGE_PRODUCTS}>
            <CollectionsClient />
        </PermissionGate>
    );
}

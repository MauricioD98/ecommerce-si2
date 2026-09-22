import PermissionGate from "@/components/modules/admin/PermissionGate";
import CategoriesClient from "@/components/modules/admin/CategoriesClient";
import { Permission } from "@/utils/permissions";

export default function AdminCategoriesPage() {
    return (
        <PermissionGate permission={Permission.MANAGE_PRODUCTS}>
            <CategoriesClient />
        </PermissionGate>
    );
}

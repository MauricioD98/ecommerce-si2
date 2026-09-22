import PermissionGate from "@/components/modules/admin/PermissionGate";
import ProductsClient from "@/components/modules/admin/ProductsClient";
import { Permission } from "@/utils/permissions";

export default function AdminProductsPage() {
    return (
        <PermissionGate permission={Permission.MANAGE_PRODUCTS}>
            <ProductsClient />
        </PermissionGate>
    );
}

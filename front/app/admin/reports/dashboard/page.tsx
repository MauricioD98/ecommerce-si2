import PermissionGate from "@/components/modules/admin/PermissionGate";
import AnalyticsDashboardClient from "@/components/modules/analytics/AnalyticsDashboardClient";
import { Permission } from "@/utils/permissions";

// Dashboard interactivo: mismo permiso que Reportes (el backend lo exige en /analytics/*)
export default function AdminAnalyticsDashboardPage() {
    return (
        <PermissionGate permission={Permission.VIEW_REPORTS}>
            <AnalyticsDashboardClient />
        </PermissionGate>
    );
}

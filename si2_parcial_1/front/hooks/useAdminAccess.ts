import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { canAccessAdmin, hasAllBranches, hasPermission, SUPER_ADMIN_ROLE } from "@/utils/permissions";

// Permisos y sucursal del usuario autenticado (lectura desde Redux, sin llamadas a la API).
// isGlobal = tiene el permiso ALL_BRANCHES (puede actuar sobre cualquier sucursal).
// isSuperAdmin = es específicamente el rol "Super Admin" (dueño global del sistema).
export function useAdminRole() {
    const { user, isAuthenticated } = useAuth();

    return {
        user,
        isAuthenticated,
        isGlobal: hasAllBranches(user),
        isSuperAdmin: user?.role?.name === SUPER_ADMIN_ROLE,
        canAccess: canAccessAdmin(user),
        can: (permission: string) => hasPermission(user, permission),
        branchId: user?.branchId ?? null,
    };
}

// Para el layout del panel: además refresca el perfil (el login no trae branchId ni employeeDiscount)
// y avisa cuando ya se puede confiar en el rol y la sucursal del usuario.
export function useAdminGuard() {
    const access = useAdminRole();
    const { refreshProfile } = useAuth();
    const [profileReady, setProfileReady] = useState(false);
    const { isAuthenticated } = access;

    useEffect(() => {
        if (!isAuthenticated) return;
        let active = true;
        refreshProfile().finally(() => {
            if (active) setProfileReady(true);
        });
        return () => {
            active = false;
        };
    }, [isAuthenticated, refreshProfile]);

    return { ...access, profileReady };
}

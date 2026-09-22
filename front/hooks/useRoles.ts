import { useEffect, useState } from "react";
import { RolesService } from "@/service/api/roles.service";
import { getApiErrorMessage } from "@/service/api/error.utils";
import { RoleItem, RolePayload } from "@/types/admin.types";

// Todos los roles (vista /admin/roles). Las acciones lanzan el error para que el formulario lo muestre
export function useRoles() {
    const [roles, setRoles] = useState<RoleItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let active = true;

        RolesService.getRoles()
            .then((data) => {
                if (!active) return;
                setRoles(data);
                setError(null);
            })
            .catch((error) => {
                if (active) setError(getApiErrorMessage(error, "No se pudieron cargar los roles."));
            })
            .finally(() => {
                if (active) setIsLoading(false);
            });

        return () => {
            active = false;
        };
    }, []);

    const createRole = async (data: RolePayload) => {
        const created = await RolesService.createRole(data);
        setRoles((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
    };

    const updateRole = async (id: string, data: Partial<RolePayload>) => {
        const updated = await RolesService.updateRole(id, data);
        setRoles((prev) => prev.map((role) => (role.id === id ? updated : role)));
    };

    const deleteRole = async (id: string) => {
        await RolesService.deleteRole(id);
        setRoles((prev) => prev.filter((role) => role.id !== id));
    };

    return { roles, isLoading, error, createRole, updateRole, deleteRole };
}

// Roles que el usuario actual puede asignar al crear o editar empleados
export function useAssignableRoles() {
    const [roles, setRoles] = useState<RoleItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        let active = true;

        RolesService.getAssignableRoles()
            .then((data) => {
                if (active) setRoles(data);
            })
            .catch(() => {
                if (active) setRoles([]);
            })
            .finally(() => {
                if (active) setIsLoading(false);
            });

        return () => {
            active = false;
        };
    }, []);

    return { roles, isLoading };
}

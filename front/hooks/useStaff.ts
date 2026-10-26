import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { StaffService } from "@/service/api/staff.service";
import { getApiErrorMessage } from "@/service/api/error.utils";
import { CreateStaffPayload, StaffUser, UpdateStaffPayload } from "@/types/admin.types";

// Empleados y admins de sucursal (el backend filtra por sucursal para ADMIN_SUCURSAL)
export function useStaff() {
    const t = useTranslations("AdminErrors");
    const [staff, setStaff] = useState<StaffUser[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let active = true;

        StaffService.getStaff()
            .then((data) => {
                if (!active) return;
                setStaff(data);
                setError(null);
            })
            .catch((error) => {
                if (active) setError(getApiErrorMessage(error, t("staff")));
            })
            .finally(() => {
                if (active) setIsLoading(false);
            });

        return () => {
            active = false;
        };
    }, []);

    // Las acciones lanzan el error para que el formulario lo muestre
    const createStaff = async (data: CreateStaffPayload) => {
        const created = await StaffService.createStaff(data);
        setStaff((prev) => [created, ...prev]);
    };

    const updateStaff = async (id: string, data: UpdateStaffPayload) => {
        const updated = await StaffService.updateStaff(id, data);
        setStaff((prev) => prev.map((member) => (member.id === id ? updated : member)));
    };

    return { staff, isLoading, error, createStaff, updateStaff };
}

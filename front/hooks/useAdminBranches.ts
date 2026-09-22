import { useEffect, useState } from "react";
import { BranchService } from "@/service/api/branch.service";
import { getApiErrorMessage } from "@/service/api/error.utils";
import { Branch } from "@/types/branch.types";
import { BranchPayload } from "@/types/admin.types";

// Sucursales del panel admin (incluye inactivas; ADMIN_SUCURSAL solo recibe la suya)
export function useAdminBranches() {
    const [branches, setBranches] = useState<Branch[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let active = true;

        BranchService.getAllBranches()
            .then((data) => {
                if (!active) return;
                setBranches(data);
                setError(null);
            })
            .catch((error) => {
                if (active) setError(getApiErrorMessage(error, "No se pudieron cargar las sucursales."));
            })
            .finally(() => {
                if (active) setIsLoading(false);
            });

        return () => {
            active = false;
        };
    }, []);

    // Las acciones lanzan el error para que el formulario lo muestre
    const createBranch = async (data: BranchPayload) => {
        const created = await BranchService.createBranch(data);
        setBranches((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
    };

    const updateBranch = async (id: string, data: Partial<BranchPayload>) => {
        const updated = await BranchService.updateBranch(id, data);
        setBranches((prev) => prev.map((branch) => (branch.id === id ? updated : branch)));
    };

    const deleteBranch = async (id: string) => {
        await BranchService.deleteBranch(id);
        setBranches((prev) => prev.filter((branch) => branch.id !== id));
    };

    return { branches, isLoading, error, createBranch, updateBranch, deleteBranch };
}

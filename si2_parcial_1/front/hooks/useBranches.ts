import { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { IRootState, useAppDispatch } from "@/store";
import { clearSelectedBranch, setSelectedBranch } from "@/store/slices/branchSlice";
import { BranchService } from "@/service/api/branch.service";
import { getApiErrorMessage } from "@/service/api/error.utils";
import { Branch } from "@/types/branch.types";

// Solo lee la sucursal elegida (sin llamar a la API): para catálogo y detalle de producto
export function useSelectedBranchId(): string | null {
    return useSelector((state: IRootState) => state.branch.selectedBranchId);
}

// Carga las sucursales activas y permite elegir en cuál se compra
export function useBranches() {
    const dispatch = useAppDispatch();
    const selectedBranchId = useSelectedBranchId();
    const [branches, setBranches] = useState<Branch[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let active = true;

        BranchService.getActiveBranches()
            .then((data) => {
                if (!active) return;
                setBranches(data);
                // Si la sucursal guardada ya no existe o está inactiva, se descarta
                if (selectedBranchId && !data.some((branch) => branch.id === selectedBranchId)) {
                    dispatch(clearSelectedBranch());
                }
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
        // La sucursal guardada se valida solo al cargar la lista; no debe volver a pedirla al cambiarla
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [dispatch]);

    const selectBranch = (branchId: string) => {
        dispatch(setSelectedBranch(branchId));
    };

    const selectedBranch = branches.find((branch) => branch.id === selectedBranchId) ?? null;

    return { branches, selectedBranchId, selectedBranch, selectBranch, isLoading, error };
}

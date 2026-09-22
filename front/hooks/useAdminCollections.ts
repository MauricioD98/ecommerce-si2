import { useCallback, useEffect, useState } from "react";
import { CollectionService } from "@/service/api/collection.service";
import { getApiErrorMessage } from "@/service/api/error.utils";
import { Collection, CollectionPayload } from "@/types/admin.types";

const PAGE_SIZE = 10;

// Colecciones paginadas (incluye inactivas) con búsqueda por nombre/descripción, para el panel admin
export function useAdminCollections(page: number, search: string) {
    const [collections, setCollections] = useState<Collection[]>([]);
    const [total, setTotal] = useState(0);
    const [refreshKey, setRefreshKey] = useState(0);
    const [loadedKey, setLoadedKey] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const key = `${page}|${search}|${refreshKey}`;

    useEffect(() => {
        let active = true;

        CollectionService.getCollectionsAdmin(page, PAGE_SIZE, search)
            .then((response) => {
                if (!active) return;
                setCollections(response.data);
                setTotal(response.meta.total);
                setError(null);
            })
            .catch((error) => {
                if (active) setError(getApiErrorMessage(error, "No se pudieron cargar las colecciones."));
            })
            .finally(() => {
                if (active) setLoadedKey(key);
            });

        return () => {
            active = false;
        };
    }, [page, search, key]);

    const refresh = useCallback(() => setRefreshKey((value) => value + 1), []);

    // Las acciones lanzan el error para que el formulario o la fila lo muestren
    const createCollection = async (data: CollectionPayload) => {
        await CollectionService.createCollection(data);
        refresh();
    };

    const updateCollection = async (id: string, data: Partial<CollectionPayload>) => {
        await CollectionService.updateCollection(id, data);
        refresh();
    };

    const deleteCollection = async (id: string) => {
        await CollectionService.deleteCollection(id);
        refresh();
    };

    return {
        collections,
        total,
        totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
        isLoading: loadedKey !== key,
        error,
        createCollection,
        updateCollection,
        deleteCollection,
    };
}

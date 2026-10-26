import { apiClient } from "./axios.config";
import { StoreAppearance, StoreAppearanceUpdate } from "@/types/appearance.types";

// Personalización de la tienda pública. El panel requiere el permiso MANAGE_APPEARANCE; la lectura
// pública la hace el layout en el servidor (utils/storeAppearance.server.ts).

const ADMIN = "/admin/settings/appearance";
// axios manda JSON por defecto (axios.config): con FormData hay que pedir multipart explícitamente
const MULTIPART = { headers: { "Content-Type": "multipart/form-data" } };

export type AppearanceImageKind = "logo" | "favicon" | "background";

// Mismos límites que APPEARANCE_IMAGE_LIMITS en el backend
export const APPEARANCE_IMAGE_LIMITS: Record<AppearanceImageKind, number> = {
    logo: 256 * 1024,
    favicon: 64 * 1024,
    background: 512 * 1024,
};

export const appearanceService = {
    get: async (): Promise<StoreAppearance> => {
        const { data } = await apiClient.get<{ data: StoreAppearance }>(ADMIN);
        return data.data;
    },

    update: async (payload: StoreAppearanceUpdate): Promise<StoreAppearance> => {
        const { data } = await apiClient.patch<{ data: StoreAppearance }>(ADMIN, payload);
        return data.data;
    },

    uploadImage: async (kind: AppearanceImageKind, file: File): Promise<StoreAppearance> => {
        const form = new FormData();
        form.append("file", file);
        const { data } = await apiClient.put<{ data: StoreAppearance }>(`${ADMIN}/${kind}`, form, MULTIPART);
        return data.data;
    },
};

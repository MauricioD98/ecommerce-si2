import axios from "axios";
import { apiClient } from "./axios.config";
import type { BackupApi, BackupConfig, BackupJob, BackupPreview } from "@/types/backup.types";

// Copias de seguridad de la tienda actual (/api/v1/backups). Van con x-tenant-id y el JWT: la tienda la
// decide el backend desde la sesión; ningún id de tienda sale de acá. Solo el Super Admin puede usarlas.

// axios manda JSON por defecto (axios.config): con FormData hay que pedir multipart explícitamente
const MULTIPART = { headers: { "Content-Type": "multipart/form-data" } };

// Con responseType "blob" el cuerpo de un error también llega como Blob: se lo convierte a JSON para que
// getApiErrorMessage muestre el mensaje traducido de la API
async function unwrapBlobError(error: unknown): Promise<never> {
    if (axios.isAxiosError(error) && error.response?.data instanceof Blob) {
        try {
            error.response.data = JSON.parse(await error.response.data.text());
        } catch {
            // se deja tal cual
        }
    }
    throw error;
}

function fileNameFrom(disposition: string | undefined, fallback: string): string {
    const match = disposition?.match(/filename="?([^";]+)"?/i);
    return match?.[1] ?? fallback;
}

export const storeBackupService: BackupApi & { create(): Promise<BackupJob> } = {
    config: async () => (await apiClient.get<{ data: BackupConfig }>("/backups/config")).data.data,
    list: async () => (await apiClient.get<{ data: BackupJob[] }>("/backups")).data.data,
    create: async () => (await apiClient.post<{ data: BackupJob }>("/backups")).data.data,
    download: async (job) => {
        try {
            const res = await apiClient.get<Blob>(`/backups/${job.id}/download`, { responseType: "blob" });
            return { blob: res.data, fileName: fileNameFrom(res.headers["content-disposition"], `${job.id}.sfbk`) };
        } catch (error) {
            return unwrapBlobError(error);
        }
    },
    upload: async (file) => {
        const form = new FormData();
        form.append("file", file);
        return (await apiClient.post<{ data: BackupJob }>("/backups/upload", form, MULTIPART)).data.data;
    },
    preview: async (id) => (await apiClient.get<{ data: BackupPreview }>(`/backups/${id}/preview`)).data.data,
    restore: async (id, confirmation) =>
        (await apiClient.post<{ data: BackupJob }>(`/backups/${id}/restore`, { confirmation, acknowledgeReplace: true })).data.data,
    remove: async (id) => (await apiClient.delete(`/backups/${id}`)).data.data,
};

import { apiClient } from "./axios.config";
import { AdminOrder } from "@/types/admin.types";

// Gestión de pagos de la tienda (Stripe Connect, QR bancario y USDT) y comprobantes de pagos manuales.
// El panel requiere el permiso MANAGE_PAYMENTS; las opciones del checkout son públicas.

export type UsdtNetwork = "TRC20" | "ERC20" | "BEP20" | "POLYGON";
export const USDT_NETWORKS: UsdtNetwork[] = ["TRC20", "ERC20", "BEP20", "POLYGON"];
export type ManualPaymentMethod = "BANK_QR" | "USDT";

export interface PaymentSettings {
    stripe: {
        connected: boolean;
        chargesEnabled: boolean;
        detailsSubmitted: boolean;
        pendingRequirements: number;
        accountId: string | null;
    };
    qr: { enabled: boolean; hasImage: boolean; instructions: string };
    usdt: { enabled: boolean; network: UsdtNetwork | null; walletAddress: string };
}

export interface PaymentSettingsUpdate {
    qrEnabled?: boolean;
    qrInstructions?: string;
    usdtEnabled?: boolean;
    usdtNetwork?: UsdtNetwork | null;
    usdtWalletAddress?: string;
}

export interface PaymentOptions {
    card: boolean;
    bankQr: { instructions: string } | null;
    usdt: { network: UsdtNetwork; walletAddress: string; walletQr: string } | null;
}

const ADMIN = "/admin/settings/payments";
// axios manda JSON por defecto (axios.config): con FormData hay que pedir multipart explícitamente
const MULTIPART = { headers: { "Content-Type": "multipart/form-data" } };

// Las imágenes salen de la API con x-tenant-id (y el JWT en el panel), que un <img src> no envía:
// se bajan como blob y se muestran con un object URL (quien lo usa lo libera con URL.revokeObjectURL)
const blobUrl = async (url: string): Promise<string> => {
    const { data } = await apiClient.get<Blob>(url, { responseType: "blob" });
    return URL.createObjectURL(data);
};

export const paymentSettingsService = {
    get: async (): Promise<PaymentSettings> => {
        const { data } = await apiClient.get<{ data: PaymentSettings }>(ADMIN);
        return data.data;
    },

    update: async (payload: PaymentSettingsUpdate): Promise<PaymentSettings> => {
        const { data } = await apiClient.patch<{ data: PaymentSettings }>(ADMIN, payload);
        return data.data;
    },

    uploadQrImage: async (file: File): Promise<void> => {
        const form = new FormData();
        form.append("file", file);
        await apiClient.put(`${ADMIN}/qr-image`, form, MULTIPART);
    },

    removeQrImage: async (): Promise<void> => {
        await apiClient.delete(`${ADMIN}/qr-image`);
    },

    qrImageUrl: () => blobUrl(`${ADMIN}/qr-image`),

    // URL del formulario de Stripe para crear o completar la cuenta de cobros
    startStripeOnboarding: async (): Promise<string> => {
        const { data } = await apiClient.post<{ data: { url: string } }>(`${ADMIN}/stripe/onboarding`);
        return data.data.url;
    },

    disconnectStripe: async (): Promise<PaymentSettings> => {
        const { data } = await apiClient.delete<{ data: PaymentSettings }>(`${ADMIN}/stripe`);
        return data.data;
    },

    // Checkout: solo los medios activos de la tienda
    getOptions: async (): Promise<PaymentOptions> => {
        const { data } = await apiClient.get<{ data: PaymentOptions }>("/store/payment-options");
        return data.data;
    },

    publicQrImageUrl: () => blobUrl("/store/payment-options/qr-image"),

    // Cliente: comprobante del QR (imagen) o TxID de USDT para un pedido propio
    submitProof: async (orderId: string, method: ManualPaymentMethod, input: { file?: File | null; txId?: string }): Promise<void> => {
        const form = new FormData();
        form.append("method", method);
        if (input.txId) form.append("txId", input.txId.trim());
        if (input.file) form.append("file", input.file);
        await apiClient.post(`/orders/${orderId}/payment-proof`, form, MULTIPART);
    },

    // Panel de pedidos: revisar el comprobante
    proofImageUrl: (orderId: string) => blobUrl(`/orders/admin/${orderId}/payment-proof/image`),

    approveProof: async (orderId: string): Promise<AdminOrder> => {
        const { data } = await apiClient.post<{ data: AdminOrder }>(`/orders/admin/${orderId}/payment-proof/approve`);
        return data.data;
    },

    rejectProof: async (orderId: string): Promise<AdminOrder> => {
        const { data } = await apiClient.post<{ data: AdminOrder }>(`/orders/admin/${orderId}/payment-proof/reject`);
        return data.data;
    },
};

import axios from "axios";
import { apiClient, getApiBaseUrl } from "./axios.config";
import { TENANT_HEADER, getCurrentTenantId } from "@/utils/tenant";
import { User, AutoResponse, LoginCredential, RegisterCredential, UpdateProfilePayload } from "@/types/auth.types";

export interface PublicTenant {
    id: string;
    slug: string;
    name: string;
    plan: string;
    planName?: string;
    mobileApp?: boolean;
}

// POST /platform/auth/tenant-login: la tienda se elige antes de autenticar y es la única donde el
// backend consulta el correo. Los administradores de NovaSoft usan platformAdminService.login.
export interface TenantLoginResponse {
    tenant: PublicTenant;
    auth: AutoResponse;
}

const tenantHeaderConfig = (tenantId?: string) =>
    tenantId ? { headers: { [TENANT_HEADER]: tenantId } } : undefined;

export const authService = {
    getPublicTenants: async (): Promise<PublicTenant[]> => {
        const response = await apiClient.get<{ data: PublicTenant[] }>("/platform/tenants/public");
        return response.data?.data ?? [];
    },

    tenantLogin: async (payload: {
        email: string;
        password: string;
        tenantId: string;
    }): Promise<TenantLoginResponse> => {
        const response = await apiClient.post<{ data: TenantLoginResponse }>(
            "/platform/auth/tenant-login",
            payload,
        );
        return response.data.data;
    },

    logout: async (): Promise<void> => {
        try {
            await apiClient.post("/auth/logout");
        } catch (error) {
            // Esperado sin conexión (AxiosError: Network Error) o si el refresh token ya venció:
            // la sesión local se cierra igual (ver useAuth.logout), así que no es un error fatal.
            console.warn("No se pudo notificar el logout al backend (se cierra la sesión localmente igual):", error);
        }
    },
    // Devuelve AMBOS tokens: el backend rota el refresh token en cada renovación (guarda el hash del
    // nuevo), así que el anterior deja de valer. Si solo se guardara el access token, la próxima
    // renovación usaría un refresh token ya invalidado y terminaría en un logout que no corresponde.
    refreshToken: async (refreshToken: string): Promise<{ accessToken: string; refreshToken: string } | null> => {
        if (!refreshToken) return null;
        try {
            // El backend espera el refresh token en el header Authorization (no en el body).
            // Se usa axios "limpio" para que el interceptor no lo reemplace por el access token.
            const response = await axios.post<AutoResponse>(
                `${getApiBaseUrl()}/auth/refresh`,
                undefined,
                // Sin interceptor tampoco hay x-tenant-id automático: el backend valida que el refresh
                // token sea de esta tienda, así que se manda explícito.
                { headers: { Authorization: `Bearer ${refreshToken}`, [TENANT_HEADER]: getCurrentTenantId() ?? "" }, timeout: 10000 }
            );
            const { accessToken, refreshToken: rotated } = response.data;
            return accessToken ? { accessToken, refreshToken: rotated ?? refreshToken } : null;
        } catch (error) {
            console.error("Token refresh failed", error);
            return null
        }
    },

    // Perfil actualizado del usuario (incluye role, branchId y employeeDiscount)
    getProfile: async (): Promise<User> => {
        const response = await apiClient.get<User>('/users/me');
        return response.data;
    },

    updateProfile: async (data: UpdateProfilePayload): Promise<User> => {
        const response = await apiClient.patch<User>('/users/me', data);
        return response.data;
    },

    // Cambio de contraseña desde "Mi cuenta". Lanza el error (contraseña actual incorrecta, nueva muy débil)
    changePassword: async (currentPassword: string, newPassword: string): Promise<void> => {
        await apiClient.patch('/users/me/password', { currentPassword, newPassword });
    },

    login: async (credentials: LoginCredential, tenantId?: string): Promise<AutoResponse> => {
        const response = await apiClient.post<AutoResponse>('/auth/login', credentials, tenantHeaderConfig(tenantId));
        return response.data;
    },

    register: async (data: RegisterCredential, tenantId?: string): Promise<AutoResponse> => {
        const response = await apiClient.post<AutoResponse>('/auth/register', data, tenantHeaderConfig(tenantId));
        return response.data;
    },

    // El backend responde igual exista o no el correo (no revela qué cuentas existen). Lanza el error si falla la red
    forgotPassword: async (email: string, tenantId?: string): Promise<void> => {
        await apiClient.post('/auth/forgot-password', { email: email.trim() }, tenantHeaderConfig(tenantId));
    },

    // Comprueba el código de 6 dígitos sin consumirlo. Lanza el error si es incorrecto o venció
    verifyOtp: async (email: string, otp: string, tenantId?: string): Promise<void> => {
        await apiClient.post('/auth/verify-otp', { email: email.trim(), otp: String(otp).trim() }, tenantHeaderConfig(tenantId));
    },

    // Cambia la contraseña con el código de 6 dígitos del correo. Lanza el error (código inválido/vencido, contraseña débil)
    resetPassword: async (email: string, otp: string, newPassword: string, tenantId?: string): Promise<void> => {
        // otp siempre como texto y sin espacios: "001234" no debe perder los ceros
        await apiClient.post(
            '/auth/reset-password',
            { email: email.trim(), otp: String(otp).trim(), newPassword },
            tenantHeaderConfig(tenantId),
        );
    },
}

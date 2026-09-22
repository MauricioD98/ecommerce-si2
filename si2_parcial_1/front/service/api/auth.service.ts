import axios from "axios";
import { apiClient } from "./axios.config";
import { User, AutoResponse, LoginCredential, RegisterCredential, UpdateProfilePayload } from "@/types/auth.types";

export const authService = {

    logout: async (): Promise<void> => {
        try {
            await apiClient.post("/auth/logout");
        } catch (error) {
            console.error("Logout failed", error);
        }
    },
    refreshToken: async (refreshToken: string): Promise<string | null> => {
        if (!refreshToken) return null;
        try {
            // El backend espera el refresh token en el header Authorization (no en el body).
            // Se usa axios "limpio" para que el interceptor no lo reemplace por el access token.
            const response = await axios.post<AutoResponse>(
                `${process.env.NEXT_PUBLIC_API_URL}/auth/refresh`,
                undefined,
                { headers: { Authorization: `Bearer ${refreshToken}` }, timeout: 10000 }
            );
            return response.data.accessToken;
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

    login: async (credentials: LoginCredential): Promise<AutoResponse> => {
        const response = await apiClient.post<AutoResponse>('/auth/login', credentials);
        return response.data;
    },

    register: async (data: RegisterCredential): Promise<AutoResponse> => {
        const response = await apiClient.post<AutoResponse>('/auth/register', data);
        return response.data;
    },

    // El backend responde igual exista o no el correo (no revela qué cuentas existen). Lanza el error si falla la red
    forgotPassword: async (email: string): Promise<void> => {
        await apiClient.post('/auth/forgot-password', { email: email.trim() });
    },

    // Comprueba el código de 6 dígitos sin consumirlo. Lanza el error si es incorrecto o venció
    verifyOtp: async (email: string, otp: string): Promise<void> => {
        await apiClient.post('/auth/verify-otp', { email: email.trim(), otp: String(otp).trim() });
    },

    // Cambia la contraseña con el código de 6 dígitos del correo. Lanza el error (código inválido/vencido, contraseña débil)
    resetPassword: async (email: string, otp: string, newPassword: string): Promise<void> => {
        // otp siempre como texto y sin espacios: "001234" no debe perder los ceros
        await apiClient.post('/auth/reset-password', { email: email.trim(), otp: String(otp).trim(), newPassword });
    },
}

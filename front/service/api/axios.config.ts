import { store } from "@/store";
import axios from "axios";
import { authService } from "./auth.service";
import { setAccessToken, clearAuth } from "@/store/slices/authSlices";

export const getApiBaseUrl = (): string => {
    if (typeof window !== "undefined") {
        const hostname = window.location.hostname;
        if (!hostname.includes("localhost") && !hostname.includes("127.0.0.1") && !hostname.includes("10.0.") && !hostname.includes("192.168.")) {
            return "https://stella-api.wonderfulriver-db5286cd.eastus.azurecontainerapps.io/api/v1";
        }
    }
    return process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1";
};

export const apiClient = axios.create({
    baseURL: getApiBaseUrl(),
    headers: {
        "Content-type": "application/json",
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache",
    },
    timeout: 15000,
    // El default de Axios serializa arrays como "sizes[]=S&sizes[]=L". El ValidationPipe global del
    // backend (whitelist: true) no conoce "sizes[]" como propiedad del DTO y rechaza todo con 400.
    // Con { indexes: null } serializa "sizes=S&sizes=L" (clave repetida), que es lo que espera Nest.
    paramsSerializer: { indexes: null },
});

apiClient.interceptors.request.use(
    (config) => {
        config.baseURL = getApiBaseUrl();
        const state = store.getState();
        const token = state.auth.accessToken;

        if (token) {
            config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
    },
    (error) => {
        return Promise.reject(error);
    }
);

apiClient.interceptors.response.use(
    (response) => response,
    async (error) => {
        const originalRequest = error.config;
        // Los endpoints /auth/* (login, registro...) manejan sus 401 por su cuenta: no se refresca ni se redirige
        const isAuthRequest = originalRequest?.url?.startsWith("/auth/");
        if (error.response?.status === 401 && !originalRequest._retry && !isAuthRequest) {
            originalRequest._retry = true;

            const state = store.getState();
            const refreshToken = state.auth.refreshToken;

            if (refreshToken) {
                const newAccessToken = await authService.refreshToken(refreshToken);

                if (newAccessToken) {
                    store.dispatch(setAccessToken(newAccessToken));
                    originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
                    return apiClient(originalRequest);
                }
            }

            store.dispatch(clearAuth());
            if (typeof window !== 'undefined') {
                window.location.href = "/auth/login";
            }
        }
        return Promise.reject(error);
    }
);

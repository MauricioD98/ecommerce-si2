import { store } from "@/store";
import axios from "axios";
import { authService } from "./auth.service";
import { setAccessToken, clearAuth } from "@/store/slices/authSlices";

export const apiClient = axios.create({
    baseURL: process.env.NEXT_PUBLIC_API_URL,
    headers: {
        "Content-type": "application/json",
    },
    timeout: 10000,
});

apiClient.interceptors.request.use(
    (config) => {
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

import { IRootState, useAppDispatch } from "@/store"
import { useCallback, useState } from "react";
import { useDispatch, useSelector } from "react-redux"
import axios from "axios";
import { authService } from "@/service/api/auth.service";
import { apiClient } from "@/service/api/axios.config";
import { getApiErrorMessage } from "@/service/api/error.utils";
import { LoginCredential, RegisterCredential } from "@/types/auth.types";
import { clearAuth, setAuth, setUser } from "@/store/slices/authSlices";


export function useAuth() {
    const authState = useSelector((state: IRootState) => state.auth)
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const dispatch = useAppDispatch();

    const logout = async () => {
        setIsLoading(true);
        setError(null);
        try {
            await authService.logout();
        } catch (error) {
        } finally {
            // La sesión local se cierra siempre, aunque el backend no responda
            dispatch(clearAuth());
            // El service worker cachea respuestas de la API por URL, sin distinguir de quién son
            // (perfil, pedidos). En un dispositivo compartido, la próxima persona que inicie sesión
            // podría ver por un instante (u offline, del todo) los datos de esta cuenta si no se
            // limpia acá. Ver public/sw.js: listener "message" -> CLEAR_USER_CACHE.
            navigator.serviceWorker?.controller?.postMessage({ type: 'CLEAR_USER_CACHE' });
            setIsLoading(false);
        }
    }

    // Trae el perfil actual (rol, sucursal y descuento de trabajador). Falla en silencio: es solo informativo
    const refreshProfile = useCallback(async () => {
        try {
            const profile = await authService.getProfile();
            dispatch(setUser(profile));
        } catch (error) {
            console.warn("No se pudo actualizar el perfil", error);
        }
    }, [dispatch]);

    const login = async (credentials: LoginCredential): Promise<boolean> => {
        setIsLoading(true);
        setError(null);

        try {
            const response = await authService.login(credentials);
            dispatch(setAuth({
                accessToken: response.accessToken,
                refreshToken: response.refreshToken,
                user: response.user
            }))
            return true;
        } catch (error) {
            setError(
                axios.isAxiosError(error) && error.response?.status === 401
                    ? "Correo o contraseña incorrectos."
                    : getApiErrorMessage(error, "Error al iniciar sesión. Inténtalo de nuevo.")
            );
            return false;
        } finally {
            setIsLoading(false);
        }

    };

    const register = async (data: RegisterCredential): Promise<boolean> => {
        setIsLoading(true);
        setError(null);

        try {
            const response = await authService.register(data);
            dispatch(setAuth({
                accessToken: response.accessToken,
                refreshToken: response.refreshToken,
                user: response.user
            }))
            return true;
        } catch (error) {
            setError(getApiErrorMessage(error, "No se pudo crear la cuenta. Inténtalo de nuevo."));
            return false;
        } finally {
            setIsLoading(false);
        }
    };

    return {
        login,
        register,
        logout,
        refreshProfile,
        isAuthenticated: authState.esAutenticado,
        user: authState.user,
        isLoading,
        error
    }

}

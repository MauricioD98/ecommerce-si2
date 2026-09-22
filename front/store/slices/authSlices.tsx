import { User } from "@/types/auth.types";
import { createSlice, PayloadAction } from "@reduxjs/toolkit";

export interface AuthState {
    accessToken: string | null;
    refreshToken: string | null;
    user: User | null;
    esAutenticado: boolean;
}

const initialState: AuthState = {
    accessToken: null,
    refreshToken: null,
    user: null,
    esAutenticado: false,
};

const authSlice = createSlice({
    name: "auth",
    initialState,
    reducers: {
        setAccessToken: (state: AuthState, action: PayloadAction<string>) => {
            state.accessToken = action.payload;
            state.esAutenticado = !!action.payload;
        },
        clearAuth: (state: AuthState) => {
            state.accessToken = null;
            state.refreshToken = null;
            state.user = null;
            state.esAutenticado = false;
        },
        // Actualiza los datos del usuario (p. ej. employeeDiscount) sin tocar los tokens
        setUser: (state: AuthState, action: PayloadAction<User>) => {
            state.user = action.payload;
        },
        setAuth: (state, action: PayloadAction<{
            accessToken: string; refreshToken: string;
            user: User
        }>) => {
    state.accessToken = action.payload.accessToken;
    state.refreshToken = action.payload.refreshToken;
    state.user = action.payload.user;
    state.esAutenticado = true;

}
    },
});

export const { setAccessToken, clearAuth, setAuth, setUser } = authSlice.actions;
export default authSlice.reducer;
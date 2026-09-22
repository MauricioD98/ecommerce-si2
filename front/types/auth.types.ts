export interface User {
    id: String;
    email: string;
    name?: string;
    firstName?: string | null;
    lastName?: string | null;
    phone?: string | null;
    // Sucursal favorita del cliente (notificaciones)
    preferredBranchId?: string | null;
    // Rol dinámico y sus permisos (vienen del backend; los permisos también van en el JWT)
    role?: { id: string; name: string };
    permissions?: string[];
    branchId?: string | null;
    employeeDiscount?: number;
}

export interface LoginCredential {
    email: string;
    password: string;
}

export interface RegisterCredential {
    email: string;
    password: string;
    firstName?: string;
    lastName?: string;
    phone?: string;
}

export interface AutoResponse {
    accessToken: string;
    refreshToken: string;
    user: User;
}

// PATCH /users/me: un texto vacío borra el teléfono; preferredBranchId null quita la sucursal favorita
export interface UpdateProfilePayload {
    firstName?: string;
    lastName?: string;
    phone?: string;
    preferredBranchId?: string | null;
}

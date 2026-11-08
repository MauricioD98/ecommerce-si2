export type Role =
  | 'USUARIO'
  | 'ADMIN'
  | 'Cliente'
  | 'Super Admin'
  | 'Admin Sucursal'
  | 'Empleado'
  | { id: string; name: string };

export interface User {
  id: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  role: Role;
  createdAt?: string;
  updatedAt?: string;
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: User;
}

export interface LoginPayload {
  email: string;
  password: string;
}

export interface RegisterPayload {
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
}

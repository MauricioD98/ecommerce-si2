import apiClient from './client';
import { AuthResponse, LoginPayload, RegisterPayload } from '../types';
import { withMobileAttestation } from '../security/mobileAttestation';

// Canal móvil: la API solo emite la sesión si el plan de la tienda incluye la app y el dispositivo
// prueba ser la app oficial (Play Integrity / App Attest). Ver src/security/mobileAttestation.ts.
export const authApi = {
  login: async (payload: LoginPayload): Promise<AuthResponse> => {
    const response = await withMobileAttestation((attestation) =>
      apiClient.post<AuthResponse>('/auth/mobile/login', { ...payload, attestation })
    );
    return response.data;
  },

  register: async (payload: RegisterPayload): Promise<AuthResponse> => {
    const response = await withMobileAttestation((attestation) =>
      apiClient.post<AuthResponse>('/auth/mobile/register', { ...payload, attestation })
    );
    return response.data;
  },

  logout: async (): Promise<{ message: string }> => {
    const response = await apiClient.post<{ message: string }>('/auth/logout');
    return response.data;
  },
};

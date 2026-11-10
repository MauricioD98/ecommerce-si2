import axios from 'axios';
import apiClient from './client';
import { getApiBaseUrl } from '../config/env';
import { checkOnline } from '../offline/network';
import { classifyDirectoryError, toStores, type DirectoryError, type DirectoryStore } from '../tenant/storeDirectory';

// Directorio público de tiendas activas: el mismo endpoint que usa el selector de la web
// (GET /platform/tenants/public). /platform/* no exige tienda ni sesión.
export const storesApi = {
  list: async (): Promise<DirectoryStore[]> => {
    const { data } = await apiClient.get<{ data: unknown }>('/platform/tenants/public', { timeout: 15_000 });
    return toStores(data?.data, await getApiBaseUrl());
  },
};

export async function describeDirectoryFailure(error: unknown): Promise<DirectoryError> {
  const status = axios.isAxiosError(error) ? error.response?.status : undefined;
  return classifyDirectoryError({ online: await checkOnline(), status });
}

import apiClient from './client';

export interface Branch {
  id: string;
  name: string;
  address?: string | null;
  phone?: string | null;
  isActive: boolean;
}

export const branchesApi = {
  getActive: async (): Promise<Branch[]> => {
    const res = await apiClient.get<Branch[]>('/branches');
    return res.data;
  },
};

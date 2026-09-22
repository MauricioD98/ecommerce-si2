import apiClient from './client';
import { User, UpdateUserPayload, ChangePasswordPayload } from '../types';

export const usersApi = {
  getProfile: async (): Promise<User> => {
    const response = await apiClient.get<User>('/users/me');
    return response.data;
  },

  updateProfile: async (payload: UpdateUserPayload): Promise<User> => {
    const response = await apiClient.patch<User>('/users/me', payload);
    return response.data;
  },

  changePassword: async (payload: ChangePasswordPayload): Promise<{ message: string }> => {
    const response = await apiClient.patch<{ message: string }>('/users/me/password', payload);
    return response.data;
  },
};

import { apiClient } from "./axios.config";
import { CreateAddressPayload, UserAddress } from "@/types/address.types";

export class AddressService {
    private static readonly ENDPOINT = "/users/me/addresses";

    // La predeterminada viene primero
    static async getAddresses(): Promise<UserAddress[]> {
        const response = await apiClient.get<UserAddress[]>(this.ENDPOINT);
        return response.data;
    }

    static async createAddress(data: CreateAddressPayload): Promise<UserAddress> {
        const response = await apiClient.post<UserAddress>(this.ENDPOINT, data);
        return response.data;
    }

    // PUT: edición completa (título, calle, referencia y ubicación)
    static async updateAddress(id: string, data: CreateAddressPayload): Promise<UserAddress> {
        const response = await apiClient.put<UserAddress>(`${this.ENDPOINT}/${id}`, data);
        return response.data;
    }

    // Marca la dirección como principal; el backend quita el flag a las demás
    static async setDefault(id: string): Promise<UserAddress> {
        const response = await apiClient.patch<UserAddress>(`${this.ENDPOINT}/${id}/default`);
        return response.data;
    }

    static async deleteAddress(id: string): Promise<void> {
        await apiClient.delete(`${this.ENDPOINT}/${id}`);
    }
}

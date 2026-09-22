import { useEffect, useState } from "react";
import { AddressService } from "@/service/api/address.service";
import { getApiErrorMessage } from "@/service/api/error.utils";
import { CreateAddressPayload, UserAddress } from "@/types/address.types";

// Direcciones guardadas del usuario. Las acciones lanzan el error para que el formulario lo muestre
export function useAddresses() {
    const [addresses, setAddresses] = useState<UserAddress[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let active = true;

        AddressService.getAddresses()
            .then((data) => {
                if (!active) return;
                setAddresses(data);
                setError(null);
            })
            .catch((error) => {
                if (active) setError(getApiErrorMessage(error, "No se pudieron cargar tus direcciones."));
            })
            .finally(() => {
                if (active) setIsLoading(false);
            });

        return () => {
            active = false;
        };
    }, []);

    const createAddress = async (data: CreateAddressPayload): Promise<UserAddress> => {
        const created = await AddressService.createAddress(data);
        // Si la nueva es la predeterminada, las demás dejan de serlo
        setAddresses((prev) => [created, ...prev.map((a) => (created.isDefault ? { ...a, isDefault: false } : a))]);
        return created;
    };

    const removeAddress = async (id: string) => {
        await AddressService.deleteAddress(id);
        // Al borrar la predeterminada, el backend promueve la más reciente: se recarga para reflejarlo
        setAddresses(await AddressService.getAddresses());
    };

    const updateAddress = async (id: string, data: CreateAddressPayload): Promise<UserAddress> => {
        const updated = await AddressService.updateAddress(id, data);
        setAddresses((prev) => prev.map((a) => (a.id === id ? updated : a)));
        return updated;
    };

    const setDefaultAddress = async (id: string) => {
        await AddressService.setDefault(id);
        // La predeterminada pasa al principio de la lista: se recarga con el orden del backend
        setAddresses(await AddressService.getAddresses());
    };

    return { addresses, isLoading, error, createAddress, updateAddress, setDefaultAddress, removeAddress };
}

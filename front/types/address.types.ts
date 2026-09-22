// Dirección guardada del usuario (GET /users/me/addresses)
export interface UserAddress {
    id: string;
    title: string;
    address: string;
    reference: string | null;
    latitude: number;
    longitude: number;
    isDefault: boolean;
}

export interface CreateAddressPayload {
    title: string;
    address: string;
    reference?: string;
    latitude: number;
    longitude: number;
    isDefault?: boolean;
}

// Dirección elegida para el envío: puede venir de las guardadas o ser de un solo uso
export interface DeliveryAddress {
    id?: string;
    title?: string;
    address: string;
    reference?: string | null;
    latitude: number;
    longitude: number;
}

export interface MapPosition {
    lat: number;
    lng: number;
}

// Santa Cruz de la Sierra, Bolivia: centro inicial del mapa
export const SANTA_CRUZ_CENTER: MapPosition = { lat: -17.7833, lng: -63.1821 };

export const toDeliveryAddress = (address: UserAddress): DeliveryAddress => ({
    id: address.id,
    title: address.title,
    address: address.address,
    reference: address.reference,
    latitude: address.latitude,
    longitude: address.longitude,
});

// Texto que se guarda en Order.shippingAddress
export const formatShippingAddress = (address: DeliveryAddress): string =>
    address.reference ? `${address.address} — ${address.reference}` : address.address;

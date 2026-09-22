export interface Branch {
    id: string;
    name: string;
    address: string | null;
    phone: string | null;
    isActive: boolean;
}

export type FulfillmentType = "DELIVERY" | "PICKUP";

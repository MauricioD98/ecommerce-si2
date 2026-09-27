// Punto de devolución (espejo de api/src/modules/returns/dto)

// Motivo declarado por el cliente. Es independiente del estado físico: alguien puede devolver por
// talla equivocada una prenda que llega dañada, y lo que decide si se revende es la condición.
export type ReturnReason = "WRONG_SIZE" | "DEFECTIVE" | "CHANGED_MIND" | "OTHER";

// Estado físico con el que vuelve la prenda, y lo único que decide a qué inventario entra
export type ItemCondition = "SELLABLE" | "DAMAGED";

export const RETURN_REASON_LABELS: Record<ReturnReason, string> = {
    WRONG_SIZE: "Talla equivocada",
    DEFECTIVE: "Prenda defectuosa",
    CHANGED_MIND: "Cambió de opinión",
    OTHER: "Otro motivo",
};

export const ITEM_CONDITION_LABELS: Record<ItemCondition, string> = {
    SELLABLE: "Vender nuevamente",
    DAMAGED: "Defectuoso / Merma",
};

// Línea de la venta original, con lo que ya se devolvió y lo que todavía se puede devolver
export interface ReturnableOrderItem {
    orderItemId: string;
    productId: string;
    productName: string;
    sku: string;
    size: string | null;
    quantity: number;
    unitPrice: number;
    alreadyReturned: number;
    // Tope que acepta el backend (quantity - alreadyReturned)
    returnableQuantity: number;
}

export interface ReturnableOrder {
    orderId: string;
    orderNumber: string;
    source: string;
    paymentMethod: string;
    status: string;
    totalAmount: number;
    branchName: string | null;
    customerName: string;
    customerEmail: string;
    nit: string | null;
    razonSocial: string | null;
    createdAt: string;
    items: ReturnableOrderItem[];
    // true cuando ya no queda ninguna unidad por devolver en toda la orden
    fullyReturned: boolean;
}

// Una línea a devolver. El mismo orderItemId puede repetirse con distinta condición (de 2 unidades,
// 1 vuelve vendible y 1 entra a mermas): el backend valida el tope sobre la suma.
export interface ProcessReturnItem {
    orderItemId: string;
    quantity: number;
    reason: ReturnReason;
    condition: ItemCondition;
}

export interface ProcessReturnPayload {
    orderId: string;
    items: ProcessReturnItem[];
    // Solo tiene efecto con el permiso ALL_BRANCHES
    branchId?: string;
    notes?: string;
}

export interface ReturnRecordItem {
    id: string;
    productId: string;
    productName: string;
    sku: string;
    size: string | null;
    quantity: number;
    unitPrice: number;
    subtotal: number;
    reason: ReturnReason;
    condition: ItemCondition;
}

export interface ReturnRecord {
    id: string;
    returnNumber: string;
    orderId: string;
    orderNumber: string;
    branchId: string;
    branchName: string | null;
    totalRefunded: number;
    notes: string | null;
    customerName: string;
    cashierName: string;
    sellableUnits: number;
    damagedUnits: number;
    items: ReturnRecordItem[];
    createdAt: string;
}

export interface PaginatedReturns {
    data: ReturnRecord[];
    meta: { total: number; page: number; limit: number; totalPages: number };
}

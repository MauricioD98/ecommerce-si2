import { FulfillmentType } from "./branch.types";

export interface BranchPayload {
    name: string;
    address?: string;
    latitude?: number;
    longitude?: number;
    phone?: string;
    isActive?: boolean;
}

export interface StaffUser {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    role: { id: string; name: string };
    permissions: string[];
    branchId: string | null;
    employeeDiscount: number;
    createdAt: string;
}

export interface CreateStaffPayload {
    email: string;
    password: string;
    firstName?: string;
    lastName?: string;
    roleId: string;
    branchId?: string;
    employeeDiscount?: number;
}

export interface UpdateStaffPayload {
    roleId?: string;
    branchId?: string;
    employeeDiscount?: number;
}

// Rol dinámico con sus permisos (GET /roles)
export interface RoleItem {
    id: string;
    name: string;
    description: string | null;
    permissions: string[];
    usersCount: number;
    // Rol base del sistema: no se puede eliminar ni renombrar
    isBase: boolean;
}

export interface RolePayload {
    name: string;
    description?: string;
    permissions: string[];
}

export interface InventorySizeStock {
    size: string;
    stock: number;
}

export interface InventoryItem {
    productId: string;
    branchId: string;
    // Suma del stock de todas las tallas
    stock: number;
    // Stock desglosado por talla
    sizes: InventorySizeStock[];
    productName: string;
    sku: string;
    price: number;
    discountPrice: number | null;
    discountPercentage: number | null;
    effectivePrice: number;
}

// null quita el descuento
export interface ProductDiscountPayload {
    discountPrice: number | null;
    discountPercentage: number | null;
}

// PUT /branches/:branchId/inventory/:productId: stock por talla y descuento de la sucursal
// (el descuento aplica igual a todas las tallas)
export interface SetInventoryPayload extends ProductDiscountPayload {
    sizes: InventorySizeStock[];
}

export type OrderStatus = "PENDIENTE" | "PROCESANDO" | "ENVIADO" | "ENTREGADO" | "CANCELADO";

export interface AdminOrder {
    id: string;
    userId: string;
    status: OrderStatus;
    total: number;
    discountApplied: number;
    shippingAddress: string;
    fulfillmentType: FulfillmentType;
    branchId: string | null;
    userEmail?: string;
    userName?: string;
    createdAt: string;
}

export interface PaginatedOrders {
    data: AdminOrder[];
    total: number;
    page: number;
    limit: number;
}

export interface CampaignPayload {
    subject: string;
    htmlBody: string;
    // Sin branchId: todos los usuarios (alcance global) o la sucursal propia
    branchId?: string;
}

export interface CampaignResult {
    audience: string;
    recipients: number;
    sent: number;
    failed: number;
}

export interface SalesByDay {
    date: string;
    revenue: number;
    orders: number;
}

export interface SalesOverview {
    branchId: string | null;
    from: string;
    to: string;
    totalRevenue: number;
    totalOrders: number;
    paidOrders: number;
    completedOrders: number;
    pendingOrders: number;
    cancelledOrders: number;
    averageOrderValue: number;
    totalDiscounts: number;
    salesByDay: SalesByDay[];
}

export interface TopProduct {
    productId: string;
    name: string;
    sku: string;
    units: number;
    revenue: number;
}

// Las columnas dependen de la pregunta: por eso las filas son objetos genéricos
export interface DynamicReportResult {
    sql: string;
    columns: string[];
    rows: Record<string, unknown>[];
    rowCount: number;
}

// POST /products y PATCH /products/:id. El stock no se envía: un producto nuevo nace con stock 0
// en todas las sucursales y se asigna desde el inventario
export interface ProductPayload {
    name: string;
    description?: string;
    categoryId: string;
    sku: string;
    price: number;
    sizes: string[];
    imageUrl?: string;
    isActive?: boolean;
    // Sucursal a la que el producto queda exclusivo. Omitido/null = global (visible en todas).
    // Con un admin de sucursal (sin ALL_BRANCHES) el backend lo ignora y fuerza su propia sucursal.
    branchId?: string | null;
    // Colecciones a las que pertenece (ej. Otoño-Invierno). Omitido: no se toca; [] las quita todas.
    collectionIds?: string[];
}

export interface CategoryOption {
    id: string;
    name: string;
}

export interface Category {
    id: string;
    name: string;
    description: string | null;
    slug: string;
    imageUrl: string | null;
    isActive: boolean;
    // Cuántos productos usan esta categoría (el backend bloquea el borrado si es > 0)
    productCount: number;
    createdAt: string;
    updatedAt: string;
}

export interface CategoryPayload {
    name: string;
    description?: string;
    // Vacío/omitido: el backend genera el slug a partir del nombre
    slug?: string;
    imageUrl?: string;
    isActive?: boolean;
}

export interface PaginatedCategories {
    data: Category[];
    meta: {
        total: number;
        page: number;
        limit: number;
        totalPages: number;
    };
}

export interface Collection {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    bannerImageUrl: string | null;
    isActive: boolean;
    // Cuántos productos tiene la colección (el backend bloquea el borrado si es > 0)
    productCount: number;
    createdAt: string;
    updatedAt: string;
}

export interface CollectionPayload {
    name: string;
    description?: string;
    // Vacío/omitido: el backend genera el slug a partir del nombre
    slug?: string;
    bannerImageUrl?: string;
    isActive?: boolean;
}

export interface PaginatedCollections {
    data: Collection[];
    meta: {
        total: number;
        page: number;
        limit: number;
        totalPages: number;
    };
}

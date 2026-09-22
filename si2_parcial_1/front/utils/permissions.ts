// Permisos de los roles dinámicos (espejo de api/src/common/constants/permissions.ts)
import { User } from "@/types/auth.types";

export const Permission = {
    MANAGE_BRANCHES: "MANAGE_BRANCHES",
    MANAGE_USERS: "MANAGE_USERS",
    MANAGE_INVENTORY: "MANAGE_INVENTORY",
    MANAGE_PRODUCTS: "MANAGE_PRODUCTS",
    VIEW_ORDERS: "VIEW_ORDERS",
    MANAGE_ROLES: "MANAGE_ROLES",
    SEND_MARKETING: "SEND_MARKETING",
    VIEW_REPORTS: "VIEW_REPORTS",
    ALL_BRANCHES: "ALL_BRANCHES",
    USE_POS: "USE_POS",
} as const;

export type PermissionValue = (typeof Permission)[keyof typeof Permission];

// Opciones del formulario de roles (checkboxes)
export const PERMISSION_OPTIONS: { value: PermissionValue; label: string; description: string }[] = [
    { value: "MANAGE_INVENTORY", label: "Inventario", description: "Stock y ofertas de la sucursal" },
    { value: "VIEW_ORDERS", label: "Pedidos", description: "Ver y gestionar pedidos" },
    { value: "MANAGE_USERS", label: "Usuarios", description: "Crear y editar empleados" },
    { value: "MANAGE_BRANCHES", label: "Sucursales", description: "Crear y editar sucursales" },
    { value: "MANAGE_ROLES", label: "Roles", description: "Crear y editar roles" },
    { value: "SEND_MARKETING", label: "Marketing", description: "Enviar correos promocionales a clientes" },
    { value: "VIEW_REPORTS", label: "Reportes", description: "Ver métricas y consultar datos con IA" },
    { value: "MANAGE_PRODUCTS", label: "Productos", description: "Catálogo de productos y categorías" },
    { value: "ALL_BRANCHES", label: "Todas las sucursales", description: "Actuar sobre cualquier sucursal, no solo la propia" },
    { value: "USE_POS", label: "Punto de venta", description: "Cobrar ventas físicas en la caja de la sucursal" },
];

export const PERMISSION_LABELS: Record<string, string> = Object.fromEntries(
    PERMISSION_OPTIONS.map((option) => [option.value, option.label])
);

// Permisos que dan acceso al panel /admin
const PANEL_PERMISSIONS: PermissionValue[] = [
    Permission.MANAGE_BRANCHES,
    Permission.MANAGE_USERS,
    Permission.MANAGE_INVENTORY,
    Permission.MANAGE_PRODUCTS,
    Permission.VIEW_ORDERS,
    Permission.MANAGE_ROLES,
    Permission.SEND_MARKETING,
    Permission.VIEW_REPORTS,
    Permission.USE_POS,
];

export const SUPER_ADMIN_ROLE = "Super Admin";

type PermissionUser = Pick<User, "role" | "permissions"> | null | undefined;

// "Super Admin" pasa cualquier verificación (igual que en el backend)
export const hasPermission = (user: PermissionUser, permission: string): boolean =>
    !!user && (user.role?.name === SUPER_ADMIN_ROLE || !!user.permissions?.includes(permission));

export const hasAllBranches = (user: PermissionUser): boolean =>
    hasPermission(user, Permission.ALL_BRANCHES);

export const canAccessAdmin = (user: PermissionUser): boolean =>
    PANEL_PERMISSIONS.some((permission) => hasPermission(user, permission));

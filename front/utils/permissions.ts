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
    PROCESS_RETURNS: "PROCESS_RETURNS",
    MANAGE_PAYMENTS: "MANAGE_PAYMENTS",
} as const;

export type PermissionValue = (typeof Permission)[keyof typeof Permission];

// Orden de los checkboxes del formulario de roles. Etiqueta y descripción de cada permiso:
// messages/<idioma>.json → AdminRoles.perms.<PERMISO>
export const PERMISSION_OPTIONS: PermissionValue[] = [
    "MANAGE_INVENTORY",
    "VIEW_ORDERS",
    "MANAGE_USERS",
    "MANAGE_BRANCHES",
    "MANAGE_ROLES",
    "SEND_MARKETING",
    "VIEW_REPORTS",
    "MANAGE_PRODUCTS",
    "ALL_BRANCHES",
    "USE_POS",
    "PROCESS_RETURNS",
    "MANAGE_PAYMENTS",
];

export const isPermission = (value: string): value is PermissionValue =>
    (PERMISSION_OPTIONS as string[]).includes(value);

// Roles base: el backend los crea con estos nombres fijos en cada tienda. Se traducen al mostrarlos
// (AdminRoles.baseRoles.<clave>); los roles creados por el usuario se muestran tal cual.
export const BASE_ROLE_KEYS: Record<string, "superAdmin" | "branchAdmin" | "employee" | "customer"> = {
    "Super Admin": "superAdmin",
    "Admin Sucursal": "branchAdmin",
    "Empleado": "employee",
    "Cliente": "customer",
};

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
    Permission.PROCESS_RETURNS,
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

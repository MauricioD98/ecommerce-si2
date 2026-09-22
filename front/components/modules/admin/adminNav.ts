import { Bell, Boxes, Building2, ChartColumn, ClipboardList, Layers, LucideIcon, ShieldCheck, Shirt, ShoppingCart, Tags, Users } from "lucide-react";
import { Permission, PermissionValue } from "@/utils/permissions";

export interface AdminNavLink {
    href: string;
    label: string;
    icon: LucideIcon;
}

interface NavItem {
    href: string;
    icon: LucideIcon;
    // Permiso necesario para ver el ítem
    permission: PermissionValue;
    // Etiqueta con alcance global (permiso ALL_BRANCHES) y con alcance de sucursal
    label: string;
    branchLabel?: string;
}

const NAV_ITEMS: NavItem[] = [
    { href: "/admin/pos", icon: ShoppingCart, permission: Permission.USE_POS, label: "Punto de Venta" },
    { href: "/admin/branches", icon: Building2, permission: Permission.MANAGE_BRANCHES, label: "Sucursales" },
    { href: "/admin/staff", icon: Users, permission: Permission.MANAGE_USERS, label: "Usuarios / Empleados", branchLabel: "Mis Empleados" },
    { href: "/admin/products", icon: Shirt, permission: Permission.MANAGE_PRODUCTS, label: "Productos" },
    { href: "/admin/categories", icon: Tags, permission: Permission.MANAGE_PRODUCTS, label: "Categorías" },
    { href: "/admin/collections", icon: Layers, permission: Permission.MANAGE_PRODUCTS, label: "Colecciones" },
    { href: "/admin/inventory", icon: Boxes, permission: Permission.MANAGE_INVENTORY, label: "Inventario", branchLabel: "Mi Inventario" },
    { href: "/admin/orders", icon: ClipboardList, permission: Permission.VIEW_ORDERS, label: "Pedidos", branchLabel: "Pedidos Locales" },
    { href: "/admin/reports", icon: ChartColumn, permission: Permission.VIEW_REPORTS, label: "Reportes" },
    { href: "/admin/notifications", icon: Bell, permission: Permission.SEND_MARKETING, label: "Notificaciones" },
    { href: "/admin/roles", icon: ShieldCheck, permission: Permission.MANAGE_ROLES, label: "Roles" },
];

// Ítems del menú lateral según los permisos del usuario. Las rutas son las mismas para todos,
// pero con alcance de sucursal los datos se limitan a la propia y las etiquetas cambian.
export const getAdminLinks = (can: (permission: string) => boolean, isGlobal: boolean): AdminNavLink[] =>
    NAV_ITEMS.filter((item) => can(item.permission)).map((item) => ({
        href: item.href,
        icon: item.icon,
        label: isGlobal ? item.label : item.branchLabel ?? item.label,
    }));

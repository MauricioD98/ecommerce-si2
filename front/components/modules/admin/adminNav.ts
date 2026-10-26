import { Bell, Boxes, Building2, ChartColumn, ClipboardList, CreditCard, Landmark, Layers, LucideIcon, RotateCcw, ShieldCheck, Shirt, ShoppingCart, Tags, Users } from "lucide-react";
import type { Messages } from "next-intl";
import { Permission, PermissionValue } from "@/utils/permissions";

// Claves de messages/<idioma>.json → "AdminNav"; el componente las traduce con useTranslations("AdminNav")
export type AdminNavLabel = Exclude<keyof Messages["AdminNav"], "menuLabel">;

export interface AdminNavLink {
    href: string;
    label: AdminNavLabel;
    icon: LucideIcon;
}

interface NavItem {
    href: string;
    icon: LucideIcon;
    // Permiso necesario para ver el ítem
    permission: PermissionValue;
    // Además del permiso, solo para el rol "Super Admin" (dueño de la tienda)
    superAdminOnly?: boolean;
    // Etiqueta con alcance global (permiso ALL_BRANCHES) y con alcance de sucursal
    label: AdminNavLabel;
    branchLabel?: AdminNavLabel;
}

const NAV_ITEMS: NavItem[] = [
    { href: "/admin/pos", icon: ShoppingCart, permission: Permission.USE_POS, label: "pos" },
    { href: "/admin/returns", icon: RotateCcw, permission: Permission.PROCESS_RETURNS, label: "returns" },
    { href: "/admin/branches", icon: Building2, permission: Permission.MANAGE_BRANCHES, label: "branches" },
    { href: "/admin/staff", icon: Users, permission: Permission.MANAGE_USERS, label: "staff", branchLabel: "staffBranch" },
    { href: "/admin/products", icon: Shirt, permission: Permission.MANAGE_PRODUCTS, label: "products" },
    { href: "/admin/categories", icon: Tags, permission: Permission.MANAGE_PRODUCTS, label: "categories" },
    { href: "/admin/collections", icon: Layers, permission: Permission.MANAGE_PRODUCTS, label: "collections" },
    { href: "/admin/inventory", icon: Boxes, permission: Permission.MANAGE_INVENTORY, label: "inventory", branchLabel: "inventoryBranch" },
    { href: "/admin/orders", icon: ClipboardList, permission: Permission.VIEW_ORDERS, label: "orders", branchLabel: "ordersBranch" },
    { href: "/admin/reports", icon: ChartColumn, permission: Permission.VIEW_REPORTS, label: "reports" },
    { href: "/admin/notifications", icon: Bell, permission: Permission.SEND_MARKETING, label: "notifications" },
    { href: "/admin/roles", icon: ShieldCheck, permission: Permission.MANAGE_ROLES, label: "roles" },
    { href: "/admin/suscripcion", icon: CreditCard, permission: Permission.MANAGE_ROLES, label: "subscription", superAdminOnly: true },
    { href: "/admin/pagos", icon: Landmark, permission: Permission.MANAGE_ROLES, label: "payments", superAdminOnly: true },
];

// Ítems del menú lateral según los permisos del usuario. Las rutas son las mismas para todos,
// pero con alcance de sucursal los datos se limitan a la propia y las etiquetas cambian.
export const getAdminLinks = (can: (permission: string) => boolean, isGlobal: boolean, isSuperAdmin = false): AdminNavLink[] =>
    NAV_ITEMS.filter((item) => can(item.permission) && (!item.superAdminOnly || isSuperAdmin)).map((item) => ({
        href: item.href,
        icon: item.icon,
        label: isGlobal ? item.label : item.branchLabel ?? item.label,
    }));

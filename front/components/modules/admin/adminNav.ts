import { Bell, Boxes, Building2, ChartColumn, ClipboardList, CreditCard, Landmark, Layers, LucideIcon, Palette, RotateCcw, ShieldCheck, Shirt, ShoppingCart, Tags, Users } from "lucide-react";
import type { Messages } from "next-intl";
import { Permission, PermissionValue } from "@/utils/permissions";
import type { PlanFeatures } from "@/providers/StoreInfoProvider";

// Claves de messages/<idioma>.json → "AdminNav"; el componente las traduce con useTranslations("AdminNav")
export type AdminNavLabel = Exclude<keyof Messages["AdminNav"], "menuLabel">;

export interface AdminNavLink {
    href: string;
    label: AdminNavLabel;
    icon: LucideIcon;
    highlight?: boolean;
}

type GatedPlanFeature = "pos" | "returns" | "campaigns";

interface NavItem {
    href: string;
    icon: LucideIcon;
    // Permiso necesario para ver el ítem
    permission: PermissionValue;
    // Beneficio del plan SaaS necesario para usar el módulo
    planFeature?: GatedPlanFeature;
    requiredPlanName?: string;
    // Además del permiso, solo para el rol "Super Admin" (dueño de la tienda)
    superAdminOnly?: boolean;
    // Ítem destacado en el menú (acento de color aunque no esté activo)
    highlight?: boolean;
    // Etiqueta con alcance global (permiso ALL_BRANCHES) y con alcance de sucursal
    label: AdminNavLabel;
    branchLabel?: AdminNavLabel;
}

const NAV_ITEMS: NavItem[] = [
    { href: "/admin/pos", icon: ShoppingCart, permission: Permission.USE_POS, label: "pos", planFeature: "pos", requiredPlanName: "Growth" },
    { href: "/admin/returns", icon: RotateCcw, permission: Permission.PROCESS_RETURNS, label: "returns", planFeature: "returns", requiredPlanName: "Growth" },
    { href: "/admin/branches", icon: Building2, permission: Permission.MANAGE_BRANCHES, label: "branches" },
    { href: "/admin/staff", icon: Users, permission: Permission.MANAGE_USERS, label: "staff", branchLabel: "staffBranch" },
    { href: "/admin/products", icon: Shirt, permission: Permission.MANAGE_PRODUCTS, label: "products" },
    { href: "/admin/categories", icon: Tags, permission: Permission.MANAGE_PRODUCTS, label: "categories" },
    { href: "/admin/collections", icon: Layers, permission: Permission.MANAGE_PRODUCTS, label: "collections" },
    { href: "/admin/inventory", icon: Boxes, permission: Permission.MANAGE_INVENTORY, label: "inventory", branchLabel: "inventoryBranch" },
    { href: "/admin/orders", icon: ClipboardList, permission: Permission.VIEW_ORDERS, label: "orders", branchLabel: "ordersBranch" },
    { href: "/admin/reports", icon: ChartColumn, permission: Permission.VIEW_REPORTS, label: "reports" },
    { href: "/admin/notifications", icon: Bell, permission: Permission.SEND_MARKETING, label: "notifications", planFeature: "campaigns", requiredPlanName: "Pro" },
    { href: "/admin/roles", icon: ShieldCheck, permission: Permission.MANAGE_ROLES, label: "roles" },
    { href: "/admin/suscripcion", icon: CreditCard, permission: Permission.MANAGE_ROLES, label: "subscription", superAdminOnly: true },
    { href: "/admin/settings/payments", icon: Landmark, permission: Permission.MANAGE_PAYMENTS, label: "payments" },
    { href: "/admin/settings/appearance", icon: Palette, permission: Permission.MANAGE_APPEARANCE, label: "appearance", highlight: true },
];

// Ítems del menú lateral según los permisos del usuario y los beneficios del plan contratado.
export const getAdminLinks = (
    can: (permission: string) => boolean,
    isGlobal: boolean,
    isSuperAdmin = false,
    features?: PlanFeatures,
): AdminNavLink[] =>
    NAV_ITEMS.filter(
        (item) =>
            can(item.permission) &&
            (!item.superAdminOnly || isSuperAdmin) &&
            (!item.planFeature || !features || features[item.planFeature]),
    ).map((item) => ({
        href: item.href,
        icon: item.icon,
        highlight: item.highlight,
        label: isGlobal ? item.label : item.branchLabel ?? item.label,
    }));

// Detecta si la ruta actual corresponde a un módulo bloqueado por el plan actual de la tienda.
export const getLockedModuleForPath = (
    pathname: string,
    features?: PlanFeatures,
): { label: AdminNavLabel; requiredPlan: string } | null => {
    if (!features) return null;
    const matched = NAV_ITEMS.find((item) => item.planFeature && pathname.startsWith(item.href));
    if (!matched || !matched.planFeature) return null;
    if (features[matched.planFeature]) return null;
    return {
        label: matched.label,
        requiredPlan: matched.requiredPlanName ?? "Pro",
    };
};

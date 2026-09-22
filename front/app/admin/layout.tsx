import type { Metadata } from "next";
import AdminShell from "@/components/modules/admin/AdminShell";

export const metadata: Metadata = {
    title: "Panel administrativo",
    description: "Gestión de sucursales, empleados, inventario y pedidos",
};

// Layout protegido: AdminShell verifica el rol en Redux y muestra el menú lateral según el rol
export default function AdminLayout({ children }: { children: React.ReactNode }) {
    return <AdminShell>{children}</AdminShell>;
}

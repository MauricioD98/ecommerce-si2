import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import AdminShell from "@/components/modules/admin/AdminShell";

export async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations("Metadata");
    return { title: t("adminTitle"), description: t("adminDescription") };
}

// Layout protegido: AdminShell verifica el rol en Redux y muestra el menú lateral según el rol
export default function AdminLayout({ children }: { children: React.ReactNode }) {
    return <AdminShell>{children}</AdminShell>;
}

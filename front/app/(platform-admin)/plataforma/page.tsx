import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import PlatformAdminClient from "@/components/modules/platform-admin/PlatformAdminClient";

export async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations("Metadata");
    // Panel interno: fuera de los buscadores
    return { title: { absolute: t("platformAdminTitle") }, description: t("platformAdminDescription"), robots: { index: false, follow: false } };
}

// Plano de control del SaaS (Super Admin de la plataforma, no de una tienda). Va en su propio grupo
// de rutas para no heredar la navegación de marketing de (platform). El acceso lo da la llave de
// plataforma, que verifica el backend (PlatformAdminGuard).
export default function PlataformaPage() {
    return <PlatformAdminClient />;
}

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import PlatformAdminShell from "@/components/modules/platform-admin/PlatformAdminShell";
import { PLATFORM_BRAND } from "@/utils/storeName";

export async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations("Metadata");
    const description = t("platformAdminDescription");
    // Panel interno: fuera de los buscadores
    return {
        title: { absolute: t("platformAdminTitle") },
        description,
        applicationName: PLATFORM_BRAND,
        openGraph: { siteName: PLATFORM_BRAND, title: t("platformAdminTitle"), description },
        robots: { index: false, follow: false },
    };
}

// Plano de control del SaaS (Super Admin de la plataforma, no de una tienda). Va en su propio grupo
// de rutas para no heredar la navegación de marketing de (platform). El layout mantiene la sesión, la
// cabecera y el menú mientras se navega entre secciones (/plataforma, /plataforma/tiendas, ...). El
// acceso lo da el token de plataforma, que verifica el backend (PlatformAdminGuard) en cada endpoint.
export default function PlataformaLayout({ children }: { children: React.ReactNode }) {
    return <PlatformAdminShell>{children}</PlatformAdminShell>;
}

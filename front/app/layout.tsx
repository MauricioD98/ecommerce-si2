import { poppins } from "./fonts"; // Ajusta esta ruta de importación
import "./globals.css";
import Providers from "@/providers";
import BotpressChat from "@/components/modules/chatbot/BotpressChat";
import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { getServerStoreName } from "@/utils/storeName.server";
import { getServerStoreAppearance } from "@/utils/storeAppearance.server";
import { getStoreFontClass } from "@/utils/fonts";
import { BACKGROUND_ASSET_PATH, appearanceCssVars, backgroundImageCss } from "@/utils/appearanceTheme";

// Títulos con el nombre de la tienda: "Carrito de compras | Boutique Aurora". Las páginas del SaaS
// (/planes, /contacto, /plataforma) usan title.absolute para no heredar la plantilla.
// La descripción y el favicon los personaliza la tienda en /admin/settings/appearance.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Metadata");
  const [store, appearance] = await Promise.all([getServerStoreName(), getServerStoreAppearance()]);
  const description = appearance.description ?? t("rootDescription", { store });
  return {
    title: { default: t("rootTitle", { store }), template: `%s | ${store}` },
    description,
    applicationName: store,
    openGraph: { siteName: store, description, ...(appearance.logoUrl?.startsWith("http") ? { images: [appearance.logoUrl] } : {}) },
    ...(appearance.faviconUrl ? { icons: { icon: appearance.faviconUrl } } : {}),
  };
}

export async function generateViewport(): Promise<Viewport> {
  const { primaryColor } = await getServerStoreAppearance();
  return {
    width: "device-width",
    initialScale: 1,
    maximumScale: 5,
    themeColor: primaryColor,
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Idioma resuelto en i18n/request.ts (cookie NEXT_LOCALE → Accept-Language → es).
  // NextIntlClientProvider hereda locale y mensajes del servidor: useTranslations funciona también
  // en los componentes "use client", y al cambiar de idioma basta con router.refresh().
  const [locale, appearance] = await Promise.all([getLocale(), getServerStoreAppearance()]);
  // Apariencia de la tienda como variables CSS (--color-*, --navbar-*, --search-*, --store-bg-*,
  // --admin-menu-*): los SCSS Modules las leen con var(--x, <color de siempre>).
  const brandStyle = appearanceCssVars(appearance, backgroundImageCss(appearance.storeBackgroundImage, appearance.updatedAt));
  // El fondo subido puede pesar cientos de KB: a los componentes cliente solo les llega si hay uno
  const clientAppearance = {
    ...appearance,
    storeBackgroundImage: appearance.storeBackgroundImage?.startsWith("data:") ? BACKGROUND_ASSET_PATH : appearance.storeBackgroundImage,
  };
  return (
    <html lang={locale}>
      <body className={`${poppins.variable} ${getStoreFontClass(appearance.fontFamily)}`} style={brandStyle}>
        <NextIntlClientProvider>
          <Providers appearance={clientAppearance}>{children}</Providers>
        </NextIntlClientProvider>
        <BotpressChat />
      </body>
    </html>
  );
}
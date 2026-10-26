import { poppins } from "./fonts"; // Ajusta esta ruta de importación
import "./globals.css";
import Providers from "@/providers";
import BotpressChat from "@/components/modules/chatbot/BotpressChat";
import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { getServerStoreName } from "@/utils/storeName.server";

// Títulos con el nombre de la tienda: "Carrito de compras | Boutique Aurora". Las páginas del SaaS
// (/planes, /contacto, /plataforma) usan title.absolute para no heredar la plantilla.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Metadata");
  const store = await getServerStoreName();
  return {
    title: { default: t("rootTitle", { store }), template: `%s | ${store}` },
    description: t("rootDescription", { store }),
    applicationName: store,
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: "#000000",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Idioma resuelto en i18n/request.ts (cookie NEXT_LOCALE → Accept-Language → es).
  // NextIntlClientProvider hereda locale y mensajes del servidor: useTranslations funciona también
  // en los componentes "use client", y al cambiar de idioma basta con router.refresh().
  const locale = await getLocale();
  return (
    <html lang={locale}>
      <body className={`${poppins.variable}`}>
        <NextIntlClientProvider>
          <Providers>{children}</Providers>
        </NextIntlClientProvider>
        <BotpressChat />
      </body>
    </html>
  );
}
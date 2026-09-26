import { poppins } from "./fonts"; // Ajusta esta ruta de importación
import "./globals.css";
import Providers from "@/providers";
import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "Stella Femme | E-commerce",
  description: "Stella Femme: moda femenina con retiro en tienda o envío a domicilio en Santa Cruz de la Sierra, Bolivia.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: "#000000",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${poppins.variable}`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
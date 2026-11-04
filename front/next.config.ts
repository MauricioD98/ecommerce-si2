import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// Idioma por cookie/Accept-Language, sin prefijo en la URL: ver i18n/request.ts
const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
  /* config options here */
  // Genera .next/standalone para Docker — permite correr con solo `node server.js`
  output: "standalone",
  // El service worker no se cachea por HTTP: de otro modo una corrección de seguridad tardaría en llegar
  async headers() {
    return [{ source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }] }];
  },
  images: {
    // Las imágenes vienen del backend desde hosts arbitrarios: sin optimizar para que next/image no falle con hosts no listados
    unoptimized: true,
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
        port: '',
        pathname: '/**'
      },
      {
        protocol: "https",
        hostname: "upload.wikimedia.org",
        port: '',
        pathname: '/**'
      }
    ]
  }
};

export default withNextIntl(nextConfig);

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Genera .next/standalone para Docker — permite correr con solo `node server.js`
  output: "standalone",
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

export default nextConfig;

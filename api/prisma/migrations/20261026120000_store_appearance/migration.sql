-- Personalización de la tienda pública: logo, favicon, colores, descripción y redes sociales.
-- Solo agrega una tabla de una fila (id "default"): no toca datos existentes.
CREATE TABLE "store_appearance" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "logoUrl" TEXT,
    "faviconUrl" TEXT,
    "primaryColor" TEXT NOT NULL DEFAULT '#000000',
    "secondaryColor" TEXT NOT NULL DEFAULT '#ffffff',
    "description" TEXT,
    "socialLinks" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "store_appearance_pkey" PRIMARY KEY ("id")
);

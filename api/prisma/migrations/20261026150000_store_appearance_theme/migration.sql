-- Personalización granular: tipografía, cabecera, búsqueda, fondo de la tienda y menú del panel.
-- Solo agrega columnas con default: las tiendas que ya guardaron su apariencia toman los valores por defecto.
ALTER TABLE "store_appearance" ADD COLUMN "fontFamily" TEXT NOT NULL DEFAULT 'Inter';
ALTER TABLE "store_appearance" ADD COLUMN "navbarBackgroundColor" TEXT NOT NULL DEFAULT '#ffffff';
ALTER TABLE "store_appearance" ADD COLUMN "navbarTextColor" TEXT NOT NULL DEFAULT '#000000';
ALTER TABLE "store_appearance" ADD COLUMN "searchBarBackgroundColor" TEXT NOT NULL DEFAULT '#333333';
ALTER TABLE "store_appearance" ADD COLUMN "storeBackgroundColor" TEXT NOT NULL DEFAULT '#ffffff';
ALTER TABLE "store_appearance" ADD COLUMN "storeBackgroundImage" TEXT;
ALTER TABLE "store_appearance" ADD COLUMN "adminMenuColor" TEXT NOT NULL DEFAULT '#1a1a1a';

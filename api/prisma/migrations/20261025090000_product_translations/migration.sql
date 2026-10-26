-- Traducciones del catálogo: { "en": { "name", "description" }, "fr": {...}, "pt": {...}, "zh": {...} }.
-- name/description siguen siendo el texto base (español): búsqueda, reportes y pedidos no cambian.
ALTER TABLE "products" ADD COLUMN "translations" JSONB NOT NULL DEFAULT '{}';

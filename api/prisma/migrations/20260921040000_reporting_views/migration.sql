-- Reportes dinámicos (Text-to-SQL): el SQL que genera la IA NUNCA toca las tablas reales.
-- Se ejecuta con un rol de solo lectura (storefront_reports) que solo puede leer las vistas del
-- esquema "reporting". Esas vistas:
--   * exponen solo columnas seguras (sin contraseñas, tokens ni correos),
--   * aplican el filtro de sucursal leyendo la variable de sesión app.branch_id, que fija el backend:
--     '*' = todas las sucursales, un id = solo esa sucursal, sin valor = ninguna fila (falla cerrado).

CREATE SCHEMA IF NOT EXISTS reporting;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'storefront_reports') THEN
    CREATE ROLE storefront_reports NOLOGIN;
  END IF;
END
$$;

-- El usuario de la aplicación debe poder hacer SET ROLE a este rol
GRANT storefront_reports TO CURRENT_USER;

CREATE OR REPLACE VIEW reporting.branches AS
SELECT b."id", b."name", b."address", b."phone", b."isActive" AS is_active
FROM public.branches b
WHERE current_setting('app.branch_id', true) = '*'
   OR b."id" = current_setting('app.branch_id', true);

CREATE OR REPLACE VIEW reporting.orders AS
SELECT o."id",
       o."orderNumber" AS order_number,
       o."status"::text AS status,
       o."totalAmount" AS total_amount,
       o."discountApplied" AS discount_applied,
       o."fulfillmentType"::text AS fulfillment_type,
       o."branchId" AS branch_id,
       o."userId" AS user_id,
       o."createdAt" AS created_at
FROM public.orders o
WHERE current_setting('app.branch_id', true) = '*'
   OR o."branchId" = current_setting('app.branch_id', true);

CREATE OR REPLACE VIEW reporting.order_items AS
SELECT oi."id",
       oi."orderId" AS order_id,
       oi."productId" AS product_id,
       oi."quantity",
       oi."price",
       o."branchId" AS branch_id,
       oi."createdAt" AS created_at
FROM public.order_items oi
JOIN public.orders o ON o."id" = oi."orderId"
WHERE current_setting('app.branch_id', true) = '*'
   OR o."branchId" = current_setting('app.branch_id', true);

-- El catálogo es común a todas las sucursales
CREATE OR REPLACE VIEW reporting.products AS
SELECT p."id", p."name", p."sku", p."price", p."categoryId" AS category_id,
       p."isActive" AS is_active, p."createdAt" AS created_at
FROM public.products p;

CREATE OR REPLACE VIEW reporting.categories AS
SELECT c."id", c."name", c."slug"
FROM public.categories c;

CREATE OR REPLACE VIEW reporting.product_inventories AS
SELECT pi."id",
       pi."productId" AS product_id,
       pi."branchId" AS branch_id,
       pi."stock",
       pi."discountPrice" AS discount_price,
       pi."discountPercentage" AS discount_percentage
FROM public.product_inventories pi
WHERE current_setting('app.branch_id', true) = '*'
   OR pi."branchId" = current_setting('app.branch_id', true);

-- Solo nombre: sin correo, contraseña ni tokens. Con alcance de sucursal, solo quienes compraron en ella
CREATE OR REPLACE VIEW reporting.users AS
SELECT u."id", u."firstName" AS first_name, u."lastName" AS last_name, u."createdAt" AS created_at
FROM public.users u
WHERE current_setting('app.branch_id', true) = '*'
   OR EXISTS (
        SELECT 1 FROM public.orders o
        WHERE o."userId" = u."id" AND o."branchId" = current_setting('app.branch_id', true)
      );

GRANT USAGE ON SCHEMA reporting TO storefront_reports;
GRANT SELECT ON ALL TABLES IN SCHEMA reporting TO storefront_reports;

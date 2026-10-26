-- Reportes dinámicos (Text-to-SQL) aislados por tienda.
--
-- `prisma migrate deploy` corre con ?schema=<schema_tienda>, así que current_schema() es la tienda
-- que se está migrando. Para ella se crea:
--   * "<schema>_reporting": las mismas vistas de antes (solo columnas seguras, filtro de sucursal
--     por app.branch_id: '*' = todas, un id = esa sucursal, sin valor = ninguna fila).
--   * rol "reports_<sufijo>" NOLOGIN con USAGE + SELECT SOLO sobre ese schema. ReportsService hace
--     SET LOCAL ROLE a este rol antes de ejecutar el SQL de la IA: aunque la consulta nombrara las
--     vistas de otra tienda, PostgreSQL la rechaza por permisos. Las vistas leen las tablas con los
--     privilegios de su dueño (el usuario de la app), así que el rol no necesita acceso a las tablas.
-- Los nombres se derivan igual que en tenant-context.ts (reportingSchemaOf / reportingRoleOf).

DO $migration$
DECLARE
  s text := current_schema();
  r text := current_schema() || '_reporting';
  role_name text := 'reports_' || substr(current_schema(), length('tenant_') + 1);
BEGIN
  IF s !~ '^tenant_([a-f0-9]{32}|legacy)$' THEN
    RAISE EXCEPTION 'tenant_scoped_reporting: schema inesperado "%" (¿falta ?schema= en la URL?)', s;
  END IF;

  EXECUTE format('CREATE SCHEMA IF NOT EXISTS %I', r);

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
    EXECUTE format('CREATE ROLE %I NOLOGIN', role_name);
  END IF;
  -- El usuario de la aplicación debe poder hacer SET ROLE a este rol
  EXECUTE format('GRANT %I TO CURRENT_USER', role_name);

  EXECUTE format($v$
    CREATE OR REPLACE VIEW %1$I.branches AS
    SELECT b."id", b."name", b."address", b."phone", b."isActive" AS is_active
    FROM %2$I.branches b
    WHERE current_setting('app.branch_id', true) = '*'
       OR b."id" = current_setting('app.branch_id', true)
  $v$, r, s);

  EXECUTE format($v$
    CREATE OR REPLACE VIEW %1$I.orders AS
    SELECT o."id",
           o."orderNumber" AS order_number,
           o."status"::text AS status,
           o."totalAmount" AS total_amount,
           o."discountApplied" AS discount_applied,
           o."fulfillmentType"::text AS fulfillment_type,
           o."branchId" AS branch_id,
           o."userId" AS user_id,
           o."createdAt" AS created_at
    FROM %2$I.orders o
    WHERE current_setting('app.branch_id', true) = '*'
       OR o."branchId" = current_setting('app.branch_id', true)
  $v$, r, s);

  EXECUTE format($v$
    CREATE OR REPLACE VIEW %1$I.order_items AS
    SELECT oi."id",
           oi."orderId" AS order_id,
           oi."productId" AS product_id,
           oi."quantity",
           oi."price",
           o."branchId" AS branch_id,
           oi."createdAt" AS created_at
    FROM %2$I.order_items oi
    JOIN %2$I.orders o ON o."id" = oi."orderId"
    WHERE current_setting('app.branch_id', true) = '*'
       OR o."branchId" = current_setting('app.branch_id', true)
  $v$, r, s);

  -- El catálogo es común a todas las sucursales
  EXECUTE format($v$
    CREATE OR REPLACE VIEW %1$I.products AS
    SELECT p."id", p."name", p."sku", p."price", p."categoryId" AS category_id,
           p."isActive" AS is_active, p."createdAt" AS created_at
    FROM %2$I.products p
  $v$, r, s);

  EXECUTE format($v$
    CREATE OR REPLACE VIEW %1$I.categories AS
    SELECT c."id", c."name", c."slug"
    FROM %2$I.categories c
  $v$, r, s);

  EXECUTE format($v$
    CREATE OR REPLACE VIEW %1$I.product_inventories AS
    SELECT pi."id",
           pi."productId" AS product_id,
           pi."branchId" AS branch_id,
           pi."stock",
           pi."discountPrice" AS discount_price,
           pi."discountPercentage" AS discount_percentage
    FROM %2$I.product_inventories pi
    WHERE current_setting('app.branch_id', true) = '*'
       OR pi."branchId" = current_setting('app.branch_id', true)
  $v$, r, s);

  -- Solo nombre: sin correo, contraseña ni tokens. Con alcance de sucursal, solo quienes compraron en ella
  EXECUTE format($v$
    CREATE OR REPLACE VIEW %1$I.users AS
    SELECT u."id", u."firstName" AS first_name, u."lastName" AS last_name, u."createdAt" AS created_at
    FROM %2$I.users u
    WHERE current_setting('app.branch_id', true) = '*'
       OR EXISTS (
            SELECT 1 FROM %2$I.orders o
            WHERE o."userId" = u."id" AND o."branchId" = current_setting('app.branch_id', true)
          )
  $v$, r, s);

  -- Venta a nivel de orden: sucursal, cliente, cajero (orders.cashierId) y facturación en una fila
  EXECUTE format($v$
    CREATE OR REPLACE VIEW %1$I.ventas_globales AS
    SELECT
      o."id" AS order_id,
      o."orderNumber" AS order_number,
      o."createdAt" AS created_at,
      o."status"::text AS status,
      o."source"::text AS canal,
      o."fulfillmentType"::text AS fulfillment_type,
      o."paymentMethod"::text AS metodo_pago,
      o."paymentStatus"::text AS estado_pago,
      o."totalAmount" AS total_amount,
      o."shippingCost" AS costo_envio,
      o."discountApplied" AS descuento_aplicado,
      o."branchId" AS branch_id,
      b."name" AS sucursal,
      o."userId" AS cliente_id,
      NULLIF(trim(concat(coalesce(cu."firstName", ''), ' ', coalesce(cu."lastName", ''))), '') AS cliente_nombre,
      o."cashierId" AS cajero_id,
      NULLIF(trim(concat(coalesce(ca."firstName", ''), ' ', coalesce(ca."lastName", ''))), '') AS cajero_nombre,
      o."nit" AS nit,
      o."razonSocial" AS razon_social,
      p."transactionId" AS pago_transaccion_id,
      p."status"::text AS pago_estado_detalle
    FROM %2$I.orders o
    LEFT JOIN %2$I.branches b ON b."id" = o."branchId"
    LEFT JOIN %2$I.users cu ON cu."id" = o."userId"
    LEFT JOIN %2$I.users ca ON ca."id" = o."cashierId"
    LEFT JOIN %2$I.payments p ON p."orderId" = o."id"
    WHERE current_setting('app.branch_id', true) = '*'
       OR o."branchId" = current_setting('app.branch_id', true)
  $v$, r, s);

  -- Rendimiento de productos: un item vendido por fila, con su categoría y la sucursal de la orden
  EXECUTE format($v$
    CREATE OR REPLACE VIEW %1$I.rendimiento_productos AS
    SELECT
      oi."id" AS order_item_id,
      oi."orderId" AS order_id,
      o."orderNumber" AS order_number,
      o."createdAt" AS fecha,
      o."status"::text AS estado_pedido,
      o."source"::text AS canal,
      o."fulfillmentType"::text AS fulfillment_type,
      oi."productId" AS product_id,
      pr."name" AS producto,
      pr."sku" AS sku,
      oi."size" AS talla,
      c."id" AS category_id,
      c."name" AS categoria,
      oi."quantity" AS cantidad,
      oi."price" AS precio_unitario,
      (oi."quantity" * oi."price") AS subtotal,
      o."branchId" AS branch_id,
      b."name" AS sucursal
    FROM %2$I.order_items oi
    JOIN %2$I.orders o ON o."id" = oi."orderId"
    JOIN %2$I.products pr ON pr."id" = oi."productId"
    LEFT JOIN %2$I.categories c ON c."id" = pr."categoryId"
    LEFT JOIN %2$I.branches b ON b."id" = o."branchId"
    WHERE current_setting('app.branch_id', true) = '*'
       OR o."branchId" = current_setting('app.branch_id', true)
  $v$, r, s);

  EXECUTE format('GRANT USAGE ON SCHEMA %I TO %I', r, role_name);
  EXECUTE format('GRANT SELECT ON ALL TABLES IN SCHEMA %I TO %I', r, role_name);
END
$migration$;

-- El schema "reporting" global (de antes del multitenant) solo tenía las vistas de la tienda
-- original, que ahora viven en tenant_legacy_reporting. En las tiendas nuevas es un no-op.
DROP SCHEMA IF EXISTS reporting CASCADE;

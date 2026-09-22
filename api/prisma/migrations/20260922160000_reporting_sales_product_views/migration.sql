-- Vistas planas para el Text-to-SQL de reportes: evitan que la IA tenga que armar JOINs de 4-6
-- tablas ella misma (orders + users x2 + branches + payments, o order_items + products + categories
-- + orders + branches). Mismo modelo de seguridad que las vistas de "20260921040000_reporting_views":
-- solo lectura, esquema "reporting", filtradas por la variable de sesión app.branch_id
-- ('*' = todas las sucursales, un id = solo esa sucursal, sin valor = ninguna fila).

-- Venta a nivel de orden: sucursal, cliente, cajero (si fue venta POS) y datos de facturación, todo
-- en una sola fila. "cajero" sale de orders.cashierId (quién cobró en caja), no del rol del usuario:
-- los roles son dinámicos (los crea el Super Admin) y no hay un nombre de rol fijo "Cajero" en el
-- que apoyarse; cashierId ya es la señal exacta de quién atendió la venta.
CREATE OR REPLACE VIEW reporting.ventas_globales AS
SELECT
  o."id" AS order_id,
  o."orderNumber" AS order_number,
  o."createdAt" AS created_at,
  o."status"::text AS status,
  o."source"::text AS canal,                       -- WEB (e-commerce) | POS (caja física)
  o."fulfillmentType"::text AS fulfillment_type,    -- DELIVERY | PICKUP
  o."paymentMethod"::text AS metodo_pago,           -- STRIPE | CASH | PHYSICAL_CARD | QR
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
FROM public.orders o
LEFT JOIN public.branches b ON b."id" = o."branchId"
LEFT JOIN public.users cu ON cu."id" = o."userId"
LEFT JOIN public.users ca ON ca."id" = o."cashierId"
LEFT JOIN public.payments p ON p."orderId" = o."id"
WHERE current_setting('app.branch_id', true) = '*'
   OR o."branchId" = current_setting('app.branch_id', true);

-- Rendimiento de productos: un item vendido por fila, con su categoría y la sucursal de la orden.
CREATE OR REPLACE VIEW reporting.rendimiento_productos AS
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
FROM public.order_items oi
JOIN public.orders o ON o."id" = oi."orderId"
JOIN public.products pr ON pr."id" = oi."productId"
LEFT JOIN public.categories c ON c."id" = pr."categoryId"
LEFT JOIN public.branches b ON b."id" = o."branchId"
WHERE current_setting('app.branch_id', true) = '*'
   OR o."branchId" = current_setting('app.branch_id', true);

-- Re-otorga SELECT sobre todas las vistas del esquema (incluye las dos nuevas; el GRANT original de
-- "reporting_views" solo alcanzó a las que existían en ese momento).
GRANT SELECT ON ALL TABLES IN SCHEMA reporting TO storefront_reports;

-- Reportes con IA, etapa 2: fechas en hora local, devoluciones y ventas netas.
--
-- FECHAS. Las tablas guardan "createdAt" como timestamp SIN zona y en UTC (Prisma escribe la hora UTC
-- desde el cliente; ningún INSERT crudo de pedidos/devoluciones usa el DEFAULT). Las vistas ahora
-- exponen esas columnas como timestamptz ("createdAt" AT TIME ZONE 'UTC'): con el TimeZone de la sesión
-- en la zona de la tienda (lo fija ReportsService), current_date, date_trunc, ::date y los literales
-- '2026-11-08' se interpretan en hora LOCAL de la tienda. Antes "ayer" o "mes pasado" se cortaban en UTC.
--
-- VENTAS Y DEVOLUCIONES (reglas reales del proyecto):
--   * Venta = pedido con status PROCESANDO, ENVIADO o ENTREGADO (misma regla que report-scope.ts).
--     PENDIENTE = sin pagar; CANCELADO = anulado/vencido (nunca se devuelve).
--   * Una devolución (returns/return_items) solo existe sobre ventas cobradas; es parcial por línea y
--     se reembolsa al precio unitario histórico de esa línea. NO cambia el status del pedido: solo
--     cuando se devolvió todo, payment_status pasa a REEMBOLSADO. El envío no se reembolsa.
--   * Las devoluciones se agregan POR PEDIDO o POR LÍNEA antes de unirse: un pedido con varios
--     productos, un pago y varias devoluciones parciales sigue siendo una fila con su total exacto.
--   * Importes: todos en la moneda del catálogo de la tienda. El sistema no guarda moneda por pedido
--     ni tipo de cambio; moneda_cobro es la moneda con la que se registró el cobro (p. ej. USDT =
--     el cliente envió "el equivalente"), NO la moneda del importe.
--
-- Se agrega la vista "devoluciones" (una fila por línea devuelta). Su branch_id es la sucursal que
-- RECIBIÓ la devolución; en las vistas de ventas, lo devuelto se atribuye a la venta original.
-- Las vistas se recrean (cambia el tipo de las fechas): el CASCADE se lleva las vistas de sucursal
-- "rb_*", que ensure_report_branch_scope() reconstruye con la versión v3 en la próxima consulta.

DO $migration$
DECLARE
  s text := current_schema();
  r text := current_schema() || '_reporting';
  v text;
  ensure_body text;
  branch_filter constant text := $f$current_setting('app.branch_id', true) = '*' OR %s = current_setting('app.branch_id', true)$f$;
BEGIN
  IF s !~ '^tenant_([a-f0-9]{32}|legacy)$' THEN
    RAISE EXCEPTION 'reporting_accuracy: schema inesperado "%" (¿falta ?schema= en la URL?)', s;
  END IF;

  FOREACH v IN ARRAY ARRAY['branches','orders','order_items','products','categories','product_inventories',
                           'users','ventas_globales','rendimiento_productos','devoluciones'] LOOP
    EXECUTE format('DROP VIEW IF EXISTS %I.%I CASCADE', r, v);
  END LOOP;

  EXECUTE format($v$
    CREATE VIEW %1$I.branches AS
    SELECT b."id", b."name", b."address", b."phone", b."isActive" AS is_active
    FROM %2$I.branches b
    WHERE %3$s
  $v$, r, s, format(branch_filter, 'b."id"'));

  EXECUTE format($v$
    CREATE VIEW %1$I.orders AS
    SELECT o."id",
           o."orderNumber" AS order_number,
           o."status"::text AS status,
           o."totalAmount" AS total_amount,
           o."discountApplied" AS discount_applied,
           o."fulfillmentType"::text AS fulfillment_type,
           o."branchId" AS branch_id,
           o."userId" AS user_id,
           (o."createdAt" AT TIME ZONE 'UTC') AS created_at,
           o."paymentStatus"::text AS estado_pago,
           o."source"::text AS canal,
           o."paymentMethod"::text AS metodo_pago,
           o."shippingCost" AS costo_envio,
           (o."status"::text IN ('PROCESANDO','ENVIADO','ENTREGADO')) AS es_venta,
           coalesce(d.unidades, 0)::integer AS unidades_devueltas,
           coalesce(d.monto, 0)::numeric(12,2) AS monto_devuelto,
           (o."totalAmount" - coalesce(d.monto, 0))::numeric(12,2) AS total_neto
    FROM %2$I.orders o
    LEFT JOIN (
      SELECT rt."orderId", sum(ri.quantity) AS unidades, sum(ri.quantity * ri."unitPrice") AS monto
      FROM %2$I.returns rt JOIN %2$I.return_items ri ON ri."returnId" = rt."id"
      GROUP BY rt."orderId"
    ) d ON d."orderId" = o."id"
    WHERE %3$s
  $v$, r, s, format(branch_filter, 'o."branchId"'));

  EXECUTE format($v$
    CREATE VIEW %1$I.order_items AS
    SELECT oi."id",
           oi."orderId" AS order_id,
           oi."productId" AS product_id,
           oi."quantity",
           oi."price",
           o."branchId" AS branch_id,
           (oi."createdAt" AT TIME ZONE 'UTC') AS created_at,
           oi."size" AS talla,
           (oi."quantity" * oi."price")::numeric(12,2) AS subtotal,
           coalesce(d.unidades, 0)::integer AS cantidad_devuelta,
           coalesce(d.monto, 0)::numeric(12,2) AS monto_devuelto,
           (oi."quantity" - coalesce(d.unidades, 0))::integer AS cantidad_neta,
           (oi."quantity" * oi."price" - coalesce(d.monto, 0))::numeric(12,2) AS subtotal_neto
    FROM %2$I.order_items oi
    JOIN %2$I.orders o ON o."id" = oi."orderId"
    LEFT JOIN (
      SELECT ri."orderItemId", sum(ri.quantity) AS unidades, sum(ri.quantity * ri."unitPrice") AS monto
      FROM %2$I.return_items ri GROUP BY ri."orderItemId"
    ) d ON d."orderItemId" = oi."id"
    WHERE %3$s
  $v$, r, s, format(branch_filter, 'o."branchId"'));

  -- El catálogo es común a todas las sucursales
  EXECUTE format($v$
    CREATE VIEW %1$I.products AS
    SELECT p."id", p."name", p."sku", p."price", p."categoryId" AS category_id,
           p."isActive" AS is_active, (p."createdAt" AT TIME ZONE 'UTC') AS created_at
    FROM %2$I.products p
  $v$, r, s);

  EXECUTE format($v$
    CREATE VIEW %1$I.categories AS
    SELECT c."id", c."name", c."slug"
    FROM %2$I.categories c
  $v$, r, s);

  EXECUTE format($v$
    CREATE VIEW %1$I.product_inventories AS
    SELECT pi."id",
           pi."productId" AS product_id,
           pi."branchId" AS branch_id,
           pi."stock",
           pi."discountPrice" AS discount_price,
           pi."discountPercentage" AS discount_percentage
    FROM %2$I.product_inventories pi
    WHERE %3$s
  $v$, r, s, format(branch_filter, 'pi."branchId"'));

  -- Solo nombre: sin correo, contraseña ni tokens. Con alcance de sucursal, solo quienes compraron en ella
  EXECUTE format($v$
    CREATE VIEW %1$I.users AS
    SELECT u."id", u."firstName" AS first_name, u."lastName" AS last_name, (u."createdAt" AT TIME ZONE 'UTC') AS created_at
    FROM %2$I.users u
    WHERE current_setting('app.branch_id', true) = '*'
       OR EXISTS (
            SELECT 1 FROM %2$I.orders o
            WHERE o."userId" = u."id" AND o."branchId" = current_setting('app.branch_id', true)
          )
  $v$, r, s);

  -- Una fila por pedido: el pago es único por pedido (payments.orderId UNIQUE) y las devoluciones van
  -- agregadas, así que no hay duplicados
  EXECUTE format($v$
    CREATE VIEW %1$I.ventas_globales AS
    SELECT
      o."id" AS order_id,
      o."orderNumber" AS order_number,
      (o."createdAt" AT TIME ZONE 'UTC') AS created_at,
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
      p."status"::text AS pago_estado_detalle,
      (o."status"::text IN ('PROCESANDO','ENVIADO','ENTREGADO')) AS es_venta,
      coalesce(d.unidades, 0)::integer AS unidades_devueltas,
      coalesce(d.monto, 0)::numeric(12,2) AS monto_devuelto,
      (o."totalAmount" - coalesce(d.monto, 0))::numeric(12,2) AS total_neto,
      upper(p."currency") AS moneda_cobro
    FROM %2$I.orders o
    LEFT JOIN %2$I.branches b ON b."id" = o."branchId"
    LEFT JOIN %2$I.users cu ON cu."id" = o."userId"
    LEFT JOIN %2$I.users ca ON ca."id" = o."cashierId"
    LEFT JOIN %2$I.payments p ON p."orderId" = o."id"
    LEFT JOIN (
      SELECT rt."orderId", sum(ri.quantity) AS unidades, sum(ri.quantity * ri."unitPrice") AS monto
      FROM %2$I.returns rt JOIN %2$I.return_items ri ON ri."returnId" = rt."id"
      GROUP BY rt."orderId"
    ) d ON d."orderId" = o."id"
    WHERE %3$s
  $v$, r, s, format(branch_filter, 'o."branchId"'));

  -- Una fila por línea vendida; lo devuelto de ESA línea va agregado
  EXECUTE format($v$
    CREATE VIEW %1$I.rendimiento_productos AS
    SELECT
      oi."id" AS order_item_id,
      oi."orderId" AS order_id,
      o."orderNumber" AS order_number,
      (o."createdAt" AT TIME ZONE 'UTC') AS fecha,
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
      b."name" AS sucursal,
      (o."status"::text IN ('PROCESANDO','ENVIADO','ENTREGADO')) AS es_venta,
      coalesce(d.unidades, 0)::integer AS cantidad_devuelta,
      coalesce(d.monto, 0)::numeric(12,2) AS monto_devuelto,
      (oi."quantity" - coalesce(d.unidades, 0))::integer AS cantidad_neta,
      (oi."quantity" * oi."price" - coalesce(d.monto, 0))::numeric(12,2) AS subtotal_neto
    FROM %2$I.order_items oi
    JOIN %2$I.orders o ON o."id" = oi."orderId"
    JOIN %2$I.products pr ON pr."id" = oi."productId"
    LEFT JOIN %2$I.categories c ON c."id" = pr."categoryId"
    LEFT JOIN %2$I.branches b ON b."id" = o."branchId"
    LEFT JOIN (
      SELECT ri."orderItemId", sum(ri.quantity) AS unidades, sum(ri.quantity * ri."unitPrice") AS monto
      FROM %2$I.return_items ri GROUP BY ri."orderItemId"
    ) d ON d."orderItemId" = oi."id"
    WHERE %3$s
  $v$, r, s, format(branch_filter, 'o."branchId"'));

  -- Una fila por línea devuelta. branch_id = sucursal que RECIBIÓ la devolución
  EXECUTE format($v$
    CREATE VIEW %1$I.devoluciones AS
    SELECT
      ri."id" AS devolucion_item_id,
      rt."id" AS devolucion_id,
      rt."returnNumber" AS numero_devolucion,
      (rt."createdAt" AT TIME ZONE 'UTC') AS fecha,
      rt."branchId" AS branch_id,
      b."name" AS sucursal,
      o."id" AS order_id,
      o."orderNumber" AS order_number,
      (o."createdAt" AT TIME ZONE 'UTC') AS fecha_venta,
      o."branchId" AS branch_id_venta,
      o."source"::text AS canal_venta,
      ri."productId" AS product_id,
      pr."name" AS producto,
      pr."sku" AS sku,
      ri."size" AS talla,
      c."name" AS categoria,
      ri."quantity" AS cantidad,
      ri."unitPrice" AS precio_unitario,
      (ri."quantity" * ri."unitPrice")::numeric(12,2) AS monto,
      ri."reason"::text AS motivo,
      ri."condition"::text AS condicion
    FROM %2$I.return_items ri
    JOIN %2$I.returns rt ON rt."id" = ri."returnId"
    JOIN %2$I.orders o ON o."id" = rt."orderId"
    JOIN %2$I.products pr ON pr."id" = ri."productId"
    LEFT JOIN %2$I.categories c ON c."id" = pr."categoryId"
    LEFT JOIN %2$I.branches b ON b."id" = rt."branchId"
    WHERE %3$s
  $v$, r, s, format(branch_filter, 'rt."branchId"'));

  -- Ámbitos de sucursal v3: incluyen "devoluciones" (filtrada por la sucursal que la recibió) ----------
  ensure_body := $tpl$
DECLARE
  v_tenant  constant text := @TENANT@;
  v_base    constant text := @TENANT@ || '_reporting';
  v_views   constant text[] := ARRAY['branches','orders','order_items','products','categories',
                                     'product_inventories','users','ventas_globales','rendimiento_productos',
                                     'devoluciones'];
  v_name   text;
  v_tag    text;
  v_exists boolean;
  v_ready  boolean;
  v_view   text;
BEGIN
  IF p_branch_id IS NULL OR length(p_branch_id) = 0 OR length(p_branch_id) > 64 THEN
    RAISE EXCEPTION 'report_scope_invalid_branch' USING ERRCODE = '22023';
  END IF;

  EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I.branches WHERE id = $1)', v_tenant) INTO v_exists USING p_branch_id;
  IF NOT v_exists THEN
    RAISE EXCEPTION 'report_scope_unknown_branch' USING ERRCODE = 'P0002';
  END IF;

  v_name := 'rb_' || md5(v_tenant || ':' || p_branch_id);
  v_tag := 'report-branch-scope-v3:' || v_tenant || ':' || p_branch_id;

  SELECT obj_description(n.oid, 'pg_namespace') = v_tag
         AND (SELECT count(*) FROM pg_class c WHERE c.relnamespace = n.oid AND c.relkind = 'v') = cardinality(v_views)
    INTO v_ready
    FROM pg_namespace n WHERE n.nspname = v_name;
  IF coalesce(v_ready, false) THEN
    RETURN v_name;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_name, 0));
  SELECT obj_description(n.oid, 'pg_namespace') = v_tag
         AND (SELECT count(*) FROM pg_class c WHERE c.relnamespace = n.oid AND c.relkind = 'v') = cardinality(v_views)
    INTO v_ready
    FROM pg_namespace n WHERE n.nspname = v_name;
  IF coalesce(v_ready, false) THEN
    RETURN v_name;
  END IF;

  EXECUTE format('CREATE SCHEMA IF NOT EXISTS %I', v_name);
  EXECUTE format('REVOKE ALL ON SCHEMA %I FROM PUBLIC', v_name);

  FOREACH v_view IN ARRAY v_views LOOP
    EXECUTE format('DROP VIEW IF EXISTS %I.%I', v_name, v_view);
  END LOOP;

  EXECUTE format('CREATE VIEW %I.branches WITH (security_barrier = true) AS SELECT * FROM %I.branches WHERE id = %L', v_name, v_base, p_branch_id);
  EXECUTE format('CREATE VIEW %I.orders WITH (security_barrier = true) AS SELECT * FROM %I.orders WHERE branch_id = %L', v_name, v_base, p_branch_id);
  EXECUTE format('CREATE VIEW %I.order_items WITH (security_barrier = true) AS SELECT * FROM %I.order_items WHERE branch_id = %L', v_name, v_base, p_branch_id);
  EXECUTE format('CREATE VIEW %I.product_inventories WITH (security_barrier = true) AS SELECT * FROM %I.product_inventories WHERE branch_id = %L', v_name, v_base, p_branch_id);
  EXECUTE format('CREATE VIEW %I.ventas_globales WITH (security_barrier = true) AS SELECT * FROM %I.ventas_globales WHERE branch_id = %L', v_name, v_base, p_branch_id);
  EXECUTE format('CREATE VIEW %I.rendimiento_productos WITH (security_barrier = true) AS SELECT * FROM %I.rendimiento_productos WHERE branch_id = %L', v_name, v_base, p_branch_id);
  EXECUTE format('CREATE VIEW %I.devoluciones WITH (security_barrier = true) AS SELECT * FROM %I.devoluciones WHERE branch_id = %L', v_name, v_base, p_branch_id);
  EXECUTE format('CREATE VIEW %I.products WITH (security_barrier = true) AS SELECT * FROM %I.products', v_name, v_base);
  EXECUTE format('CREATE VIEW %I.categories WITH (security_barrier = true) AS SELECT * FROM %I.categories', v_name, v_base);
  EXECUTE format(
    'CREATE VIEW %1$I.users WITH (security_barrier = true) AS SELECT u.* FROM %2$I.users u '
    'WHERE EXISTS (SELECT 1 FROM %2$I.orders o WHERE o.user_id = u.id AND o.branch_id = %3$L)',
    v_name, v_base, p_branch_id);

  EXECUTE format('COMMENT ON SCHEMA %I IS %L', v_name, v_tag);
  PERFORM @TENANT_IDENT@.prune_report_branch_scopes();
  RETURN v_name;
END
$tpl$;

  ensure_body := replace(replace(ensure_body, '@TENANT_IDENT@', quote_ident(s)), '@TENANT@', quote_literal(s));
  EXECUTE format(
    'CREATE OR REPLACE FUNCTION %I.ensure_report_branch_scope(p_branch_id text) RETURNS text '
    'LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS %L',
    s, ensure_body);
  EXECUTE format('REVOKE ALL ON FUNCTION %I.ensure_report_branch_scope(text) FROM PUBLIC', s);
END
$migration$;

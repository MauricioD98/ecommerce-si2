-- Reportes con IA: empleados y ventas por empleado.
--
-- Qué guarda realmente el sistema (revisado en schema.prisma, users.service, pos.service):
--   * No hay un campo "es empleado". El personal se reconoce por el ROL: los clientes tienen el rol sin
--     permisos ("Cliente"); el personal tiene un rol con permisos. La pantalla "Personal" lista a los
--     usuarios con sucursal asignada (users."branchId"); los dueños/administradores globales (Super Admin)
--     no tienen sucursal pero también venden en caja. La vista "empleados" incluye a ambos y lo indica en
--     asignado_a_sucursal.
--   * No hay estado activo/inactivo: solo un bloqueo temporal de acceso ("lockedUntil"). estado_acceso
--     refleja eso y nada más.
--   * Cada venta POS guarda quién cobró (orders."cashierId"). Las ventas WEB no tienen empleado: no se le
--     atribuyen a nadie.
--   * NO se guarda el rol que tenía el empleado al momento de la venta: cajero_rol_actual es su rol HOY.
--   * La hora de la venta es la creación del pedido (no existe una fecha de pago en orders).
--
-- Cambios (todos aditivos; no se modifica ninguna migración anterior):
--   * Vista nueva "<schema>_reporting".empleados (sin correo, teléfono, contraseña, tokens ni descuentos).
--   * ventas_globales: + cajero_rol_actual.
--   * rendimiento_productos: + cajero_id, cajero_nombre, cajero_rol_actual (unidades por empleado).
--   * ensure_report_branch_scope v4: los ámbitos de sucursal incluyen "empleados" (solo el personal asignado
--     a ESA sucursal). Los ámbitos v3 existentes se reconstruyen solos en la próxima consulta.
-- La vista empleados solo se concede a quien tiene MANAGE_USERS (lo decide ReportsService por petición).

DO $migration$
DECLARE
  s text := current_schema();
  r text := current_schema() || '_reporting';
  ensure_body text;
  branch_filter constant text := $f$current_setting('app.branch_id', true) = '*' OR %s = current_setting('app.branch_id', true)$f$;
BEGIN
  IF s !~ '^tenant_([a-f0-9]{32}|legacy)$' THEN
    RAISE EXCEPTION 'reporting_employees: schema inesperado "%" (¿falta ?schema= en la URL?)', s;
  END IF;

  -- Mismo cuerpo que 20261110120000 + columnas nuevas AL FINAL (CREATE OR REPLACE solo permite agregar)
  EXECUTE format($v$
    CREATE OR REPLACE VIEW %1$I.ventas_globales AS
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
      upper(p."currency") AS moneda_cobro,
      ra."name" AS cajero_rol_actual
    FROM %2$I.orders o
    LEFT JOIN %2$I.branches b ON b."id" = o."branchId"
    LEFT JOIN %2$I.users cu ON cu."id" = o."userId"
    LEFT JOIN %2$I.users ca ON ca."id" = o."cashierId"
    LEFT JOIN %2$I.roles ra ON ra."id" = ca."roleId"
    LEFT JOIN %2$I.payments p ON p."orderId" = o."id"
    LEFT JOIN (
      SELECT rt."orderId", sum(ri.quantity) AS unidades, sum(ri.quantity * ri."unitPrice") AS monto
      FROM %2$I.returns rt JOIN %2$I.return_items ri ON ri."returnId" = rt."id"
      GROUP BY rt."orderId"
    ) d ON d."orderId" = o."id"
    WHERE %3$s
  $v$, r, s, format(branch_filter, 'o."branchId"'));

  EXECUTE format($v$
    CREATE OR REPLACE VIEW %1$I.rendimiento_productos AS
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
      (oi."quantity" * oi."price" - coalesce(d.monto, 0))::numeric(12,2) AS subtotal_neto,
      o."cashierId" AS cajero_id,
      NULLIF(trim(concat(coalesce(ca."firstName", ''), ' ', coalesce(ca."lastName", ''))), '') AS cajero_nombre,
      ra."name" AS cajero_rol_actual
    FROM %2$I.order_items oi
    JOIN %2$I.orders o ON o."id" = oi."orderId"
    JOIN %2$I.products pr ON pr."id" = oi."productId"
    LEFT JOIN %2$I.categories c ON c."id" = pr."categoryId"
    LEFT JOIN %2$I.branches b ON b."id" = o."branchId"
    LEFT JOIN %2$I.users ca ON ca."id" = o."cashierId"
    LEFT JOIN %2$I.roles ra ON ra."id" = ca."roleId"
    LEFT JOIN (
      SELECT ri."orderItemId", sum(ri.quantity) AS unidades, sum(ri.quantity * ri."unitPrice") AS monto
      FROM %2$I.return_items ri GROUP BY ri."orderItemId"
    ) d ON d."orderItemId" = oi."id"
    WHERE %3$s
  $v$, r, s, format(branch_filter, 'o."branchId"'));

  -- Personal: rol con permisos o sucursal asignada. Sin datos de contacto, credenciales ni descuentos.
  EXECUTE format('DROP VIEW IF EXISTS %I.empleados CASCADE', r);
  EXECUTE format($v$
    CREATE VIEW %1$I.empleados AS
    SELECT
      u."id",
      u."firstName" AS nombre,
      u."lastName" AS apellido,
      NULLIF(trim(concat(coalesce(u."firstName", ''), ' ', coalesce(u."lastName", ''))), '') AS nombre_completo,
      ro."name" AS rol,
      u."branchId" AS branch_id,
      b."name" AS sucursal,
      (u."branchId" IS NOT NULL) AS asignado_a_sucursal,
      CASE WHEN u."lockedUntil" IS NOT NULL AND u."lockedUntil" > (now() AT TIME ZONE 'UTC')
           THEN 'BLOQUEADO_TEMPORALMENTE' ELSE 'HABILITADO' END AS estado_acceso,
      (u."createdAt" AT TIME ZONE 'UTC') AS fecha_alta
    FROM %2$I.users u
    JOIN %2$I.roles ro ON ro."id" = u."roleId"
    LEFT JOIN %2$I.branches b ON b."id" = u."branchId"
    WHERE (u."branchId" IS NOT NULL OR cardinality(ro."permissions") > 0)
      AND (%3$s)
  $v$, r, s, format(branch_filter, 'u."branchId"'));

  -- Ámbitos de sucursal v4 (11 vistas) ---------------------------------------------------------------
  ensure_body := $tpl$
DECLARE
  v_tenant  constant text := @TENANT@;
  v_base    constant text := @TENANT@ || '_reporting';
  v_views   constant text[] := ARRAY['branches','orders','order_items','products','categories',
                                     'product_inventories','users','ventas_globales','rendimiento_productos',
                                     'devoluciones','empleados'];
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
  v_tag := 'report-branch-scope-v4:' || v_tenant || ':' || p_branch_id;

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
  EXECUTE format('CREATE VIEW %I.empleados WITH (security_barrier = true) AS SELECT * FROM %I.empleados WHERE branch_id = %L', v_name, v_base, p_branch_id);
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

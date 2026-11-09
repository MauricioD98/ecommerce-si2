-- Reportes con IA: el alcance (tienda o sucursal) lo garantiza PostgreSQL, sin un rol por sucursal ni
-- por tienda.
--
-- Problemas que corrige (reproducidos en un clúster aislado):
--   * Las vistas filtraban la sucursal con current_setting('app.branch_id'), que cualquier rol cambia con
--     set_config(): la separación entre sucursales dependía solo del validador de SQL.
--   * La consulta corría con SET ROLE reports_<tienda>. La cuenta de la conexión (session_user) es
--     miembro de ese rol, así que una sola sentencia podía hacer set_config('role','none') y, con una
--     función que ejecuta SQL en tiempo de ejecución (query_to_xml), leer otras tiendas.
--   * Un rol por tienda o por sucursal choca con el límite de Neon (500 roles por rama).
--
-- Diseño:
--   * Un único rol global "stella_report_runner" (NOLOGIN) SIN permisos permanentes.
--   * report_runtime.run_report(sql, límite): SECURITY DEFINER, propiedad de ese rol. Dentro de una
--     función SECURITY DEFINER PostgreSQL prohíbe cambiar "role" y "session_authorization", así que la
--     consulta no puede volver a la cuenta de la conexión.
--   * En cada petición la API, dentro de su transacción, concede al rol USAGE + SELECT SOLO sobre el
--     schema autorizado ("<schema>_reporting" para ALL_BRANCHES o "rb_<md5>" para una sucursal), pasa la
--     transacción a solo lectura, ejecuta run_report y termina SIEMPRE con ROLLBACK: los GRANT nunca se
--     confirman y ninguna otra sesión los ve.
--   * "rb_<md5>" es un schema (no un rol) con las mismas vistas filtradas por el id de la sucursal
--     ESCRITO COMO LITERAL y security_barrier. Lo crea a pedido <schema>.ensure_report_branch_scope().
--     <schema>.prune_report_branch_scopes() borra los de sucursales que ya no existen.
--   * El rol "reports_<sufijo>" que creaba la migración 20261024120000 deja de usarse y se elimina.

DO $migration$
DECLARE
  s text := current_schema();
  legacy_role text := 'reports_' || substr(current_schema(), length('tenant_') + 1);
  runner constant text := 'stella_report_runner';
  ensure_body text;
  prune_body text;
BEGIN
  IF s !~ '^tenant_([a-f0-9]{32}|legacy)$' THEN
    RAISE EXCEPTION 'branch_scoped_reporting: schema inesperado "%" (¿falta ?schema= en la URL?)', s;
  END IF;

  -- Lo global (rol y report_runtime) lo comparten todas las tiendas: se serializa entre migraciones
  PERFORM pg_advisory_xact_lock(hashtextextended('stella_report_runtime', 0));

  -- 1) Rol ejecutor global, sin permisos propios ---------------------------------------------------
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = runner) THEN
    EXECUTE format('CREATE ROLE %I NOLOGIN NOINHERIT', runner);
  END IF;
  -- La cuenta de la aplicación debe poder asignarle la función (ALTER ... OWNER)
  EXECUTE format('GRANT %I TO CURRENT_USER', runner);

  EXECUTE 'CREATE SCHEMA IF NOT EXISTS report_runtime';
  EXECUTE 'REVOKE ALL ON SCHEMA report_runtime FROM PUBLIC';

  EXECUTE $fn$
    CREATE OR REPLACE FUNCTION report_runtime.run_report(p_sql text, p_limit integer)
    RETURNS SETOF json
    LANGUAGE plpgsql
    SECURITY DEFINER
    AS $body$
    BEGIN
      IF p_limit IS NULL OR p_limit < 1 OR p_limit > 10000 THEN
        RAISE EXCEPTION 'report_invalid_limit' USING ERRCODE = '22023';
      END IF;
      -- Mismo envoltorio que valida la API (sql-guard.ts, REPORT_WRAPPER_*): una sola consulta
      RETURN QUERY EXECUTE
        'SELECT to_json(report_result) FROM (' || chr(10) || p_sql || chr(10) || ') AS report_result LIMIT $1'
        USING p_limit;
    END
    $body$
  $fn$;
  -- Dueño = rol ejecutor (para eso necesita CREATE en el schema solo durante el cambio)
  EXECUTE format('GRANT CREATE ON SCHEMA report_runtime TO %I', runner);
  EXECUTE format('ALTER FUNCTION report_runtime.run_report(text, integer) OWNER TO %I', runner);
  EXECUTE format('REVOKE CREATE ON SCHEMA report_runtime FROM %I', runner);
  EXECUTE 'REVOKE ALL ON FUNCTION report_runtime.run_report(text, integer) FROM PUBLIC';
  EXECUTE 'GRANT USAGE ON SCHEMA report_runtime TO CURRENT_USER';
  EXECUTE 'GRANT EXECUTE ON FUNCTION report_runtime.run_report(text, integer) TO CURRENT_USER';

  -- 2) Ámbitos por sucursal: schemas, no roles ---------------------------------------------------
  ensure_body := $tpl$
DECLARE
  v_tenant  constant text := @TENANT@;
  v_base    constant text := @TENANT@ || '_reporting';
  v_views   constant text[] := ARRAY['branches','orders','order_items','products','categories',
                                     'product_inventories','users','ventas_globales','rendimiento_productos'];
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
  -- Registro: versión, tienda y sucursal (lo usa prune_report_branch_scopes)
  v_tag := 'report-branch-scope-v2:' || v_tenant || ':' || p_branch_id;

  -- Camino rápido (lo normal): schema con la versión vigente y sus 9 vistas
  SELECT obj_description(n.oid, 'pg_namespace') = v_tag
         AND (SELECT count(*) FROM pg_class c WHERE c.relnamespace = n.oid AND c.relkind = 'v') = cardinality(v_views)
    INTO v_ready
    FROM pg_namespace n WHERE n.nspname = v_name;
  IF coalesce(v_ready, false) THEN
    RETURN v_name;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_name, 0));
  -- Otra petición pudo terminarlo mientras se esperaba el lock
  SELECT obj_description(n.oid, 'pg_namespace') = v_tag
         AND (SELECT count(*) FROM pg_class c WHERE c.relnamespace = n.oid AND c.relkind = 'v') = cardinality(v_views)
    INTO v_ready
    FROM pg_namespace n WHERE n.nspname = v_name;
  IF coalesce(v_ready, false) THEN
    RETURN v_name;
  END IF;

  EXECUTE format('CREATE SCHEMA IF NOT EXISTS %I', v_name);
  EXECUTE format('REVOKE ALL ON SCHEMA %I FROM PUBLIC', v_name);

  -- Se recrean siempre juntas: si cambiaron las columnas de las vistas base, CREATE OR REPLACE fallaría
  FOREACH v_view IN ARRAY v_views LOOP
    EXECUTE format('DROP VIEW IF EXISTS %I.%I', v_name, v_view);
  END LOOP;

  EXECUTE format('CREATE VIEW %I.branches WITH (security_barrier = true) AS SELECT * FROM %I.branches WHERE id = %L', v_name, v_base, p_branch_id);
  EXECUTE format('CREATE VIEW %I.orders WITH (security_barrier = true) AS SELECT * FROM %I.orders WHERE branch_id = %L', v_name, v_base, p_branch_id);
  EXECUTE format('CREATE VIEW %I.order_items WITH (security_barrier = true) AS SELECT * FROM %I.order_items WHERE branch_id = %L', v_name, v_base, p_branch_id);
  EXECUTE format('CREATE VIEW %I.product_inventories WITH (security_barrier = true) AS SELECT * FROM %I.product_inventories WHERE branch_id = %L', v_name, v_base, p_branch_id);
  EXECUTE format('CREATE VIEW %I.ventas_globales WITH (security_barrier = true) AS SELECT * FROM %I.ventas_globales WHERE branch_id = %L', v_name, v_base, p_branch_id);
  EXECUTE format('CREATE VIEW %I.rendimiento_productos WITH (security_barrier = true) AS SELECT * FROM %I.rendimiento_productos WHERE branch_id = %L', v_name, v_base, p_branch_id);
  -- El catálogo es común a todas las sucursales
  EXECUTE format('CREATE VIEW %I.products WITH (security_barrier = true) AS SELECT * FROM %I.products', v_name, v_base);
  EXECUTE format('CREATE VIEW %I.categories WITH (security_barrier = true) AS SELECT * FROM %I.categories', v_name, v_base);
  -- Clientes: solo quienes compraron en esta sucursal
  EXECUTE format(
    'CREATE VIEW %1$I.users WITH (security_barrier = true) AS SELECT u.* FROM %2$I.users u '
    'WHERE EXISTS (SELECT 1 FROM %2$I.orders o WHERE o.user_id = u.id AND o.branch_id = %3$L)',
    v_name, v_base, p_branch_id);

  EXECUTE format('COMMENT ON SCHEMA %I IS %L', v_name, v_tag);
  -- Se aprovecha la (rara) creación para limpiar ámbitos de sucursales borradas
  PERFORM @TENANT_IDENT@.prune_report_branch_scopes();
  RETURN v_name;
END
$tpl$;

  prune_body := $tpl$
DECLARE
  v_tenant constant text := @TENANT@;
  v_rec    record;
  v_branch text;
  v_exists boolean;
  v_dropped integer := 0;
BEGIN
  FOR v_rec IN
    SELECT n.nspname, obj_description(n.oid, 'pg_namespace') AS tag
      FROM pg_namespace n
     WHERE n.nspname ~ '^rb_[0-9a-f]{32}$'
  LOOP
    -- Solo schemas registrados por ESTA tienda y cuyo nombre coincide con el registro
    CONTINUE WHEN v_rec.tag IS NULL OR v_rec.tag NOT LIKE 'report-branch-scope-%:' || v_tenant || ':%';
    v_branch := substr(v_rec.tag, position(':' || v_tenant || ':' IN v_rec.tag) + length(v_tenant) + 2);
    CONTINUE WHEN v_rec.nspname <> 'rb_' || md5(v_tenant || ':' || v_branch);
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I.branches WHERE id = $1)', v_tenant) INTO v_exists USING v_branch;
    IF NOT v_exists THEN
      EXECUTE format('DROP SCHEMA %I CASCADE', v_rec.nspname);
      v_dropped := v_dropped + 1;
    END IF;
  END LOOP;
  RETURN v_dropped;
END
$tpl$;

  prune_body := replace(prune_body, '@TENANT@', quote_literal(s));
  EXECUTE format(
    'CREATE OR REPLACE FUNCTION %I.prune_report_branch_scopes() RETURNS integer '
    'LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS %L',
    s, prune_body);
  EXECUTE format('REVOKE ALL ON FUNCTION %I.prune_report_branch_scopes() FROM PUBLIC', s);

  ensure_body := replace(replace(ensure_body, '@TENANT_IDENT@', quote_ident(s)), '@TENANT@', quote_literal(s));
  EXECUTE format(
    'CREATE OR REPLACE FUNCTION %I.ensure_report_branch_scope(p_branch_id text) RETURNS text '
    'LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS %L',
    s, ensure_body);
  EXECUTE format('REVOKE ALL ON FUNCTION %I.ensure_report_branch_scope(text) FROM PUBLIC', s);

  -- 3) Roles que ya no se usan: el de la tienda (20261024120000) y el global "storefront_reports"
  --    (20260921040000, sin permisos desde el paso a multitenant). Se eliminan para no ocupar el cupo de
  --    roles ni dejar a la cuenta de la conexión roles a los que cambiar.
  FOREACH legacy_role IN ARRAY ARRAY[legacy_role, 'storefront_reports'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = legacy_role) THEN
      BEGIN
        -- PG16+: quien crea un rol recibe ADMIN pero no sus privilegios; DROP OWNED BY los exige
        EXECUTE format('GRANT %I TO CURRENT_USER', legacy_role);
        EXECUTE format('DROP OWNED BY %I', legacy_role);
        EXECUTE format('DROP ROLE %I', legacy_role);
      EXCEPTION WHEN OTHERS THEN
        -- Sin permisos de la cuenta de migración: queda huérfano pero sin uso (no rompe la migración)
        RAISE WARNING 'branch_scoped_reporting: no se pudo eliminar el rol %: %', legacy_role, SQLERRM;
      END;
    END IF;
  END LOOP;
END
$migration$;

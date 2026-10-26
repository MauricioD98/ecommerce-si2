-- Reportes dinámicos (Text-to-SQL): el SQL que genera la IA NUNCA toca las tablas reales.
--
-- MULTITENANT: esta migración creaba las vistas en un schema "reporting" global leyendo de
-- public.*. Con un schema por tienda eso falla (public ahora es el plano de control) y, peor, la
-- segunda tienda reemplazaría las vistas de la primera. Las vistas se movieron a
-- 20261024120000_tenant_scoped_reporting, que crea "<schema_tienda>_reporting" y un rol de lectura
-- propio por tienda. Acá queda solo lo global e idempotente.
--
-- Editar una migración ya aplicada es seguro con `prisma migrate deploy` (no recalcula checksums de
-- lo aplicado); `prisma migrate dev` sí avisa del cambio en entornos locales viejos: ahí basta con
-- recrear la base local.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'storefront_reports') THEN
    CREATE ROLE storefront_reports NOLOGIN;
  END IF;
END
$$;

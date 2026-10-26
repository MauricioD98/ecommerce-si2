-- ============================================================================================
-- Paso 1 de la migración a multitenant. Ejecutar UNA sola vez en Neon (SQL Editor o psql con la
-- DIRECT_URL, sin "-pooler"), con el backend viejo DETENIDO y después de sacar un branch/backup:
--
--   Neon Console → Branches → Create branch (desde main)   ← punto de restauración instantáneo
--
-- Qué hace: el schema "public" actual (todas las tablas de la tienda + _prisma_migrations) pasa a
-- llamarse "tenant_legacy" y se crea un "public" vacío para el plano de control (tenants,
-- tenant_credentials). Renombrar no copia datos: es instantáneo y conserva índices, FKs,
-- secuencias, enums y el historial de migraciones de la tienda.
--
-- Las vistas del schema "reporting" referencian las tablas por OID, así que tras el rename siguen
-- apuntando a tenant_legacy. La migración 20261024120000_tenant_scoped_reporting las reemplaza por
-- vistas propias de cada tienda y elimina "reporting".
-- ============================================================================================

-- 0) Chequeo previo: extensiones instaladas en public. Si aparece alguna, se mueve junto con el
--    schema (queda en tenant_legacy); anotala por si hay que recrearla en public después.
SELECT e.extname, n.nspname
FROM pg_extension e
JOIN pg_namespace n ON n.oid = e.extnamespace
WHERE n.nspname = 'public';

BEGIN;

ALTER SCHEMA public RENAME TO tenant_legacy;

CREATE SCHEMA public;
-- Mismos privilegios que trae el "public" por defecto de PostgreSQL 15+ (USAGE para todos, sin CREATE)
GRANT USAGE ON SCHEMA public TO PUBLIC;

COMMIT;

-- Siguiente paso (desde api/, con DIRECT_URL en el entorno):
--   npx prisma migrate deploy --config prisma.control.config.ts
-- y después ejecutar 002_register_legacy_tenant.sql

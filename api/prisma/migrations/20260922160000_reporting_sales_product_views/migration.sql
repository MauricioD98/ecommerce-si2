-- Vistas planas para el Text-to-SQL de reportes (ventas_globales, rendimiento_productos).
--
-- MULTITENANT: se movieron, junto con el resto de las vistas, a
-- 20261024120000_tenant_scoped_reporting (un schema de vistas y un rol por tienda). Esta migración
-- queda vacía a propósito para no romper el historial de las bases donde ya se aplicó.
SELECT 1;

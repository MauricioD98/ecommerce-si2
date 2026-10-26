-- ============================================================================================
-- Paso 2: registra la tienda original en el plano de control. Ejecutar DESPUÉS de
--   npx prisma migrate deploy --config prisma.control.config.ts
-- (que crea public.tenants). Es idempotente.
--
-- El id es fijo para poder configurarlo de antemano en todos lados:
--   api       → LEGACY_TENANT_ID           (fallback del webhook de Stripe para pagos en curso)
--   front     → NEXT_PUBLIC_TENANT_ID      (build de una sola tienda) y NEXT_PUBLIC_LEGACY_TENANT_ID
--   app_movil → EXPO_PUBLIC_TENANT_ID
-- ============================================================================================

INSERT INTO public.tenants (id, slug, name, schema_name, status, plan, schema_version, created_at, updated_at)
VALUES (
  '00000000-0000-4000-8000-000000000001',
  'stella-femme',
  'Stella Femme',
  'tenant_legacy',
  'ACTIVE',
  'legacy',
  (SELECT migration_name
     FROM tenant_legacy._prisma_migrations
    WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
    ORDER BY finished_at DESC
    LIMIT 1),
  now(),
  now()
)
ON CONFLICT (id) DO NOTHING;

-- Los usuarios Super Admin ya existen dentro de tenant_legacy.users: no hace falta credencial de
-- dueño para operar la tienda. Si se quiere acceso al panel de plataforma con un dueño, crearla con
-- POST /api/v1/platform/... (o un INSERT en public.tenant_credentials con un hash bcrypt).

-- Stripe Connect: hasta completar el onboarding de esta tienda, los pagos con tarjeta responden 400.
-- Cuando Stripe apruebe la cuenta (o si ya existe una acct_ conectada):
--   UPDATE public.tenants SET stripe_account_id = 'acct_...', stripe_charges_enabled = true
--    WHERE id = '00000000-0000-4000-8000-000000000001';

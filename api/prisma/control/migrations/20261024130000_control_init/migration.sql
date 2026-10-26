-- Plano de control (schema "public"): tiendas, altas self-service, integraciones y credenciales.
-- Equivale a `prisma migrate diff --from-empty --to-schema prisma/control/schema.prisma`.

-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('PROVISIONING', 'ACTIVE', 'SUSPENDED', 'FAILED');

-- CreateEnum
CREATE TYPE "CredentialType" AS ENUM ('OWNER_PASSWORD', 'API_KEY');

-- CreateEnum
CREATE TYPE "SignupStatus" AS ENUM ('PENDING', 'PROVISIONING', 'COMPLETED', 'FAILED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "IntegrationProvider" AS ENUM ('DECART', 'WEBPUSH', 'STRIPE');

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "schema_name" TEXT NOT NULL,
    "domain" TEXT,
    "domain_verified_at" TIMESTAMP(3),
    "status" "TenantStatus" NOT NULL DEFAULT 'PROVISIONING',
    "plan" TEXT NOT NULL DEFAULT 'free',
    "schema_version" TEXT,
    "provision_error" TEXT,
    "stripe_account_id" TEXT,
    "stripe_charges_enabled" BOOLEAN NOT NULL DEFAULT false,
    "platform_fee_bps" INTEGER NOT NULL DEFAULT 0,
    "stripe_customer_id" TEXT,
    "stripe_subscription_id" TEXT,
    "subscription_status" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_signups" (
    "id" UUID NOT NULL,
    "plan" TEXT NOT NULL,
    "tenant_name" TEXT NOT NULL,
    "domain" TEXT,
    "admin_email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "status" "SignupStatus" NOT NULL DEFAULT 'PENDING',
    "tenant_id" UUID,
    "stripe_checkout_id" TEXT,
    "stripe_customer_id" TEXT,
    "stripe_subscription_id" TEXT,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_signups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_integrations" (
    "tenant_id" UUID NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "encrypted_data" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_integrations_pkey" PRIMARY KEY ("tenant_id","provider")
);

-- CreateTable
CREATE TABLE "tenant_credentials" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "type" "CredentialType" NOT NULL,
    "identifier" TEXT NOT NULL,
    "secret_hash" TEXT NOT NULL,
    "label" TEXT,
    "last_used_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_schema_name_key" ON "tenants"("schema_name");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_domain_key" ON "tenants"("domain");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_stripe_account_id_key" ON "tenants"("stripe_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_stripe_customer_id_key" ON "tenants"("stripe_customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_stripe_subscription_id_key" ON "tenants"("stripe_subscription_id");

-- CreateIndex
CREATE INDEX "tenants_status_idx" ON "tenants"("status");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_signups_tenant_id_key" ON "tenant_signups"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_signups_stripe_checkout_id_key" ON "tenant_signups"("stripe_checkout_id");

-- CreateIndex
CREATE INDEX "tenant_signups_status_updated_at_idx" ON "tenant_signups"("status", "updated_at");

-- CreateIndex
CREATE INDEX "tenant_credentials_tenant_id_idx" ON "tenant_credentials"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_credentials_type_identifier_key" ON "tenant_credentials"("type", "identifier");

-- AddForeignKey
ALTER TABLE "tenant_integrations" ADD CONSTRAINT "tenant_integrations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_credentials" ADD CONSTRAINT "tenant_credentials_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

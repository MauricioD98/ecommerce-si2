-- Canal móvil: desafíos de integridad de un solo uso y claves de App Attest (plano de control)
CREATE TABLE "mobile_attestation_challenges" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "challenge" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mobile_attestation_challenges_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "mobile_attestation_challenges_challenge_key" ON "mobile_attestation_challenges"("challenge");
CREATE INDEX "mobile_attestation_challenges_expires_at_idx" ON "mobile_attestation_challenges"("expires_at");

CREATE TABLE "mobile_app_attest_keys" (
    "key_id" TEXT NOT NULL,
    "public_key" TEXT NOT NULL,
    "sign_count" INTEGER NOT NULL DEFAULT 0,
    "environment" TEXT NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP(3),

    CONSTRAINT "mobile_app_attest_keys_pkey" PRIMARY KEY ("key_id")
);

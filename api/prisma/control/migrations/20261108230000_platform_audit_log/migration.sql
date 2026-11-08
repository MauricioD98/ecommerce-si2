-- Auditoría de las acciones del panel de plataforma (y de cambios automáticos de estado por facturación).
-- created_at es timestamptz a propósito: no depende de la zona horaria de la sesión.
-- Nunca se guardan contraseñas, tokens, claves ni contenido de respaldos (ver PlatformAuditService).
CREATE TABLE "platform_audit_log" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- PLATFORM_ADMIN (persona con sesión) | PLATFORM_KEY (script con PLATFORM_ADMIN_KEY) | SYSTEM | ANONYMOUS (login fallido)
    "actor_type" TEXT NOT NULL,
    "actor_id" UUID,
    "actor_email" TEXT,
    "action" TEXT NOT NULL,
    "tenant_id" UUID,
    -- Copia del nombre/identificador al momento de la acción (la tienda puede cambiar o desaparecer)
    "tenant_slug" TEXT,
    "tenant_name" TEXT,
    -- Recurso afectado que no es una tienda (p. ej. id de backup_jobs)
    "target_id" TEXT,
    -- SUCCESS | FAILURE | REQUESTED (operación asíncrona: el resultado final está en su propio registro)
    "result" TEXT NOT NULL,
    "error_code" TEXT,
    "details" JSONB,

    CONSTRAINT "platform_audit_log_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "platform_audit_log_created_at_idx" ON "platform_audit_log"("created_at" DESC);
CREATE INDEX "platform_audit_log_tenant_id_created_at_idx" ON "platform_audit_log"("tenant_id", "created_at" DESC);
CREATE INDEX "platform_audit_log_action_created_at_idx" ON "platform_audit_log"("action", "created_at" DESC);

-- Marca de inicio: no hay historial anterior a esta fila (no se reconstruye uno)
INSERT INTO "platform_audit_log" ("actor_type", "action", "result") VALUES ('SYSTEM', 'AUDIT_STARTED', 'SUCCESS');

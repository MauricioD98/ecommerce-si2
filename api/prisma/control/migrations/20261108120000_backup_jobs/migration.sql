-- Copias de seguridad y restauraciones (plano de control). Registra cada respaldo generado o subido y
-- cada restauración, con su estado. Los archivos cifrados viven fuera de la base (BACKUP_DIR); acá solo
-- quedan los metadatos, el SHA-256 del archivo y el resultado. Esta tabla NO se incluye en los
-- respaldos de plataforma ni se reemplaza al restaurar: es el registro de la propia recuperación.
CREATE TYPE "BackupJobKind" AS ENUM ('BACKUP', 'RESTORE');
CREATE TYPE "BackupScope" AS ENUM ('TENANT', 'PLATFORM');
CREATE TYPE "BackupJobStatus" AS ENUM ('PREPARING', 'AVAILABLE', 'VALIDATING', 'RESTORING', 'COMPLETED', 'FAILED');

CREATE TABLE "backup_jobs" (
    "id" UUID NOT NULL,
    "kind" "BackupJobKind" NOT NULL,
    "scope" "BackupScope" NOT NULL,
    "tenant_id" UUID,
    "status" "BackupJobStatus" NOT NULL,
    "origin" TEXT,
    "source_backup_id" UUID,
    "file_name" TEXT,
    "size_bytes" BIGINT,
    "sha256" TEXT,
    "backup_created_at" TIMESTAMP(3),
    "summary" JSONB,
    "result" JSONB,
    "error_code" TEXT,
    "error_detail" TEXT,
    "requested_by_type" TEXT NOT NULL,
    "requested_by_id" TEXT,
    "requested_by_email" TEXT,
    "lock_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "backup_jobs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "backup_jobs_scope_tenant_check" CHECK (("scope" = 'TENANT') = ("tenant_id" IS NOT NULL))
);

CREATE INDEX "backup_jobs_scope_tenant_id_created_at_idx" ON "backup_jobs"("scope", "tenant_id", "created_at");
-- Una sola operación activa por alcance (tienda o plataforma): segunda barrera además del lock en el servicio
CREATE UNIQUE INDEX "backup_jobs_active_lock_key" ON "backup_jobs"("lock_key")
    WHERE "status" IN ('PREPARING', 'VALIDATING', 'RESTORING');

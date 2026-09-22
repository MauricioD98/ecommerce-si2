-- Roles dinámicos: el enum "Role" pasa a ser la tabla "roles" con permisos por rol.
-- Los usuarios existentes conservan su rol: se migran a los roles base según su enum anterior.

-- CreateTable
CREATE TABLE "roles" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "roles_name_key" ON "roles"("name");

-- Roles base (el seed vuelve a sincronizar sus permisos al ejecutarse)
INSERT INTO "roles" ("id", "name", "description", "permissions", "updatedAt") VALUES
  (gen_random_uuid()::text, 'Super Admin', 'Acceso total al sistema', ARRAY['MANAGE_BRANCHES','MANAGE_USERS','MANAGE_INVENTORY','MANAGE_PRODUCTS','VIEW_ORDERS','MANAGE_ROLES','ALL_BRANCHES'], CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Admin Sucursal', 'Gestiona empleados, inventario y pedidos de su sucursal', ARRAY['MANAGE_USERS','MANAGE_INVENTORY','VIEW_ORDERS'], CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Empleado', 'Personal de una sucursal (solo usa la tienda)', ARRAY[]::TEXT[], CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Cliente', 'Cliente de la tienda', ARRAY[]::TEXT[], CURRENT_TIMESTAMP);

-- AlterTable: la columna nueva nace opcional para poder rellenarla
ALTER TABLE "users" ADD COLUMN "roleId" TEXT;

UPDATE "users" SET "roleId" = (
  SELECT "id" FROM "roles" WHERE "name" = CASE "users"."role"::text
    WHEN 'SUPERADMIN' THEN 'Super Admin'
    WHEN 'ADMIN' THEN 'Super Admin'
    WHEN 'ADMIN_SUCURSAL' THEN 'Admin Sucursal'
    WHEN 'EMPLEADO' THEN 'Empleado'
    ELSE 'Cliente'
  END
);

ALTER TABLE "users" ALTER COLUMN "roleId" SET NOT NULL;
ALTER TABLE "users" DROP COLUMN "role";

-- DropEnum
DROP TYPE "Role";

-- CreateIndex
CREATE INDEX "users_roleId_idx" ON "users"("roleId");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

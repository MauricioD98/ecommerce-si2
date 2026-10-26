import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// Config del plano de control. Va aparte de prisma.config.ts (el de los tenants) porque cada
// uno tiene su propia tabla _prisma_migrations: la de control vive en "public" y la de cada
// tienda dentro de su "tenant_<uuid>".
// Neon: migrar siempre contra la URL directa (sin "-pooler"); PgBouncer rompe los advisory locks.
const base =
  process.env.DIRECT_URL ||
  process.env.DATABASE_URL ||
  'postgresql://placeholder:placeholder@localhost:5432/placeholder';

const url = new URL(base);
url.searchParams.set('schema', 'public');

export default defineConfig({
  schema: 'prisma/control/schema.prisma',
  migrations: {
    path: 'prisma/control/migrations',
  },
  datasource: {
    url: url.toString(),
  },
});

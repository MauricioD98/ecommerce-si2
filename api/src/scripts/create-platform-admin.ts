// Crea (o actualiza) un administrador del SaaS, el que entra a /plataforma con email y contraseña.
// Script independiente: no levanta Nest; solo el PrismaClient del plano de control.
//
//   npm run build
//   npm run platform:admin -- <email> <contraseña> ["Nombre"]
//
// Si el email ya existe, le cambia la contraseña, lo reactiva y lo desbloquea: sirve también para
// recuperar el acceso. Variables (del entorno o de api/.env): DIRECT_URL | DATABASE_URL.
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/control/client';
import { hashAdminPassword, normalizeAdminEmail } from '../modules/platform/platform-auth.service';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 10;

class AdminScriptError extends Error {}

function loadDotEnv(): void {
  try {
    // Nativo de Node ≥ 20.12, sin dependencias. No pisa variables ya definidas en el entorno.
    process.loadEnvFile('.env');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

async function main(): Promise<void> {
  loadDotEnv();
  const [rawEmail, password, name] = process.argv.slice(2);

  if (!rawEmail || !password) {
    throw new AdminScriptError('Uso: npm run platform:admin -- <email> <contraseña> ["Nombre"]');
  }
  const email = normalizeAdminEmail(rawEmail);
  if (!EMAIL_RE.test(email)) throw new AdminScriptError(`Email inválido: ${rawEmail}`);
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new AdminScriptError(`La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres`);
  }

  const databaseUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!databaseUrl) throw new AdminScriptError('Falta DIRECT_URL o DATABASE_URL');

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl, max: 1 }, { schema: 'public' }),
  });

  try {
    const passwordHash = await hashAdminPassword(password);
    const existing = await prisma.platformAdmin.findUnique({ where: { email }, select: { id: true } });
    const reset = { passwordHash, isActive: true, loginAttempts: 0, lockedUntil: null };
    await prisma.platformAdmin.upsert({
      where: { email },
      create: { email, passwordHash, name: name?.trim() || null },
      update: { ...reset, ...(name?.trim() ? { name: name.trim() } : {}) },
    });
    console.log(existing ? `Administrador actualizado: ${email}` : `Administrador creado: ${email}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  if (error instanceof AdminScriptError) console.error(`Error: ${error.message}`);
  // P2021: falta la tabla, es decir, no se corrió la migración del plano de control
  else if ((error as { code?: string })?.code === 'P2021') {
    console.error('Error: no existe public.platform_admins. Corré antes: npm run migrate:control');
  } else console.error('Falló la creación del administrador:', error);
  process.exitCode = 1;
});

// Importa UNA vez las credenciales globales que usaba la tienda original (.env / docker-compose) a
// public.tenant_integrations, cifradas, vinculadas a LEGACY_TENANT_ID. Script independiente: no
// levanta Nest; solo EncryptionService + el PrismaClient del plano de control.
//
//   npm run build
//   node dist/scripts/import-legacy-integrations.js            # importa
//   node dist/scripts/import-legacy-integrations.js --dry-run  # valida y cifra, sin escribir
//
// Variables (del entorno o de api/.env; las del entorno ganan):
//   LEGACY_TENANT_ID      id de la tienda original en public.tenants (ver prisma/control/sql/002_…)
//   TENANT_SECRETS_KEYS   llave maestra "1:<base64 de 32 bytes>" (la MISMA que usa la API)
//   DIRECT_URL | DATABASE_URL
//   DECART_API_KEY        opcional. Usar la key NUEVA: la vieja quedó en el historial de git
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT   opcionales, las tres o ninguna
//
// Web Push importa el MISMO par VAPID que ya usaba la tienda: las suscripciones existentes de sus
// clientes siguen funcionando. Es idempotente (upsert): correrlo dos veces deja el último valor.
import 'reflect-metadata';
import { PrismaPg } from '@prisma/adapter-pg';
import { IntegrationProvider, PrismaClient } from '../generated/control/client';
import { EncryptionService } from '../common/encryption/encryption.service';
import { integrationAad } from '../tenancy/integration-aad';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface PendingIntegration {
  provider: IntegrationProvider;
  payload: Record<string, string>;
  // Para el log: nunca se imprime el secreto, solo los últimos caracteres
  summary: string;
}

class ImportError extends Error {}

const mask = (value: string) => `…${value.slice(-4)} (${value.length} caracteres)`;

function loadDotEnv(): void {
  try {
    // Nativo de Node ≥ 20.12, sin dependencias. No pisa variables ya definidas en el entorno.
    process.loadEnvFile('.env');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

function collectIntegrations(): PendingIntegration[] {
  const pending: PendingIntegration[] = [];
  const env = (name: string) => process.env[name]?.trim() || undefined;

  const decartKey = env('DECART_API_KEY');
  if (decartKey) {
    if (!decartKey.startsWith('dct_')) throw new ImportError('DECART_API_KEY no parece una key de Decart (empieza con "dct_")');
    pending.push({ provider: 'DECART', payload: { apiKey: decartKey }, summary: `apiKey ${mask(decartKey)}` });
  }

  const vapid = { publicKey: env('VAPID_PUBLIC_KEY'), privateKey: env('VAPID_PRIVATE_KEY'), subject: env('VAPID_SUBJECT') };
  const vapidDefined = Object.values(vapid).filter(Boolean).length;
  if (vapidDefined === 3) {
    if (!/^(mailto:|https:\/\/)/.test(vapid.subject!)) throw new ImportError('VAPID_SUBJECT debe empezar con "mailto:" o "https://"');
    pending.push({
      provider: 'WEBPUSH',
      payload: vapid as Record<string, string>,
      summary: `publicKey ${vapid.publicKey!.slice(0, 12)}…, privateKey ${mask(vapid.privateKey!)}, subject ${vapid.subject}`,
    });
  } else if (vapidDefined > 0) {
    // A medias es casi seguro un error de copia: mejor frenar que guardar un par inservible
    throw new ImportError('VAPID incompleto: definí VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY y VAPID_SUBJECT, o ninguna');
  }

  return pending;
}

async function main(): Promise<void> {
  loadDotEnv();
  const dryRun = process.argv.includes('--dry-run');

  const tenantId = process.env.LEGACY_TENANT_ID?.trim().toLowerCase();
  if (!tenantId || !UUID_RE.test(tenantId)) throw new ImportError('LEGACY_TENANT_ID falta o no es un UUID');
  if (!process.env.TENANT_SECRETS_KEYS) {
    throw new ImportError('Falta TENANT_SECRETS_KEYS (tiene que ser la misma que usa la API, o no podrá descifrar)');
  }
  const databaseUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!databaseUrl) throw new ImportError('Falta DIRECT_URL o DATABASE_URL');

  const pending = collectIntegrations();
  if (pending.length === 0) {
    throw new ImportError('No hay nada para importar: no están DECART_API_KEY ni las VAPID_*');
  }

  // Lanza aquí si TENANT_SECRETS_KEYS está mal formada
  const encryption = new EncryptionService();
  // Cada proveedor se cifra por separado, con su propio iv y su propio AAD (tienda + proveedor)
  const rows = pending.map((item) => ({
    ...item,
    data: encryption.encrypt(item.payload, integrationAad(tenantId, item.provider)),
  }));

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl, max: 1 }, { schema: 'public' }),
  });

  try {
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true, schemaName: true } });
    if (!tenant) {
      throw new ImportError(`LEGACY_TENANT_ID ${tenantId} no existe en public.tenants (¿corriste prisma/control/sql/002_register_legacy_tenant.sql?)`);
    }
    console.log(`Tienda: ${tenant.name} (${tenant.schemaName})`);
    for (const row of rows) console.log(`  ${row.provider}: ${row.summary}`);

    if (dryRun) {
      console.log('--dry-run: validado y cifrado correctamente, no se escribió nada.');
      return;
    }

    // Todo o nada: si falla una, no queda la otra a medias
    await prisma.$transaction(
      rows.map(({ provider, data }) =>
        prisma.tenantIntegration.upsert({
          where: { tenantId_provider: { tenantId, provider } },
          create: { tenantId, provider, ...data },
          update: data,
        }),
      ),
    );

    // Verificación: se lee lo guardado y se descifra con el mismo AAD que usará la API
    for (const { provider, payload } of rows) {
      const stored = await prisma.tenantIntegration.findUniqueOrThrow({
        where: { tenantId_provider: { tenantId, provider } },
        select: { encryptedData: true, iv: true },
      });
      const decrypted = encryption.decrypt<Record<string, string>>(stored.encryptedData, stored.iv, integrationAad(tenantId, provider));
      if (JSON.stringify(decrypted) !== JSON.stringify(payload)) {
        throw new Error(`Verificación fallida para ${provider}: lo guardado no coincide al descifrar`);
      }
    }

    console.log(`Importadas y verificadas: ${rows.map((r) => r.provider).join(', ')}.`);
    console.log('Siguiente paso: borrar DECART_API_KEY y VAPID_* del .env, docker-compose y Azure.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  // Errores esperados (configuración): mensaje limpio. Inesperados (red, Prisma): con stack.
  if (error instanceof ImportError) console.error(`Error: ${error.message}`);
  else console.error('Falló la importación:', error);
  process.exitCode = 1;
});

// Revisión de SOLO LECTURA: lista las tiendas cuya billetera digital podría conservar los datos de
// ejemplo que sembraban las versiones anteriores (@<slug> / pagos@<slug>.com). No modifica nada:
// la sesión de PostgreSQL se abre con default_transaction_read_only=on y cada lectura corre dentro
// de una transacción READ ONLY, así que cualquier escritura fallaría en la propia base.
//
//   npm run build
//   npm run wallet:audit                 # tabla legible
//   npm run wallet:audit -- --json       # JSON para guardar o procesar
//   npm run wallet:audit -- --tenant <slug>
//
// Variables (del entorno o de api/.env): DIRECT_URL | DATABASE_URL. Cómo revisar los casos antes de
// cambiar algo: contexto.md §5.1.19.
import { Client } from 'pg';
import { assertTenantSchema, quoteIdent } from '../tenancy/tenant-context';
import { detectWalletSample, type WalletSampleRisk, type WalletSampleSignal } from '../modules/payments/wallet-sample';

interface Finding {
  tenantId: string;
  slug: string;
  status: string;
  plan: string;
  risk: WalletSampleRisk;
  signals: WalletSampleSignal[];
  walletEnabled: boolean;
  walletProvider: string | null;
  walletAccount: string | null;
  // Uso real: pedidos por billetera y comprobantes aprobados. Con uso, la cuenta probablemente es real.
  walletOrders: number;
  approvedWalletProofs: number;
  tenantCreatedAt: string;
  settingsUpdatedAt: string;
}

const RISK_ORDER: Record<WalletSampleRisk, number> = { ALTA: 0, MEDIA: 1, BAJA: 2 };

function loadDotEnv(): void {
  try {
    process.loadEnvFile('.env');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

async function readOnly<T>(client: Client, fn: () => Promise<T>): Promise<T> {
  await client.query('BEGIN TRANSACTION READ ONLY');
  try {
    return await fn();
  } finally {
    await client.query('ROLLBACK');
  }
}

async function main(): Promise<void> {
  loadDotEnv();
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const tenantIdx = args.indexOf('--tenant');
  const onlySlug = tenantIdx >= 0 ? args[tenantIdx + 1]?.trim().toLowerCase() : undefined;

  const databaseUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('Falta DIRECT_URL o DATABASE_URL');

  const client = new Client({ connectionString: databaseUrl, options: '-c default_transaction_read_only=on' });
  await client.connect();

  const findings: Finding[] = [];
  const errors: { slug: string; error: string }[] = [];
  let reviewed = 0;
  try {
    type TenantRow = { id: string; slug: string; schema_name: string; status: string; plan: string; created_at: Date };
    const tenants = await readOnly(client, async (): Promise<TenantRow[]> => {
      const res = await client.query(
        `SELECT id, slug, schema_name, status, plan, created_at FROM public.tenants
          WHERE ($1::text IS NULL OR slug = $1) ORDER BY created_at`,
        [onlySlug ?? null],
      );
      return res.rows as TenantRow[];
    });

    for (const t of tenants) {
      try {
        assertTenantSchema(t.schema_name);
        const s = quoteIdent(t.schema_name);
        const row = await readOnly(client, async () => {
          const settings = await client.query(
            `SELECT "walletEnabled", "walletProvider", "walletAccount", "walletInstructions", "updatedAt"
               FROM ${s}.payment_settings WHERE id = 'default'`,
          );
          if (!settings.rows[0]) return null;
          const usage = await client.query(
            `SELECT
               (SELECT count(*)::int FROM ${s}.orders WHERE "paymentMethod" = 'WALLET') AS orders,
               (SELECT count(*)::int FROM ${s}.payment_proofs WHERE method = 'WALLET' AND status = 'APROBADO') AS proofs`,
          );
          return { ...settings.rows[0], ...usage.rows[0] };
        });
        reviewed += 1;
        if (!row) continue;

        const { signals, risk } = detectWalletSample(row, t.slug);
        if (!risk) continue;
        findings.push({
          tenantId: t.id,
          slug: t.slug,
          status: t.status,
          plan: t.plan,
          risk,
          signals,
          walletEnabled: row.walletEnabled,
          walletProvider: row.walletProvider,
          walletAccount: row.walletAccount,
          walletOrders: row.orders,
          approvedWalletProofs: row.proofs,
          tenantCreatedAt: new Date(t.created_at).toISOString(),
          settingsUpdatedAt: new Date(row.updatedAt).toISOString(),
        });
      } catch (e: any) {
        // Schema sin migrar o roto: se informa y se sigue con las demás
        errors.push({ slug: t.slug, error: String(e.message) });
      }
    }
  } finally {
    await client.end();
  }

  findings.sort((a, b) => RISK_ORDER[a.risk] - RISK_ORDER[b.risk] || Number(b.walletEnabled) - Number(a.walletEnabled));

  if (asJson) {
    console.log(JSON.stringify({ reviewed, findings, errors }, null, 2));
    return;
  }
  console.log(`Tiendas revisadas: ${reviewed}. Con posibles datos de ejemplo: ${findings.length}. Con error: ${errors.length}.`);
  if (findings.length > 0) {
    console.table(
      findings.map((f) => ({
        riesgo: f.risk,
        tienda: f.slug,
        plan: f.plan,
        estado: f.status,
        activa: f.walletEnabled ? 'sí' : 'no',
        cuenta: f.walletAccount,
        señales: f.signals.join(','),
        pedidos: f.walletOrders,
        aprobados: f.approvedWalletProofs,
        actualizada: f.settingsUpdatedAt,
      })),
    );
  }
  for (const e of errors) console.error(`  ${e.slug}: ${e.error}`);
  console.log('Solo lectura: no se modificó ninguna tienda. Confirmá cada caso con la tienda antes de cambiar su configuración.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

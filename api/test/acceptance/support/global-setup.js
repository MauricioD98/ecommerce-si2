const { execFileSync } = require('node:child_process');
const { join } = require('node:path');
const { Client } = require('pg');

// Base limpia + migraciones reales (control y una por tienda) en cada corrida
const TENANTS = [
  { id: '11111111-1111-4111-8111-111111111111', slug: 'alpha', account: 'acct_alpha' },
  { id: '22222222-2222-4222-8222-222222222222', slug: 'beta', account: 'acct_beta' },
];

module.exports = async function globalSetup() {
  const raw = process.env.ACCEPTANCE_DATABASE_URL;
  if (!raw) throw new Error('Falta ACCEPTANCE_DATABASE_URL');
  const url = new URL(raw);
  if (!['127.0.0.1', 'localhost', '::1'].includes(url.hostname) || !/test/i.test(url.pathname)) {
    throw new Error('ACCEPTANCE_DATABASE_URL debe ser local y su base debe contener "test"');
  }
  const client = new Client({ connectionString: raw });
  await client.connect();
  const { rows } = await client.query(`SELECT nspname FROM pg_namespace WHERE nspname LIKE 'tenant\\_%'`);
  for (const { nspname } of rows) await client.query(`DROP SCHEMA "${nspname}" CASCADE`);
  await client.query('DROP SCHEMA IF EXISTS public CASCADE');
  await client.query('CREATE SCHEMA public');
  await client.end();

  const cwd = join(__dirname, '..', '..', '..');
  const cli = join(cwd, 'node_modules', 'prisma', 'build', 'index.js');
  const run = (config, env) =>
    execFileSync(process.execPath, [cli, 'migrate', 'deploy', '--config', config], {
      cwd,
      env: { ...process.env, ...env },
      stdio: 'pipe',
    });
  run('prisma.control.config.ts', { DATABASE_URL: raw, DIRECT_URL: raw });

  const admin = new Client({ connectionString: raw });
  await admin.connect();
  for (const t of TENANTS) {
    const schema = `tenant_${t.id.replace(/-/g, '')}`;
    await admin.query(`CREATE SCHEMA "${schema}"`);
    const tenantUrl = new URL(raw);
    tenantUrl.searchParams.set('schema', schema);
    run('prisma.config.ts', { DATABASE_URL: tenantUrl.toString(), DIRECT_URL: raw });
    await admin.query(
      `INSERT INTO public.tenants (id, slug, name, schema_name, status, stripe_account_id, stripe_charges_enabled, platform_fee_bps, updated_at)
       VALUES ($1,$2,$3,$4,'ACTIVE',$5,true,250,now())`,
      [t.id, t.slug, t.slug, schema, t.account],
    );
  }
  await admin.end();
};

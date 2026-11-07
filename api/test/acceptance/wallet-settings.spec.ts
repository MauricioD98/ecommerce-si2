import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PaymentSettingsService } from '../../src/modules/payments/payment-settings.service';
import { detectWalletSample, legacySampleAccount, LEGACY_SAMPLE_INSTRUCTIONS, LEGACY_SAMPLE_PROVIDER } from '../../src/modules/payments/wallet-sample';
import { TenantProvisioningService } from '../../src/tenancy/tenant-provisioning.service';
import { runInTenant } from '../../src/tenancy/tenant-context';
import { acceptanceDatabaseUrl } from './support/env';
import { TENANT_B, apiFor, bootApp, createProduct, createUser, key, queryRows, seedTenant, withSql } from './support/world';

interface Provisioned {
  tenantId: string;
  schemaName: string;
  slug: string;
  plan: string;
}

const REAL = { walletProvider: 'Airtm', walletAccount: 'cobros.tienda@ejemplo.bo', walletInstructions: 'Indica tu número de pedido en la nota.' };

describe('Billetera digital: configuración inicial, plan y reintentos', () => {
  let app: INestApplication;
  let provisioning: TenantProvisioningService;
  let settings: PaymentSettingsService;
  const created: Record<string, Provisioned> = {};

  const settingsRow = async (schema: string) =>
    (await queryRows(`SELECT * FROM "${schema}".payment_settings WHERE id='default'`))[0] as Record<string, any> | undefined;
  const asPlan = <T>(t: Pick<Provisioned, 'tenantId' | 'schemaName'>, plan: string, fn: () => Promise<T>) =>
    runInTenant({ tenantId: t.tenantId, schemaName: t.schemaName, plan }, fn);
  const resetWallet = (schema: string) =>
    withSql((c) =>
      c.query(
        `UPDATE "${schema}".payment_settings SET "walletEnabled"=false, "walletProvider"=NULL, "walletAccount"=NULL, "walletInstructions"=NULL WHERE id='default'`,
      ),
    );

  const provision = async (plan: string): Promise<Provisioned> => {
    const slug = `wallet-${plan}-${randomUUID().slice(0, 8)}`;
    const tenant = await provisioning.createTenant({
      name: `Tienda ${plan}`,
      slug,
      ownerEmail: `${slug}@test.local`,
      ownerPassword: 'Owner-Password-123',
      plan,
    });
    assert.equal(tenant.status, 'ACTIVE');
    return { tenantId: tenant.id, schemaName: tenant.schemaName, slug, plan };
  };

  before(async () => {
    app = await bootApp();
    provisioning = app.get(TenantProvisioningService, { strict: false });
    settings = app.get(PaymentSettingsService, { strict: false });
    // Aprovisionamiento real: CREATE SCHEMA + migraciones + datos base
    for (const plan of ['starter', 'growth', 'pro']) created[plan] = await provision(plan);
  });
  after(() => app.close());

  describe('tiendas nuevas', () => {
    for (const plan of ['starter', 'growth', 'pro']) {
      it(`${plan}: nace con la billetera desactivada y sin cuenta, correo ni proveedor inventados`, async () => {
        const row = await settingsRow(created[plan].schemaName);
        assert.ok(row, 'la fila de pagos se crea vacía');
        assert.equal(row.walletEnabled, false);
        assert.equal(row.walletProvider, null);
        assert.equal(row.walletAccount, null);
        assert.equal(row.walletInstructions, null);
        assert.equal(row.qrEnabled, false);
        assert.equal(row.usdtEnabled, false);
      });
    }

    it('el panel la muestra desactivada y vacía, y el checkout no la ofrece', async () => {
      const t = created.growth;
      const admin = await asPlan(t, 'growth', () => settings.getForAdmin(t.tenantId));
      assert.deepEqual(admin.wallet, { allowed: true, enabled: false, provider: '', account: '', instructions: '' });
      const options = await asPlan(t, 'growth', () => settings.getPublicOptions(t.tenantId));
      assert.equal(options.walletAllowed, true);
      assert.equal(options.wallet, null);
    });

    it('leer la configuración no la completa ni la activa (antes read() sembraba la cuenta de ejemplo)', async () => {
      const t = created.pro;
      await withSql((c) => c.query(`DELETE FROM "${t.schemaName}".payment_settings`));
      await asPlan(t, 'pro', () => settings.getPublicOptions(t.tenantId));
      await asPlan(t, 'pro', () => settings.getForAdmin(t.tenantId));
      assert.equal(await settingsRow(t.schemaName), undefined, 'una lectura no crea filas');
      await withSql((c) => c.query(`INSERT INTO "${t.schemaName}".payment_settings (id,"updatedAt") VALUES ('default', now())`));
    });
  });

  describe('configuración válida e incompleta', () => {
    beforeEach(() => resetWallet(created.growth.schemaName));

    it('con proveedor y cuenta reales se activa y se ofrece en el checkout', async () => {
      const t = created.growth;
      await asPlan(t, 'growth', () => settings.update({ walletEnabled: true, ...REAL }));
      const options = await asPlan(t, 'growth', () => settings.getPublicOptions(t.tenantId));
      assert.deepEqual(options.wallet, { provider: REAL.walletProvider, account: REAL.walletAccount, instructions: REAL.walletInstructions });
    });

    it('activar sin cuenta o sin proveedor se rechaza y no guarda nada', async () => {
      const t = created.growth;
      await assert.rejects(asPlan(t, 'growth', () => settings.update({ walletEnabled: true, walletProvider: 'Airtm', walletAccount: '  ' })), { status: 400 });
      await assert.rejects(asPlan(t, 'growth', () => settings.update({ walletEnabled: true, walletAccount: REAL.walletAccount })), { status: 400 });
      const row = await settingsRow(t.schemaName);
      assert.equal(row?.walletEnabled, false);
      assert.equal(row?.walletAccount, null);
    });

    it('datos guardados sin activar no se ofrecen', async () => {
      const t = created.growth;
      await asPlan(t, 'growth', () => settings.update({ walletEnabled: false, ...REAL }));
      assert.equal((await asPlan(t, 'growth', () => settings.getPublicOptions(t.tenantId))).wallet, null);
    });

    it('una fila activa pero incompleta (datos viejos) no se ofrece', async () => {
      const t = created.growth;
      await withSql((c) =>
        c.query(`UPDATE "${t.schemaName}".payment_settings SET "walletEnabled"=true, "walletProvider"='Airtm', "walletAccount"=NULL WHERE id='default'`),
      );
      assert.equal((await asPlan(t, 'growth', () => settings.getPublicOptions(t.tenantId))).wallet, null);
      await withSql((c) =>
        c.query(`UPDATE "${t.schemaName}".payment_settings SET "walletProvider"=NULL, "walletAccount"='@real' WHERE id='default'`),
      );
      assert.equal((await asPlan(t, 'growth', () => settings.getPublicOptions(t.tenantId))).wallet, null);
    });

    it('la API rechaza pedidos por billetera mientras no esté lista, y los acepta configurada', async () => {
      const t = created.growth;
      const fx = await seedTenant(t.schemaName);
      const userId = await createUser(t.schemaName, fx);
      const api = await apiFor(app, t.tenantId, userId);
      const order = async () => {
        const productId = await createProduct(t.schemaName, fx, { [fx.branchA]: { M: 5 } });
        await api.addToCart(productId, 1, 'M', fx.branchA);
        return api.createOrder({
          key: key(),
          cartVersion: await api.cartVersion(),
          items: [{ productId, quantity: 1, size: 'M' }],
          branchId: fx.branchA,
          paymentMethod: 'WALLET',
        });
      };

      const publicOff = await api.call('GET', '/store/payment-options');
      assert.equal(publicOff.status, 200);
      assert.equal(publicOff.body.data.wallet, null);
      const rejected = await order();
      assert.equal(rejected.status, 400, JSON.stringify(rejected.body));

      await asPlan(t, 'growth', () => settings.update({ walletEnabled: true, ...REAL }));
      const publicOn = await api.call('GET', '/store/payment-options');
      assert.equal(publicOn.body.data.wallet?.account, REAL.walletAccount);
      const accepted = await order();
      assert.equal(accepted.status, 201, JSON.stringify(accepted.body));
    });
  });

  describe('restricción por plan', () => {
    it('Starter no puede habilitarla ni guardar datos de billetera', async () => {
      const t = created.starter;
      await assert.rejects(asPlan(t, 'starter', () => settings.update({ walletEnabled: true, ...REAL })), { status: 403 });
      await assert.rejects(asPlan(t, 'starter', () => settings.update({ walletAccount: REAL.walletAccount })), { status: 403 });
      assert.equal((await settingsRow(t.schemaName))?.walletEnabled, false);
    });

    it('Starter con una billetera configurada (bajó de plan) no la ofrece ni la muestra activa', async () => {
      const t = created.starter;
      await withSql((c) =>
        c.query(`UPDATE "${t.schemaName}".payment_settings SET "walletEnabled"=true, "walletProvider"=$1, "walletAccount"=$2 WHERE id='default'`, [
          REAL.walletProvider,
          REAL.walletAccount,
        ]),
      );
      const options = await asPlan(t, 'starter', () => settings.getPublicOptions(t.tenantId));
      assert.equal(options.walletAllowed, false);
      assert.equal(options.wallet, null);
      const admin = await asPlan(t, 'starter', () => settings.getForAdmin(t.tenantId));
      assert.equal(admin.wallet.allowed, false);
      assert.equal(admin.wallet.enabled, false);
      await resetWallet(t.schemaName);
    });

    for (const plan of ['growth', 'pro', 'legacy']) {
      it(`${plan}: puede habilitarla cuando está configurada`, async () => {
        const t = created.pro;
        await resetWallet(t.schemaName);
        await asPlan(t, plan, () => settings.update({ walletEnabled: true, ...REAL }));
        assert.equal((await asPlan(t, plan, () => settings.getPublicOptions(t.tenantId))).wallet?.account, REAL.walletAccount);
      });
    }
  });

  describe('reintentos de aprovisionamiento', () => {
    it('retry() no sobrescribe la configuración real que la tienda ya guardó', async () => {
      const t = created.growth;
      await resetWallet(t.schemaName);
      await asPlan(t, 'growth', () => settings.update({ walletEnabled: true, ...REAL }));
      const before = await settingsRow(t.schemaName);

      const retried = await provisioning.retry(t.tenantId);
      assert.equal(retried.status, 'ACTIVE');

      const after = await settingsRow(t.schemaName);
      assert.equal(after?.walletEnabled, true);
      assert.equal(after?.walletProvider, REAL.walletProvider);
      assert.equal(after?.walletAccount, REAL.walletAccount);
      assert.equal(after?.walletInstructions, REAL.walletInstructions);
      assert.equal(new Date(after?.updatedAt).getTime(), new Date(before?.updatedAt).getTime(), 'la fila no se tocó');
    });

    it('retry() tampoco toca una tienda que conserva datos de ejemplo: esos casos se revisan a mano', async () => {
      const t = created.pro;
      const sample = legacySampleAccount(t.slug);
      await withSql((c) =>
        c.query(`UPDATE "${t.schemaName}".payment_settings SET "walletEnabled"=true, "walletProvider"=$1, "walletAccount"=$2 WHERE id='default'`, [
          LEGACY_SAMPLE_PROVIDER,
          sample,
        ]),
      );
      await provisioning.retry(t.tenantId);
      const row = await settingsRow(t.schemaName);
      assert.equal(row?.walletEnabled, true);
      assert.equal(row?.walletAccount, sample);
      await resetWallet(t.schemaName);
    });

    it('retry() de una tienda que falló antes de crear la fila la crea desactivada', async () => {
      const t = created.starter;
      await withSql((c) => c.query(`DELETE FROM "${t.schemaName}".payment_settings`));
      await provisioning.retry(t.tenantId);
      const row = await settingsRow(t.schemaName);
      assert.equal(row?.walletEnabled, false);
      assert.equal(row?.walletAccount, null);
    });
  });

  describe('revisión de tiendas existentes (solo lectura)', () => {
    it('detectWalletSample clasifica sin afirmar que la cuenta sea falsa', () => {
      const none = { walletProvider: null, walletAccount: null, walletInstructions: null };
      assert.deepEqual(detectWalletSample(none, 'mitienda'), { signals: [], risk: null });
      assert.equal(detectWalletSample({ ...none, walletAccount: '@moda / pagos@moda.com' }, 'moda').risk, 'ALTA');
      assert.equal(detectWalletSample({ ...none, walletAccount: '  @MODA /  PAGOS@moda.com ' }, 'moda').risk, 'ALTA');
      assert.equal(detectWalletSample({ ...none, walletAccount: '@mitienda / pagos@mitienda.com' }, 'moda').risk, 'ALTA');
      assert.equal(detectWalletSample({ ...none, walletAccount: 'pagos@moda.com' }, 'moda').risk, 'MEDIA');
      assert.equal(detectWalletSample({ ...none, walletAccount: '@moda' }, 'moda').risk, 'MEDIA');
      assert.equal(detectWalletSample({ ...none, walletAccount: '@modabolivia' }, 'moda').risk, null);
      const leftovers = detectWalletSample(
        { walletProvider: LEGACY_SAMPLE_PROVIDER, walletAccount: 'cobros@otra.bo', walletInstructions: LEGACY_SAMPLE_INSTRUCTIONS },
        'moda',
      );
      assert.equal(leftovers.risk, 'BAJA');
      assert.deepEqual(leftovers.signals, ['PROVIDER_DEFAULT', 'INSTRUCTIONS_DEFAULT']);
    });

    it('el script reporta los casos y no modifica ninguna tienda', async () => {
      const t = created.growth;
      const sample = legacySampleAccount(t.slug);
      await withSql((c) =>
        c.query(
          `UPDATE "${t.schemaName}".payment_settings SET "walletEnabled"=true, "walletProvider"=$1, "walletAccount"=$2, "walletInstructions"=$3 WHERE id='default'`,
          [LEGACY_SAMPLE_PROVIDER, sample, LEGACY_SAMPLE_INSTRUCTIONS],
        ),
      );
      const snapshot = async () =>
        JSON.stringify(
          await Promise.all(
            [t.schemaName, created.pro.schemaName, TENANT_B.schemaName].map((schema) => queryRows(`SELECT * FROM "${schema}".payment_settings`)),
          ),
        );
      const before = await snapshot();

      const script = join(__dirname, '..', '..', 'src', 'scripts', 'audit-wallet-samples.js');
      const out = execFileSync(process.execPath, [script, '--json'], {
        cwd: join(__dirname, '..', '..', '..'),
        env: { ...process.env, DIRECT_URL: acceptanceDatabaseUrl(), DATABASE_URL: acceptanceDatabaseUrl() },
        encoding: 'utf8',
      });
      const report = JSON.parse(out);
      const finding = report.findings.find((f: any) => f.slug === t.slug);
      assert.ok(finding, out);
      assert.equal(finding.risk, 'ALTA');
      assert.equal(finding.walletEnabled, true);
      assert.ok(report.findings.every((f: any) => f.slug !== created.starter.slug));

      assert.equal(await snapshot(), before, 'la revisión no escribe');
      await resetWallet(t.schemaName);
    });

    it('la sesión del script es de solo lectura: una escritura falla en la base', async () => {
      const { Client } = await import('pg');
      const c = new Client({ connectionString: acceptanceDatabaseUrl(), options: '-c default_transaction_read_only=on' });
      await c.connect();
      try {
        await assert.rejects(c.query(`UPDATE "${created.growth.schemaName}".payment_settings SET "walletEnabled"=true`), { code: '25006' }); // read_only_sql_transaction
      } finally {
        await c.end();
      }
    });
  });
});

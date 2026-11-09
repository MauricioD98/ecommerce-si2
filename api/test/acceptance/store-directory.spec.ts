import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { PublicTenantLogosService } from '../../src/modules/platform/public-tenant-logos.service';
import { TENANT_A, TENANT_B, bootApp, queryRows } from './support/world';

// Directorio público de tiendas para el selector del login (app móvil y web): GET /platform/tenants/public
// con logos, y GET /platform/tenants/:id/logo. Se valida con el MISMO código del teléfono
// (docs/app_movil/src/tenant/storeDirectory.js).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const dir = require(join(process.cwd(), '..', 'docs', 'app_movil', 'src', 'tenant', 'storeDirectory.js'));

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

describe('Directorio público de tiendas con logo (selector del login)', () => {
  let app: INestApplication;
  let base: string;
  const setLogo = async (schema: string, logoUrl: string | null) => {
    await queryRows(
      `INSERT INTO "${schema}".store_appearance (id, "logoUrl", "updatedAt") VALUES ('default', $1, now())
       ON CONFLICT (id) DO UPDATE SET "logoUrl" = EXCLUDED."logoUrl"`,
      [logoUrl],
    );
    app.get(PublicTenantLogosService, { strict: false }).invalidate();
  };
  const get = async (path: string, redirect: RequestRedirect = 'follow') => {
    const res = await fetch(`${base}/api/v1${path}`, { redirect, headers: { 'x-forwarded-for': `10.79.0.${Math.floor(Math.random() * 250)}` } });
    return res;
  };

  before(async () => {
    app = await bootApp();
    base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
    await queryRows("UPDATE public.tenants SET status='ACTIVE', plan='pro' WHERE id = ANY($1)", [[TENANT_A.tenantId, TENANT_B.tenantId]]);
  });
  after(async () => {
    await setLogo(TENANT_A.schemaName, null);
    await setLogo(TENANT_B.schemaName, null);
    await app?.close();
  });

  it('D01: el directorio lista las tiendas activas con datos públicos y el logo de cada una', async () => {
    await setLogo(TENANT_A.schemaName, `data:image/png;base64,${PNG.toString('base64')}`);
    await setLogo(TENANT_B.schemaName, 'https://cdn.example.com/logo-b.png');

    const res = await get('/platform/tenants/public');
    assert.equal(res.status, 200);
    const list = (await res.json()).data as any[];
    const a = list.find((t) => t.id === TENANT_A.tenantId);
    const b = list.find((t) => t.id === TENANT_B.tenantId);
    assert.equal(a.logoUrl, `/platform/tenants/${TENANT_A.tenantId}/logo`, 'el data URL no se incrusta en el directorio');
    assert.equal(b.logoUrl, 'https://cdn.example.com/logo-b.png');
    for (const t of list) {
      assert.deepEqual(Object.keys(t).sort(), ['id', 'logoUrl', 'mobileApp', 'name', 'plan', 'planName', 'slug'], 'solo datos públicos');
    }

    // Lo que hace el teléfono con la respuesta
    const stores = dir.toStores(list, `${base}/api/v1`);
    const storeA = stores.find((s: any) => s.id === TENANT_A.tenantId);
    assert.equal(storeA.logoUrl, `${base}/api/v1/platform/tenants/${TENANT_A.tenantId}/logo`);
    assert.equal(storeA.mobileApp, true);
  });

  it('D02: el logo subido se sirve como imagen; el externo redirige; sin logo, 404', async () => {
    await setLogo(TENANT_A.schemaName, `data:image/png;base64,${PNG.toString('base64')}`);
    const img = await get(`/platform/tenants/${TENANT_A.tenantId}/logo`);
    assert.equal(img.status, 200);
    assert.equal(img.headers.get('content-type'), 'image/png');
    assert.equal(img.headers.get('x-content-type-options'), 'nosniff');
    assert.deepEqual(Buffer.from(await img.arrayBuffer()), PNG);

    await setLogo(TENANT_B.schemaName, 'https://cdn.example.com/logo-b.png');
    const redirect = await get(`/platform/tenants/${TENANT_B.tenantId}/logo`, 'manual');
    assert.equal(redirect.status, 302);
    assert.equal(redirect.headers.get('location'), 'https://cdn.example.com/logo-b.png');

    await setLogo(TENANT_B.schemaName, null);
    assert.equal((await get(`/platform/tenants/${TENANT_B.tenantId}/logo`)).status, 404);
    const list = (await (await get('/platform/tenants/public')).json()).data as any[];
    assert.equal(list.find((t) => t.id === TENANT_B.tenantId).logoUrl, null);
  });

  it('D03: nunca se publica un SVG ni un http inseguro; id inválido o tienda suspendida no exponen nada', async () => {
    await setLogo(TENANT_A.schemaName, `data:image/svg+xml;base64,${Buffer.from('<svg onload="alert(1)"/>').toString('base64')}`);
    assert.equal((await get(`/platform/tenants/${TENANT_A.tenantId}/logo`)).status, 404);
    await setLogo(TENANT_A.schemaName, 'http://inseguro.example.com/logo.png');
    assert.equal((await get(`/platform/tenants/${TENANT_A.tenantId}/logo`)).status, 404);

    assert.equal((await get('/platform/tenants/no-es-un-uuid/logo')).status, 400);

    await setLogo(TENANT_A.schemaName, `data:image/png;base64,${PNG.toString('base64')}`);
    await queryRows("UPDATE public.tenants SET status='SUSPENDED' WHERE id=$1", [TENANT_A.tenantId]);
    try {
      assert.equal((await get(`/platform/tenants/${TENANT_A.tenantId}/logo`)).status, 404);
      const list = (await (await get('/platform/tenants/public')).json()).data as any[];
      assert.equal(list.some((t) => t.id === TENANT_A.tenantId), false, 'una tienda suspendida no aparece en el selector');
    } finally {
      await queryRows("UPDATE public.tenants SET status='ACTIVE' WHERE id=$1", [TENANT_A.tenantId]);
    }
  });

  it('D04: el directorio marca las tiendas sin app móvil (el login móvil igual lo exige en el servidor)', async () => {
    await queryRows("UPDATE public.tenants SET plan='starter' WHERE id=$1", [TENANT_B.tenantId]);
    try {
      const list = (await (await get('/platform/tenants/public')).json()).data as any[];
      assert.equal(list.find((t) => t.id === TENANT_B.tenantId).mobileApp, false);
      const stores = dir.toStores(list, `${base}/api/v1`);
      const ordered = dir.searchStores(stores, '');
      assert.equal(ordered.at(-1).id, TENANT_B.tenantId, 'en el selector queda al final y deshabilitada');
    } finally {
      await queryRows("UPDATE public.tenants SET plan='pro' WHERE id=$1", [TENANT_B.tenantId]);
    }
  });
});

import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { randomUUID } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import { Api, TENANT_A, createProduct, createUser, key, queryRows, seedTenant, spawnReplica, type Fixture } from './support/world';

// Panel de administración sin conexión en Chromium real contra el build de PRODUCCIÓN del front.
// Solo corre con PLAYWRIGHT_MODULE y FRONT_DIR definidos (como pwa-browser).
const PLAYWRIGHT = process.env.PLAYWRIGHT_MODULE;
const FRONT_DIR = process.env.FRONT_DIR;
const API_PORT = 39200;
const FRONT_PORT = 39302;
const FRONT = `http://localhost:${FRONT_PORT}`;
const schema = TENANT_A.schemaName;
const tenant = TENANT_A.tenantId;
const ADMIN = ['MANAGE_PRODUCTS', 'VIEW_ORDERS', 'MANAGE_INVENTORY', 'ALL_BRANCHES'];

describe('Panel de administración sin conexión en navegador real', { skip: !PLAYWRIGHT || !FRONT_DIR }, () => {
  let chromium: any;
  let browser: any;
  let fx: Fixture;
  let replica: Awaited<ReturnType<typeof spawnReplica>>;
  let front: ChildProcess;
  const jwt = new JwtService({ secret: process.env.JWT_SECRET });

  const accessOf = (userId: string, permissions: string[]) =>
    jwt.sign({ sub: userId, email: `${userId}@test.local`, role: 'Admin', permissions, tenantId: tenant }, { secret: process.env.JWT_SECRET, expiresIn: 3600 });
  const refreshOf = (userId: string) =>
    jwt.sign({ sub: userId, email: `${userId}@test.local`, tenantId: tenant, refreshId: randomUUID() }, { secret: process.env.JWT_REFRESH_SECRET, expiresIn: 7 * 24 * 3600 });
  const persisted = (userId: string, permissions: string[]) =>
    JSON.stringify({
      auth: JSON.stringify({
        accessToken: accessOf(userId, permissions),
        refreshToken: refreshOf(userId),
        user: { id: userId, email: `${userId}@test.local`, role: { id: 'r', name: 'Admin' }, permissions },
        esAutenticado: true,
      }),
      cart: JSON.stringify({ items: [], totalItems: 0, totalPrice: 0 }),
      branch: JSON.stringify({ selectedBranchId: fx.branchA }),
      _persist: JSON.stringify({ version: -1, rehydrated: true }),
    });

  const openContext = async () => {
    const context = await browser.newContext({ locale: 'es-BO', serviceWorkers: 'allow' });
    await context.addCookies([{ name: 'NEXT_LOCALE', value: 'es', url: FRONT }]);
    await context.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (route: any) => route.abort());
    const page = await context.newPage();
    return { context, page };
  };
  const signIn = async (page: any, state: string) => {
    await page.goto(`${FRONT}/file.svg`);
    await page.evaluate(([k, v, t]: string[]) => {
      localStorage.setItem('sf_tenant_id', t);
      localStorage.setItem(k, v);
    }, [`persist:root:${tenant}`, state, tenant]);
  };
  const OFFLINE_ROUTE = /localhost:39302|127\.0\.0\.1:39200/;
  const goOffline = async (context: any) => {
    await context.setOffline(true);
    await context.route(OFFLINE_ROUTE, (route: any) => route.abort('internetdisconnected'));
  };
  const goOnline = async (context: any) => {
    await context.unroute(OFFLINE_ROUTE);
    await context.setOffline(false);
  };
  const idbAll = (page: any, store: string) =>
    page.evaluate(
      ([name, storeName]: string[]) =>
        new Promise((resolve, reject) => {
          const open = indexedDB.open(name);
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const db = open.result;
            if (!db.objectStoreNames.contains(storeName)) {
              db.close();
              return resolve([]);
            }
            const all = db.transaction(storeName).objectStore(storeName).getAll();
            all.onsuccess = () => {
              db.close();
              resolve(all.result);
            };
          };
        }),
      [`stella-femme-offline:${tenant}`, store],
    ) as Promise<any[]>;
  const waitFor = async (label: string, fn: () => Promise<boolean>, tries = 60, ms = 250) => {
    for (let i = 0; i < tries; i += 1) {
      if (await fn()) return;
      await new Promise((resolve) => setTimeout(resolve, ms));
    }
    assert.fail(`timeout: ${label}`);
  };
  const swReady = (page: any) =>
    page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) {
        await new Promise((resolve) => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
      }
    });
  const offlineFallbackReady = (page: any) =>
    waitFor('fallback offline precacheado', () =>
      page.evaluate(async () => {
        const keys = await (await caches.open('sf-pages-v9')).keys();
        return keys.some((r) => r.url.includes('/offline') && r.url.includes('__sf_tenant='));
      }),
    );
  // Abre una sección con conexión hasta ver `text`, con el service worker controlando y la copia guardada
  const openOnline = async (page: any, path: string, text: string) => {
    await page.goto(`${FRONT}${path}`);
    await swReady(page);
    await page.goto(`${FRONT}${path}`);
    await page.getByText(text, { exact: true }).first().waitFor({ timeout: 20000 });
    await waitFor('copia del panel', async () => (await idbAll(page, 'admin_read_cache')).some((e) => e.url === path.replace('/admin', '').replace('/orders', '/orders/admin/all')));
    await offlineFallbackReady(page);
  };
  const rowOf = (page: any, text: string) => page.locator('tr', { hasText: text }).first();
  const newAdmin = (permissions = ADMIN) => createUser(schema, fx, { permissions });
  const productRow = async (id: string) => (await queryRows(`SELECT name, price::float AS price FROM "${schema}".products WHERE id=$1`, [id]))[0];

  before(async () => {
    process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = '1';
    fx = await seedTenant(schema);
    replica = await spawnReplica(API_PORT, { ALLOWED_ORIGINS: FRONT });
    const nextBin = join(FRONT_DIR!, 'node_modules', 'next', 'dist', 'bin', 'next');
    front = spawn(process.execPath, [nextBin, 'start', '-p', String(FRONT_PORT)], {
      cwd: FRONT_DIR!,
      env: { ...process.env, NODE_ENV: 'production', NEXT_PUBLIC_TENANT_ID: '', DATABASE_URL: '', DIRECT_URL: '' },
      stdio: 'ignore',
    });
    for (let i = 0; i < 120; i += 1) {
      if (await fetch(`${FRONT}/offline`).then((r) => r.ok).catch(() => false)) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    ({ chromium } = require(PLAYWRIGHT!));
    browser = await chromium.launch();
  });

  after(async () => {
    await browser?.close();
    front?.kill();
    await replica?.stop();
  });

  it('D01: sin conexión se abre Productos, se edita el precio y se sincroniza al volver la red', async () => {
    const adminId = await newAdmin();
    const productId = await createProduct(schema, fx, { [fx.branchA]: { M: 5 } }, 100);
    const name = `Prod-${productId.slice(0, 6)}`;
    await queryRows(`UPDATE "${schema}".products SET name=$2 WHERE id=$1`, [productId, name]);
    const { context, page } = await openContext();
    await signIn(page, persisted(adminId, ADMIN));
    await openOnline(page, '/admin/products', name);

    await goOffline(context);
    await page.goto(`${FRONT}/admin/products`);
    await page.getByTestId('offline-admin').waitFor({ timeout: 15000 });
    await rowOf(page, name).waitFor();
    await page.getByText('Sin conexión: puedes editar productos', { exact: false }).waitFor();

    await rowOf(page, name).getByRole('button', { name: 'Editar' }).click();
    await page.locator('#product-price').fill('125');
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    await page.getByTestId('admin-pending-count').waitFor();
    const [change] = await idbAll(page, 'admin_changes');
    assert.equal(change.entity, 'product');
    assert.deepEqual(change.changes, { price: 125 });
    assert.deepEqual(change.expected, { price: 100 });
    assert.equal(change.userId, adminId);
    assert.equal((await productRow(productId)).price, 100, 'sin red no llegó nada');
    await waitFor('la lista muestra lo editado', async () => (await rowOf(page, name).innerText()).includes('125'));

    // Recargar sin red: sigue pendiente y visible
    await page.reload();
    await page.getByTestId('admin-pending-count').waitFor({ timeout: 15000 });

    await goOnline(context);
    await waitFor('sincronizado', async () => (await productRow(productId)).price === 125);
    await waitFor('cola vacía', async () => (await idbAll(page, 'admin_changes')).length === 0);
    await context.close();
  });

  it('D02: conflicto con otro dispositivo en una categoría: se muestra, no se pisa y se resuelve', async () => {
    const adminId = await newAdmin();
    const categoryId = randomUUID();
    const name = `Cat-${categoryId.slice(0, 6)}`;
    await queryRows(`INSERT INTO "${schema}".categories (id,name,slug,"updatedAt") VALUES ($1,$2,$3,now())`, [categoryId, name, `cat-${categoryId}`]);
    const { context, page } = await openContext();
    await signIn(page, persisted(adminId, ADMIN));
    await openOnline(page, '/admin/categories', name);

    await goOffline(context);
    await page.goto(`${FRONT}/admin/categories`);
    await page.getByTestId('offline-admin').waitFor({ timeout: 15000 });
    await rowOf(page, name).getByRole('button', { name: 'Editar' }).click();
    await page.locator('#category-name').fill(`${name} Mía`);
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    await page.getByTestId('admin-pending-count').waitFor();
    // Otro dispositivo cambia el nombre mientras tanto
    await queryRows(`UPDATE "${schema}".categories SET name=$2 WHERE id=$1`, [categoryId, `${name} Servidor`]);

    await goOnline(context);
    await waitFor('conflicto', async () => (await idbAll(page, 'admin_changes'))[0]?.status === 'conflict');
    const name1 = (await queryRows(`SELECT name FROM "${schema}".categories WHERE id=$1`, [categoryId]))[0].name;
    assert.equal(name1, `${name} Servidor`, 'nada se sobrescribió');
    await page.getByRole('button', { name: 'Ver cambios' }).click();
    const row = page.locator('[data-testid="admin-changes-list"] tr[data-field="name"]');
    await row.waitFor();
    assert.ok((await row.innerText()).includes(`${name} Mía`));
    assert.ok((await row.innerText()).includes(`${name} Servidor`));
    await page.getByRole('button', { name: 'Usar mis cambios' }).click();
    await waitFor('mi versión aplicada', async () => (await queryRows(`SELECT name FROM "${schema}".categories WHERE id=$1`, [categoryId]))[0].name === `${name} Mía`);
    await waitFor('cola vacía', async () => (await idbAll(page, 'admin_changes')).length === 0);
    await context.close();
  });

  it('D03: crear una categoría y cambiar el estado de un pedido sin conexión; ambos se sincronizan una sola vez', async () => {
    const adminId = await newAdmin();
    const buyerId = await createUser(schema, fx);
    const productId = await createProduct(schema, fx, { [fx.branchA]: { M: 5 } });
    const buyer = new Api(`http://127.0.0.1:${API_PORT}`, tenant, jwt.sign({ sub: buyerId, email: 'b@test.local', role: 'CLIENTE', permissions: [], tenantId: tenant }, { secret: process.env.JWT_SECRET, expiresIn: 3600 }));
    await buyer.addToCart(productId, 1, 'M', fx.branchA);
    const created = await buyer.createOrder({ key: key(), cartVersion: await buyer.cartVersion(), items: [{ productId, quantity: 1, size: 'M' }], branchId: fx.branchA });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const orderId = created.body.data.id as string;
    const status = async () => (await queryRows(`SELECT status FROM "${schema}".orders WHERE id=$1`, [orderId]))[0].status;

    const { context, page } = await openContext();
    await signIn(page, persisted(adminId, ADMIN));
    await openOnline(page, '/admin/categories', 'Nueva categoría');
    await openOnline(page, '/admin/orders', `#${orderId.slice(0, 8)}`);

    await goOffline(context);
    await page.goto(`${FRONT}/admin/orders`);
    await page.getByTestId('offline-admin').waitFor({ timeout: 15000 });
    await page.getByLabel(`Estado del pedido ${orderId.slice(0, 8)}`).selectOption('PROCESANDO');
    await page.getByTestId('admin-pending-count').waitFor();

    const catName = `Nueva-${randomUUID().slice(0, 6)}`;
    await page.goto(`${FRONT}/admin/categories`);
    await page.getByTestId('offline-admin').waitFor({ timeout: 15000 });
    await page.getByRole('button', { name: 'Nueva categoría' }).click();
    await page.locator('#category-name').fill(catName);
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    await rowOf(page, catName).waitFor({ timeout: 10000 });
    const queued = await idbAll(page, 'admin_changes');
    assert.equal(queued.length, 2);
    const createChange = queued.find((c) => c.op === 'create');
    assert.equal(await status(), 'PENDIENTE');
    assert.equal((await queryRows(`SELECT * FROM "${schema}".categories WHERE name=$1`, [catName])).length, 0);

    await goOnline(context);
    await waitFor('pedido sincronizado', async () => (await status()) === 'PROCESANDO');
    await waitFor('categoría creada', async () => (await queryRows(`SELECT id FROM "${schema}".categories WHERE name=$1`, [catName])).length === 1);
    const [cat] = await queryRows(`SELECT id FROM "${schema}".categories WHERE name=$1`, [catName]);
    assert.equal(cat.id, createChange.entityId, 'mismo id que en el dispositivo');
    await waitFor('cola vacía', async () => (await idbAll(page, 'admin_changes')).length === 0);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.waitForTimeout(1500);
    assert.equal((await queryRows(`SELECT * FROM "${schema}".categories WHERE name=$1`, [catName])).length, 1, 'sin duplicados');
    await context.close();
  });

  it('D04: lo que exige conexión lo dice; secciones fuera de alcance; inventario abre sin red', async () => {
    const adminId = await newAdmin([...ADMIN, 'MANAGE_USERS']);
    const categoryId = randomUUID();
    const name = `Del-${categoryId.slice(0, 6)}`;
    await queryRows(`INSERT INTO "${schema}".categories (id,name,slug,"updatedAt") VALUES ($1,$2,$3,now())`, [categoryId, name, `del-${categoryId}`]);
    const { context, page } = await openContext();
    await signIn(page, persisted(adminId, [...ADMIN, 'MANAGE_USERS']));
    await openOnline(page, '/admin/categories', name);
    await page.goto(`${FRONT}/admin/inventory`);
    await page.waitForTimeout(2500);

    await goOffline(context);
    await page.goto(`${FRONT}/admin/categories`);
    await page.getByTestId('offline-admin').waitFor({ timeout: 15000 });
    page.once('dialog', (dialog: any) => dialog.accept());
    await rowOf(page, name).getByRole('button', { name: 'Eliminar' }).click();
    await page.getByText('Esta acción requiere conexión a Internet.').waitFor();
    assert.equal((await idbAll(page, 'admin_changes')).length, 0, 'borrar no se encola');
    assert.equal((await queryRows(`SELECT * FROM "${schema}".categories WHERE id=$1`, [categoryId])).length, 1);

    await page.goto(`${FRONT}/admin/staff`);
    await page.getByTestId('offline-admin').waitFor({ timeout: 15000 });
    await page.getByText('Esta sección requiere conexión').waitFor();

    await page.goto(`${FRONT}/admin/inventory`);
    await page.getByTestId('offline-admin').waitFor({ timeout: 15000 });
    assert.equal(await page.getByText('Esta sección requiere conexión').count(), 0);
    await goOnline(context);
    await context.close();
  });

  it('D05: cerrar sesión borra la copia del panel; lo pendiente no sale con otra cuenta ni lo ve un cliente', async () => {
    const adminA = await newAdmin();
    const adminB = await newAdmin();
    const clientId = await createUser(schema, fx);
    const productId = await createProduct(schema, fx, { [fx.branchA]: { M: 5 } }, 100);
    const name = `Iso-${productId.slice(0, 6)}`;
    await queryRows(`UPDATE "${schema}".products SET name=$2 WHERE id=$1`, [productId, name]);
    const { context, page } = await openContext();
    const syncs: string[] = [];
    context.on('request', (r: any) => r.method() === 'POST' && r.url().endsWith('/admin/offline-sync') && syncs.push(r.headers().authorization ?? ''));
    await signIn(page, persisted(adminA, ADMIN));
    await openOnline(page, '/admin/products', name);
    await goOffline(context);
    await page.goto(`${FRONT}/admin/products`);
    await page.getByTestId('offline-admin').waitFor({ timeout: 15000 });
    await rowOf(page, name).getByRole('button', { name: 'Editar' }).click();
    await page.locator('#product-price').fill('140');
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    await page.getByTestId('admin-pending-count').waitFor();
    await goOnline(context);
    // Antes de que se envíe: cierra sesión (bloqueando el envío para fijar el escenario)
    await context.route('**/admin/offline-sync', (route: any) => route.fulfill({ status: 503, body: '{}' }));
    await page.goto(`${FRONT}/admin/products`);
    await page.getByRole('button', { name: 'Cerrar sesión' }).first().click();
    await waitFor('copia del panel borrada', async () => (await idbAll(page, 'admin_read_cache')).length === 0);
    assert.equal((await idbAll(page, 'admin_changes')).length, 1, 'el pendiente sobrevive');
    await context.unroute('**/admin/offline-sync');
    syncs.length = 0;

    // Un cliente sin acceso al panel, sin red: aviso genérico, nada del panel
    await signIn(page, persisted(clientId, []));
    await page.goto(`${FRONT}/`);
    await offlineFallbackReady(page);
    await goOffline(context);
    await page.goto(`${FRONT}/admin/products`);
    await page.getByRole('heading', { name: /sin conexión/i }).waitFor();
    assert.equal(await page.getByTestId('offline-admin').count(), 0);
    assert.equal((await page.locator('body').innerText()).includes(name), false);
    await goOnline(context);

    // Otro administrador en el mismo dispositivo: no ve ni envía el cambio de A
    await signIn(page, persisted(adminB, ADMIN));
    await page.goto(`${FRONT}/admin/products`);
    await rowOf(page, name).waitFor({ timeout: 20000 });
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.waitForTimeout(2500);
    assert.equal(syncs.length, 0, 'nada se envía con la sesión de B');
    assert.equal(await page.getByTestId('admin-pending-count').count(), 0, 'B no ve lo pendiente de A');
    assert.equal((await productRow(productId)).price, 100);

    // Vuelve A: se envía con su token
    await signIn(page, persisted(adminA, ADMIN));
    await page.goto(`${FRONT}/admin/products`);
    await waitFor('enviado por A', async () => (await productRow(productId)).price === 140);
    const subject = (auth: string) => JSON.parse(Buffer.from(auth.replace('Bearer ', '').split('.')[1], 'base64url').toString()).sub;
    assert.ok(syncs.length >= 1 && syncs.every((s) => subject(s) === adminA));
    await context.close();
  });
});

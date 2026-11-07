import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { randomUUID } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import { Api, TENANT_A, TENANT_B, createProduct, createUser, key, queryRows, seedTenant, spawnReplica, type Fixture } from './support/world';

// Perfil editable sin conexión en Chromium real contra el build de PRODUCCIÓN del front (NEXT_PUBLIC_API_URL
// apuntando a API_PORT). Solo corre con PLAYWRIGHT_MODULE y FRONT_DIR definidos, como pwa-browser.
const PLAYWRIGHT = process.env.PLAYWRIGHT_MODULE;
const FRONT_DIR = process.env.FRONT_DIR;
const API_PORT = 39200;
const FRONT_PORT = 39301;
const FRONT = `http://localhost:${FRONT_PORT}`;
const schema = TENANT_A.schemaName;
const tenant = TENANT_A.tenantId;

describe('Perfil sin conexión en navegador real', { skip: !PLAYWRIGHT || !FRONT_DIR }, () => {
  let chromium: any;
  let browser: any;
  let fx: Fixture;
  let replica: Awaited<ReturnType<typeof spawnReplica>>;
  let front: ChildProcess;
  const jwt = new JwtService({ secret: process.env.JWT_SECRET });

  const accessOf = (userId: string, tenantId = tenant, expiresIn = 3600) =>
    jwt.sign({ sub: userId, email: `${userId}@test.local`, role: 'CLIENTE', permissions: [], tenantId }, { secret: process.env.JWT_SECRET, expiresIn });
  // Refresh token con forma real (sub, tenantId, exp). Con otro secreto el servidor lo rechaza: sesión vencida
  const refreshOf = (userId: string, tenantId = tenant, valid = true) =>
    jwt.sign({ sub: userId, email: `${userId}@test.local`, tenantId, refreshId: randomUUID() }, {
      secret: valid ? process.env.JWT_REFRESH_SECRET : 'otro-secreto',
      expiresIn: 7 * 24 * 3600,
    });

  const persisted = (userId: string, opts: { tenantId?: string; accessTtl?: number; refreshValid?: boolean; cart?: { productId: string; name: string } } = {}) => {
    const { tenantId = tenant, accessTtl = 3600, refreshValid = true, cart } = opts;
    const items = cart
      ? [{ id: `${cart.productId}-M`, cartId: 'local', productId: cart.productId, product: { id: cart.productId, name: cart.name, price: 100, stock: 5, sizes: ['M'], sku: 's', isActive: true }, price: 100, quantity: 1, selectedSize: 'M' }]
      : [];
    return JSON.stringify({
      auth: JSON.stringify({
        accessToken: accessOf(userId, tenantId, accessTtl),
        refreshToken: refreshOf(userId, tenantId, refreshValid),
        user: { id: userId, email: `${userId}@test.local`, role: { id: 'r', name: 'CLIENTE' }, permissions: [] },
        esAutenticado: true,
      }),
      cart: JSON.stringify({ items, totalItems: items.length, totalPrice: items.length * 100 }),
      branch: JSON.stringify({ selectedBranchId: fx.branchA }),
      _persist: JSON.stringify({ version: -1, rehydrated: true }),
    });
  };

  const openContext = async () => {
    const context = await browser.newContext({ locale: 'es-BO', serviceWorkers: 'allow' });
    await context.addCookies([{ name: 'NEXT_LOCALE', value: 'es', url: FRONT }]);
    await context.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (route: any) => route.abort());
    const page = await context.newPage();
    return { context, page };
  };

  // Desde un recurso sin la app: en una página viva redux-persist volvería a escribir su estado encima
  const NEUTRAL_PAGE = `${FRONT}/file.svg`;
  const signIn = async (page: any, state: string, tenantId = tenant) => {
    await page.goto(NEUTRAL_PAGE);
    await page.evaluate(
      ([k, v, t]: string[]) => {
        localStorage.setItem('sf_tenant_id', t);
        localStorage.setItem(k, v);
      },
      [`persist:root:${tenantId}`, state, tenantId],
    );
  };

  // setOffline no alcanza a los fetch del propio service worker: esos se cortan por ruta
  const OFFLINE_ROUTE = /localhost:39301|127\.0\.0\.1:39200/;
  const goOffline = async (context: any) => {
    await context.setOffline(true);
    await context.route(OFFLINE_ROUTE, (route: any) => route.abort('internetdisconnected'));
  };
  const goOnline = async (context: any) => {
    await context.unroute(OFFLINE_ROUTE);
    await context.setOffline(false);
  };

  const idbAll = (page: any, store: string, tenantId = tenant) =>
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
      [`stella-femme-offline:${tenantId}`, store],
    ) as Promise<any[]>;

  const userRow = async (id: string) =>
    (await queryRows(`SELECT "firstName","lastName",phone,"preferredBranchId","updatedAt" FROM "${schema}".users WHERE id=$1`, [id]))[0];
  const receiptsOf = async (id: string) => (await queryRows(`SELECT * FROM "${schema}".profile_sync_receipts WHERE "userId"=$1`, [id])).length;

  const waitFor = async (label: string, fn: () => Promise<boolean>, tries = 60, ms = 250) => {
    for (let i = 0; i < tries; i += 1) {
      if (await fn()) return;
      await new Promise((resolve) => setTimeout(resolve, ms));
    }
    assert.fail(`timeout: ${label}`);
  };

  // El formulario se llena después de leer IndexedDB: se espera el valor, no se lee una sola vez
  const expectValue = (page: any, selector: string, value: string) =>
    waitFor(`${selector} = ${value}`, async () => (await page.locator(selector).inputValue().catch(() => '')) === value, 40);

  const swReady = (page: any) =>
    page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) {
        await new Promise((resolve) => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
      }
    });

  // Perfil abierto con conexión: copia local guardada y el fallback /offline de la tienda precacheado
  const loadProfileOnline = async (page: any, userId: string) => {
    await page.goto(`${FRONT}/account`);
    await swReady(page);
    await page.goto(`${FRONT}/account`);
    await waitFor('copia local', async () => (await idbAll(page, 'profile_snapshots')).some((s) => s.userId === userId));
    await waitFor('fallback offline precacheado', () =>
      page.evaluate(async () => {
        const keys = await (await caches.open('sf-pages-v9')).keys();
        return keys.some((r) => r.url.includes('/offline') && r.url.includes('__sf_tenant='));
      }),
    );
  };

  const cacheUrls = (page: any): Promise<string[]> =>
    page.evaluate(async () => {
      const out: string[] = [];
      for (const name of await caches.keys()) for (const r of await (await caches.open(name)).keys()) out.push(r.url);
      return out;
    });
  const PRIVATE_CACHE = /\/api\/v1\/(users|auth|orders|cart|payments)|\/account/;

  const newUser = async (firstName: string, phone: string | null = null) => {
    const id = await createUser(schema, fx);
    await queryRows(`UPDATE "${schema}".users SET "firstName"=$2, phone=$3 WHERE id=$1`, [id, firstName, phone]);
    return id;
  };

  const saveOffline = async (page: any, values: { firstName?: string; phone?: string }) => {
    if (values.firstName !== undefined) await page.locator('#firstName').fill(values.firstName);
    if (values.phone !== undefined) await page.locator('#phone').fill(values.phone);
    await page.getByRole('button', { name: 'Guardar en este dispositivo' }).click();
    await page.getByText('Guardado en este dispositivo', { exact: false }).first().waitFor();
  };

  before(async () => {
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

  it('P01: perfil cargado antes se abre y se edita sin conexión, y se sincroniza al volver la red', async () => {
    const userId = await newUser('Ana');
    const { context, page } = await openContext();
    const orderPosts: string[] = [];
    page.on('request', (r: any) => r.method() === 'POST' && r.url().includes('/api/v1/orders') && orderPosts.push(r.url()));
    await signIn(page, persisted(userId));
    await loadProfileOnline(page, userId);
    assert.deepEqual((await cacheUrls(page)).filter((u) => PRIVATE_CACHE.test(u)), [], 'nada privado en Cache Storage');

    await goOffline(context);
    await page.goto(`${FRONT}/account`);
    await page.getByTestId('offline-account').waitFor();
    await expectValue(page, '#firstName', 'Ana');
    assert.ok(await page.getByText('Sin conexión. Puedes editar tu perfil', { exact: false }).count());
    assert.ok(await page.getByText('Puedes editar tu perfil y consultar tus pedidos', { exact: false }).count());

    await saveOffline(page, { firstName: 'Ana Offline', phone: '+591 70000009' });
    const [pending] = await idbAll(page, 'profile_changes');
    assert.equal(pending.userId, userId);
    assert.equal(pending.status, 'pending');
    assert.deepEqual(pending.changes, { firstName: 'Ana Offline', phone: '+591 70000009' });
    assert.deepEqual(pending.expected, { firstName: ['Ana'], phone: [null] });
    assert.equal(JSON.stringify(pending).includes('Bearer'), false);
    assert.equal((await userRow(userId)).firstName, 'Ana', 'sin conexión no llegó nada al servidor');

    // Reabrir sin red: se ve lo pendiente encima de la copia
    await page.reload();
    await page.getByTestId('offline-account').waitFor();
    await expectValue(page, '#firstName', 'Ana Offline');
    assert.ok(await page.getByText('Tienes cambios pendientes', { exact: false }).count());

    await goOnline(context);
    await waitFor('sincronizado en el servidor', async () => (await userRow(userId)).firstName === 'Ana Offline');
    await waitFor('pendiente eliminado', async () => (await idbAll(page, 'profile_changes')).length === 0);
    const row = await userRow(userId);
    assert.equal(row.phone, '+591 70000009');
    await page.getByText('Perfil sincronizado con el servidor').waitFor();
    const [snapshot] = await idbAll(page, 'profile_snapshots');
    assert.equal(snapshot.values.firstName, 'Ana Offline', 'la copia refleja lo confirmado');
    assert.equal(orderPosts.length, 0, 'no se envió ninguna compra');
    await context.close();
  });

  it('P02: cambio pendiente al cerrar la app: se envía al volver a abrirla', async () => {
    const userId = await newUser('Bruno');
    const { context, page } = await openContext();
    await signIn(page, persisted(userId));
    await loadProfileOnline(page, userId);
    await goOffline(context);
    await page.goto(`${FRONT}/account`);
    await page.getByTestId('offline-account').waitFor();
    await saveOffline(page, { firstName: 'Bruno Reabierto' });
    await page.close();
    await goOnline(context);
    assert.equal((await userRow(userId)).firstName, 'Bruno', 'sin la app abierta no se envía');

    // Sin evento "online": solo abrir la PWA de nuevo
    const reopened = await context.newPage();
    await reopened.goto(`${FRONT}/`);
    await waitFor('enviado al reabrir', async () => (await userRow(userId)).firstName === 'Bruno Reabierto');
    await waitFor('pendiente eliminado', async () => (await idbAll(reopened, 'profile_changes')).length === 0);
    await context.close();
  });

  it('P03: la API falla o se corta tras aplicar: sigue pendiente y el reintento no aplica dos veces', async () => {
    const userId = await newUser('Carla');
    const { context, page } = await openContext();
    await signIn(page, persisted(userId));
    await loadProfileOnline(page, userId);

    const bodies: any[] = [];
    let mode: 'fail' | 'cut' | 'pass' = 'fail';
    await page.route('**/api/v1/users/me/sync', async (route: any) => {
      bodies.push(JSON.parse(route.request().postData()));
      if (mode === 'fail') return route.fulfill({ status: 503, contentType: 'application/json', body: '{"statusCode":503}' });
      if (mode === 'cut') {
        await route.fetch();
        return route.abort('connectionreset');
      }
      return route.continue();
    });

    // El formulario lo llena el cliente: si se escribe antes de hidratar, el botón hace un envío HTML nativo
    await expectValue(page, '#firstName', 'Carla');
    await page.locator('#firstName').fill('Carla Nueva');
    await page.getByRole('button', { name: 'Guardar cambios' }).click();
    try {
      await page.getByText('Guardado en este dispositivo', { exact: false }).first().waitFor({ timeout: 8000 });
    } catch (e) {
      // Diagnóstico si vuelve a fallar: qué muestra la página y qué quedó en IndexedDB
      console.log('[P03 body]', (await page.locator('body').innerText()).slice(0, 1500));
      console.log('[P03 bodies]', JSON.stringify(bodies));
      console.log('[P03 idb]', JSON.stringify(await idbAll(page, 'profile_changes')));
      throw e;
    }
    let [pending] = await idbAll(page, 'profile_changes');
    assert.equal(pending.status, 'pending', 'un 503 no lo descarta ni lo marca sincronizado');
    assert.equal((await userRow(userId)).firstName, 'Carla');
    await page.getByText('Cambios pendientes de sincronizar').waitFor();

    // El servidor aplica pero la respuesta no llega
    mode = 'cut';
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await waitFor('segundo intento', async () => bodies.length >= 2);
    await waitFor('aplicado en el servidor', async () => (await userRow(userId)).firstName === 'Carla Nueva');
    await waitFor('sigue pendiente', async () => ((await idbAll(page, 'profile_changes'))[0]?.attempts ?? 0) >= 2);
    [pending] = await idbAll(page, 'profile_changes');
    assert.equal(pending.status, 'pending', 'sin confirmación no se marca sincronizado');
    const afterApply = await userRow(userId);

    mode = 'pass';
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await waitFor('confirmado', async () => (await idbAll(page, 'profile_changes')).length === 0);
    assert.ok(bodies.length >= 3);
    assert.ok(bodies.every((b) => b.changeId === bodies[0].changeId), 'mismo changeId en todos los reintentos');
    assert.equal(await receiptsOf(userId), 1);
    assert.equal((await userRow(userId)).updatedAt.getTime(), afterApply.updatedAt.getTime(), 'el reintento no volvió a escribir');
    await context.close();
  });

  it('P04: sesión vencida: el cambio se conserva, se pide iniciar sesión y se envía al volver la misma cuenta', async () => {
    const userId = await newUser('Diana');
    const { context, page } = await openContext();
    // Access token de 4 s y refresh que el servidor no acepta
    await signIn(page, persisted(userId, { accessTtl: 4, refreshValid: false }));
    await loadProfileOnline(page, userId);
    await goOffline(context);
    await page.goto(`${FRONT}/account`);
    await page.getByTestId('offline-account').waitFor();
    await saveOffline(page, { firstName: 'Diana Vencida' });
    await page.waitForTimeout(4500);

    await goOnline(context);
    // Puede haber dos redirecciones al login a la vez (sincronizador y cabecera): importa dónde termina
    await waitFor('en el login', async () => page.url().includes('/auth/login'), 80);
    await page.waitForLoadState('load');
    const [kept] = await idbAll(page, 'profile_changes');
    assert.equal(kept?.userId, userId, 'el cambio pendiente no se borró');
    assert.deepEqual(kept.changes, { firstName: 'Diana Vencida' });
    assert.ok(['needs-login', 'pending'].includes(kept.status), kept.status);
    assert.equal((await idbAll(page, 'profile_snapshots')).length, 0, 'la copia del perfil se borró con la sesión');
    assert.equal((await userRow(userId)).firstName, 'Diana');
    await page.getByText('Hay cambios de perfil guardados sin conexión', { exact: false }).waitFor();

    // Vuelve a entrar la misma cuenta
    await signIn(page, persisted(userId));
    await page.goto(`${FRONT}/`);
    await waitFor('enviado tras iniciar sesión', async () => (await userRow(userId)).firstName === 'Diana Vencida');
    await context.close();
  });

  it('P05: aislamiento: el cambio de A no se ve ni se envía con la sesión de B ni en otra tienda', async () => {
    const userA = await newUser('Elisa', '+591 70000001');
    const userB = await newUser('Fabio', '+591 70000002');
    const { context, page } = await openContext();
    const syncs: { auth: string; body: any }[] = [];
    context.on('request', (r: any) => {
      if (r.method() === 'PATCH' && r.url().endsWith('/api/v1/users/me/sync')) syncs.push({ auth: r.headers().authorization ?? '', body: JSON.parse(r.postData()) });
    });
    await signIn(page, persisted(userA));
    await loadProfileOnline(page, userA);
    await goOffline(context);
    await page.goto(`${FRONT}/account`);
    await page.getByTestId('offline-account').waitFor();
    await saveOffline(page, { firstName: 'Elisa Secreta', phone: '+591 79999999' });
    await page.close();

    // Entra B en el mismo navegador (antes de que la app de A vuelva a abrirse con red)
    const second = await context.newPage();
    await goOnline(context);
    await signIn(second, persisted(userB));
    await second.goto(`${FRONT}/account`);
    await waitFor('perfil de B', async () => (await second.locator('#firstName').inputValue().catch(() => '')) === 'Fabio');
    await second.evaluate(() => window.dispatchEvent(new Event('online')));
    await second.waitForTimeout(2500);
    const body = await second.locator('body').innerText();
    assert.equal(body.includes('Elisa'), false);
    assert.equal(body.includes('79999999'), false);
    assert.equal(syncs.length, 0, 'nada se envía con la sesión de otra persona');
    assert.equal((await userRow(userA)).firstName, 'Elisa');
    const pending = await idbAll(second, 'profile_changes');
    assert.equal(pending.length, 1);
    assert.equal(pending[0].userId, userA, 'el cambio de A se conserva');
    assert.ok((await idbAll(second, 'profile_snapshots')).every((s) => s.userId === userB), 'la copia de A no queda al entrar B');

    // Otra tienda: otra base, nada de A
    assert.equal((await idbAll(second, 'profile_changes', TENANT_B.tenantId)).length, 0);

    // A vuelve: se envía con SU token
    await signIn(second, persisted(userA));
    await second.goto(`${FRONT}/`);
    await waitFor('enviado por A', async () => (await userRow(userA)).firstName === 'Elisa Secreta');
    const subject = (auth: string) => JSON.parse(Buffer.from(auth.replace('Bearer ', '').split('.')[1], 'base64url').toString()).sub;
    assert.ok(syncs.length >= 1 && syncs.every((s) => subject(s.auth) === userA));
    await context.close();
  });

  it('P06: conflicto con otro dispositivo: se muestra, no se pisa, y se resuelve con una decisión explícita', async () => {
    const userId = await newUser('Gina', '+591 70000003');
    const { context, page } = await openContext();
    await signIn(page, persisted(userId));
    await loadProfileOnline(page, userId);
    await goOffline(context);
    await page.goto(`${FRONT}/account`);
    await page.getByTestId('offline-account').waitFor();
    await saveOffline(page, { firstName: 'Gina Mía' });
    // Otro dispositivo cambia el nombre
    await queryRows(`UPDATE "${schema}".users SET "firstName"='Gina Servidor' WHERE id=$1`, [userId]);

    await goOnline(context);
    await page.getByText('Tu perfil cambió en otro dispositivo').waitFor({ timeout: 20000 });
    const row = page.locator('tr[data-field="firstName"]');
    assert.ok((await row.innerText()).includes('Gina Mía'));
    assert.ok((await row.innerText()).includes('Gina Servidor'));
    await page.waitForTimeout(1000);
    assert.equal((await userRow(userId)).firstName, 'Gina Servidor', 'nada se sobrescribió');
    assert.equal((await idbAll(page, 'profile_changes'))[0].status, 'conflict');

    await page.getByRole('button', { name: 'Usar mis cambios' }).click();
    await waitFor('mi versión aplicada', async () => (await userRow(userId)).firstName === 'Gina Mía');
    await waitFor('resuelto', async () => (await idbAll(page, 'profile_changes')).length === 0);

    // Segunda vez: conservar la del servidor
    await goOffline(context);
    await page.goto(`${FRONT}/account`);
    await page.getByTestId('offline-account').waitFor();
    await saveOffline(page, { phone: '+591 71111111' });
    await queryRows(`UPDATE "${schema}".users SET phone='+591 72222222' WHERE id=$1`, [userId]);
    await goOnline(context);
    await page.getByText('Tu perfil cambió en otro dispositivo').waitFor({ timeout: 20000 });
    await page.getByRole('button', { name: 'Conservar los del servidor' }).click();
    await waitFor('descartado', async () => (await idbAll(page, 'profile_changes')).length === 0);
    await page.waitForTimeout(800);
    assert.equal((await userRow(userId)).phone, '+591 72222222');
    await expectValue(page, '#phone', '+591 72222222');
    await context.close();
  });

  it('P07: cerrar sesión borra la copia, conserva lo pendiente y nadie más ve los datos sin conexión', async () => {
    const userId = await newUser('Hilda', '+591 70000004');
    const other = await newUser('Iván');
    const { context, page } = await openContext();
    await signIn(page, persisted(userId));
    await loadProfileOnline(page, userId);
    // Cambio que no puede enviarse (API caída)
    await page.route('**/api/v1/users/me/sync', (route: any) => route.fulfill({ status: 503, body: '{}' }));
    await expectValue(page, '#phone', '+591 70000004');
    await page.locator('#phone').fill('+591 78888888');
    await page.getByRole('button', { name: 'Guardar cambios' }).click();
    await page.getByText('Guardado en este dispositivo', { exact: false }).first().waitFor();

    await page.getByRole('button', { name: 'Cerrar sesión' }).first().click();
    await waitFor('copia borrada', async () => (await idbAll(page, 'profile_snapshots')).length === 0);
    const pending = await idbAll(page, 'profile_changes');
    assert.equal(pending.length, 1, 'el pendiente sobrevive al cierre de sesión');
    assert.equal(pending[0].userId, userId);
    assert.deepEqual((await cacheUrls(page)).filter((u) => PRIVATE_CACHE.test(u)), []);

    // Sin sesión y sin conexión: aviso genérico
    await goOffline(context);
    await page.goto(`${FRONT}/account`);
    await page.getByRole('heading', { name: /sin conexión/i }).waitFor();
    assert.equal(await page.getByTestId('offline-account').count(), 0);
    let body = await page.locator('body').innerText();
    for (const secret of ['Hilda', '70000004', '78888888', userId]) assert.equal(body.includes(secret), false, secret);
    await goOnline(context);

    // Otra persona en el mismo dispositivo, luego sin conexión
    await page.unroute('**/api/v1/users/me/sync');
    await signIn(page, persisted(other));
    await page.goto(`${FRONT}/account`);
    await waitFor('perfil de Iván', async () => (await page.locator('#firstName').inputValue().catch(() => '')) === 'Iván');
    // Cerrar sesión vació las páginas guardadas: se espera a que el fallback /offline vuelva a estar en caché
    await waitFor('fallback offline precacheado de nuevo', () =>
      page.evaluate(async () => {
        const keys = await (await caches.open('sf-pages-v9')).keys();
        return keys.some((r) => r.url.includes('/offline') && r.url.includes('__sf_tenant='));
      }),
    );
    await goOffline(context);
    await page.goto(`${FRONT}/account`);
    await page.getByTestId('offline-account').waitFor();
    body = await page.locator('body').innerText();
    for (const secret of ['Hilda', '70000004', '78888888']) assert.equal(body.includes(secret), false, secret);
    await expectValue(page, '#firstName', 'Iván');
    await goOnline(context);
    await page.waitForTimeout(1500);
    assert.equal((await userRow(userId)).phone, '+591 70000004', 'el cambio de Hilda no salió con la sesión de Iván');
    await context.close();
  });

  it('P08: sin conexión se ven el carrito, la cuenta, la lista de pedidos y el detalle; tras cerrar sesión, nada', async () => {
    const userId = await newUser('Julia');
    const productId = await createProduct(schema, fx, { [fx.branchA]: { M: 5 } });
    // Pedido real hecho por la API con la sesión de Julia
    const api = new Api(`http://127.0.0.1:${API_PORT}`, tenant, accessOf(userId));
    await api.addToCart(productId, 1, 'M', fx.branchA);
    const created = await api.createOrder({ key: key(), cartVersion: await api.cartVersion(), items: [{ productId, quantity: 1, size: 'M' }], branchId: fx.branchA });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const orderId = created.body.data.id as string;
    const shortId = orderId.slice(0, 8).toUpperCase();
    // El pedido vació el carrito del servidor; en este dispositivo queda otro producto en el carrito local
    const otherProduct = await createProduct(schema, fx, { [fx.branchA]: { M: 5 } });

    const { context, page } = await openContext();
    await signIn(page, persisted(userId, { cart: { productId: otherProduct, name: 'Vestido Sin Red' } }));
    await loadProfileOnline(page, userId);
    // Con conexión: lista y detalle (quedan copiados en IndexedDB)
    await page.goto(`${FRONT}/account?tab=orders`);
    await page.getByText(`Pedido #${shortId}`).waitFor();
    await page.getByText(`Pedido #${shortId}`).click();
    await page.waitForURL(`**/account/orders/${orderId}`);
    await page.getByRole('heading', { name: `Pedido #${shortId}` }).waitFor();
    await waitFor('detalle copiado', async () => (await idbAll(page, 'orders_cache')).some((c) => c.userId === userId && c.details[orderId]));
    assert.deepEqual((await cacheUrls(page)).filter((u) => PRIVATE_CACHE.test(u)), [], 'pedidos nunca en Cache Storage');

    await goOffline(context);
    // Pantalla de cuenta, pestaña de pedidos
    await page.goto(`${FRONT}/account?tab=orders`);
    await page.getByTestId('offline-account').waitFor();
    await page.getByTestId('orders-offline-copy').waitFor();
    await page.getByText(`Pedido #${shortId}`).waitFor();
    // Navegar al detalle desde la lista, sin red
    await page.getByText(`Pedido #${shortId}`).click();
    await page.waitForURL(`**/account/orders/${orderId}`);
    await page.getByTestId('order-offline-copy').waitFor({ timeout: 15000 });
    await page.getByRole('heading', { name: `Pedido #${shortId}` }).waitFor();
    // Perfil (pestaña por defecto) y carrito
    await page.goto(`${FRONT}/account`);
    await expectValue(page, '#firstName', 'Julia');
    await page.goto(`${FRONT}/cart`);
    await page.getByText('Vestido Sin Red').first().waitFor({ timeout: 15000 });
    await goOnline(context);

    // Cerrar sesión: la copia de pedidos se borra y sin red no se ve nada de Julia
    await page.goto(`${FRONT}/account`);
    await page.getByRole('button', { name: 'Cerrar sesión' }).first().click();
    await waitFor('copia de pedidos borrada', async () => (await idbAll(page, 'orders_cache')).length === 0);
    await goOffline(context);
    await page.goto(`${FRONT}/account?tab=orders`);
    await page.getByRole('heading', { name: /sin conexión/i }).waitFor();
    assert.equal(await page.getByTestId('offline-account').count(), 0);
    const body = await page.locator('body').innerText();
    for (const secret of ['Julia', shortId]) assert.equal(body.includes(secret), false, secret);
    await page.goto(`${FRONT}/account/orders/${orderId}`);
    await page.getByRole('heading', { name: /sin conexión/i }).waitFor();
    assert.equal((await page.locator('body').innerText()).includes(shortId), false);
    await context.close();
  });

  it('P09: entra al perfil sin red aunque nunca haya abierto "Mi cuenta" con conexión', async () => {
    const userId = await newUser('Karen', '+591 70000005');
    const { context, page } = await openContext();
    await signIn(page, persisted(userId));
    // Con conexión solo navega el inicio: la cabecera refresca el perfil y deja la copia
    await page.goto(`${FRONT}/`);
    await swReady(page);
    await page.goto(`${FRONT}/`);
    await waitFor('copia guardada al navegar', async () => (await idbAll(page, 'profile_snapshots')).some((s) => s.userId === userId && s.values.phone === '+591 70000005'));
    await waitFor('fallback offline precacheado', () =>
      page.evaluate(async () => {
        const keys = await (await caches.open('sf-pages-v9')).keys();
        return keys.some((r) => r.url.includes('/offline') && r.url.includes('__sf_tenant='));
      }),
    );

    await goOffline(context);
    // Clic en el ícono de la cabecera, sin red
    await page.getByRole('link', { name: 'Mi cuenta' }).first().click();
    await page.getByTestId('offline-account').waitFor({ timeout: 15000 });
    await expectValue(page, '#firstName', 'Karen');
    await expectValue(page, '#phone', '+591 70000005');

    // Caso extremo: sin ninguna copia en IndexedDB, sale de la sesión guardada en el dispositivo
    await page.evaluate(
      (name: string) =>
        new Promise<void>((resolve) => {
          const open = indexedDB.open(name);
          open.onsuccess = () => {
            const tx = open.result.transaction('profile_snapshots', 'readwrite');
            tx.objectStore('profile_snapshots').clear();
            tx.oncomplete = () => {
              open.result.close();
              resolve();
            };
          };
        }),
      `stella-femme-offline:${tenant}`,
    );
    await page.goto(`${FRONT}/account`);
    await page.getByTestId('offline-account').waitFor({ timeout: 15000 });
    await expectValue(page, '#firstName', 'Karen');
    assert.equal(await page.locator('#email').inputValue(), `${userId}@test.local`);
    await context.close();
  });
});

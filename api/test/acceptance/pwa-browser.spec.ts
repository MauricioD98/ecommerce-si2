import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { JwtService } from '@nestjs/jwt';
import { FakeStripe } from './support/fake-stripe';
import { TENANT_A, TENANT_B, createProduct, createUser, queryRows, seedTenant, spawnReplica, type Fixture } from './support/world';

// PWA en Chromium real contra el build de PRODUCCIÓN del front (`next build` previo, con NEXT_PUBLIC_API_URL
// apuntando a API_PORT). Solo corre con PLAYWRIGHT_MODULE y FRONT_DIR definidos.
const PLAYWRIGHT = process.env.PLAYWRIGHT_MODULE;
const FRONT_DIR = process.env.FRONT_DIR;
const API_PORT = 39200;
const FRONT_PORT = 39300;
const FRONT = `http://localhost:${FRONT_PORT}`;
const API = `http://127.0.0.1:${API_PORT}/api/v1`;
const schema = TENANT_A.schemaName;
const tenant = TENANT_A.tenantId;
const PRODUCT_NAME = 'P';

describe('PWA en navegador real', { skip: !PLAYWRIGHT || !FRONT_DIR }, () => {
  let chromium: any;
  let browser: any;
  let fx: Fixture;
  let stripe: FakeStripe;
  let replica: Awaited<ReturnType<typeof spawnReplica>>;
  let front: ChildProcess;
  const jwt = new JwtService({ secret: process.env.JWT_SECRET });

  const tokenOf = (userId: string, tenantId = tenant) =>
    jwt.sign({ sub: userId, email: `${userId}@test.local`, role: 'CLIENTE', permissions: [], tenantId }, { secret: process.env.JWT_SECRET, expiresIn: 3600 });

  const persisted = (userId: string, opts: { productId?: string; quantity?: number; price?: number; tenantId?: string } = {}) => {
    const { productId, quantity = 1, price = 100, tenantId = tenant } = opts;
    const items = productId
      ? [{ id: `${productId}-M`, cartId: 'local', productId, product: { id: productId, name: PRODUCT_NAME, price, stock: 50, sizes: ['M'], sku: 's', isActive: true }, price, quantity, selectedSize: 'M' }]
      : [];
    return JSON.stringify({
      auth: JSON.stringify({ accessToken: tokenOf(userId, tenantId), refreshToken: 'r', user: { id: userId, email: `${userId}@test.local`, role: 'CLIENTE', permissions: [] }, esAutenticado: true }),
      cart: JSON.stringify({ items, totalItems: quantity, totalPrice: price * quantity }),
      branch: JSON.stringify({ selectedBranchId: fx.branchA }),
      _persist: JSON.stringify({ version: -1, rehydrated: true }),
    });
  };

  // Sesión sembrada en el navegador. Fuera de localhost todo se bloquea: el navegador no sale a internet.
  const openContext = async () => {
    const context = await browser.newContext({ locale: 'es-BO', serviceWorkers: 'allow' });
    await context.addCookies([{ name: 'NEXT_LOCALE', value: 'es', url: FRONT }]);
    await context.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (route: any) => route.abort());
    const page = await context.newPage();
    return { context, page };
  };

  // Desde un recurso sin la app: en una página viva, redux-persist volvería a escribir su propio estado encima.
  // No /favicon.ico: con context.route activo, Playwright aborta toda petición a */favicon.ico (ERR_ABORTED).
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
  const goOffline = async (context: any) => {
    await context.setOffline(true);
    await context.route(/localhost:39300/, (route: any) => route.abort('internetdisconnected'));
  };
  const goOnline = async (context: any) => {
    await context.unroute(/localhost:39300/);
    await context.setOffline(false);
  };

  const toPayment = async (page: any) => {
    await page.goto(`${FRONT}/checkout`);
    await page.getByText('Retiro en tienda', { exact: true }).click();
    await page.getByRole('button', { name: 'Continuar al pago' }).click();
  };

  const ordersOf = async (userId: string) => queryRows(`SELECT * FROM "${schema}".orders WHERE "userId"=$1`, [userId]);

  const idbAttempts = (page: any, tenantId = tenant) =>
    page.evaluate(
      (name: string) =>
        new Promise((resolve, reject) => {
          const open = indexedDB.open(name);
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const db = open.result;
            if (!db.objectStoreNames.contains('checkout_attempts')) return resolve([]);
            const all = db.transaction('checkout_attempts').objectStore('checkout_attempts').getAll();
            all.onsuccess = () => {
              db.close();
              resolve(all.result);
            };
          };
        }),
      `stella-femme-offline:${tenantId}`,
    );

  const swReady = (page: any) =>
    page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) {
        await new Promise((resolve) => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
      }
    });

  before(async () => {
    process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = '1';
    stripe = new FakeStripe();
    const stripeBase = await stripe.start();
    fx = await seedTenant(schema);
    // El front muestra Bs y solo ofrece tarjeta si la API cobra en "bob" (CheckoutClient): support/env.ts fija
    // "usd" para las suites de mecánica de cobro, pero aquí se prueba el front real con la moneda de producción.
    replica = await spawnReplica(API_PORT, { STRIPE_API_BASE: stripeBase, ALLOWED_ORIGINS: FRONT, PAYMENT_CURRENCY: 'bob' });
    const nextBin = join(FRONT_DIR!, 'node_modules', 'next', 'dist', 'bin', 'next');
    front = spawn(process.execPath, [nextBin, 'start', '-p', String(FRONT_PORT)], {
      cwd: FRONT_DIR!,
      env: { ...process.env, NODE_ENV: 'production', NEXT_PUBLIC_API_URL: API, API_INTERNAL_URL: API, NEXT_PUBLIC_TENANT_ID: '', DATABASE_URL: '', DIRECT_URL: '' },
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
    await stripe?.stop();
  });

  it('U08: manifest e íconos válidos, con identidad por tienda, e instalable según Chromium', async () => {
    await seedTenant(TENANT_B.schemaName);
    const manifest = await (await fetch(`${FRONT}/web-manifest?tenant=${tenant}`)).json();
    const other = await (await fetch(`${FRONT}/web-manifest?tenant=${TENANT_B.tenantId}`)).json();
    assert.equal(manifest.name, 'alpha');
    assert.equal(other.name, 'beta');
    assert.notEqual(manifest.id, other.id);
    assert.equal(manifest.scope, '/');
    assert.ok(manifest.start_url.includes(tenant));
    assert.equal(manifest.display, 'standalone');

    const png = async (src: string) => {
      const res = await fetch(`${FRONT}${src}`);
      const bytes = Buffer.from(await res.arrayBuffer());
      assert.equal(res.headers.get('content-type'), 'image/png', src);
      assert.equal(bytes.subarray(1, 4).toString(), 'PNG', src);
      return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
    };
    for (const icon of manifest.icons) {
      const size = Number(icon.sizes.split('x')[0]);
      assert.deepEqual(await png(icon.src), [size, size]);
    }
    assert.ok(manifest.icons.some((i: any) => i.purpose === 'maskable' && i.sizes === '512x512'));
    assert.deepEqual(await png(`/pwa-icon/180?tenant=${tenant}`), [180, 180]);

    const { context, page } = await openContext();
    await page.goto(`${FRONT}/?tenant=${tenant}`);
    await swReady(page);
    await page.waitForTimeout(800);
    // router.refresh puede repetir el enlace al fijar la tienda: da igual mientras todos sean de ESTA tienda
    const manifestLinks: string[] = await page.locator('link[rel="manifest"]').evaluateAll((links: HTMLLinkElement[]) => links.map((l) => l.href));
    assert.ok(manifestLinks.length > 0 && manifestLinks.every((href) => href.includes(tenant)), manifestLinks.join());
    assert.ok(await page.locator('link[rel="apple-touch-icon"]').count());
    const cdp = await context.newCDPSession(page);
    const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
    assert.deepEqual(installabilityErrors, [], JSON.stringify(installabilityErrors));
    await context.close();
  });

  it('U01: se corta la respuesta tras el commit, se cierra y se reabre: misma compra, sin otra', async () => {
    const userId = await createUser(schema, fx);
    const productId = await createProduct(schema, fx, { [fx.branchA]: { M: 5 } });
    const { context, page } = await openContext();
    await signIn(page, persisted(userId, { productId }));

    // La petición llega y se confirma, pero el navegador nunca ve la respuesta
    let cut = 0;
    await page.route('**/api/v1/orders', async (route: any) => {
      if (route.request().method() !== 'POST') return route.continue();
      cut += 1;
      await route.fetch();
      await route.abort('connectionreset');
    });
    await toPayment(page);
    await page.getByText('Estamos verificando tu compra', { exact: false }).first().waitFor();
    for (let i = 0; i < 40 && (await ordersOf(userId)).length === 0; i += 1) await page.waitForTimeout(100);
    assert.ok(cut >= 1);
    assert.equal((await ordersOf(userId)).length, 1, 'el servidor sí confirmó');
    const [attempt] = (await idbAttempts(page)) as any[];
    assert.ok(['IN_DOUBT', 'CONFIRMED'].includes(attempt.state), attempt.state);
    assert.equal(attempt.payload.cartVersion > 0, true);
    assert.equal(JSON.stringify(attempt).includes('secret'), false);
    assert.equal(JSON.stringify(attempt).includes('Bearer'), false);

    // Se cierra la pestaña y se reabre sin el corte
    await page.close();
    const reopened = await context.newPage();
    await reopened.goto(`${FRONT}/checkout`);
    await reopened.waitForFunction(async () => {
      const dbs = await indexedDB.databases();
      return dbs.length > 0;
    });
    for (let i = 0; i < 40; i += 1) {
      const [current] = (await idbAttempts(reopened)) as any[];
      if (current?.state === 'CONFIRMED') break;
      await reopened.waitForTimeout(500);
      await reopened.evaluate(() => window.dispatchEvent(new Event('online')));
    }
    const [recovered] = (await idbAttempts(reopened)) as any[];
    assert.equal(recovered.state, 'CONFIRMED');
    const orders = await ordersOf(userId);
    assert.equal(orders.length, 1, 'sin compra duplicada');
    assert.equal(recovered.orderId, orders[0].id);
    assert.equal(recovered.attemptId, attempt.attemptId, 'misma clave');
    await context.close();
  });

  it('U02: cambiar de usuario o tienda con un intento pendiente no muestra ni envía nada cruzado', async () => {
    const [userA, userB] = [await createUser(schema, fx), await createUser(schema, fx)];
    const productId = await createProduct(schema, fx, { [fx.branchA]: { M: 5 } });
    const { context, page } = await openContext();
    await signIn(page, persisted(userA, { productId }));
    await page.route('**/api/v1/orders', (route: any) => (route.request().method() === 'POST' ? route.abort('connectionreset') : route.continue()));
    await toPayment(page);
    await page.getByText('Estamos verificando tu compra', { exact: false }).first().waitFor();
    assert.equal((await idbAttempts(page)).length, 1);
    await page.unroute('**/api/v1/orders');

    // Entra la cuenta B en el mismo navegador
    const posts: string[] = [];
    page.on('request', (r: any) => {
      if (r.method() === 'POST' && r.url().endsWith('/api/v1/orders')) posts.push(r.headers().authorization ?? '');
    });
    await signIn(page, persisted(userB));
    await page.goto(`${FRONT}/cart`);
    await page.waitForTimeout(2500);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.waitForTimeout(1500);
    assert.equal(await page.getByText('Estamos verificando tu compra', { exact: false }).count(), 0);
    assert.equal(posts.length, 0, 'nada se envía bajo otra identidad');
    assert.equal((await ordersOf(userB)).length, 0);
    assert.equal((await idbAttempts(page)).length, 1, 'la referencia de A no se borra');

    // La misma cuenta en otra tienda usa otra base: no ve el intento
    assert.equal((await idbAttempts(page, TENANT_B.tenantId)).length, 0);

    // A vuelve y su intento se recupera
    await signIn(page, persisted(userA, { productId }));
    await page.goto(`${FRONT}/checkout`);
    for (let i = 0; i < 40 && (await ordersOf(userA)).length === 0; i += 1) {
      await page.waitForTimeout(500);
      await page.evaluate(() => window.dispatchEvent(new Event('online')));
    }
    assert.equal((await ordersOf(userA)).length, 1);
    await context.close();
  });

  it('U03: IndexedDB falla o está lleno: no afirma guardado ni envía; borrado: el servidor conserva la compra', async () => {
    const userId = await createUser(schema, fx);
    const productId = await createProduct(schema, fx, { [fx.branchA]: { M: 5 } });
    const { context, page } = await openContext();
    await context.addInitScript(() => {
      const original = IDBObjectStore.prototype.add;
      IDBObjectStore.prototype.add = function (...args: any[]) {
        if (this.name === 'checkout_attempts' && (window as any).__failIdb !== false) throw new DOMException('lleno', 'QuotaExceededError');
        return original.apply(this, args as never);
      };
    });
    await signIn(page, persisted(userId, { productId }));
    let posts = 0;
    page.on('request', (r: any) => {
      if (r.method() === 'POST' && r.url().endsWith('/api/v1/orders')) posts += 1;
    });
    await toPayment(page);
    await page.getByText('almacenamiento de este dispositivo está lleno', { exact: false }).first().waitFor();
    assert.equal(posts, 0, 'sin intento guardado no se envía');
    assert.equal((await ordersOf(userId)).length, 0);
    await context.close();

    // Almacenamiento borrado tras enviar: la compra sigue en el servidor y no se repite
    const second = await openContext();
    const user2 = await createUser(schema, fx);
    await signIn(second.page, persisted(user2, { productId }));
    await toPayment(second.page);
    for (let i = 0; i < 40 && (await ordersOf(user2)).length === 0; i += 1) await second.page.waitForTimeout(250);
    assert.equal((await ordersOf(user2)).length, 1);
    await second.page.evaluate((name: string) => indexedDB.deleteDatabase(name), `stella-femme-offline:${tenant}`);
    await second.page.goto(`${FRONT}/cart`);
    await second.page.waitForTimeout(1500);
    assert.equal((await ordersOf(user2)).length, 1);
    await second.context.close();
  });

  it('U04: borrador offline; si cambia el precio se revisa y confirma, nunca se envía solo', async () => {
    const userId = await createUser(schema, fx);
    const productId = await createProduct(schema, fx, { [fx.branchA]: { M: 5 } }, 100);
    const { context, page } = await openContext();
    await signIn(page, persisted(userId, { productId }));
    await page.goto(`${FRONT}/checkout`);
    await swReady(page);
    // Deja el SW en control y la página de destino guardada antes de cortar la red
    await page.goto(`${FRONT}/checkout`);
    await page.waitForFunction(async () => {
      const keys = await (await caches.open('sf-pages-v9')).keys();
      return keys.some((request) => request.url.includes('/checkout/offline-success') && request.url.includes('__sf_tenant='));
    });
    await page.getByText('Retiro en tienda', { exact: true }).click();
    await goOffline(context);
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await page.getByRole('button', { name: 'Continuar al pago' }).click();
    await page.getByRole('button', { name: /guardar/i }).first().click();
    await page.getByText('Borrador guardado. Compra aún no realizada').waitFor();

    const posts: string[] = [];
    page.on('request', (r: any) => {
      if (r.method() === 'POST' && r.url().endsWith('/api/v1/orders')) posts.push(r.url());
    });
    await queryRows(`UPDATE "${schema}".products SET price=130 WHERE id=$1`, [productId]);
    await goOnline(context);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.waitForTimeout(2500);
    assert.equal(posts.length, 0, 'volver la conexión no crea ninguna compra');
    assert.equal((await ordersOf(userId)).length, 0);

    await page.goto(`${FRONT}/checkout/drafts`);
    await page.getByRole('button', { name: 'Revisar y confirmar' }).click();
    await page.waitForURL('**/checkout');
    await page.getByText('Retiro en tienda', { exact: true }).click();
    await page.getByRole('button', { name: 'Continuar al pago' }).click();
    for (let i = 0; i < 40 && (await ordersOf(userId)).length === 0; i += 1) await page.waitForTimeout(250);
    const orders = await ordersOf(userId);
    assert.equal(orders.length, 1);
    assert.equal(Number(orders[0].totalAmount), 130, 'se compró al precio vigente revisado');
    for (let i = 0; i < 20; i += 1) {
      const drafts = await page.evaluate(
        (name: string) =>
          new Promise<number>((resolve) => {
            const open = indexedDB.open(name);
            open.onsuccess = () => {
              const count = open.result.transaction('order_drafts').objectStore('order_drafts').count();
              count.onsuccess = () => resolve(count.result);
            };
          }),
        `stella-femme-offline:${tenant}`,
      );
      if (drafts === 0) break;
      assert.ok(i < 19, 'el borrador se elimina al existir la orden');
      await page.waitForTimeout(250);
    }
    await context.close();
  });

  it('U05: cola antigua sin propietario: se conserva como borrador y no se reenvía', async () => {
    const userId = await createUser(schema, fx);
    const productId = await createProduct(schema, fx, { [fx.branchA]: { M: 5 } });
    const { context, page } = await openContext();
    // Sin la app cargada: ella crearía la base en la versión nueva antes de sembrar la vieja
    await page.goto(NEUTRAL_PAGE);
    await page.evaluate(
      ([name, pid]: string[]) =>
        new Promise<void>((resolve, reject) => {
          // Estado de la versión anterior: base v2 con la tienda "orders"
          const open = indexedDB.open(name, 2);
          open.onupgradeneeded = () => {
            open.result.createObjectStore('orders', { keyPath: 'id' });
            open.result.createObjectStore('inventory_queue', { keyPath: 'id' });
          };
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const tx = open.result.transaction('orders', 'readwrite');
            tx.objectStore('orders').add({ id: 'legacy-1', payload: { items: [{ productId: pid, quantity: 1, selectedSize: 'M' }], fulfillmentType: 'PICKUP', paymentMethod: 'QR' }, createdAt: '2026-01-01T00:00:00.000Z', status: 'pending' });
            tx.oncomplete = () => {
              open.result.close();
              resolve();
            };
          };
        }),
      [`stella-femme-offline:${tenant}`, productId],
    );
    await signIn(page, persisted(userId));
    const posts: string[] = [];
    page.on('request', (r: any) => {
      if (r.method() === 'POST' && r.url().endsWith('/api/v1/orders')) posts.push(r.url());
    });
    await page.goto(`${FRONT}/checkout/drafts`);
    await page.getByText('sin cuenta asociada', { exact: false }).waitFor();
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.waitForTimeout(2000);
    assert.equal(posts.length, 0, 'sin reenvío ciego');
    assert.equal((await ordersOf(userId)).length, 0);
    await context.close();
  });

  it('U06: SW viejo y deploy nuevo: limpia cachés privadas, avisa sin recargar y no pierde el intento', async () => {
    const userId = await createUser(schema, fx);
    const productId = await createProduct(schema, fx, { [fx.branchA]: { M: 5 } });
    const { context, page } = await openContext();
    let swVersion = '';
    await context.route('**/sw.js', async (route: any) => {
      const response = await route.fetch();
      await route.fulfill({ response, body: `${await response.text()}\n// ${swVersion}` });
    });

    // Caché privada que dejó la versión anterior
    await signIn(page, persisted(userId, { productId }));
    const hadLegacy = await page.evaluate(async () => {
      for (const registration of await navigator.serviceWorker.getRegistrations()) await registration.unregister();
      const legacy = await caches.open('sf-api-v8');
      await legacy.put('/api/v1/orders/me', new Response('{"privado":true}'));
      return caches.has('sf-api-v8');
    });
    assert.equal(hadLegacy, true);
    await page.goto(`${FRONT}/checkout`);
    await swReady(page);
    for (let i = 0; i < 20 && (await page.evaluate(() => caches.has('sf-api-v8'))); i += 1) await page.waitForTimeout(250);
    assert.equal(await page.evaluate(() => caches.has('sf-api-v8')), false, 'caché privada anterior eliminada');

    // Compra en curso: intento persistido, resultado incierto
    await page.route('**/api/v1/orders', (route: any) => (route.request().method() === 'POST' ? route.abort('connectionreset') : route.continue()));
    await page.getByText('Retiro en tienda', { exact: true }).click();
    await page.getByRole('button', { name: 'Continuar al pago' }).click();
    await page.getByText('Estamos verificando tu compra', { exact: false }).first().waitFor();
    const before = (await idbAttempts(page)) as any[];
    assert.equal(before.length, 1);

    // Deploy nuevo: otro sw.js. Queda esperando; la página NO se recarga sola
    let navigations = 0;
    page.on('framenavigated', (frame: any) => {
      if (frame === page.mainFrame()) navigations += 1;
    });
    swVersion = 'deploy-2';
    const state = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration('/sw.js');
      await registration!.update();
      for (let i = 0; i < 60; i += 1) {
        if (registration!.waiting) return 'waiting';
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      return registration!.installing ? 'installing' : 'none';
    });
    assert.equal(state, 'waiting');
    await page.waitForTimeout(1000);
    assert.equal(navigations, 0, 'sin recarga destructiva');
    const after = (await idbAttempts(page)) as any[];
    assert.equal(after[0].attemptId, before[0].attemptId);

    // La API nueva sigue atendiendo a esta pestaña vieja, con la misma clave
    await page.unroute('**/api/v1/orders');
    for (let i = 0; i < 40 && (await ordersOf(userId)).length === 0; i += 1) {
      await page.waitForTimeout(500);
      await page.evaluate(() => window.dispatchEvent(new Event('online')));
    }
    assert.equal((await ordersOf(userId)).length, 1);
    assert.equal(navigations, 0);
    await context.close();
  });

  it('U07: offline tras ver perfil y pedidos y cambiar de cuenta: nada privado en caché ni en pantalla', async () => {
    const userId = await createUser(schema, fx);
    const { context, page } = await openContext();
    await signIn(page, persisted(userId));
    await page.goto(`${FRONT}/account`);
    await swReady(page);
    await page.goto(`${FRONT}/account`);
    const token = tokenOf(userId);
    const status = await page.evaluate(
      async ([api, t, tid]: string[]) => {
        const headers = { authorization: `Bearer ${t}`, 'x-tenant-id': tid };
        const orders = await fetch(`${api}/orders/me`, { headers });
        await fetch(`${api}/auth/profile`, { headers });
        await fetch(`${api}/cart`, { headers });
        await fetch(`${api}/products`, { headers: { 'x-tenant-id': tid } });
        return orders.status;
      },
      [API, token, tenant],
    );
    assert.equal(status, 200);
    await page.waitForTimeout(500);

    const keys: string[] = await page.evaluate(async () => {
      const out: string[] = [];
      for (const name of await caches.keys()) {
        for (const request of await (await caches.open(name)).keys()) out.push(request.url);
      }
      return out;
    });
    const privatePattern = /\/api\/v1\/(orders|auth|cart|payments|users|checkout-ops)|\/account|\/admin|\/plataforma|\/auth\//;
    assert.deepEqual(keys.filter((url) => privatePattern.test(url)), []);
    assert.ok(keys.some((url) => url.includes('/api/v1/products') && url.includes('__sf_tenant=')), 'el catálogo público sí se guarda, por tienda');

    await goOffline(context);
    await page.goto(`${FRONT}/account`);
    const body = await page.locator('body').innerText();
    assert.ok(/sin conexión/i.test(body), body.slice(0, 200));
    assert.ok(await page.getByRole('heading', { name: /sin conexión/i }).count(), 'es el fallback genérico, no la cuenta');
    assert.equal(body.includes(userId), false);
    const rsc = await page.evaluate(async () => (await fetch('/account?_rsc=abc', { headers: { rsc: '1' } })).status);
    assert.equal(rsc, 503);
    await goOnline(context);

    // Cerrar sesión purga también páginas guardadas
    await page.goto(`${FRONT}/offline`);
    await swReady(page);
    await page.evaluate(() => navigator.serviceWorker.controller!.postMessage({ type: 'CLEAR_USER_CACHE' }));
    await page.waitForTimeout(500);
    const left: string[] = await page.evaluate(async () => {
      const out: string[] = [];
      for (const name of await caches.keys()) {
        if (!name.startsWith('sf-pages') && !name.startsWith('sf-public-api')) continue;
        for (const request of await (await caches.open(name)).keys()) out.push(request.url);
      }
      return out;
    });
    // La app puede volver a pedir el catálogo público enseguida; ninguna página de la sesión anterior sobrevive
    assert.deepEqual(left.filter((url) => !url.includes('/api/v1/')), []);
    await context.close();
  });
});

import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { JwtService } from '@nestjs/jwt';
import { FakeStripe } from './support/fake-stripe';
import { TENANT_A, createProduct, createUser, queryRows, seedTenant, spawnReplica, withSql, type Fixture } from './support/world';

// Checkout por QR bancario en Chromium real contra el build de PRODUCCIÓN del front (`next build` previo, con
// NEXT_PUBLIC_API_URL apuntando a API_PORT). Solo corre con PLAYWRIGHT_MODULE y FRONT_DIR definidos;
// CHROMIUM_PATH es opcional (binario de Chromium si la revisión instalada no coincide con Playwright).
// Datos de demostración; el navegador no sale de localhost, Stripe es el falso y no hay SMTP.
const PLAYWRIGHT = process.env.PLAYWRIGHT_MODULE;
const FRONT_DIR = process.env.FRONT_DIR;
const SHOTS = process.env.SCREENSHOT_DIR;
const API_PORT = 39200;
const FRONT_PORT = 39300;
const FRONT = `http://localhost:${FRONT_PORT}`;
const API = `http://127.0.0.1:${API_PORT}/api/v1`;
const schema = TENANT_A.schemaName;
const tenant = TENANT_A.tenantId;
const NAME = 'Vestido negro (demo)';
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]);

describe('Checkout QR bancario en navegador real', { skip: !PLAYWRIGHT || !FRONT_DIR }, () => {
  let browser: any;
  let fx: Fixture;
  let stripe: FakeStripe;
  let replica: Awaited<ReturnType<typeof spawnReplica>>;
  let front: ChildProcess;
  let previousPlan: string;
  const jwt = new JwtService({ secret: process.env.JWT_SECRET });
  const tokenOf = (userId: string, permissions: string[] = [], role = 'CLIENTE') =>
    jwt.sign({ sub: userId, email: `${userId}@test.local`, role, permissions, tenantId: tenant }, { secret: process.env.JWT_SECRET, expiresIn: 3600 });

  // Carrito con el mismo producto en dos tallas: M x2 y L x1 (Bs 100 c/u)
  const persisted = (userId: string, productId: string) => {
    const product = { id: productId, name: NAME, price: 100, stock: 10, sizes: ['M', 'L'], stockBySize: [{ size: 'M', stock: 5 }, { size: 'L', stock: 5 }], sku: 's', isActive: true };
    const items = [
      { id: `${productId}-M`, cartId: 'local', productId, product, price: 100, quantity: 2, selectedSize: 'M' },
      { id: `${productId}-L`, cartId: 'local', productId, product, price: 100, quantity: 1, selectedSize: 'L' },
    ];
    return JSON.stringify({
      auth: JSON.stringify({ accessToken: tokenOf(userId), refreshToken: 'r', user: { id: userId, email: `${userId}@test.local`, role: 'CLIENTE', permissions: [] }, esAutenticado: true }),
      cart: JSON.stringify({ items, totalItems: 3, totalPrice: 300 }),
      branch: JSON.stringify({ selectedBranchId: fx.branchA }),
      _persist: JSON.stringify({ version: -1, rehydrated: true }),
    });
  };

  const openContext = async (locale = 'es', viewport = { width: 1280, height: 900 }) => {
    const context = await browser.newContext({ locale, viewport, serviceWorkers: 'block' });
    await context.addCookies([{ name: 'NEXT_LOCALE', value: locale, url: FRONT }]);
    await context.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (route: any) => route.abort());
    return { context, page: await context.newPage() };
  };

  const signIn = async (page: any, state: string) => {
    await page.goto(`${FRONT}/file.svg`);
    await page.evaluate(
      ([k, v, t]: string[]) => {
        localStorage.setItem('sf_tenant_id', t);
        localStorage.setItem(k, v);
      },
      [`persist:root:${tenant}`, state, tenant],
    );
  };

  // Comprador nuevo con su carrito, en el paso de pago con "QR bancario" elegido
  const toBankQr = async (page: any) => {
    const userId = await createUser(schema, fx);
    const productId = await createProduct(schema, fx, { [fx.branchA]: { M: 5, L: 5 } });
    await withSql((c) => c.query(`UPDATE "${schema}".products SET name=$2 WHERE id=$1`, [productId, NAME]));
    await signIn(page, persisted(userId, productId));
    await page.goto(`${FRONT}/checkout`);
    await page.getByText('Retiro en tienda', { exact: true }).click();
    await page.getByRole('button', { name: 'Continuar al pago' }).click();
    await page.getByText('QR bancario', { exact: true }).click();
    await page.getByRole('button', { name: 'Ya realicé la transferencia' }).waitFor();
    return { userId, productId };
  };

  const ordersOf = (userId: string) => queryRows(`SELECT id,status,"paymentStatus" FROM "${schema}".orders WHERE "userId"=$1`, [userId]);
  const proofOf = async (orderId: string) => (await queryRows(`SELECT status,"txId","imageType" FROM "${schema}".payment_proofs WHERE "orderId"=$1`, [orderId]))[0];
  const shot = async (page: any, name: string) => {
    if (SHOTS) await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });
  };

  // El paso 3 con los datos del pedido del servidor
  const assertConfirmation = async (page: any, status = 'Pendiente de verificación') => {
    await page.getByText(status, { exact: true }).waitFor({ timeout: 15_000 });
    const text: string = await page.locator('main, body').first().innerText();
    assert.match(text, /Talla M · Cantidad: 2/);
    assert.match(text, /Talla L · Cantidad: 1/);
    assert.match(text, /Bs\s?300[.,]00/);
    assert.doesNotMatch(text, /Artículos \(0\)/);
    return text;
  };

  before(async () => {
    const [row] = await queryRows(`SELECT plan FROM public.tenants WHERE id=$1`, [tenant]);
    previousPlan = row.plan;
    await queryRows(`UPDATE public.tenants SET plan='pro' WHERE id=$1`, [tenant]);
    stripe = new FakeStripe();
    const stripeBase = await stripe.start();
    fx = await seedTenant(schema);
    await withSql((c) =>
      c.query(
        `INSERT INTO "${schema}".payment_settings (id,"qrEnabled","qrImage","qrImageType","updatedAt") VALUES ('default',true,$1,'image/png',now())
         ON CONFLICT (id) DO UPDATE SET "qrEnabled"=true,"qrImage"=$1,"qrImageType"='image/png'`,
        [PNG],
      ),
    );
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
    const { chromium } = require(PLAYWRIGHT!);
    browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  });

  after(async () => {
    await browser?.close();
    front?.kill();
    await replica?.stop();
    await stripe?.stop();
    await queryRows(`UPDATE public.tenants SET plan=$2 WHERE id=$1`, [tenant, previousPlan]);
  });

  it('B01: sin imagen avanza al paso 3 con el pedido del servidor; recargar no duplica; "Ver mi pedido"', async () => {
    const { context, page } = await openContext();
    const { userId } = await toBankQr(page);
    await shot(page, 'desktop-paso2-qr');
    await page.getByRole('button', { name: 'Ya realicé la transferencia' }).click();

    await page.getByRole('heading', { name: 'Pedido enviado — pago pendiente de verificación' }).waitFor({ timeout: 15_000 });
    const text = await assertConfirmation(page);
    assert.doesNotMatch(text, /Pago confirmado|Pagado/);
    await shot(page, 'desktop-paso3');

    const orders = await ordersOf(userId);
    assert.equal(orders.length, 1);
    assert.deepEqual([orders[0].status, orders[0].paymentStatus], ['PENDIENTE', 'PENDIENTE']);
    assert.deepEqual(await proofOf(orders[0].id), { status: 'PENDIENTE', txId: null, imageType: null });
    // El número de pedido mostrado es el del servidor
    const [{ orderNumber }] = await queryRows(`SELECT "orderNumber" FROM "${schema}".orders WHERE id=$1`, [orders[0].id]);
    assert.ok(text.includes(orderNumber), 'falta el número de pedido');

    // Recarga y "volver atrás": sigue en la confirmación y no hay otro pedido
    await page.reload();
    await assertConfirmation(page);
    await page.goBack().catch(() => undefined);
    await page.goto(`${FRONT}/checkout`);
    await assertConfirmation(page);
    assert.equal((await ordersOf(userId)).length, 1);

    await page.getByRole('link', { name: 'Ver mi pedido' }).click();
    await page.waitForURL(new RegExp(`/account/orders/${orders[0].id}$`));
    await context.close();
  });

  it('B02: si el envío falla se queda en el paso de pago, sin confirmación falsa', async () => {
    const { context, page } = await openContext();
    const { userId } = await toBankQr(page);
    await page.route(/\/payment-proof$/, (route: any) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ statusCode: 500, message: 'Error simulado' }) }),
    );
    await page.getByRole('button', { name: 'Ya realicé la transferencia' }).click();
    await page.getByText(/Error simulado|No se pudo enviar/).first().waitFor({ timeout: 15_000 });
    const text: string = await page.locator('body').innerText();
    assert.doesNotMatch(text, /Pedido enviado|Recibimos tu aviso/);
    assert.ok(await page.getByRole('button', { name: 'Ya realicé la transferencia' }).isVisible());
    await shot(page, 'desktop-error');

    // El pedido existe (reserva el stock) pero sin aviso; reintentar usa el MISMO pedido
    const before = await ordersOf(userId);
    assert.equal(before.length, 1);
    assert.equal(await proofOf(before[0].id), undefined);
    await page.unroute(/\/payment-proof$/);
    await page.getByRole('button', { name: 'Ya realicé la transferencia' }).click();
    await page.getByRole('heading', { name: 'Pedido enviado — pago pendiente de verificación' }).waitFor({ timeout: 15_000 });
    assert.equal((await ordersOf(userId)).length, 1);
    await context.close();
  });

  it('B03: con referencia e imagen; la aprobación de la tienda se refleja al recargar', async () => {
    const { context, page } = await openContext();
    const { userId } = await toBankQr(page);
    const reference = `BNB-${Date.now()}`;
    await page.getByLabel('Referencia de la transferencia (opcional)').fill(reference);
    await page.locator('input[type=file]').setInputFiles({ name: 'comprobante.png', mimeType: 'image/png', buffer: PNG });
    await page.getByRole('button', { name: 'Ya realicé la transferencia' }).click();
    await page.getByRole('heading', { name: 'Pedido enviado — pago pendiente de verificación' }).waitFor({ timeout: 15_000 });
    const [order] = await ordersOf(userId);
    assert.deepEqual(await proofOf(order.id), { status: 'PENDIENTE', txId: reference, imageType: 'image/png' });

    // La dueña aprueba desde Pedidos (API del panel)
    const staffId = await createUser(schema, fx, { permissions: ['VIEW_ORDERS', 'ALL_BRANCHES'] });
    const approved = await fetch(`${API}/orders/admin/${order.id}/payment-proof/approve`, {
      method: 'POST',
      headers: { authorization: `Bearer ${tokenOf(staffId, ['VIEW_ORDERS', 'ALL_BRANCHES'], 'ADMIN')}`, 'x-tenant-id': tenant },
    });
    assert.equal(approved.status, 200, await approved.text());
    await page.reload();
    await page.getByRole('heading', { name: 'Pago confirmado' }).waitFor({ timeout: 15_000 });
    await assertConfirmation(page, 'Pagado');
    await context.close();
  });

  it('B04: móvil y textos en inglés, francés y chino', async () => {
    const mobile = await openContext('es', { width: 390, height: 844 });
    await toBankQr(mobile.page);
    await shot(mobile.page, 'mobile-paso2-qr');
    await mobile.page.getByRole('button', { name: 'Ya realicé la transferencia' }).click();
    await mobile.page.getByRole('heading', { name: 'Pedido enviado — pago pendiente de verificación' }).waitFor({ timeout: 15_000 });
    await assertConfirmation(mobile.page);
    const overflow = await mobile.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 0, `scroll horizontal de ${overflow}px`);
    await shot(mobile.page, 'mobile-paso3');
    await mobile.context.close();

    // Los textos de cada idioma salen de los diccionarios del front: la prueba recorre la interfaz traducida
    const expectedTitles: Record<string, string> = {
      en: 'Order sent — payment pending verification',
      fr: 'Commande envoyée — paiement en attente de vérification',
      zh: '订单已提交 — 付款待核实',
    };
    for (const [locale, expected] of Object.entries(expectedTitles)) {
      const m = JSON.parse(readFileSync(join(FRONT_DIR!, 'messages', `${locale}.json`), 'utf8')).Checkout;
      assert.equal(m.confirmation.title, expected);
      const { context, page } = await openContext(locale);
      const userId = await createUser(schema, fx);
      const productId = await createProduct(schema, fx, { [fx.branchA]: { M: 5, L: 5 } });
      await signIn(page, persisted(userId, productId));
      await page.goto(`${FRONT}/checkout`);
      await page.getByText(m.delivery.pickup, { exact: true }).click();
      await page.getByRole('button', { name: m.delivery.continue }).click();
      await page.getByText(m.payment.bankQr, { exact: true }).click();
      await page.getByRole('button', { name: m.manual.transferDone }).click();
      await page.getByRole('heading', { name: m.confirmation.title }).waitFor({ timeout: 15_000 });
      // El detalle del pedido llega después del título (GET /orders/:id)
      await page.getByText(m.confirmation.statusPending, { exact: true }).waitFor({ timeout: 15_000 });
      const text: string = await page.locator('body').innerText();
      assert.ok(text.includes(m.confirmation.statusPending), `${locale}: falta el estado pendiente`);
      assert.ok(text.includes(m.confirmation.viewOrder), `${locale}: falta "ver mi pedido"`);
      await shot(page, `desktop-paso3-${locale}`);
      await context.close();
    }
  });
});

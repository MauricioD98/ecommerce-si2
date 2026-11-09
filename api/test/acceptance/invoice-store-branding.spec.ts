import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { deflateSync, inflateSync } from 'node:zlib';
import { NotFoundException } from '@nestjs/common';
import { runInTenant, tenantStorage } from '../../src/tenancy/tenant-context';
import { InvoiceService } from '../../src/modules/invoices/invoice.service';
import { InvoiceDeliveryError, InvoiceIssuerUnavailableError } from '../../src/modules/invoices/invoice-issuer';
import { MailService } from '../../src/modules/mail/mail.service';
import { resolveMailTransport } from '../../src/modules/mail/mail.module';
import { CheckoutMaintenanceService } from '../../src/modules/payments/checkout-maintenance.service';
import { PaymentsService } from '../../src/modules/payments/payments.service';

// Facturas de compras con el nombre de la tienda donde se hizo la compra (no el del SaaS ni otro fijo).
// No necesita PostgreSQL: Prisma y el plano de control son fakes con un "schema" por tienda y el SMTP es
// un transporte capturado, así que se puede correr suelto con node --test. No sale ningún correo.

// ---------- Datos aislados: dos tiendas con nombre, slug, schema y logo distintos ----------

const crc32 = (buf: Buffer): number => {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
};
const chunk = (type: string, data: Buffer): Buffer => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
// PNG RGB de 2x2 de un color: el IDAT queda tal cual dentro del PDF, así se puede buscar
const solidPng = (r: number, g: number, b: number) => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(2, 0);
  ihdr.writeUInt32BE(2, 4);
  ihdr[8] = 8; // bits
  ihdr[9] = 2; // RGB
  const row = [0, r, g, b, r, g, b];
  const idat = deflateSync(Buffer.from([...row, ...row]));
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  return { png, idat };
};

const LOGO_A = solidPng(255, 0, 0);
const LOGO_B = solidPng(0, 0, 255);

const TENANT_A = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  name: 'Tienda Starter Demo',
  slug: 'tienda-starter-demo',
  schemaName: 'tenant_aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa',
};
const TENANT_B = {
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  name: 'Stella Femme Demo',
  slug: 'stella-femme-demo',
  schemaName: 'tenant_bbbbbbbbbbbb4bbb8bbbbbbbbbbbbbbb',
};

const order = (id: string, orderNumber: string, email: string) => ({
  id,
  orderNumber,
  createdAt: new Date('2026-11-01T12:00:00Z'),
  branch: { name: 'Sucursal Centro', address: 'Av. Siempre Viva 123', phone: '70000000' },
  user: { firstName: 'Ana', lastName: 'Pérez', email },
  fulfillmentType: 'PICKUP',
  shippingAddress: null,
  orderItems: [
    { quantity: 2, price: '50.00', product: { name: 'Blusa básica' } },
    { quantity: 1, price: '120.50', product: { name: 'Pantalón' } },
  ],
  discountApplied: '10.00',
  totalAmount: '210.50',
});

// Un "schema" por tienda: el fake de Prisma solo ve los pedidos del schema del contexto actual,
// igual que el proxy multitenant real.
const db: Record<string, { orders: Record<string, ReturnType<typeof order>>; logoUrl: string | null }> = {
  [TENANT_A.schemaName]: {
    orders: { 'order-a': order('order-a', 'A-0001', 'cliente-a@example.test') },
    logoUrl: `data:image/png;base64,${LOGO_A.png.toString('base64')}`,
  },
  [TENANT_B.schemaName]: {
    orders: { 'order-b': order('order-b', 'B-0001', 'cliente-b@example.test') },
    logoUrl: `data:image/png;base64,${LOGO_B.png.toString('base64')}`,
  },
};
const tenants: Record<string, typeof TENANT_A> = { [TENANT_A.id]: { ...TENANT_A }, [TENANT_B.id]: { ...TENANT_B } };

const currentSchema = () => {
  const schema = tenantStorage.getStore()?.schemaName;
  if (!schema || !db[schema]) throw new Error('relation "orders" does not exist');
  return db[schema];
};
const prisma = {
  order: { findUnique: (async ({ where }: { where: { id: string } }) => currentSchema().orders[where.id] ?? null) },
  storeAppearance: { findUnique: (async () => ({ logoUrl: currentSchema().logoUrl })) },
};
const control = {
  tenant: { findUnique: (async ({ where }: { where: { id: string } }) => (tenants[where.id] ? { ...tenants[where.id] } : null)) },
};

const inA = <T>(fn: () => Promise<T>) => runInTenant({ tenantId: TENANT_A.id, schemaName: TENANT_A.schemaName }, fn);
const inB = <T>(fn: () => Promise<T>) => runInTenant({ tenantId: TENANT_B.id, schemaName: TENANT_B.schemaName }, fn);

// Texto visible del PDF: pdfkit escribe el texto con fuentes estándar como <hex> dentro de operadores TJ
const pdfText = (pdf: Buffer): string => {
  const raw = pdf.toString('latin1');
  const parts: string[] = [];
  const streamRe = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let m: RegExpExecArray | null;
  while ((m = streamRe.exec(raw))) {
    let content: string;
    try {
      content = inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1');
    } catch {
      continue;
    }
    for (const tj of content.matchAll(/\[([^\]]*)\]\s*TJ/g)) {
      parts.push([...tj[1].matchAll(/<([0-9a-fA-F]*)>/g)].map((h) => Buffer.from(h[1], 'hex').toString('latin1')).join(''));
    }
  }
  return parts.join('\n');
};

const service = new InvoiceService(prisma as never, control as never);

describe('InvoiceService — factura con el nombre de la tienda de la compra', () => {
  it('la factura de la tienda A lleva nombre, logo y archivo de A, y nada de B', async () => {
    const { buffer, filename, data } = await inA(() => service.generateOrderInvoice('order-a'));
    const text = pdfText(buffer);
    const raw = buffer.toString('latin1');

    assert.equal(data.store.name, 'Tienda Starter Demo');
    assert.equal(filename, 'factura-tienda-starter-demo-A-0001.pdf');
    assert.ok(text.includes('TIENDA STARTER DEMO'));
    assert.ok(text.includes('¡Gracias por tu compra en Tienda Starter Demo!'));
    assert.doesNotMatch(text, /stella/i);
    assert.ok(raw.includes('Tienda Starter Demo')); // metadatos Title/Author del PDF
    assert.doesNotMatch(raw, /stella/i);
    assert.equal(buffer.includes(LOGO_A.idat), true);
    assert.equal(buffer.includes(LOGO_B.idat), false);
  });

  it('la factura de la tienda B lleva nombre, logo y archivo de B, y nada de A', async () => {
    const { buffer, filename } = await inB(() => service.generateOrderInvoice('order-b'));
    const text = pdfText(buffer);

    assert.equal(filename, 'factura-stella-femme-demo-B-0001.pdf');
    assert.ok(text.includes('STELLA FEMME DEMO'));
    assert.doesNotMatch(text, /starter/i);
    assert.doesNotMatch(buffer.toString('latin1'), /starter/i);
    assert.equal(buffer.includes(LOGO_B.idat), true);
    assert.equal(buffer.includes(LOGO_A.idat), false);
  });

  it('mantiene importes, productos y entrega', async () => {
    const { buffer, data } = await inA(() => service.generateOrderInvoice('order-a'));
    const text = pdfText(buffer);
    assert.equal(data.total, 210.5);
    assert.equal(data.discount, 10);
    assert.ok(text.includes('Blusa básica'));
    assert.ok(text.includes('Bs 220.50')); // subtotal 2×50 + 120.50
    assert.ok(text.includes('-Bs 10.00'));
    assert.ok(text.includes('Bs 210.50'));
    assert.ok(text.includes('Retiro en sucursal'));
  });

  it('una tienda no puede generar la factura de un pedido de otra', async () => {
    await assert.rejects(inB(() => service.generateOrderInvoice('order-a')), NotFoundException);
    await assert.rejects(inA(() => service.generateOrderInvoice('order-b')), NotFoundException);
  });

  it('sin contexto de tienda no se emite nada', async () => {
    await assert.rejects(service.generateOrderInvoice('order-a'), InvoiceIssuerUnavailableError);
  });

  it('contexto inconsistente (tenantId de A con schema de B) no se emite con ningún nombre', async () => {
    const call = runInTenant({ tenantId: TENANT_A.id, schemaName: TENANT_B.schemaName }, () => service.generateOrderInvoice('order-b'));
    await assert.rejects(call, InvoiceIssuerUnavailableError);
  });

  it('tienda sin nombre: no se emite (y el error no expone datos del cliente)', async () => {
    tenants[TENANT_A.id].name = '   ';
    try {
      const error = await inA(() => service.generateOrderInvoice('order-a')).catch((e: Error) => e);
      assert.ok(error instanceof InvoiceIssuerUnavailableError);
      assert.ok(!(error as Error).message.includes('cliente-a@example.test'));
    } finally {
      tenants[TENANT_A.id].name = TENANT_A.name;
    }
  });

  it('tienda inexistente en el plano de control: no se emite', async () => {
    const call = runInTenant({ tenantId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', schemaName: TENANT_A.schemaName }, () =>
      service.generateOrderInvoice('order-a'),
    );
    await assert.rejects(call, InvoiceIssuerUnavailableError);
  });

  it('sin logo, o con logo externo/WebP, la factura sale solo con el nombre', async () => {
    const original = db[TENANT_A.schemaName].logoUrl;
    try {
      for (const logoUrl of [null, 'https://cdn.example.test/logo.png', 'data:image/webp;base64,UklGRg==']) {
        db[TENANT_A.schemaName].logoUrl = logoUrl;
        const { buffer, data } = await inA(() => service.generateOrderInvoice('order-a'));
        assert.equal(data.store.logo, null);
        assert.ok(pdfText(buffer).includes('TIENDA STARTER DEMO'));
      }
    } finally {
      db[TENANT_A.schemaName].logoUrl = original;
    }
  });

  it('un cambio de nombre posterior no altera una factura ya emitida', async () => {
    const first = await inA(() => service.generateOrderInvoice('order-a'));
    tenants[TENANT_A.id].name = 'Nombre Nuevo';
    try {
      await inA(() => service.generateOrderInvoice('order-a'));
      assert.ok(pdfText(first.buffer).includes('TIENDA STARTER DEMO'));
      assert.equal(first.data.store.name, 'Tienda Starter Demo');
    } finally {
      tenants[TENANT_A.id].name = TENANT_A.name;
    }
  });
});

// ---------- Correo simulado: transporte capturado, no sale nada ----------

// Responde como el transporte real: SMTP acepta/rechaza destinatarios, JSON (sin SMTP) no informa ninguno
type SmtpMode = 'accept' | 'reject' | 'fail' | 'json';
const makeMail = (env: Record<string, string | undefined>, mode: SmtpMode = 'accept') => {
  const sent: Record<string, unknown>[] = [];
  const mailer = {
    sendMail: async (options: Record<string, unknown>) => {
      if (mode === 'fail') throw new Error(`getaddrinfo EAI_FAIL ${String(options.to)}`);
      sent.push(options);
      if (mode === 'json') return { envelope: {}, messageId: '<json@local>', message: '{}' };
      if (mode === 'reject') return { accepted: [], rejected: [options.to], response: `550 5.1.1 <${String(options.to)}> no existe` };
      return { accepted: [options.to], rejected: [], messageId: '<ok@smtp>', response: '250 2.0.0 OK' };
    },
  };
  const config = { get: (key: string) => env[key] };
  return { mail: new MailService(mailer as never, config as never, control as never), sent };
};

describe('MailService.sendInvoice — asunto, cuerpo, adjunto y remitente', () => {
  const env = { SMTP_HOST: 'smtp.example.test', SMTP_USER: 'no-reply@novasoft.test', MAIL_FROM: undefined };

  it('A y B reciben cada uno su tienda, sin rastro de la otra', async () => {
    const { mail, sent } = makeMail(env);
    const a = await inA(() => service.generateOrderInvoice('order-a'));
    const b = await inB(() => service.generateOrderInvoice('order-b'));
    for (const doc of [a, b]) {
      await mail.sendInvoice({
        to: doc.data.customer.email!,
        firstName: doc.data.customer.name,
        storeName: doc.data.store.name,
        orderNumber: doc.data.number,
        total: doc.data.total,
        pdf: doc.buffer,
        filename: doc.filename,
      });
    }
    const [mailA, mailB] = sent as { from: string; subject: string; html: string; attachments: { filename: string }[]; to: string }[];

    assert.equal(mailA.to, 'cliente-a@example.test');
    assert.equal(mailA.subject, 'Tu factura de Tienda Starter Demo - pedido #A-0001');
    assert.equal(mailA.from, '"Tienda Starter Demo vía NovaSoft" <no-reply@novasoft.test>');
    assert.ok(mailA.html.includes('Gracias por tu compra en Tienda Starter Demo'));
    assert.ok(mailA.html.includes('TIENDA STARTER DEMO'));
    assert.equal(mailA.attachments[0].filename, 'factura-tienda-starter-demo-A-0001.pdf');
    assert.doesNotMatch(JSON.stringify(mailA), /stella/i);

    assert.equal(mailB.subject, 'Tu factura de Stella Femme Demo - pedido #B-0001');
    assert.equal(mailB.from, '"Stella Femme Demo vía NovaSoft" <no-reply@novasoft.test>');
    assert.ok(mailB.html.includes('STELLA FEMME DEMO'));
    assert.equal(mailB.attachments[0].filename, 'factura-stella-femme-demo-B-0001.pdf');
    assert.doesNotMatch(JSON.stringify({ ...mailB, attachments: undefined }), /starter/i);
  });

  it('sin SMTP_USER usa solo la dirección de MAIL_FROM (ya autorizada), nunca una de la tienda', async () => {
    const { mail, sent } = makeMail({ MAIL_FROM: '"NovaSoft" <facturas@novasoft.test>' });
    await mail.sendInvoice({ to: 'x@example.test', storeName: 'Tienda Starter Demo', orderNumber: '1', total: 1, pdf: Buffer.from(''), filename: 'f.pdf' });
    assert.equal((sent[0] as { from: string }).from, '"Tienda Starter Demo vía NovaSoft" <facturas@novasoft.test>');
    assert.ok(!('replyTo' in sent[0]));
  });

  it('sin ninguna dirección configurada deja el remitente por defecto del mailer', async () => {
    const { mail, sent } = makeMail({});
    await mail.sendInvoice({ to: 'x@example.test', storeName: 'Tienda Starter Demo', orderNumber: '1', total: 1, pdf: Buffer.from(''), filename: 'f.pdf' });
    assert.equal((sent[0] as { from?: string }).from, undefined);
  });

  it('un nombre con saltos de línea o comillas no inyecta cabeceras', async () => {
    const { mail, sent } = makeMail(env);
    await mail.sendInvoice({ to: 'x@example.test', storeName: 'Mala"\r\nBcc: otro@example.test', orderNumber: '1', total: 1, pdf: Buffer.from(''), filename: 'f.pdf' });
    const { from, subject } = sent[0] as { from: string; subject: string };
    assert.doesNotMatch(from, /[\r\n]/);
    assert.doesNotMatch(subject, /[\r\n]/);
    assert.equal(from.match(/"/g)?.length, 2);
  });

  it('sin nombre de tienda no envía', async () => {
    const { mail, sent } = makeMail(env);
    const result = await mail.sendInvoice({ to: 'x@example.test', storeName: ' ', orderNumber: '1', total: 1, pdf: Buffer.from(''), filename: 'f.pdf' });
    assert.equal(result.status, 'failed');
    assert.equal(sent.length, 0);
  });

  it('el logo de la tienda va incrustado en el correo (cid) y es el de esa tienda, no el de la otra', async () => {
    const { mail, sent } = makeMail(env);
    for (const [run, orderId] of [[inA, 'order-a'], [inB, 'order-b']] as const) {
      const doc = await run(() => service.generateOrderInvoice(orderId));
      await mail.sendInvoice({
        to: doc.data.customer.email!,
        storeName: doc.data.store.name,
        orderNumber: doc.data.number,
        total: doc.data.total,
        pdf: doc.buffer,
        filename: doc.filename,
        logo: doc.data.store.logo,
      });
    }
    const [mailA, mailB] = sent as { html: string; attachments: { cid?: string; content: Buffer; contentType: string }[] }[];
    const logoOf = (m: typeof mailA) => m.attachments.find((a) => a.cid);
    assert.ok(mailA.html.includes('src="cid:store-logo@novasoft"'));
    assert.equal(logoOf(mailA)!.contentType, 'image/png');
    assert.ok(logoOf(mailA)!.content.equals(LOGO_A.png), 'logo de A');
    assert.ok(logoOf(mailB)!.content.equals(LOGO_B.png), 'logo de B');
    assert.ok(!logoOf(mailA)!.content.equals(LOGO_B.png));
    assert.doesNotMatch(mailA.html, /data:image/, 'nunca un data URL (los clientes de correo lo bloquean)');
  });

  it('sin logo compatible el correo sale solo con el nombre', async () => {
    const { mail, sent } = makeMail(env);
    await mail.sendInvoice({ to: 'x@example.test', storeName: 'Tienda Starter Demo', orderNumber: '1', total: 1, pdf: Buffer.from(''), filename: 'f.pdf', logo: null });
    const m = sent[0] as { html: string; attachments: unknown[] };
    assert.doesNotMatch(m.html, /cid:/);
    assert.equal(m.attachments.length, 1);
  });

  it('informa qué pasó: aceptado, rechazado, falla de conexión o sin SMTP', async () => {
    const args = { to: 'x@example.test', storeName: 'Tienda Starter Demo', orderNumber: '1', total: 1, pdf: Buffer.from(''), filename: 'f.pdf' };
    assert.equal((await makeMail(env, 'accept').mail.sendInvoice(args)).status, 'sent');
    assert.equal((await makeMail(env, 'reject').mail.sendInvoice(args)).status, 'rejected');
    assert.equal((await makeMail(env, 'fail').mail.sendInvoice(args)).status, 'failed');
    assert.equal((await makeMail({}, 'json').mail.sendInvoice(args)).status, 'simulated');
  });
});

describe('Correos de la plataforma NovaSoft: conservan su identidad', () => {
  const env = { SMTP_HOST: 'smtp.example.test', SMTP_USER: 'no-reply@novasoft.test', SUPPORT_EMAIL: 'soporte@novasoft.test', FRONTEND_URL: 'http://localhost:3000' };

  it('alta de tienda (suscripción) y contacto salen como NovaSoft, aunque se envíen dentro del contexto de una tienda', async () => {
    const { mail, sent } = makeMail(env);
    await inA(() =>
      mail.sendTenantWelcome({ to: 'duena@example.test', tenantName: 'Tienda Nueva', loginUrl: 'http://localhost:3000/admin' }),
    );
    await inB(() => mail.sendContactMessage({ name: 'Visitante', email: 'v@example.test', message: 'Hola' }));
    const [welcome, contact] = sent as { from: string; subject: string; html: string }[];
    assert.equal(welcome.from, '"NovaSoft" <no-reply@novasoft.test>');
    assert.match(welcome.subject, /NovaSoft/);
    assert.doesNotMatch(JSON.stringify(welcome), /Starter|Stella/i);
    assert.equal(contact.from, '"NovaSoft" <no-reply@novasoft.test>');
    assert.match(contact.subject, /^\[NovaSoft\]/);
    assert.doesNotMatch(JSON.stringify(contact), /Starter|Stella/i);
  });
});

describe('Configuración de la cuenta SMTP única de la plataforma', () => {
  const read = (env: Record<string, string | undefined>) => ({ get: (k: string) => env[k] }) as never;

  it('un SMTP_HOST con una dirección de correo (causa de que no saliera nada) se detecta y no se usa', () => {
    const errors: string[] = [];
    const cfg = resolveMailTransport(read({ SMTP_HOST: 'alguien@gmail.com', SMTP_USER: 'alguien@gmail.com', SMTP_PASS: 'x' }), { error: (m: string) => errors.push(m) } as never);
    assert.equal((cfg.transport as { host: string }).host, 'smtp.gmail.com');
    assert.equal(errors.length, 1);
    assert.match(errors[0], /SMTP_HOST contiene una dirección de correo/);
    assert.doesNotMatch(errors[0], /alguien@/, 'el aviso no repite la dirección');
  });

  it('un servidor válido se respeta y sin SMTP se usa el transporte simulado', () => {
    const ok = resolveMailTransport(read({ SMTP_HOST: 'smtp.example.test', SMTP_USER: 'u@example.test', SMTP_PORT: '587' }), { error: () => undefined } as never);
    assert.deepEqual({ ...(ok.transport as object), auth: undefined }, { host: 'smtp.example.test', port: 587, secure: false, auth: undefined });
    const none = resolveMailTransport(read({}), { error: () => undefined } as never);
    assert.deepEqual(none.transport, { jsonTransport: true });
  });
});

// ---------- Outbox (segundo plano, sin sesión): runInTenant + sendInvoiceEmail ----------

describe('PaymentsService.sendInvoiceEmail desde el outbox', () => {
  const build = () => {
    const { mail, sent } = makeMail({ SMTP_HOST: 'smtp.example.test', SMTP_USER: 'no-reply@novasoft.test' });
    const payments = Object.assign(Object.create(PaymentsService.prototype), { invoiceService: service, mailService: mail, logger: { log() {} } }) as PaymentsService;
    return { payments, sent };
  };

  it('cada evento sale con la tienda de su propio contexto', async () => {
    const { payments, sent } = build();
    await inA(() => payments.sendInvoiceEmail('order-a'));
    await inB(() => payments.sendInvoiceEmail('order-b'));
    assert.ok((sent[0] as { subject: string }).subject.includes('Tienda Starter Demo'));
    assert.ok((sent[1] as { subject: string }).subject.includes('Stella Femme Demo'));
  });

  it('sin tienda identificable lanza (el outbox reintenta y lo deja registrado) y no envía', async () => {
    const { payments, sent } = build();
    await assert.rejects(payments.sendInvoiceEmail('order-a'), InvoiceIssuerUnavailableError);
    assert.equal(sent.length, 0);
  });

  it('envío fallido, rechazado o sin SMTP NO se da por hecho: lanza sin datos del cliente', async () => {
    for (const [mode, env, expected] of [
      ['fail', { SMTP_HOST: 'smtp.example.test', SMTP_USER: 'no-reply@novasoft.test' }, /no enviada: getaddrinfo EAI_FAIL \*\*\*@\*\*\*/],
      ['reject', { SMTP_HOST: 'smtp.example.test', SMTP_USER: 'no-reply@novasoft.test' }, /no enviada: el servidor rechazó el destinatario/],
      ['json', {}, /no enviada: SMTP no configurado/],
    ] as const) {
      const { mail } = makeMail(env, mode);
      const payments = Object.assign(Object.create(PaymentsService.prototype), { invoiceService: service, mailService: mail, logger: { log() {} } }) as PaymentsService;
      const error = await inA(() => payments.sendInvoiceEmail('order-a')).then(
        () => null,
        (e: Error) => e,
      );
      assert.ok(error instanceof InvoiceDeliveryError, mode);
      assert.match(error.message, expected);
      assert.doesNotMatch(error.message, /cliente-a@example\.test/, 'el error queda en outbox_events.lastError');
    }
  });

  // Ciclo real del consumidor del outbox (deliverOutbox) con una tabla en memoria
  const runOutbox = async (mode: SmtpMode, attempts: number) => {
    const { mail, sent } = makeMail({ SMTP_HOST: 'smtp.example.test', SMTP_USER: 'no-reply@novasoft.test' }, mode);
    const payments = Object.assign(Object.create(PaymentsService.prototype), { invoiceService: service, mailService: mail, logger: { log() {} } }) as PaymentsService;
    const row = { id: 'evt-1', type: 'ORDER_PAID_INVOICE', payload: { orderId: 'order-a' }, attempts, claimed: false };
    const updates: { status: string; lastError: string | null }[] = [];
    const fakePrisma = {
      $queryRaw: async () => {
        if (row.claimed) return [];
        row.claimed = true;
        row.attempts += 1;
        return [{ id: row.id, type: row.type, payload: row.payload, attempts: row.attempts }];
      },
      outboxEvent: { update: async ({ data }: { data: { status: string; lastError: string | null } }) => void updates.push(data) },
    };
    const maintenance = new CheckoutMaintenanceService(fakePrisma as never, control as never, payments, {} as never);
    const delivered = await inA(() => maintenance.deliverOutbox());
    return { delivered, update: updates[0], sent };
  };

  it('outbox: aceptado por SMTP → DONE', async () => {
    const { delivered, update, sent } = await runOutbox('accept', 0);
    assert.equal(delivered, 1);
    assert.equal(update.status, 'DONE');
    assert.equal(sent.length, 1);
  });

  it('outbox: SMTP caído → vuelve a PENDING con el motivo (se reintenta), nunca DONE', async () => {
    const { delivered, update } = await runOutbox('fail', 0);
    assert.equal(delivered, 0);
    assert.equal(update.status, 'PENDING');
    assert.match(update.lastError!, /Factura del pedido #A-0001 no enviada/);
  });

  it('outbox: agotados los intentos queda DEAD (visible en métricas), no DONE', async () => {
    const { update } = await runOutbox('reject', 9);
    assert.equal(update.status, 'DEAD');
    assert.match(update.lastError!, /rechazó el destinatario/);
  });
});

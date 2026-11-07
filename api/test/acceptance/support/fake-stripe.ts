import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';
import { randomBytes } from 'node:crypto';
import Stripe from 'stripe';

type Intent = Record<string, any>;

// Stripe falso local y determinista: conserva la semántica que importa aquí (Idempotency-Key, estados del
// PaymentIntent, reembolso) y permite simular respuestas perdidas. Nunca sale a internet.
export class FakeStripe {
  private server!: Server;
  readonly intents = new Map<string, Intent>();
  readonly refunds = new Map<string, Intent>();
  private readonly idempotent = new Map<string, { body: string; response: Intent }>();
  createCalls = 0;
  refundCalls = 0;
  // POST /payment_intents/:id/confirm: solo lo usa la autoconfirmación de demo (pm_card_visa)
  confirmCalls = 0;
  // La operación se aplica y luego se corta la conexión: el cliente no sabe si funcionó
  dropNextCreateResponse = false;
  unavailable = false;
  cancelRejected = false;
  // Simula el índice de búsqueda de Stripe, que aún no ve un PaymentIntent recién creado
  searchLag = false;
  // Connect: false = la plataforma todavía no activó Connect (accounts.create responde 400)
  connectEnabled = true;
  accountCreateCalls = 0;
  readonly accounts = new Map<string, Intent>();
  private readonly idempotentAccounts = new Map<string, { status: number; body: Intent }>();

  async start(): Promise<string> {
    this.server = createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    const { port } = this.server.address() as AddressInfo;
    return `http://127.0.0.1:${port}`;
  }

  stop(): Promise<void> {
    return new Promise((resolve) => this.server.close(() => resolve()));
  }

  setStatus(id: string, status: string): Intent {
    const intent = this.intents.get(id);
    if (!intent) throw new Error(`PaymentIntent desconocido ${id}`);
    intent.status = status;
    return intent;
  }

  // Evento firmado como lo haría Stripe, listo para POST /payments/webhook
  signedEvent(type: string, object: Intent, id = `evt_${randomBytes(8).toString('hex')}`) {
    const payload = JSON.stringify({ id, object: 'event', type, data: { object }, account: undefined, api_version: '2025-01-01', created: 1, livemode: false, pending_webhooks: 1, request: null });
    const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET! });
    return { payload, signature, id };
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks).toString();
    const url = new URL(req.url!, 'http://x');
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (this.unavailable) return send(500, { error: { type: 'api_error', message: 'unavailable' } });

    const key = req.headers['idempotency-key'] as string | undefined;
    const path = url.pathname;

    if (req.method === 'GET' && path === '/v1/payment_intents/search') {
      const attemptId = /attemptId'\]:'([^']+)'/.exec(url.searchParams.get('query') ?? '')?.[1];
      const data = this.searchLag ? [] : [...this.intents.values()].filter((i) => i.metadata.attemptId === attemptId);
      return send(200, { object: 'search_result', data, has_more: false, url: path });
    }
    const match = /^\/v1\/payment_intents\/([^/]+)(\/cancel|\/confirm)?$/.exec(path);
    if (match) {
      const intent = this.intents.get(match[1]);
      if (!intent) return send(404, { error: { type: 'invalid_request_error', code: 'resource_missing', message: 'no such intent' } });
      if (req.method === 'GET') return send(200, intent);
      if (match[2] === '/confirm') {
        // Como la tarjeta de prueba de Stripe: confirmar un intento sin pagar lo cobra
        this.confirmCalls += 1;
        if (intent.status !== 'requires_payment_method' && intent.status !== 'requires_confirmation') {
          return send(400, { error: { type: 'invalid_request_error', code: 'payment_intent_unexpected_state', message: `cannot confirm ${intent.status}` } });
        }
        intent.status = 'succeeded';
        return send(200, intent);
      }
      if (match[2]) {
        if (this.cancelRejected || ['succeeded', 'processing', 'canceled'].includes(intent.status)) {
          return send(400, { error: { type: 'invalid_request_error', code: 'payment_intent_unexpected_state', message: `cannot cancel ${intent.status}` } });
        }
        intent.status = 'canceled';
        return send(200, intent);
      }
    }

    const params = decodeForm(raw);
    if (req.method === 'POST' && path === '/v1/payment_intents') {
      this.createCalls += 1;
      const seen = key ? this.idempotent.get(key) : undefined;
      if (seen) {
        if (seen.body !== raw) return send(400, { error: { type: 'idempotency_error', message: 'keys for idempotent requests can only be used with the same parameters' } });
        return send(200, seen.response);
      }
      const id = `pi_${randomBytes(10).toString('hex')}`;
      const intent: Intent = {
        id,
        object: 'payment_intent',
        amount: Number(params.amount),
        currency: params.currency,
        status: 'requires_payment_method',
        client_secret: `${id}_secret_${randomBytes(6).toString('hex')}`,
        metadata: params.metadata ?? {},
        livemode: false,
        on_behalf_of: params.on_behalf_of ?? null,
        application_fee_amount: params.application_fee_amount ? Number(params.application_fee_amount) : null,
        transfer_data: params.transfer_data?.destination ? { destination: params.transfer_data.destination } : null,
      };
      this.intents.set(id, intent);
      if (key) this.idempotent.set(key, { body: raw, response: intent });
      if (this.dropNextCreateResponse) {
        this.dropNextCreateResponse = false;
        req.socket.destroy();
        return;
      }
      return send(200, intent);
    }
    // Connect: creación de cuentas y links de onboarding. Como Stripe, guarda también la respuesta de
    // ERROR por Idempotency-Key y la repite con la cabecera Idempotent-Replayed.
    if (req.method === 'POST' && path === '/v1/accounts') {
      this.accountCreateCalls += 1;
      const seen = key ? this.idempotentAccounts.get(key) : undefined;
      if (seen) {
        res.writeHead(seen.status, { 'content-type': 'application/json', 'idempotent-replayed': 'true' });
        res.end(JSON.stringify(seen.body));
        return;
      }
      const outcome = this.connectEnabled
        ? { status: 200, body: { id: `acct_${randomBytes(8).toString('hex')}`, object: 'account', type: params.type, metadata: params.metadata ?? {}, charges_enabled: false, payouts_enabled: false, details_submitted: false } }
        : { status: 400, body: { error: { type: 'invalid_request_error', message: "You can only create new accounts if you've signed up for Connect" } } };
      if (outcome.status === 200) this.accounts.set(outcome.body.id as string, outcome.body);
      if (key) this.idempotentAccounts.set(key, outcome);
      return send(outcome.status, outcome.body);
    }
    if (req.method === 'POST' && path === '/v1/account_links') {
      if (!this.accounts.has(params.account)) return send(400, { error: { type: 'invalid_request_error', message: 'No such account' } });
      return send(200, { object: 'account_link', url: `https://connect.stripe.test/setup/${params.account}`, expires_at: 0 });
    }
    if (req.method === 'POST' && path === '/v1/refunds') {
      this.refundCalls += 1;
      const seen = key ? this.idempotent.get(key) : undefined;
      if (seen) return send(200, seen.response);
      const refund = { id: `re_${randomBytes(8).toString('hex')}`, object: 'refund', status: 'succeeded', payment_intent: params.payment_intent, reverse_transfer: params.reverse_transfer, refund_application_fee: params.refund_application_fee };
      this.refunds.set(refund.id, refund);
      if (key) this.idempotent.set(key, { body: raw, response: refund });
      return send(200, refund);
    }
    return send(404, { error: { type: 'invalid_request_error', message: `ruta no simulada ${req.method} ${path}` } });
  }
}

function decodeForm(raw: string): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [name, value] of new URLSearchParams(raw)) {
    const parts = name.split(/[[\]]+/).filter(Boolean);
    let node = out;
    parts.slice(0, -1).forEach((part) => (node = node[part] ??= {}));
    node[parts[parts.length - 1]] = value;
  }
  return out;
}

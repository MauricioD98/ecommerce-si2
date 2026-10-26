import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'node:crypto';
import Stripe from 'stripe';
import { ControlPrismaService } from '../../tenancy/control-prisma.service';
import { TenantProvisioningService } from '../../tenancy/tenant-provisioning.service';
import { withTenantParam } from '../../tenancy/tenant-context';
import { MailService } from '../mail/mail.service';
import { i18nMessage } from '../../i18n/i18n-message';
import { SubscriptionCheckoutDto } from './dto/subscription-checkout.dto';
import { PLANS, type PlanKey, missingBillingEnv, planForPrice, priceIdFor } from './plans';

// metadata.kind distingue estas sesiones de cualquier otro Checkout de la misma cuenta de Stripe
const SIGNUP_KIND = 'tenant_signup';
// Tienda que ya existe (creada por la plataforma o cuya suscripción terminó) y se suscribe desde su panel
const TENANT_SUBSCRIPTION_KIND = 'tenant_subscription';
// Con estos estados la tienda ya tiene una suscripción viva: cambiar de plan o cancelar va por el
// Billing Portal, no por un Checkout nuevo (que crearía una segunda suscripción y cobraría doble)
const LIVE_STATUSES = new Set(['active', 'trialing', 'past_due', 'incomplete']);
// Si el proceso murió a mitad de un aprovisionamiento, el signup queda en PROVISIONING: pasado este
// tiempo, un reintento del webhook (o de la plataforma) puede retomarlo.
const STALE_PROVISIONING_MS = 15 * 60_000;

// Estados de suscripción de Stripe con los que la tienda deja de atender
const SUSPENDING_STATUSES = new Set(['canceled', 'unpaid', 'incomplete_expired', 'paused']);

/**
 * Alta self-service: landing /planes → POST /platform/subscriptions/checkout → Stripe Checkout →
 * webhook checkout.session.completed → TenantProvisioningService → correo de bienvenida.
 * Sin aprobación manual: pagar es lo único que hace falta para tener la tienda.
 */
@Injectable()
export class SubscriptionsService implements OnModuleInit {
  private readonly logger = new Logger(SubscriptionsService.name);
  private readonly stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

  constructor(
    private readonly control: ControlPrismaService,
    private readonly provisioning: TenantProvisioningService,
    private readonly mail: MailService,
  ) {}

  onModuleInit() {
    const missing = missingBillingEnv();
    if (missing.length > 0) {
      this.logger.warn(`Suscripciones de Stripe incompletas, falta configurar: ${missing.join(', ')}`);
    }
  }

  private get platformUrl(): string {
    return (process.env.PLATFORM_URL || process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/+$/, '');
  }

  // ---------------------------------------------------------------------------------------------
  // 1. Checkout
  // ---------------------------------------------------------------------------------------------

  async createCheckout(dto: SubscriptionCheckoutDto): Promise<{ url: string; sessionId: string }> {
    const priceId = priceIdFor(dto.plan);
    if (!priceId) {
      this.logger.error(`Falta ${PLANS[dto.plan].priceEnv} (price_...) en el entorno`);
      throw new ServiceUnavailableException(i18nMessage('errors.PLAN_UNAVAILABLE'));
    }

    // Se valida ANTES de cobrar: después del pago ya no se le puede decir "ese email está tomado"
    const [ownerTaken, domainTaken] = await Promise.all([
      this.control.tenantCredential.findFirst({
        where: { type: 'OWNER_PASSWORD', identifier: dto.adminEmail },
        select: { id: true },
      }),
      dto.domain ? this.control.tenant.findFirst({ where: { domain: dto.domain }, select: { id: true } }) : null,
    ]);
    if (ownerTaken) throw new ConflictException(i18nMessage('errors.OWNER_EMAIL_TAKEN'));
    if (domainTaken) throw new ConflictException(i18nMessage('errors.DOMAIN_TAKEN'));

    const signup = await this.control.tenantSignup.create({
      data: {
        plan: dto.plan,
        tenantName: dto.tenantName,
        domain: dto.domain ?? null,
        adminEmail: dto.adminEmail,
        passwordHash: await bcrypt.hash(dto.adminPassword, 12),
      },
      select: { id: true },
    });

    // En metadata solo datos NO sensibles (se ven en el dashboard de Stripe). La fuente de verdad es
    // public.tenant_signups; signupId es lo único que el webhook necesita.
    const metadata = {
      kind: SIGNUP_KIND,
      signupId: signup.id,
      plan: dto.plan,
      tenantName: dto.tenantName.slice(0, 100),
      domain: dto.domain ?? '',
    };

    const session = await this.stripe.checkout.sessions.create(
      {
        mode: 'subscription',
        line_items: [{ price: priceId, quantity: 1 }],
        customer_email: dto.adminEmail,
        client_reference_id: signup.id,
        metadata,
        // También en la suscripción: los eventos customer.subscription.* no traen la sesión
        subscription_data: { metadata },
        allow_promotion_codes: true,
        success_url: `${this.platformUrl}/planes/exito?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${this.platformUrl}/planes?cancelado=1`,
      },
      { idempotencyKey: `tenant-signup-${signup.id}` },
    );

    await this.control.tenantSignup.update({ where: { id: signup.id }, data: { stripeCheckoutId: session.id } });
    if (!session.url) throw new ServiceUnavailableException(i18nMessage('errors.PAYMENT_URL_MISSING'));
    return { url: session.url, sessionId: session.id };
  }

  /** Lo consulta la página /planes/exito mientras se crea la tienda (polling). */
  async getCheckoutStatus(sessionId: string) {
    let signup = await this.control.tenantSignup.findUnique({
      where: { stripeCheckoutId: sessionId },
      select: { status: true, tenantId: true, tenantName: true },
    });
    if (!signup) throw new NotFoundException(i18nMessage('errors.CHECKOUT_NOT_FOUND'));

    // Respaldo del webhook: si el alta sigue PENDING se le pregunta a Stripe por la sesión. Un pago
    // ya confirmado arranca el aprovisionamiento aunque checkout.session.completed se haya perdido o
    // demore (en local, sin `stripe listen`, nunca llega). Es idempotente: el webhook que llegue
    // después no duplica nada (claimForProvisioning).
    if (signup.status === 'PENDING') {
      try {
        const session = await this.stripe.checkout.sessions.retrieve(sessionId);
        if (session.status === 'complete') await this.handleCheckoutPaid(session);
        else if (session.status === 'expired') await this.handleCheckoutExpired(session);
        signup = (await this.control.tenantSignup.findUnique({
          where: { stripeCheckoutId: sessionId },
          select: { status: true, tenantId: true, tenantName: true },
        }))!;
      } catch (error) {
        this.logger.warn(`No se pudo consultar la sesión ${sessionId} en Stripe: ${(error as Error).message}`);
      }
    }

    return {
      status: signup.status,
      tenantName: signup.tenantName,
      // Recién cuando está lista: antes el link llevaría a una tienda que todavía no responde
      loginUrl: signup.status === 'COMPLETED' && signup.tenantId ? this.loginUrl(signup.tenantId) : null,
    };
  }

  // ---------------------------------------------------------------------------------------------
  // 1b. Suscripción de una tienda que ya existe (panel /admin/suscripcion, solo el Super Admin)
  // ---------------------------------------------------------------------------------------------

  /** Estado guardado por los webhooks; Stripe solo aporta el fin de período y si se cancela al final. */
  async getTenantSubscription(tenantId: string) {
    const tenant = await this.control.tenant.findUnique({
      where: { id: tenantId },
      select: { plan: true, subscriptionStatus: true, stripeSubscriptionId: true, stripeCustomerId: true },
    });
    if (!tenant) throw new NotFoundException(i18nMessage('errors.TENANT_NOT_FOUND'));

    let cancelAtPeriodEnd = false;
    let currentPeriodEnd: string | null = null;
    if (tenant.stripeSubscriptionId) {
      try {
        const subscription = await this.stripe.subscriptions.retrieve(tenant.stripeSubscriptionId);
        cancelAtPeriodEnd = subscription.cancel_at_period_end;
        const end = subscription.items.data[0]?.current_period_end;
        currentPeriodEnd = end ? new Date(end * 1000).toISOString() : null;
      } catch (error) {
        // El estado de la BD alcanza para la pantalla; los detalles son un extra
        this.logger.warn(`No se pudo leer la suscripción ${tenant.stripeSubscriptionId}: ${(error as Error).message}`);
      }
    }

    const plan = tenant.plan in PLANS ? (tenant.plan as PlanKey) : null;
    return {
      plan: tenant.plan,
      planName: plan ? PLANS[plan].name : tenant.plan,
      status: tenant.subscriptionStatus,
      active: this.hasLiveSubscription(tenant),
      canManage: !!tenant.stripeCustomerId,
      cancelAtPeriodEnd,
      currentPeriodEnd,
    };
  }

  async createTenantCheckout(tenantId: string, ownerEmail: string, plan: PlanKey): Promise<{ url: string }> {
    const priceId = priceIdFor(plan);
    if (!priceId) {
      this.logger.error(`Falta ${PLANS[plan].priceEnv} (price_...) en el entorno`);
      throw new ServiceUnavailableException(i18nMessage('errors.PLAN_UNAVAILABLE'));
    }

    const tenant = await this.control.tenant.findUnique({
      where: { id: tenantId },
      select: { subscriptionStatus: true, stripeSubscriptionId: true, stripeCustomerId: true },
    });
    if (!tenant) throw new NotFoundException(i18nMessage('errors.TENANT_NOT_FOUND'));
    if (this.hasLiveSubscription(tenant)) throw new ConflictException(i18nMessage('errors.SUBSCRIPTION_ALREADY_ACTIVE'));

    // La tienda sale del token (tenantId), nunca del body: nadie puede pagar a nombre de otra
    const metadata = { kind: TENANT_SUBSCRIPTION_KIND, tenantId, plan };
    const returnUrl = `${this.platformUrl}/admin/suscripcion`;
    const session = await this.stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      // Si ya fue cliente (suscripción anterior cancelada) se reutiliza su Customer y sus tarjetas
      ...(tenant.stripeCustomerId ? { customer: tenant.stripeCustomerId } : { customer_email: ownerEmail }),
      client_reference_id: tenantId,
      metadata,
      subscription_data: { metadata },
      allow_promotion_codes: true,
      // La vuelta no prueba nada: la página consulta GET /subscription, que refleja lo que dijo el webhook
      success_url: withTenantParam(`${returnUrl}?checkout=success`, tenantId),
      cancel_url: withTenantParam(`${returnUrl}?checkout=cancelled`, tenantId),
    });
    if (!session.url) throw new ServiceUnavailableException(i18nMessage('errors.PAYMENT_URL_MISSING'));
    return { url: session.url };
  }

  /** Billing Portal de Stripe: cambiar de plan, actualizar la tarjeta, ver facturas o cancelar. */
  async createPortalSession(tenantId: string): Promise<{ url: string }> {
    const tenant = await this.control.tenant.findUnique({ where: { id: tenantId }, select: { stripeCustomerId: true } });
    if (!tenant?.stripeCustomerId) throw new BadRequestException(i18nMessage('errors.NO_BILLING_ACCOUNT'));

    const session = await this.stripe.billingPortal.sessions.create({
      customer: tenant.stripeCustomerId,
      return_url: withTenantParam(`${this.platformUrl}/admin/suscripcion`, tenantId),
    });
    return { url: session.url };
  }

  // ---------------------------------------------------------------------------------------------
  // 1c. Métricas del plano de control
  // ---------------------------------------------------------------------------------------------

  private planPriceCache: { at: number; prices: Partial<Record<PlanKey, { amount: number; currency: string }>> } | null = null;

  /**
   * Precio mensual de lista de cada plan, leído de Stripe (cache de 10 min). Es la fuente de verdad
   * de los montos: front/components/modules/platform/plans.ts solo los muestra.
   */
  async planMonthlyPrices(): Promise<Partial<Record<PlanKey, { amount: number; currency: string }>>> {
    if (this.planPriceCache && Date.now() - this.planPriceCache.at < 10 * 60_000) return this.planPriceCache.prices;

    const prices: Partial<Record<PlanKey, { amount: number; currency: string }>> = {};
    await Promise.all(
      (Object.keys(PLANS) as PlanKey[]).map(async (plan) => {
        const priceId = priceIdFor(plan);
        if (!priceId) return;
        try {
          const price = await this.stripe.prices.retrieve(priceId);
          if (price.unit_amount == null) return;
          // Un precio anual se lleva a su equivalente mensual
          const months = price.recurring?.interval === 'year' ? 12 : 1;
          prices[plan] = { amount: price.unit_amount / 100 / months, currency: price.currency.toUpperCase() };
        } catch (error) {
          this.logger.warn(`No se pudo leer el precio de ${plan} en Stripe: ${(error as Error).message}`);
        }
      }),
    );
    this.planPriceCache = { at: Date.now(), prices };
    return prices;
  }

  private hasLiveSubscription(tenant: { subscriptionStatus: string | null; stripeSubscriptionId: string | null }): boolean {
    return !!tenant.stripeSubscriptionId && LIVE_STATUSES.has(tenant.subscriptionStatus ?? '');
  }

  // ---------------------------------------------------------------------------------------------
  // 2. Webhooks (los llama PaymentsService.handleWebhookEvent tras validar la firma)
  // ---------------------------------------------------------------------------------------------

  /** checkout.session.completed y checkout.session.async_payment_succeeded */
  async handleCheckoutPaid(session: Stripe.Checkout.Session): Promise<void> {
    if (session.metadata?.kind === TENANT_SUBSCRIPTION_KIND) return this.linkTenantSubscription(session);
    if (session.metadata?.kind !== SIGNUP_KIND || !session.metadata.signupId) return;

    // Con medios de pago asíncronos, completed llega con payment_status "unpaid": se espera a
    // async_payment_succeeded, que vuelve a entrar por acá ya pagado.
    if (session.payment_status !== 'paid' && session.payment_status !== 'no_payment_required') {
      this.logger.log(`Checkout ${session.id} completado sin pago confirmado (${session.payment_status}): se espera`);
      return;
    }

    const signupId = session.metadata.signupId;
    const claimed = await this.claimForProvisioning(signupId, {
      stripeCustomerId: typeof session.customer === 'string' ? session.customer : session.customer?.id ?? null,
      stripeSubscriptionId: typeof session.subscription === 'string' ? session.subscription : session.subscription?.id ?? null,
    });
    if (!claimed) return; // ya en curso o completado: Stripe reenvió el evento, no se duplica nada

    // Se responde a Stripe sin esperar: crear el schema y migrar puede tardar más que el timeout
    // del webhook. El estado queda en tenant_signups, y si esto falla se reintenta con retrySignup().
    void this.provisionSignup(signupId);
  }

  /** checkout.session.expired: el visitante no pagó. Se borra el hash de su contraseña. */
  async handleCheckoutExpired(session: Stripe.Checkout.Session): Promise<void> {
    if (session.metadata?.kind !== SIGNUP_KIND || !session.metadata.signupId) return;
    await this.control.tenantSignup.updateMany({
      where: { id: session.metadata.signupId, status: 'PENDING' },
      data: { status: 'EXPIRED', passwordHash: '' },
    });
  }

  /**
   * Checkout de una tienda existente pagado: le vincula la suscripción. Un reenvío del evento escribe
   * los mismos valores (idempotente). Si la tienda ya tenía OTRA suscripción viva no se pisa.
   */
  private async linkTenantSubscription(session: Stripe.Checkout.Session): Promise<void> {
    const tenantId = session.metadata?.tenantId;
    const subscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
    if (!tenantId || !subscriptionId) return;
    if (session.payment_status !== 'paid' && session.payment_status !== 'no_payment_required') {
      this.logger.log(`Checkout ${session.id} completado sin pago confirmado (${session.payment_status}): se espera`);
      return;
    }

    const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id ?? null;
    const { count } = await this.control.tenant.updateMany({
      where: {
        id: tenantId,
        OR: [
          { stripeSubscriptionId: null },
          { stripeSubscriptionId: subscriptionId },
          { subscriptionStatus: null },
          { subscriptionStatus: { notIn: [...LIVE_STATUSES] } },
        ],
      },
      data: { stripeSubscriptionId: subscriptionId, ...(customerId ? { stripeCustomerId: customerId } : {}) },
    });
    if (count === 0) {
      this.logger.error(
        `Tienda ${tenantId} ya tenía otra suscripción viva; ${subscriptionId} quedó sin vincular (revisar doble cobro en Stripe)`,
      );
      return;
    }

    // Estado y plan desde la suscripción actual, no desde la sesión
    await this.syncTenant(await this.stripe.subscriptions.retrieve(subscriptionId));
    this.logger.log(`Suscripción ${subscriptionId} vinculada a la tienda ${tenantId}`);
  }

  /** customer.subscription.updated / deleted: la tienda se suspende si deja de pagar. */
  async handleSubscriptionChange(eventSubscription: Stripe.Subscription): Promise<void> {
    // Stripe no garantiza el orden de entrega (ni que no repita eventos): se lee el estado ACTUAL en
    // vez de aplicar el del evento, así un "updated" viejo que llega tarde no pisa un "deleted".
    const subscription = await this.stripe.subscriptions.retrieve(eventSubscription.id).catch((error: Error) => {
      this.logger.warn(`No se pudo releer la suscripción ${eventSubscription.id}, se usa la del evento: ${error.message}`);
      return eventSubscription;
    });
    await this.syncTenant(subscription);
  }

  private async syncTenant(subscription: Stripe.Subscription): Promise<void> {
    const tenant = await this.control.tenant.findUnique({
      where: { stripeSubscriptionId: subscription.id },
      select: { id: true, status: true, subscriptionStatus: true },
    });
    if (!tenant) return; // suscripción de otra cosa, o la tienda todavía se está creando

    // Cambio de plan desde el Billing Portal: llega como otro price_id
    const plan = planForPrice(subscription.items.data[0]?.price.id);
    const suspend = SUSPENDING_STATUSES.has(subscription.status);
    // Solo se reactiva lo que suspendió la FACTURACIÓN: la tienda estaba suspendida y su último estado
    // de pago era uno de los que suspenden. Si el estado anterior era sano, la suspensión la hizo el
    // admin de plataforma (PATCH /platform/tenants/:id/status) y un webhook no debe deshacerla.
    const billingSuspended = tenant.status === 'SUSPENDED' && SUSPENDING_STATUSES.has(tenant.subscriptionStatus ?? '');
    await this.control.tenant.update({
      where: { id: tenant.id },
      data: {
        subscriptionStatus: subscription.status,
        ...(plan ? { plan } : {}),
        // Una tienda FAILED/PROVISIONING no se toca
        ...(suspend && tenant.status === 'ACTIVE' ? { status: 'SUSPENDED' } : {}),
        ...(!suspend && billingSuspended && subscription.status === 'active' ? { status: 'ACTIVE' } : {}),
      },
    });
    if (suspend) this.logger.warn(`Tienda ${tenant.id} suspendida: suscripción ${subscription.status}`);
  }

  // ---------------------------------------------------------------------------------------------
  // 3. Aprovisionamiento
  // ---------------------------------------------------------------------------------------------

  /** Reintento manual (plataforma) de un alta pagada que falló. */
  async retrySignup(signupId: string): Promise<void> {
    const signup = await this.control.tenantSignup.findUnique({ where: { id: signupId }, select: { status: true } });
    if (!signup) throw new NotFoundException(i18nMessage('errors.SIGNUP_NOT_FOUND'));
    if (signup.status === 'PENDING' || signup.status === 'EXPIRED') {
      throw new BadRequestException(i18nMessage('errors.SIGNUP_NOT_PAID'));
    }
    if (!(await this.claimForProvisioning(signupId, {}))) {
      throw new ConflictException(i18nMessage('errors.SIGNUP_IN_PROGRESS'));
    }
    await this.provisionSignup(signupId);
  }

  /**
   * Pasa a PROVISIONING de forma atómica (un UPDATE condicional): de dos webhooks simultáneos solo
   * uno lo logra. Acepta PENDING (primer intento), FAILED (reintento) y PROVISIONING colgado.
   */
  private async claimForProvisioning(
    signupId: string,
    billing: { stripeCustomerId?: string | null; stripeSubscriptionId?: string | null },
  ): Promise<boolean> {
    const { count } = await this.control.tenantSignup.updateMany({
      where: {
        id: signupId,
        OR: [
          { status: { in: ['PENDING', 'FAILED'] } },
          { status: 'PROVISIONING', updatedAt: { lt: new Date(Date.now() - STALE_PROVISIONING_MS) } },
        ],
      },
      data: {
        status: 'PROVISIONING',
        error: null,
        ...(billing.stripeCustomerId ? { stripeCustomerId: billing.stripeCustomerId } : {}),
        ...(billing.stripeSubscriptionId ? { stripeSubscriptionId: billing.stripeSubscriptionId } : {}),
      },
    });
    return count === 1;
  }

  private async provisionSignup(signupId: string): Promise<void> {
    const signup = await this.control.tenantSignup.findUniqueOrThrow({ where: { id: signupId } });
    try {
      // El id de la tienda se fija una sola vez: si un intento anterior ya creó el registro, se
      // retoma esa tienda (retry) en vez de crear otra con la misma credencial de dueño
      const tenantId = signup.tenantId ?? randomUUID();
      if (!signup.tenantId) {
        await this.control.tenantSignup.update({ where: { id: signupId }, data: { tenantId } });
      }

      const existing = await this.control.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
      if (existing) {
        await this.provisioning.retry(tenantId);
      } else {
        await this.provisioning.createTenant({
          id: tenantId,
          name: signup.tenantName,
          slug: await this.availableSlug(signup.tenantName),
          ownerEmail: signup.adminEmail,
          ownerPasswordHash: signup.passwordHash,
          plan: signup.plan,
          domain: await this.domainIfFree(signup.domain),
          stripeCustomerId: signup.stripeCustomerId,
          stripeSubscriptionId: signup.stripeSubscriptionId,
        });
      }

      await this.control.tenantSignup.update({
        where: { id: signupId },
        data: { status: 'COMPLETED', passwordHash: '', error: null },
      });
      this.logger.log(`Alta self-service completada: ${signup.tenantName} (${tenantId})`);

      await this.mail.sendTenantWelcome({
        to: signup.adminEmail,
        tenantName: signup.tenantName,
        loginUrl: this.loginUrl(tenantId),
        domain: signup.domain,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Alta self-service ${signupId} falló: ${message}`);
      await this.control.tenantSignup
        .update({ where: { id: signupId }, data: { status: 'FAILED', error: message.slice(0, 4000) } })
        .catch(() => undefined);
    }
  }

  // "Boutique Aurora" → "boutique-aurora"; si ya existe, "boutique-aurora-2", "-3"…
  private async availableSlug(name: string): Promise<string> {
    const base =
      name
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 50) || 'tienda';

    const taken = new Set(
      (await this.control.tenant.findMany({ where: { slug: { startsWith: base } }, select: { slug: true } })).map((t) => t.slug),
    );
    if (!taken.has(base)) return base;
    for (let n = 2; n < 1000; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
    return `${base}-${randomUUID().slice(0, 8)}`;
  }

  // Se validó en el checkout, pero otra tienda pudo tomarlo mientras se pagaba: la tienda se crea
  // igual (ya pagó) y el dominio se resuelve con soporte
  private async domainIfFree(domain: string | null): Promise<string | null> {
    if (!domain) return null;
    const taken = await this.control.tenant.findFirst({ where: { domain }, select: { id: true } });
    if (taken) this.logger.warn(`Dominio ${domain} tomado durante el checkout: la tienda se crea sin dominio`);
    return taken ? null : domain;
  }

  private loginUrl(tenantId: string): string {
    return withTenantParam(`${this.platformUrl}/auth/login`, tenantId);
  }
}

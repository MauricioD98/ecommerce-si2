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
import { TenantResolutionCache } from '../../tenancy/tenant-resolution-cache.service';
import { withTenantParam } from '../../tenancy/tenant-context';
import { MailService } from '../mail/mail.service';
import { i18nMessage } from '../../i18n/i18n-message';
import { PlatformAuditService, SYSTEM_ACTOR } from './audit/platform-audit.service';
import { SubscriptionCheckoutDto } from './dto/subscription-checkout.dto';
import {
  BILLING_INTERVALS,
  PLANS,
  type BillingInterval,
  type PlanKey,
  getPlanFeatures,
  intervalFromStripe,
  minimumPlanName,
  missingBillingEnv,
  planForPrice,
  priceEnvFor,
  priceLookup,
  priceIdFor,
} from './plans';

export interface PlanPrice {
  plan: PlanKey;
  interval: BillingInterval;
  available: boolean;
  amount: number | null; // en la moneda, no en centavos
  currency: string | null;
}

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
    private readonly tenantCache: TenantResolutionCache,
    private readonly audit: PlatformAuditService,
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
    const interval = dto.interval ?? 'monthly';
    const priceId = this.requirePrice(dto.plan, interval);

    const planFeatures = getPlanFeatures(dto.plan);
    const normalizedDomain = planFeatures.customDomain ? (dto.domain ?? null) : null;
    if (dto.domain && !planFeatures.customDomain) {
      throw new BadRequestException(
        i18nMessage('errors.PLAN_SIGNUP_CUSTOM_DOMAIN', { plan: minimumPlanName((plan) => plan.customDomain) }),
      );
    }

    // Se valida ANTES de cobrar: después del pago ya no se le puede decir "ese email está tomado"
    const [ownerTaken, domainTaken] = await Promise.all([
      this.control.tenantCredential.findFirst({
        where: { type: 'OWNER_PASSWORD', identifier: dto.adminEmail },
        select: { id: true },
      }),
      normalizedDomain
        ? this.control.tenant.findFirst({ where: { domain: normalizedDomain }, select: { id: true } })
        : null,
    ]);
    if (ownerTaken) throw new ConflictException(i18nMessage('errors.OWNER_EMAIL_TAKEN'));
    if (domainTaken) throw new ConflictException(i18nMessage('errors.DOMAIN_TAKEN'));

    const signup = await this.control.tenantSignup.create({
      data: {
        plan: dto.plan,
        tenantName: dto.tenantName,
        domain: normalizedDomain,
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
      interval,
      tenantName: dto.tenantName.slice(0, 100),
      domain: normalizedDomain ?? '',
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
  async getTenantSubscription(tenantId: string, sessionId?: string) {
    let tenant = await this.control.tenant.findUnique({
      where: { id: tenantId },
      select: { plan: true, subscriptionStatus: true, stripeSubscriptionId: true, stripeCustomerId: true },
    });
    if (!tenant) throw new NotFoundException(i18nMessage('errors.TENANT_NOT_FOUND'));

    // Respaldo sin webhook (p. ej. en desarrollo local sin `stripe listen`): si viene session_id de la
    // redirección de Stripe Checkout y la tienda aún no figura activa, se consulta la sesión directamente.
    if (sessionId && /^cs_(test|live)_/.test(sessionId) && !this.hasLiveSubscription(tenant)) {
      try {
        const session = await this.stripe.checkout.sessions.retrieve(sessionId);
        if (
          session.status === 'complete' &&
          session.metadata?.kind === TENANT_SUBSCRIPTION_KIND &&
          session.metadata?.tenantId === tenantId
        ) {
          await this.linkTenantSubscription(session);
          tenant = (await this.control.tenant.findUnique({
            where: { id: tenantId },
            select: { plan: true, subscriptionStatus: true, stripeSubscriptionId: true, stripeCustomerId: true },
          }))!;
        }
      } catch (error) {
        this.logger.warn(`No se pudo verificar la sesión ${sessionId} en Stripe: ${(error as Error).message}`);
      }
    }

    let cancelAtPeriodEnd = false;
    let currentPeriodEnd: string | null = null;
    let interval: BillingInterval | null = null;
    let amount: number | null = null;
    let currency: string | null = null;
    if (tenant.stripeSubscriptionId) {
      try {
        const subscription = await this.stripe.subscriptions.retrieve(tenant.stripeSubscriptionId);
        cancelAtPeriodEnd = subscription.cancel_at_period_end;
        const item = subscription.items.data[0];
        const end = item?.current_period_end;
        currentPeriodEnd = end ? new Date(end * 1000).toISOString() : null;
        interval = intervalFromStripe(item?.price.recurring?.interval);
        amount = item?.price.unit_amount != null ? item.price.unit_amount / 100 : null;
        currency = item?.price.currency ? item.price.currency.toUpperCase() : null;
        // También sincroniza si el cliente cambió de plan desde el Billing Portal de Stripe
        await this.syncTenant(subscription);
        const refreshed = await this.control.tenant.findUnique({
          where: { id: tenantId },
          select: { plan: true, subscriptionStatus: true, stripeSubscriptionId: true, stripeCustomerId: true },
        });
        if (refreshed) tenant = refreshed;
      } catch (error) {
        // El estado de la BD alcanza para la pantalla; los detalles son un extra
        this.logger.warn(`No se pudo leer la suscripción ${tenant.stripeSubscriptionId}: ${(error as Error).message}`);
      }
    }

    const plan = tenant.plan in PLANS ? (tenant.plan as PlanKey) : null;
    return {
      plan: tenant.plan,
      planName: plan ? PLANS[plan].name : tenant.plan,
      features: getPlanFeatures(tenant.plan),
      status: tenant.subscriptionStatus,
      active: this.hasLiveSubscription(tenant),
      canManage: !!tenant.stripeCustomerId,
      cancelAtPeriodEnd,
      currentPeriodEnd,
      // Mensual o anual, y lo que se cobra por período (del Price real de la suscripción)
      interval,
      amount,
      currency,
    };
  }

  async createTenantCheckout(
    tenantId: string,
    ownerEmail: string,
    plan: PlanKey,
    interval: BillingInterval = 'monthly',
  ): Promise<{ url: string }> {
    const priceId = this.requirePrice(plan, interval);

    const tenant = await this.control.tenant.findUnique({
      where: { id: tenantId },
      select: { subscriptionStatus: true, stripeSubscriptionId: true, stripeCustomerId: true },
    });
    if (!tenant) throw new NotFoundException(i18nMessage('errors.TENANT_NOT_FOUND'));
    if (this.hasLiveSubscription(tenant)) throw new ConflictException(i18nMessage('errors.SUBSCRIPTION_ALREADY_ACTIVE'));

    // La tienda sale del token (tenantId), nunca del body: nadie puede pagar a nombre de otra
    const metadata = { kind: TENANT_SUBSCRIPTION_KIND, tenantId, plan, interval };
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
      // La vuelta incluye session_id para sincronizar en local aunque no esté corriendo stripe listen
      success_url: withTenantParam(`${returnUrl}?checkout=success&session_id={CHECKOUT_SESSION_ID}`, tenantId),
      cancel_url: withTenantParam(`${returnUrl}?checkout=cancelled`, tenantId),
    });
    if (!session.url) throw new ServiceUnavailableException(i18nMessage('errors.PAYMENT_URL_MISSING'));
    return { url: session.url };
  }

  /** Billing Portal de Stripe: cambiar de plan, actualizar la tarjeta, ver facturas o cancelar. */
  async createPortalSession(tenantId: string): Promise<{ url: string }> {
    const tenant = await this.control.tenant.findUnique({ where: { id: tenantId }, select: { stripeCustomerId: true } });
    if (!tenant?.stripeCustomerId) throw new BadRequestException(i18nMessage('errors.NO_BILLING_ACCOUNT'));

    // STRIPE_PORTAL_CONFIGURATION (bpc_...) permite cambiar entre los 3 planes y entre mensual y anual.
    // Sin ella Stripe usa la configuración por defecto de la cuenta (si existe).
    const configuration = process.env.STRIPE_PORTAL_CONFIGURATION?.trim();
    const session = await this.stripe.billingPortal.sessions.create({
      customer: tenant.stripeCustomerId,
      return_url: withTenantParam(`${this.platformUrl}/admin/suscripcion`, tenantId),
      ...(configuration?.startsWith('bpc_') ? { configuration } : {}),
    });
    return { url: session.url };
  }

  private requirePrice(plan: PlanKey, interval: BillingInterval): string {
    const priceId = priceIdFor(plan, interval);
    if (!priceId) {
      this.logger.error(`Falta ${priceEnvFor(plan, interval)} (price_...) en el entorno: corre npm run stripe:sandbox-plans`);
      throw new ServiceUnavailableException(i18nMessage('errors.PLAN_UNAVAILABLE'));
    }
    return priceId;
  }

  private planPricesCache: { at: number; prices: PlanPrice[] } | null = null;

  /**
   * Catálogo público: para cada plan e intervalo, si se puede contratar y su precio real en Stripe
   * (cache de 10 min). El front lo usa para mostrar los montos y deshabilitar lo que no está configurado.
   */
  async planPrices(): Promise<PlanPrice[]> {
    if (this.planPricesCache && Date.now() - this.planPricesCache.at < 10 * 60_000) return this.planPricesCache.prices;
    const combos = (Object.keys(PLANS) as PlanKey[]).flatMap((plan) => BILLING_INTERVALS.map((interval) => ({ plan, interval })));
    const prices = await Promise.all(
      combos.map(async ({ plan, interval }): Promise<PlanPrice> => {
        const priceId = priceIdFor(plan, interval);
        const empty = { plan, interval, available: false, amount: null, currency: null };
        if (!priceId) return empty;
        try {
          const price = await this.stripe.prices.retrieve(priceId);
          if (!price.active || price.unit_amount == null) return empty;
          return { plan, interval, available: true, amount: price.unit_amount / 100, currency: price.currency.toUpperCase() };
        } catch (error) {
          this.logger.warn(`No se pudo leer el precio ${interval} de ${plan} en Stripe: ${(error as Error).message}`);
          return empty;
        }
      }),
    );
    // Si Stripe falló en todo, no se cachea: el próximo intento vuelve a consultar
    if (prices.some((p) => p.available)) this.planPricesCache = { at: Date.now(), prices };
    return prices;
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
      select: { id: true, slug: true, plan: true, status: true, subscriptionStatus: true },
    });
    if (!tenant) return; // suscripción de otra cosa, o la tienda todavía se está creando

    // Cambio de plan desde el Billing Portal: llega como otro price_id. Solo se reconocen los Prices
    // de ESTE proyecto (STRIPE_PRICE_*): un Price ajeno no cambia el plan.
    const item = subscription.items.data[0];
    const plan = planForPrice(item?.price.id);
    const suspend = SUSPENDING_STATUSES.has(subscription.status);
    // Solo se reactiva lo que suspendió la FACTURACIÓN: la tienda estaba suspendida y su último estado
    // de pago era uno de los que suspenden. Si el estado anterior era sano, la suspensión la hizo el
    // admin de plataforma (PATCH /platform/tenants/:id/status) y un webhook no debe deshacerla.
    const billingSuspended = tenant.status === 'SUSPENDED' && SUSPENDING_STATUSES.has(tenant.subscriptionStatus ?? '');
    const suspendNow = suspend && tenant.status === 'ACTIVE';
    const reactivateNow = !suspend && billingSuspended && subscription.status === 'active';
    await this.control.tenant.update({
      where: { id: tenant.id },
      data: {
        subscriptionStatus: subscription.status,
        ...(plan ? { plan } : {}),
        // Detalle para la supervisión de la plataforma, tal como lo informa Stripe
        ...this.subscriptionDetails(subscription),
        // Una tienda FAILED/PROVISIONING no se toca
        ...(suspendNow ? { status: 'SUSPENDED' } : {}),
        ...(reactivateNow ? { status: 'ACTIVE' } : {}),
      },
    });
    // Invalidar cache del tenant para que el nuevo plan o estado aplique de inmediato
    this.tenantCache.invalidate(tenant.id, tenant.slug);
    if (suspend) this.logger.warn(`Tienda ${tenant.id} suspendida: suscripción ${subscription.status}`);
    // Auditoría solo cuando el estado de la tienda cambia de verdad (un webhook repetido no lo cambia)
    if (suspendNow || reactivateNow) {
      await this.audit.record({
        actor: SYSTEM_ACTOR,
        action: suspendNow ? 'TENANT_SUSPENDED_BY_BILLING' : 'TENANT_REACTIVATED_BY_BILLING',
        result: 'SUCCESS',
        tenantId: tenant.id,
        details: { from: tenant.status, to: suspendNow ? 'SUSPENDED' : 'ACTIVE', subscriptionStatus: subscription.status },
      });
    }
  }

  /** Columnas de detalle de la suscripción (public.tenants) a partir del objeto de Stripe */
  private subscriptionDetails(subscription: Stripe.Subscription) {
    const item = subscription.items.data[0];
    const toDate = (seconds: number | null | undefined) => (seconds ? new Date(seconds * 1000) : null);
    return {
      stripePriceId: item?.price.id ?? null,
      billingInterval: intervalFromStripe(item?.price.recurring?.interval),
      currentPeriodEnd: toDate(item?.current_period_end),
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      cancelAt: toDate(subscription.cancel_at),
      subscriptionEndedAt: toDate(subscription.ended_at),
      subscriptionSyncedAt: new Date(),
    };
  }

  // ---------------------------------------------------------------------------------------------
  // 2b. Supervisión desde la plataforma (PlatformAdminGuard)
  // ---------------------------------------------------------------------------------------------

  /**
   * Suscripciones de todas las tiendas con lo que guardaron los webhooks: no consulta Stripe por cada
   * tienda. priceRecognized = el Price es uno de los planes de este proyecto (STRIPE_PRICE_*).
   */
  async listTenantSubscriptions() {
    const tenants = await this.control.tenant.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true,
        slug: true,
        name: true,
        status: true,
        plan: true,
        stripeSubscriptionId: true,
        subscriptionStatus: true,
        stripePriceId: true,
        billingInterval: true,
        currentPeriodEnd: true,
        cancelAtPeriodEnd: true,
        cancelAt: true,
        subscriptionEndedAt: true,
        subscriptionSyncedAt: true,
      },
    });
    return tenants.map(({ stripeSubscriptionId, stripePriceId, ...tenant }) => ({
      ...tenant,
      hasSubscription: !!stripeSubscriptionId,
      // null = todavía no se sincronizó el Price (no se sabe)
      priceRecognized: stripePriceId ? !!priceLookup(stripePriceId) : null,
    }));
  }

  /**
   * Relee en Stripe la suscripción ya vinculada a una tienda y aplica syncTenant (las mismas reglas que
   * un webhook). Solo LEE en Stripe: no crea, cambia ni cancela nada allí.
   */
  async syncTenantFromStripe(tenantId: string) {
    const tenant = await this.control.tenant.findUnique({ where: { id: tenantId }, select: { stripeSubscriptionId: true } });
    if (!tenant) throw new NotFoundException(i18nMessage('errors.TENANT_NOT_FOUND'));
    if (!tenant.stripeSubscriptionId) throw new ConflictException('La tienda no tiene una suscripción de Stripe vinculada');
    let subscription: Stripe.Subscription;
    try {
      subscription = await this.stripe.subscriptions.retrieve(tenant.stripeSubscriptionId);
    } catch (error) {
      this.logger.warn(`No se pudo leer la suscripción ${tenant.stripeSubscriptionId}: ${(error as Error).message}`);
      throw new ServiceUnavailableException('No se pudo consultar la suscripción en Stripe');
    }
    await this.syncTenant(subscription);
    return (await this.listTenantSubscriptions()).find((row) => row.id === tenantId) ?? null;
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

import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import Stripe from 'stripe';
import { createStripeClient } from './stripe-gateway.service';
import { ControlPrismaService } from '../../tenancy/control-prisma.service';
import { TenantContext } from '../../tenancy/tenant-context';

export interface PayoutAccount {
  accountId: string;
  feeBps: number;
}

/**
 * Stripe Connect con "destination charges": el PaymentIntent se crea en la cuenta de la plataforma
 * (una sola STRIPE_SECRET_KEY y un solo webhook), pero con transfer_data.destination = acct_ de la
 * tienda, así que los fondos se liquidan en la cuenta bancaria de la tienda y la plataforma solo
 * retiene application_fee_amount.
 *
 * Sin cuenta conectada Y habilitada no hay tarjeta, con cualquier clave (sk_test_ o sk_live_) y para
 * cualquier tienda, la legacy incluida: nunca se cobra a la cuenta central como alternativa.
 */
@Injectable()
export class StripeConnectService {
  private readonly logger = new Logger(StripeConnectService.name);
  private readonly stripe = createStripeClient();

  constructor(private readonly control: ControlPrismaService) {}

  /** Cuenta destino para cobrar en nombre de la tienda; null si no tiene Connect activo. */
  async getPayoutAccountOrNull(tenantId: string): Promise<PayoutAccount | null> {
    const tenant = await this.control.tenant.findUnique({
      where: { id: tenantId },
      select: { stripeAccountId: true, stripeChargesEnabled: true, platformFeeBps: true },
    });
    if (!tenant?.stripeAccountId || !tenant.stripeChargesEnabled) {
      return null;
    }
    return { accountId: tenant.stripeAccountId, feeBps: tenant.platformFeeBps };
  }

  /** Cuenta destino para cobrar en nombre de la tienda; falla si no terminó el onboarding. */
  async getPayoutAccount(tenantId: string): Promise<PayoutAccount> {
    const account = await this.getPayoutAccountOrNull(tenantId);
    if (!account) {
      throw new BadRequestException('Esta tienda todavía no tiene habilitados los pagos con tarjeta');
    }
    return account;
  }

  feeFor(amountInCents: number, feeBps: number): number | undefined {
    const fee = Math.floor((amountInCents * feeBps) / 10_000);
    return fee > 0 ? fee : undefined;
  }

  /** Crea (si hace falta) la cuenta Express de la tienda y devuelve el link de onboarding de Stripe. */
  async createOnboardingLink(tenantId: string, returnUrl: string, refreshUrl: string): Promise<{ url: string }> {
    const tenant = await this.control.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Tienda no encontrada');

    let accountId = tenant.stripeAccountId;
    if (!accountId) {
      accountId = await this.createExpressAccount(tenantId, tenant.name);
      // Condicional: si otra petición ya vinculó una cuenta, se respeta esa y no se pisa
      const { count } = await this.control.tenant.updateMany({
        where: { id: tenantId, stripeAccountId: null },
        data: { stripeAccountId: accountId },
      });
      if (count === 0) {
        const current = await this.control.tenant.findUnique({ where: { id: tenantId }, select: { stripeAccountId: true } });
        if (current?.stripeAccountId && current.stripeAccountId !== accountId) {
          this.logger.warn(`Tienda ${tenantId}: ya tenía otra cuenta conectada; la recién creada queda sin usar`);
          accountId = current.stripeAccountId;
        }
      }
    }

    const link = await this.stripe.accountLinks.create({
      account: accountId,
      type: 'account_onboarding',
      return_url: returnUrl,
      refresh_url: refreshUrl,
    });
    return { url: link.url };
  }

  // Dos clicks seguidos en "Configurar pagos" no crean dos cuentas: misma clave idempotente. Pero Stripe
  // también guarda (24 h) la respuesta de un intento FALLIDO con esa clave, p. ej. "Connect no activado":
  // corregida la causa, cada reintento recibía el mismo error. Si Stripe repite un error guardado (4xx,
  // cabecera Idempotent-Replayed), se reintenta una vez con una clave nueva, estable durante el minuto
  // para que los clicks simultáneos sigan compartiéndola.
  private async createExpressAccount(tenantId: string, name: string): Promise<string> {
    const params: Stripe.AccountCreateParams = {
      type: 'express',
      metadata: { tenantId },
      business_profile: { name },
      capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
    };
    try {
      return (await this.stripe.accounts.create(params, { idempotencyKey: `connect-account-${tenantId}` })).id;
    } catch (error) {
      const replayed = error instanceof Stripe.errors.StripeError && error.headers?.['idempotent-replayed'] === 'true';
      if (!replayed || (error.statusCode ?? 500) >= 500) throw error;
      this.logger.warn(`Tienda ${tenantId}: Stripe repitió un error guardado del onboarding; se reintenta con otra clave`);
      const retryKey = `connect-account-${tenantId}-r${Math.floor(Date.now() / 60_000)}`;
      return (await this.stripe.accounts.create(params, { idempotencyKey: retryKey })).id;
    }
  }

  /**
   * Estado de la cuenta conectada para el panel de la tienda. Si todavía no está habilitada se
   * consulta a Stripe y se sincroniza.
   */
  async getStatus(tenantId: string): Promise<{ connected: boolean; chargesEnabled: boolean; detailsSubmitted: boolean; pendingRequirements: number }> {
    const tenant = await this.control.tenant.findUnique({
      where: { id: tenantId },
      select: { stripeAccountId: true, stripeChargesEnabled: true },
    });
    if (!tenant) throw new NotFoundException('Tienda no encontrada');
    if (!tenant.stripeAccountId) {
      return { connected: false, chargesEnabled: false, detailsSubmitted: false, pendingRequirements: 0 };
    }

    try {
      const account = await this.stripe.accounts.retrieve(tenant.stripeAccountId);
      await this.syncAccount(account);
      return {
        connected: true,
        chargesEnabled: Boolean(account.charges_enabled && account.payouts_enabled),
        detailsSubmitted: account.details_submitted,
        pendingRequirements: account.requirements?.currently_due?.length ?? 0,
      };
    } catch (error) {
      // Sin respuesta de Stripe se muestra lo último que se sabe
      this.logger.warn(`No se pudo leer la cuenta ${tenant.stripeAccountId}: ${(error as Error).message}`);
      return { connected: true, chargesEnabled: tenant.stripeChargesEnabled, detailsSubmitted: false, pendingRequirements: 0 };
    }
  }

  /**
   * Desvincula la cuenta conectada: la tienda deja de cobrar con tarjeta.
   */
  async disconnect(tenantId: string): Promise<void> {
    const { count } = await this.control.tenant.updateMany({
      where: { id: tenantId },
      data: { stripeAccountId: null, stripeChargesEnabled: false },
    });
    if (count === 0) throw new NotFoundException('Tienda no encontrada');
  }

  /** Cuenta conectada (para mostrarla en el panel), sin consultar a Stripe. */
  async getAccountId(tenantId: string): Promise<string | null> {
    const tenant = await this.control.tenant.findUnique({ where: { id: tenantId }, select: { stripeAccountId: true } });
    return tenant?.stripeAccountId ?? null;
  }

  /** Para el checkout de la tienda: tarjeta solo con la misma condición que exige createPaymentIntent. */
  async isCardEnabled(tenantId: string): Promise<boolean> {
    return (await this.getPayoutAccountOrNull(tenantId)) !== null;
  }

  /** account.updated: Stripe avisa cuando la tienda completa (o pierde) la verificación. */
  async syncAccount(account: Stripe.Account): Promise<void> {
    const { count } = await this.control.tenant.updateMany({
      where: { stripeAccountId: account.id },
      data: { stripeChargesEnabled: Boolean(account.charges_enabled && account.payouts_enabled) },
    });
    if (count === 0) this.logger.warn(`account.updated de una cuenta sin tienda asociada: ${account.id}`);
  }

  /**
   * Tienda dueña de un PaymentIntent, para abrir su schema desde el webhook.
   */
  async resolveTenantForPaymentIntent(pi: Stripe.PaymentIntent): Promise<TenantContext | null> {
    const tenantId = pi.metadata?.tenantId;
    if (!tenantId) return this.resolveLegacyTenant(pi);

    // PaymentIntents ya creados sin destino (cobro a la cuenta central, el comportamiento anterior con
    // sk_test_ o con la tienda legacy): ya no se crean, pero un cliente pudo haberlos pagado y su evento
    // tiene que seguir llegando a su tienda. reconcileIntent lo valida contra el intento durable (que
    // tampoco tiene destino) y deja una anomalía para transferirle el importe a la tienda.
    if (!pi.transfer_data) {
      const tenant = await this.control.tenant.findUnique({
        where: { id: tenantId },
        select: { id: true, schemaName: true },
      });
      if (!tenant) return null;
      this.logger.warn(`PaymentIntent ${pi.id} sin destino Connect (tienda ${tenantId}): cobrado en la cuenta central`);
      return { tenantId: tenant.id, schemaName: tenant.schemaName };
    }

    const tenant = await this.control.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, schemaName: true, stripeAccountId: true },
    });
    const destination =
      typeof pi.transfer_data?.destination === 'string' ? pi.transfer_data.destination : pi.transfer_data?.destination?.id;

    if (!tenant || !tenant.stripeAccountId || destination !== tenant.stripeAccountId) {
      this.logger.error(`PaymentIntent ${pi.id}: tenant ${tenantId} no coincide con el destino ${destination}`);
      return null;
    }
    return { tenantId: tenant.id, schemaName: tenant.schemaName };
  }

  private async resolveLegacyTenant(pi: Stripe.PaymentIntent): Promise<TenantContext | null> {
    const legacyId = process.env.LEGACY_TENANT_ID;
    if (!legacyId || pi.transfer_data) return null;

    const tenant = await this.control.tenant.findUnique({
      where: { id: legacyId },
      select: { id: true, schemaName: true },
    });
    if (!tenant) {
      this.logger.error(`LEGACY_TENANT_ID=${legacyId} no existe en public.tenants`);
      return null;
    }
    this.logger.warn(`PaymentIntent legacy ${pi.id} asignado a la tienda ${tenant.id} (LEGACY_TENANT_ID)`);
    return { tenantId: tenant.id, schemaName: tenant.schemaName };
  }
}

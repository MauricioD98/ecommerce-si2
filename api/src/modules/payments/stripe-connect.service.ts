import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import Stripe from 'stripe';
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
 * Los datos de Connect viven en public.tenants (plano de control), no en el schema de la tienda:
 * el webhook llega sin tenant y tiene que poder resolverlos antes de abrir ningún schema.
 */
@Injectable()
export class StripeConnectService {
  private readonly logger = new Logger(StripeConnectService.name);
  private readonly stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

  constructor(private readonly control: ControlPrismaService) {}

  /** Cuenta destino para cobrar en nombre de la tienda; falla si no terminó el onboarding. */
  async getPayoutAccount(tenantId: string): Promise<PayoutAccount> {
    const tenant = await this.control.tenant.findUnique({
      where: { id: tenantId },
      select: { stripeAccountId: true, stripeChargesEnabled: true, platformFeeBps: true },
    });
    // Nunca se cae a la cuenta central: cobrar sin destino mandaría la plata de la tienda a la plataforma
    if (!tenant?.stripeAccountId || !tenant.stripeChargesEnabled) {
      throw new BadRequestException('Esta tienda todavía no tiene habilitados los pagos con tarjeta');
    }
    return { accountId: tenant.stripeAccountId, feeBps: tenant.platformFeeBps };
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
      const account = await this.stripe.accounts.create(
        {
          type: 'express',
          metadata: { tenantId },
          business_profile: { name: tenant.name },
          capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
        },
        // Dos clicks seguidos en "Configurar pagos" no crean dos cuentas
        { idempotencyKey: `connect-account-${tenantId}` },
      );
      accountId = account.id;
      await this.control.tenant.update({ where: { id: tenantId }, data: { stripeAccountId: accountId } });
    }

    const link = await this.stripe.accountLinks.create({
      account: accountId,
      type: 'account_onboarding',
      return_url: returnUrl,
      refresh_url: refreshUrl,
    });
    return { url: link.url };
  }

  /**
   * Estado de la cuenta conectada para el panel de la tienda. Si todavía no está habilitada se
   * consulta a Stripe y se sincroniza: así el panel se actualiza al volver del onboarding aunque el
   * webhook account.updated no haya llegado (en local, stripe listen no reenvía eventos de Connect
   * salvo con --forward-connect-to).
   */
  async getStatus(tenantId: string): Promise<{ connected: boolean; chargesEnabled: boolean; detailsSubmitted: boolean; pendingRequirements: number }> {
    const tenant = await this.control.tenant.findUnique({
      where: { id: tenantId },
      select: { stripeAccountId: true, stripeChargesEnabled: true },
    });
    if (!tenant) throw new NotFoundException('Tienda no encontrada');
    if (!tenant.stripeAccountId) return { connected: false, chargesEnabled: false, detailsSubmitted: false, pendingRequirements: 0 };

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

  /** Para el checkout de la tienda: sin cuenta habilitada no se ofrece el pago con tarjeta. */
  async isCardEnabled(tenantId: string): Promise<boolean> {
    const tenant = await this.control.tenant.findUnique({
      where: { id: tenantId },
      select: { stripeAccountId: true, stripeChargesEnabled: true },
    });
    return Boolean(tenant?.stripeAccountId && tenant.stripeChargesEnabled);
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
   * Tienda dueña de un PaymentIntent, para abrir su schema desde el webhook. Además de metadata
   * se exige que el destino coincida con su cuenta conectada: un PI con metadata de otra tienda
   * no puede marcar como pagada una orden ajena.
   */
  async resolveTenantForPaymentIntent(pi: Stripe.PaymentIntent): Promise<TenantContext | null> {
    const tenantId = pi.metadata?.tenantId;
    if (!tenantId) return this.resolveLegacyTenant(pi);

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

  /**
   * Fallback transicional: PaymentIntents creados ANTES del multitenant (sin metadata.tenantId) que
   * se confirman después del deploy (3DS pendiente, pagos asíncronos, reintentos de Stripe de hasta
   * 3 días). Eran cobros a la cuenta central, así que se exige que NO tengan transfer_data: un PI
   * nuevo sin tenantId sería un bug, no un pago legacy, y no debe caer en la tienda original.
   * Quitar LEGACY_TENANT_ID una vez que pasen unos días sin estos eventos en el log.
   */
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

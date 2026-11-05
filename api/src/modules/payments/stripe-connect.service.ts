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
 * En entorno de pruebas (STRIPE_SECRET_KEY = sk_test_*), si una tienda todavía no vinculó una cuenta
 * Stripe Connect Express propia, se permite cobrar directamente con la cuenta test de la plataforma
 * para que todas las tiendas nuevas puedan procesar pagos con tarjeta desde el primer momento.
 */
@Injectable()
export class StripeConnectService {
  private readonly logger = new Logger(StripeConnectService.name);
  private readonly stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

  constructor(private readonly control: ControlPrismaService) {}

  private isDirectPlatformFallbackAllowed(tenantId: string): boolean {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) return false;
    if (key.startsWith('sk_test_')) return true;
    const legacyId = process.env.LEGACY_TENANT_ID;
    return Boolean(legacyId && tenantId === legacyId);
  }

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
   * consulta a Stripe y se sincroniza.
   */
  async getStatus(tenantId: string): Promise<{ connected: boolean; chargesEnabled: boolean; detailsSubmitted: boolean; pendingRequirements: number }> {
    const tenant = await this.control.tenant.findUnique({
      where: { id: tenantId },
      select: { stripeAccountId: true, stripeChargesEnabled: true },
    });
    if (!tenant) throw new NotFoundException('Tienda no encontrada');
    if (!tenant.stripeAccountId) {
      if (this.isDirectPlatformFallbackAllowed(tenantId)) {
        return { connected: true, chargesEnabled: true, detailsSubmitted: true, pendingRequirements: 0 };
      }
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
   * Desvincula la cuenta conectada: la tienda deja de cobrar con tarjeta (salvo fallback sk_test_).
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

  /** Para el checkout de la tienda: ofrece tarjeta si tiene Connect activo o fallback de prueba/legacy. */
  async isCardEnabled(tenantId: string): Promise<boolean> {
    const tenant = await this.control.tenant.findUnique({
      where: { id: tenantId },
      select: { stripeAccountId: true, stripeChargesEnabled: true },
    });
    if (tenant?.stripeAccountId && tenant.stripeChargesEnabled) {
      return true;
    }
    if (!tenant?.stripeAccountId && this.isDirectPlatformFallbackAllowed(tenantId)) {
      return true;
    }
    return false;
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

    if (!pi.transfer_data && this.isDirectPlatformFallbackAllowed(tenantId)) {
      const tenant = await this.control.tenant.findUnique({
        where: { id: tenantId },
        select: { id: true, schemaName: true },
      });
      if (tenant) return { tenantId: tenant.id, schemaName: tenant.schemaName };
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

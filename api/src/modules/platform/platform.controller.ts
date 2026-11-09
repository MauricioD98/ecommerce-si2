import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { PublicTenantLogosService } from './public-tenant-logos.service';
import { PlatformAuditService, auditActorFromRequest } from './audit/platform-audit.service';
import * as webpush from 'web-push';
import { IntegrationProvider, TenantSecretsService } from '../../tenancy/tenant-secrets.service';
import { GenerateWebPushDto, SetDecartIntegrationDto, SetWebPushIntegrationDto } from './dto/integrations.dto';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Prisma } from '../../generated/control/client';
import { ControlPrismaService } from '../../tenancy/control-prisma.service';
import { TenantProvisioningService } from '../../tenancy/tenant-provisioning.service';
import { TenantResolutionCache } from '../../tenancy/tenant-resolution-cache.service';
import { CLIENT_PLATFORM_HEADER } from '../../tenancy/tenant.middleware';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { SetTenantDomainDto } from './dto/set-domain.dto';
import { SetTenantStatusDto } from './dto/set-tenant-status.dto';
import { PLATFORM_KEY_HEADER, PlatformAdminGuard } from './guards/platform-admin.guard';
import { InternalKeyGuard } from './guards/internal-key.guard';
import { SubscriptionsService } from './subscriptions.service';
import { PLANS, type PlanKey, getPlanFeatures, minimumPlanName } from './plans';
import { i18nMessage } from '../../i18n/i18n-message';

// Suscripciones que hoy generan ingreso: past_due sigue contando hasta que Stripe la dé por perdida
const PAYING_STATUSES = ['active', 'past_due'];

// Mismo criterio que front/proxy.ts: minúsculas, sin puerto ni punto final, sin "www."
const normalizeDomain = (host?: string): string | null => {
  const value = host?.trim().toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '').replace(/^www\./, '');
  return value && value.length <= 253 ? value : null;
};

// /api/v1/platform/* está excluido de TenantMiddleware (ver TenancyModule): estas rutas operan sobre
// el plano de control (schema public), no sobre una tienda.
@ApiTags('platform')
@Controller('platform/tenants')
export class PlatformController {
  constructor(
    private readonly provisioning: TenantProvisioningService,
    private readonly control: ControlPrismaService,
    private readonly secrets: TenantSecretsService,
    private readonly subscriptions: SubscriptionsService,
    private readonly tenantCache: TenantResolutionCache,
    private readonly audit: PlatformAuditService,
    private readonly logos: PublicTenantLogosService,
  ) {}

  /**
   * Directorio público de tiendas activas en la plataforma: permite que clientes y dueños cambien de
   * tienda en el front o elijan en qué tienda registrarse / iniciar sesión. Solo devuelve datos públicos.
   */
  @Get('public')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Listar las tiendas activas disponibles públicamente' })
  async listPublic() {
    const tenants = await this.control.tenant.findMany({
      where: { status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
      select: { id: true, slug: true, name: true, plan: true, schemaName: true },
    });
    const data = await Promise.all(
      tenants.map(async (t) => {
        const features = getPlanFeatures(t.plan);
        return {
          id: t.id,
          slug: t.slug,
          name: t.name,
          plan: t.plan,
          planName: features.planName,
          mobileApp: features.mobileApp,
          // URL https externa o ruta de esta API (/platform/tenants/:id/logo); null si no tiene logo
          logoUrl: await this.logos.publicLogoUrl(t),
        };
      }),
    );
    return { success: true, data, message: 'Tiendas disponibles' };
  }

  /**
   * Público: logo de una tienda activa subido desde el panel (data URL en su schema), como imagen.
   * Lo usa el selector de tienda de la app móvil. Si el logo es una URL externa, redirige a ella.
   */
  @Get(':id/logo')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @ApiOperation({ summary: 'Logo público de una tienda activa' })
  async logo(@Param('id', new ParseUUIDPipe()) id: string, @Res() res: Response) {
    const tenant = await this.control.tenant.findFirst({ where: { id, status: 'ACTIVE' }, select: { id: true, schemaName: true } });
    const logo = tenant ? await this.logos.getLogo(tenant) : null;
    if (!logo) throw new NotFoundException('La tienda no tiene logo');
    if (logo.kind === 'url') {
      res.redirect(302, logo.url);
      return;
    }
    res
      .status(200)
      .set({
        'Content-Type': logo.type,
        'Content-Length': String(logo.bytes.length),
        'Cache-Control': 'public, max-age=300',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'",
      })
      .send(logo.bytes);
  }

  /**
   * Público: lo usan el <TenantSelector/> del front y de la app para pasar de "slug" (lo que escribe
   * o ve el usuario) al UUID que va en x-tenant-id. Solo devuelve tiendas ACTIVE y datos públicos.
   */
  @Get('resolve/:slug')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } }) // frena el barrido de slugs
  @ApiOperation({ summary: 'Resolver el id de una tienda a partir de su slug' })
  async resolve(@Param('slug') slug: string, @Headers(CLIENT_PLATFORM_HEADER) clientPlatform?: string) {
    const cleanSlug = slug.trim().toLowerCase();
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cleanSlug);
    const tenant = await this.control.tenant.findFirst({
      where: {
        status: 'ACTIVE',
        OR: [
          ...(isUuid ? [{ id: cleanSlug }] : []),
          { slug: cleanSlug },
          { slug: cleanSlug.replace(/\s+/g, '-') },
          { name: { equals: slug.trim(), mode: 'insensitive' } },
        ],
      },
      select: { id: true, slug: true, name: true, plan: true },
    });
    if (!tenant) throw new NotFoundException('No encontramos una tienda con ese nombre');

    const features = getPlanFeatures(tenant.plan);
    if (clientPlatform?.trim().toLowerCase() === 'mobile' && !features.mobileApp) {
      throw new ForbiddenException(
        i18nMessage('errors.PLAN_STORE_MOBILE_APP', {
          store: tenant.name,
          currentPlan: features.planName,
          plan: minimumPlanName((plan) => plan.mobileApp),
        }),
      );
    }

    return {
      success: true,
      data: {
        id: tenant.id,
        slug: tenant.slug,
        name: tenant.name,
        plan: tenant.plan,
        features,
      },
      message: 'Tienda encontrada',
    };
  }

  /**
   * Dominio propio → tienda. Lo llama front/proxy.ts (servidor) con INTERNAL_API_KEY en cada host
   * no cacheado. Sin throttle por IP: todas las consultas salen de la misma IP del front y se
   * bloquearían entre sí; la protección es la llave interna.
   */
  @Get('by-domain')
  @UseGuards(InternalKeyGuard)
  @ApiOperation({ summary: 'Resolver la tienda de un dominio propio (uso interno del front)' })
  async resolveDomain(@Query('host') host: string) {
    const domain = normalizeDomain(host);
    if (!domain) throw new NotFoundException('Dominio no registrado');

    const tenant = await this.control.tenant.findFirst({
      where: { domain, domainVerifiedAt: { not: null }, status: 'ACTIVE' },
      select: { id: true, slug: true, name: true, plan: true },
    });
    if (!tenant || !getPlanFeatures(tenant.plan).customDomain) {
      throw new NotFoundException('Dominio no registrado');
    }
    return {
      success: true,
      data: { id: tenant.id, slug: tenant.slug, name: tenant.name },
      message: 'Tienda encontrada',
    };
  }

  // El admin de plataforma asigna el dominio después de verificar el DNS (CNAME al front). Por eso
  // se marca verificado al guardarlo: no hay auto-servicio de dominios todavía.
  @Patch(':id/domain')
  @UseGuards(PlatformAdminGuard)
  @ApiHeader({ name: PLATFORM_KEY_HEADER, required: true })
  @ApiOperation({ summary: 'Asignar (o quitar) el dominio propio de una tienda' })
  async setDomain(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SetTenantDomainDto) {
    return this.audit.track(
      { actor: auditActorFromRequest(req), action: 'TENANT_DOMAIN_CHANGED', tenantId: id, details: { domain: dto.domain ?? null } },
      async () => {
        if (dto.domain) {
          const target = await this.control.tenant.findUnique({ where: { id }, select: { plan: true } });
          if (!target) throw new NotFoundException('Tienda no encontrada');
          const features = getPlanFeatures(target.plan);
          if (!features.customDomain) {
            throw new ForbiddenException(
              i18nMessage('errors.PLAN_STORE_CUSTOM_DOMAIN', {
                currentPlan: features.planName,
                plan: minimumPlanName((plan) => plan.customDomain),
              }),
            );
          }
        }

        try {
          const tenant = await this.control.tenant.update({
            where: { id },
            data: dto.domain
              ? { domain: dto.domain, domainVerifiedAt: new Date() }
              : { domain: null, domainVerifiedAt: null },
            select: { id: true, slug: true, domain: true, domainVerifiedAt: true },
          });
          return { success: true, data: tenant, message: 'Dominio actualizado' };
        } catch (e) {
          if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
            throw new ConflictException('Ese dominio ya está asignado a otra tienda');
          }
          if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
            throw new NotFoundException('Tienda no encontrada');
          }
          throw e;
        }
      },
    );
  }

  // ---- Credenciales de terceros por tienda (cifradas en public.tenant_integrations) ----------------
  // Las respuestas nunca devuelven el secreto, solo lo público (p. ej. la llave pública VAPID).

  @Put(':id/integrations/decart')
  @UseGuards(PlatformAdminGuard)
  @ApiHeader({ name: PLATFORM_KEY_HEADER, required: true })
  @ApiOperation({ summary: 'Guardar la API key de Decart (Probador Virtual) de una tienda' })
  async setDecart(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SetDecartIntegrationDto) {
    return this.audit.track(
      { actor: auditActorFromRequest(req), action: 'TENANT_INTEGRATION_CHANGED', tenantId: id, details: { provider: 'DECART', operation: 'set' } },
      async () => {
        await this.assertTenantExists(id);
        await this.secrets.set(id, 'DECART', { apiKey: dto.apiKey });
        return { success: true, data: { provider: 'DECART' }, message: 'Probador virtual habilitado' };
      },
    );
  }

  // Para importar un par que ya tiene suscriptores. Para uno nuevo usar .../web-push/generate.
  @Put(':id/integrations/web-push')
  @UseGuards(PlatformAdminGuard)
  @ApiHeader({ name: PLATFORM_KEY_HEADER, required: true })
  @ApiOperation({ summary: 'Importar el par VAPID existente de una tienda' })
  async setWebPush(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SetWebPushIntegrationDto) {
    return this.audit.track(
      { actor: auditActorFromRequest(req), action: 'TENANT_INTEGRATION_CHANGED', tenantId: id, details: { provider: 'WEBPUSH', operation: 'import' } },
      async () => {
        await this.assertTenantExists(id);
        await this.secrets.set(id, 'WEBPUSH', { publicKey: dto.publicKey, privateKey: dto.privateKey, subject: dto.subject });
        return { success: true, data: { provider: 'WEBPUSH', publicKey: dto.publicKey }, message: 'Web Push configurado' };
      },
    );
  }

  // Reemplaza el par: TODOS los dispositivos suscritos de la tienda dejan de recibir push hasta que
  // vuelvan a suscribirse (el front lo hace al detectar la llave pública nueva).
  @Post(':id/integrations/web-push/generate')
  @UseGuards(PlatformAdminGuard)
  @ApiHeader({ name: PLATFORM_KEY_HEADER, required: true })
  @ApiOperation({ summary: 'Generar un par VAPID nuevo para una tienda (invalida las suscripciones actuales)' })
  async generateWebPush(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @Body() dto: GenerateWebPushDto) {
    return this.audit.track(
      { actor: auditActorFromRequest(req), action: 'TENANT_INTEGRATION_CHANGED', tenantId: id, details: { provider: 'WEBPUSH', operation: 'generate' } },
      async () => {
        const tenant = await this.control.tenant.findUnique({
          where: { id },
          include: { credentials: { where: { type: 'OWNER_PASSWORD' }, take: 1 } },
        });
        if (!tenant) throw new NotFoundException('Tienda no encontrada');

        const subject = dto.subject ?? (tenant.credentials[0] ? `mailto:${tenant.credentials[0].identifier}` : undefined);
        if (!subject) throw new BadRequestException('Indicá subject (mailto:… o https://…): la tienda no tiene email de dueño');

        const { publicKey, privateKey } = webpush.generateVAPIDKeys();
        await this.secrets.set(id, 'WEBPUSH', { publicKey, privateKey, subject });
        return { success: true, data: { provider: 'WEBPUSH', publicKey }, message: 'Par VAPID generado' };
      },
    );
  }

  @Delete(':id/integrations/:provider')
  @UseGuards(PlatformAdminGuard)
  @ApiHeader({ name: PLATFORM_KEY_HEADER, required: true })
  @ApiOperation({ summary: 'Quitar una integración de una tienda (decart | web-push)' })
  async removeIntegration(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @Param('provider') provider: string) {
    return this.audit.track(
      { actor: auditActorFromRequest(req), action: 'TENANT_INTEGRATION_CHANGED', tenantId: id, details: { provider: String(provider).slice(0, 20), operation: 'remove' } },
      async () => {
        const map: Record<string, IntegrationProvider> = { decart: 'DECART', 'web-push': 'WEBPUSH' };
        const target = map[provider];
        if (!target) throw new BadRequestException('provider debe ser "decart" o "web-push"');
        await this.secrets.remove(id, target);
        return { success: true, data: { provider: target }, message: 'Integración eliminada' };
      },
    );
  }

  private async assertTenantExists(id: string): Promise<void> {
    const exists = await this.control.tenant.count({ where: { id } });
    if (!exists) throw new NotFoundException('Tienda no encontrada');
  }

  @Post()
  @UseGuards(PlatformAdminGuard)
  @ApiHeader({ name: PLATFORM_KEY_HEADER, required: true })
  @ApiOperation({
    summary: 'Registrar una tienda',
    description: 'Crea el schema, aplica migraciones, roles base y el Super Admin (dueño). Puede tardar varios segundos.',
  })
  async create(@Req() req: Request, @Body() dto: CreateTenantDto) {
    return this.audit.track(
      { actor: auditActorFromRequest(req), action: 'TENANT_CREATED', details: { slug: dto.slug, plan: dto.plan ?? null } },
      async () => {
        const tenant = await this.provisioning.createTenant(dto);
        return { success: true, data: tenant, message: 'Tienda creada' };
      },
      (res) => ({ tenantId: (res.data as { id?: string })?.id ?? null }),
    );
  }

  @Get()
  @UseGuards(PlatformAdminGuard)
  @ApiHeader({ name: PLATFORM_KEY_HEADER, required: true })
  @ApiOperation({ summary: 'Listar tiendas con su dueño y estado de suscripción' })
  async findAll() {
    const tenants = await this.control.tenant.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        slug: true,
        name: true,
        status: true,
        plan: true,
        domain: true,
        schemaVersion: true,
        provisionError: true,
        stripeChargesEnabled: true,
        subscriptionStatus: true,
        stripeSubscriptionId: true,
        createdAt: true,
        // El dueño es la credencial OWNER_PASSWORD (identifier = email); nunca se devuelve el hash
        credentials: { where: { type: 'OWNER_PASSWORD', revokedAt: null }, select: { identifier: true }, take: 1 },
      },
    });
    const data = tenants.map(({ credentials, stripeSubscriptionId, ...tenant }) => ({
      ...tenant,
      ownerEmail: credentials[0]?.identifier ?? null,
      hasSubscription: !!stripeSubscriptionId,
    }));
    return { success: true, data, message: 'Tiendas obtenidas' };
  }

  /**
   * KPIs del panel de plataforma. El MRR se estima con el precio de lista de cada plan en Stripe por
   * suscripción que hoy paga (active / past_due): no descuenta cupones ni prorrateos.
   */
  @Get('metrics')
  @UseGuards(PlatformAdminGuard)
  @ApiHeader({ name: PLATFORM_KEY_HEADER, required: true })
  @ApiOperation({ summary: 'Métricas de la plataforma: tiendas por estado y MRR estimado' })
  async metrics() {
    // Todo sale del plano de control (public.*): ninguna consulta entra al schema de cada tienda, así
    // que el costo no crece con la cantidad de tiendas. Los precios de Stripe tienen cache de 10 min.
    const [byStatus, paying, bySubscription, withoutSubscription, failedSignups, prices] = await Promise.all([
      this.control.tenant.groupBy({ by: ['status'], _count: { _all: true } }),
      this.control.tenant.groupBy({
        by: ['plan'],
        where: { stripeSubscriptionId: { not: null }, subscriptionStatus: { in: PAYING_STATUSES } },
        _count: { _all: true },
      }),
      this.control.tenant.groupBy({
        by: ['subscriptionStatus'],
        where: { stripeSubscriptionId: { not: null } },
        _count: { _all: true },
      }),
      this.control.tenant.count({ where: { stripeSubscriptionId: null } }),
      // Altas pagadas cuyo aprovisionamiento falló (POST /platform/subscriptions/signups/:id/retry)
      this.control.tenantSignup.count({ where: { status: 'FAILED' } }),
      this.subscriptions.planMonthlyPrices(),
    ]);

    const count = (status: string) => byStatus.find((row) => row.status === status)?._count._all ?? 0;
    let mrr = 0;
    let currency: string | null = null;
    let payingTenants = 0;
    // Suscripciones que pagan pero cuyo plan no tiene precio legible en Stripe (variable de entorno
    // sin configurar o Stripe no respondió): no suman al MRR, y el panel lo avisa en vez de mostrar
    // una cifra incompleta como si fuera completa.
    let unpricedTenants = 0;
    for (const row of paying) {
      payingTenants += row._count._all;
      const price = row.plan in PLANS ? prices[row.plan as PlanKey] : undefined;
      if (!price) {
        unpricedTenants += row._count._all;
        continue;
      }
      mrr += price.amount * row._count._all;
      currency = price.currency;
    }
    const mrrStatus = unpricedTenants === 0 ? 'complete' : unpricedTenants < payingTenants ? 'partial' : 'unavailable';

    // Estados de Stripe agrupados como los lee el panel
    const subCount = (...statuses: string[]) =>
      bySubscription
        .filter((row) => row.subscriptionStatus !== null && statuses.includes(row.subscriptionStatus))
        .reduce((sum, row) => sum + row._count._all, 0);
    const withSubscription = bySubscription.reduce((sum, row) => sum + row._count._all, 0);
    const subscriptions = {
      withSubscription,
      withoutSubscription,
      active: subCount('active'),
      trialing: subCount('trialing'),
      // Cobro fallido o sin completar: Stripe reintenta o espera una acción del cliente
      paymentIssues: subCount('past_due', 'unpaid', 'incomplete'),
      ended: subCount('canceled', 'incomplete_expired'),
      paused: subCount('paused'),
    };
    const known = subscriptions.active + subscriptions.trialing + subscriptions.paymentIssues + subscriptions.ended + subscriptions.paused;

    return {
      success: true,
      data: {
        total: byStatus.reduce((sum, row) => sum + row._count._all, 0),
        active: count('ACTIVE'),
        suspended: count('SUSPENDED'),
        provisioning: count('PROVISIONING'),
        failed: count('FAILED'),
        failedSignups,
        payingTenants,
        mrr: Math.round(mrr * 100) / 100,
        // Sin ninguna suscripción con precio conocido no hay moneda: se mantiene USD por compatibilidad
        currency: currency ?? 'USD',
        mrrStatus,
        unpricedTenants,
        subscriptions: { ...subscriptions, otherStatus: withSubscription - known },
        generatedAt: new Date().toISOString(),
      },
      message: 'Métricas de la plataforma',
    };
  }

  /**
   * Suspende o reactiva una tienda completa: TenantMiddleware responde 401 a todo lo que no sea
   * ACTIVE (tienda, panel, app y POS). Se invalida su cache para que rija en el acto (en esta
   * instancia; otras réplicas, ≤ 60 s). Una suspensión manual no la deshace el webhook de Stripe
   * (ver SubscriptionsService.syncTenant).
   */
  @Patch(':id/status')
  @UseGuards(PlatformAdminGuard)
  @ApiHeader({ name: PLATFORM_KEY_HEADER, required: true })
  @ApiOperation({ summary: 'Suspender o reactivar una tienda (ACTIVE ⇄ SUSPENDED)' })
  async setStatus(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SetTenantStatusDto) {
    const before = await this.control.tenant.findUnique({ where: { id }, select: { status: true } });
    return this.audit.track(
      { actor: auditActorFromRequest(req), action: dto.status === 'SUSPENDED' ? 'TENANT_SUSPENDED' : 'TENANT_REACTIVATED', tenantId: before ? id : null, details: { from: before?.status ?? null, to: dto.status } },
      async () => {
        const tenant = await this.control.tenant.findUnique({ where: { id }, select: { status: true } });
        if (!tenant) throw new NotFoundException('Tienda no encontrada');
        // PROVISIONING/FAILED no son un "acceso" que se pueda cortar: se resuelven con POST :id/retry
        if (tenant.status !== 'ACTIVE' && tenant.status !== 'SUSPENDED') {
          throw new ConflictException(`La tienda está en ${tenant.status}: usá el reintento de aprovisionamiento`);
        }

        const updated = await this.control.tenant.update({
          where: { id },
          data: { status: dto.status },
          select: { id: true, slug: true, name: true, status: true },
        });
        this.tenantCache.invalidate(updated.id, updated.slug);
        return {
          success: true,
          data: updated,
          message: dto.status === 'SUSPENDED' ? 'Tienda suspendida' : 'Tienda reactivada',
        };
      },
    );
  }

  /**
   * Ficha de una tienda para el panel de plataforma. Solo lee el plano de control (public.*): no entra
   * al schema de la tienda ni a la cuenta del dueño, y nunca devuelve secretos (hashes, llaves de
   * integraciones, ids de Stripe). Declarado después de las rutas fijas (metrics, public, by-domain)
   * para que ':id' no las capture; ParseUUIDPipe rechaza cualquier otro valor.
   */
  @Get(':id')
  @UseGuards(PlatformAdminGuard)
  @ApiHeader({ name: PLATFORM_KEY_HEADER, required: true })
  @ApiOperation({ summary: 'Detalle de una tienda (plano de control, sin secretos)' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    const tenant = await this.control.tenant.findUnique({
      where: { id },
      select: {
        id: true,
        slug: true,
        name: true,
        status: true,
        plan: true,
        domain: true,
        domainVerifiedAt: true,
        schemaVersion: true,
        provisionError: true,
        stripeAccountId: true,
        stripeChargesEnabled: true,
        platformFeeBps: true,
        stripeSubscriptionId: true,
        subscriptionStatus: true,
        createdAt: true,
        updatedAt: true,
        credentials: {
          where: { type: 'OWNER_PASSWORD', revokedAt: null },
          select: { identifier: true },
          take: 1,
        },
        integrations: { select: { provider: true, updatedAt: true } },
      },
    });
    if (!tenant) throw new NotFoundException('Tienda no encontrada');

    const { credentials, integrations, stripeAccountId, stripeSubscriptionId, ...rest } = tenant;
    return {
      success: true,
      data: {
        ...rest,
        ownerEmail: credentials[0]?.identifier ?? null,
        hasSubscription: !!stripeSubscriptionId,
        hasStripeAccount: !!stripeAccountId,
        integrations: integrations.map((row) => ({ provider: row.provider, updatedAt: row.updatedAt })),
      },
      message: 'Tienda obtenida',
    };
  }

  @Post(':id/retry')
  @HttpCode(HttpStatus.OK)
  @UseGuards(PlatformAdminGuard)
  @ApiHeader({ name: PLATFORM_KEY_HEADER, required: true })
  @ApiOperation({ summary: 'Reintentar el aprovisionamiento de una tienda en FAILED' })
  async retry(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    return this.audit.track(
      { actor: auditActorFromRequest(req), action: 'TENANT_PROVISION_RETRIED', tenantId: id },
      async () => {
        // Solo FAILED, como dice la operación: provision() deja la tienda en ACTIVE, así que sobre una
        // SUSPENDED la reactivaría saltándose la suspensión, y sobre una ACTIVE volvería a sembrar roles y
        // dueño. (El reintento de un alta pagada va por POST /platform/subscriptions/signups/:id/retry.)
        const current = await this.control.tenant.findUnique({ where: { id }, select: { status: true } });
        if (!current) throw new NotFoundException('Tienda no encontrada');
        if (current.status !== 'FAILED') {
          throw new ConflictException(`La tienda está en ${current.status}: solo se reintenta el aprovisionamiento de una tienda con error`);
        }
        const tenant = await this.provisioning.retry(id);
        return { success: true, data: tenant, message: 'Tienda aprovisionada' };
      },
    );
  }
}

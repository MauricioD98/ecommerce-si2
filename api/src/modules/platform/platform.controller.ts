import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import * as webpush from 'web-push';
import { IntegrationProvider, TenantSecretsService } from '../../tenancy/tenant-secrets.service';
import { GenerateWebPushDto, SetDecartIntegrationDto, SetWebPushIntegrationDto } from './dto/integrations.dto';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Prisma } from '../../generated/control/client';
import { ControlPrismaService } from '../../tenancy/control-prisma.service';
import { TenantProvisioningService } from '../../tenancy/tenant-provisioning.service';
import { TenantResolutionCache } from '../../tenancy/tenant-resolution-cache.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { SetTenantDomainDto } from './dto/set-domain.dto';
import { SetTenantStatusDto } from './dto/set-tenant-status.dto';
import { PLATFORM_KEY_HEADER, PlatformAdminGuard } from './guards/platform-admin.guard';
import { InternalKeyGuard } from './guards/internal-key.guard';
import { SubscriptionsService } from './subscriptions.service';
import { PLANS, type PlanKey } from './plans';

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
  ) {}

  /**
   * Público: lo usan el <TenantSelector/> del front y de la app para pasar de "slug" (lo que escribe
   * o ve el usuario) al UUID que va en x-tenant-id. Solo devuelve tiendas ACTIVE y datos públicos.
   */
  @Get('resolve/:slug')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } }) // frena el barrido de slugs
  @ApiOperation({ summary: 'Resolver el id de una tienda a partir de su slug' })
  async resolve(@Param('slug') slug: string) {
    const tenant = await this.control.tenant.findFirst({
      where: { slug: slug.trim().toLowerCase(), status: 'ACTIVE' },
      select: { id: true, slug: true, name: true },
    });
    if (!tenant) throw new NotFoundException('No encontramos una tienda con ese nombre');
    return { success: true, data: tenant, message: 'Tienda encontrada' };
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
      select: { id: true, slug: true, name: true },
    });
    if (!tenant) throw new NotFoundException('Dominio no registrado');
    return { success: true, data: tenant, message: 'Tienda encontrada' };
  }

  // El admin de plataforma asigna el dominio después de verificar el DNS (CNAME al front). Por eso
  // se marca verificado al guardarlo: no hay auto-servicio de dominios todavía.
  @Patch(':id/domain')
  @UseGuards(PlatformAdminGuard)
  @ApiHeader({ name: PLATFORM_KEY_HEADER, required: true })
  @ApiOperation({ summary: 'Asignar (o quitar) el dominio propio de una tienda' })
  async setDomain(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetTenantDomainDto) {
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
  }

  // ---- Credenciales de terceros por tienda (cifradas en public.tenant_integrations) ----------------
  // Las respuestas nunca devuelven el secreto, solo lo público (p. ej. la llave pública VAPID).

  @Put(':id/integrations/decart')
  @UseGuards(PlatformAdminGuard)
  @ApiHeader({ name: PLATFORM_KEY_HEADER, required: true })
  @ApiOperation({ summary: 'Guardar la API key de Decart (Probador Virtual) de una tienda' })
  async setDecart(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetDecartIntegrationDto) {
    await this.assertTenantExists(id);
    await this.secrets.set(id, 'DECART', { apiKey: dto.apiKey });
    return { success: true, data: { provider: 'DECART' }, message: 'Probador virtual habilitado' };
  }

  // Para importar un par que ya tiene suscriptores. Para uno nuevo usar .../web-push/generate.
  @Put(':id/integrations/web-push')
  @UseGuards(PlatformAdminGuard)
  @ApiHeader({ name: PLATFORM_KEY_HEADER, required: true })
  @ApiOperation({ summary: 'Importar el par VAPID existente de una tienda' })
  async setWebPush(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetWebPushIntegrationDto) {
    await this.assertTenantExists(id);
    await this.secrets.set(id, 'WEBPUSH', { publicKey: dto.publicKey, privateKey: dto.privateKey, subject: dto.subject });
    return { success: true, data: { provider: 'WEBPUSH', publicKey: dto.publicKey }, message: 'Web Push configurado' };
  }

  // Reemplaza el par: TODOS los dispositivos suscritos de la tienda dejan de recibir push hasta que
  // vuelvan a suscribirse (el front lo hace al detectar la llave pública nueva).
  @Post(':id/integrations/web-push/generate')
  @UseGuards(PlatformAdminGuard)
  @ApiHeader({ name: PLATFORM_KEY_HEADER, required: true })
  @ApiOperation({ summary: 'Generar un par VAPID nuevo para una tienda (invalida las suscripciones actuales)' })
  async generateWebPush(@Param('id', ParseUUIDPipe) id: string, @Body() dto: GenerateWebPushDto) {
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
  }

  @Delete(':id/integrations/:provider')
  @UseGuards(PlatformAdminGuard)
  @ApiHeader({ name: PLATFORM_KEY_HEADER, required: true })
  @ApiOperation({ summary: 'Quitar una integración de una tienda (decart | web-push)' })
  async removeIntegration(@Param('id', ParseUUIDPipe) id: string, @Param('provider') provider: string) {
    const map: Record<string, IntegrationProvider> = { decart: 'DECART', 'web-push': 'WEBPUSH' };
    const target = map[provider];
    if (!target) throw new BadRequestException('provider debe ser "decart" o "web-push"');
    await this.secrets.remove(id, target);
    return { success: true, data: { provider: target }, message: 'Integración eliminada' };
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
  async create(@Body() dto: CreateTenantDto) {
    const tenant = await this.provisioning.createTenant(dto);
    return { success: true, data: tenant, message: 'Tienda creada' };
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
    const [byStatus, paying, prices] = await Promise.all([
      this.control.tenant.groupBy({ by: ['status'], _count: { _all: true } }),
      this.control.tenant.groupBy({
        by: ['plan'],
        where: { stripeSubscriptionId: { not: null }, subscriptionStatus: { in: PAYING_STATUSES } },
        _count: { _all: true },
      }),
      this.subscriptions.planMonthlyPrices(),
    ]);

    const count = (status: string) => byStatus.find((row) => row.status === status)?._count._all ?? 0;
    let mrr = 0;
    let currency = 'USD';
    let payingTenants = 0;
    for (const row of paying) {
      payingTenants += row._count._all;
      const price = row.plan in PLANS ? prices[row.plan as PlanKey] : undefined;
      if (!price) continue;
      mrr += price.amount * row._count._all;
      currency = price.currency;
    }

    return {
      success: true,
      data: {
        total: byStatus.reduce((sum, row) => sum + row._count._all, 0),
        active: count('ACTIVE'),
        suspended: count('SUSPENDED'),
        provisioning: count('PROVISIONING'),
        failed: count('FAILED'),
        payingTenants,
        mrr: Math.round(mrr * 100) / 100,
        currency,
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
  async setStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetTenantStatusDto) {
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
  }

  @Post(':id/retry')
  @HttpCode(HttpStatus.OK)
  @UseGuards(PlatformAdminGuard)
  @ApiHeader({ name: PLATFORM_KEY_HEADER, required: true })
  @ApiOperation({ summary: 'Reintentar el aprovisionamiento de una tienda en FAILED' })
  async retry(@Param('id', ParseUUIDPipe) id: string) {
    const tenant = await this.provisioning.retry(id);
    return { success: true, data: tenant, message: 'Tienda aprovisionada' };
  }
}

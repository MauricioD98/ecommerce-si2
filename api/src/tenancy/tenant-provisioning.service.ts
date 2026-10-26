import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../generated/control/client';
import { BASE_ROLES, SUPER_ADMIN_ROLE } from '../common/constants/permissions';
import { ControlPrismaService } from './control-prisma.service';
import { quoteIdent, toSchemaName } from './tenant-context';
import { TenantMigrationService } from './tenant-migration.service';
import { TenantPrismaService } from './tenant-prisma.service';
import { TenantSecretsService } from './tenant-secrets.service';
import * as webpush from 'web-push';

export interface CreateTenantInput {
  name: string;
  slug: string;
  ownerEmail: string;
  // Uno de los dos: en claro (alta desde la plataforma) o ya hasheado con bcrypt (alta self-service,
  // donde la contraseña se hasheó al crear el checkout y nunca se guardó en claro)
  ownerPassword?: string;
  ownerPasswordHash?: string;
  ownerFirstName?: string;
  ownerLastName?: string;
  plan?: string;
  // Id fijado de antemano (self-service): si el aprovisionamiento falla, el reintento retoma esta
  // misma tienda con retry() en vez de crear otra
  id?: string;
  // Dominio propio declarado por el cliente: se guarda SIN verificar (no se enruta todavía)
  domain?: string | null;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
}

interface OwnerSeed {
  email: string;
  passwordHash: string;
  firstName?: string;
  lastName?: string;
}

const publicTenantSelect = {
  id: true,
  slug: true,
  name: true,
  schemaName: true,
  status: true,
  plan: true,
  schemaVersion: true,
  createdAt: true,
} satisfies Prisma.TenantSelect;

@Injectable()
export class TenantProvisioningService {
  private readonly logger = new Logger(TenantProvisioningService.name);

  constructor(
    private readonly control: ControlPrismaService,
    private readonly migrator: TenantMigrationService,
    private readonly tenants: TenantPrismaService,
    private readonly secrets: TenantSecretsService,
  ) {}

  /**
   * Alta de tienda: registro en public → CREATE SCHEMA → migraciones → datos base → ACTIVE.
   * Si algo falla queda en FAILED con el error guardado, y se reintenta con retry().
   */
  async createTenant(input: CreateTenantInput) {
    const id = input.id ?? randomUUID();
    const schemaName = toSchemaName(id);
    const ownerEmail = input.ownerEmail.trim().toLowerCase();
    // Un solo hash para la credencial de plataforma y para el usuario Super Admin de la tienda:
    // ambos validan con bcrypt.compare, y en retry() no tenemos el password en claro.
    const passwordHash =
      input.ownerPasswordHash ?? (input.ownerPassword ? await bcrypt.hash(input.ownerPassword, 12) : null);
    if (!passwordHash) throw new Error('createTenant: falta ownerPassword u ownerPasswordHash');

    try {
      await this.control.tenant.create({
        data: {
          id,
          name: input.name,
          slug: input.slug.trim().toLowerCase(),
          schemaName,
          plan: input.plan ?? 'free',
          domain: input.domain ?? null,
          stripeCustomerId: input.stripeCustomerId ?? null,
          stripeSubscriptionId: input.stripeSubscriptionId ?? null,
          subscriptionStatus: input.stripeSubscriptionId ? 'active' : null,
          credentials: {
            create: {
              type: 'OWNER_PASSWORD',
              identifier: ownerEmail,
              secretHash: passwordHash,
              label: [input.ownerFirstName, input.ownerLastName].filter(Boolean).join(' ') || null,
            },
          },
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('El slug, el dominio o el email ya están registrados');
      }
      throw e;
    }

    return this.provision(id, schemaName, {
      email: ownerEmail,
      passwordHash,
      firstName: input.ownerFirstName,
      lastName: input.ownerLastName,
    });
  }

  async retry(tenantId: string) {
    const tenant = await this.control.tenant.findUnique({
      where: { id: tenantId },
      include: { credentials: { where: { type: 'OWNER_PASSWORD', revokedAt: null }, take: 1 } },
    });
    if (!tenant) throw new NotFoundException('Tenant no encontrado');

    const owner = tenant.credentials[0];
    if (!owner) throw new NotFoundException('La tienda no tiene credencial de dueño para crear su Super Admin');

    const [firstName, ...rest] = (owner.label ?? '').split(' ');
    return this.provision(tenant.id, tenant.schemaName, {
      email: owner.identifier,
      passwordHash: owner.secretHash,
      firstName: firstName || undefined,
      lastName: rest.join(' ') || undefined,
    });
  }

  /** Tras un deploy con migraciones nuevas: lleva todos los schemas activos a la última versión. */
  async migrateAll() {
    const tenants = await this.control.tenant.findMany({
      where: { status: { in: ['ACTIVE', 'SUSPENDED'] } },
      select: { id: true, schemaName: true },
    });

    const failed: { id: string; error: string }[] = [];
    for (const t of tenants) {
      try {
        await this.migrator.deploy(t.schemaName);
        await this.control.tenant.update({
          where: { id: t.id },
          data: { schemaVersion: await this.latestMigration(t.schemaName) },
        });
      } catch (e: any) {
        // Un tenant roto no frena al resto; queda reportado para revisarlo a mano.
        this.logger.error(e.message);
        failed.push({ id: t.id, error: e.message });
      }
    }
    return { total: tenants.length, failed };
  }

  private async provision(tenantId: string, schemaName: string, owner: OwnerSeed) {
    try {
      // Idempotente: en un retry el schema puede existir a medio migrar y migrate deploy retoma.
      await this.control.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS ${quoteIdent(schemaName)}`);
      await this.migrator.deploy(schemaName);
      await this.seedBaseData(schemaName, owner);
      await this.ensureWebPushKeys(tenantId, `mailto:${owner.email}`);

      return await this.control.tenant.update({
        where: { id: tenantId },
        data: {
          status: 'ACTIVE',
          provisionError: null,
          schemaVersion: await this.latestMigration(schemaName),
        },
        select: publicTenantSelect,
      });
    } catch (e: any) {
      this.logger.error(`Aprovisionamiento de ${schemaName} falló`, e.stack);
      await this.control.tenant.update({
        where: { id: tenantId },
        data: { status: 'FAILED', provisionError: String(e.message).slice(0, 4000) },
      });
      throw new InternalServerErrorException('No se pudo crear la tienda; reintentá más tarde');
    }
  }

  /**
   * Parte estructural de prisma/seed.mjs: roles base (sin ellos falla el registro de clientes, que
   * busca el rol "Cliente") y el Super Admin, que es el dueño. Upserts → idempotente en retry().
   *
   * Lo demás del seed NO se replica a propósito: los usuarios demo tienen contraseñas fijas
   * publicadas en el repo (Admin@123!$…), y el catálogo/sucursales demo ensuciarían una tienda real.
   * Sucursales y productos los carga el dueño desde el panel.
   */
  private async seedBaseData(schemaName: string, owner: OwnerSeed): Promise<void> {
    const db = this.tenants.forSchema(schemaName);

    await db.$transaction(async (tx) => {
      const roleIds: Record<string, string> = {};
      for (const { name, description, permissions } of BASE_ROLES) {
        const role = await tx.role.upsert({
          where: { name },
          update: { description, permissions },
          create: { name, description, permissions },
        });
        roleIds[name] = role.id;
      }

      // Si el usuario ya existía (retry) no se pisa su password: pudo haberla cambiado
      await tx.user.upsert({
        where: { email: owner.email },
        update: { roleId: roleIds[SUPER_ADMIN_ROLE] },
        create: {
          email: owner.email,
          password: owner.passwordHash,
          firstName: owner.firstName ?? null,
          lastName: owner.lastName ?? null,
          roleId: roleIds[SUPER_ADMIN_ROLE],
        },
      });
    });

    this.logger.log(`${schemaName}: ${BASE_ROLES.length} roles base y Super Admin ${owner.email} creados`);
  }

  /**
   * Cada tienda nace con su propio par VAPID: push funciona desde el primer día sin configurar nada.
   * Idempotente: si ya tiene uno NO se regenera (invalidaría las suscripciones de sus clientes).
   * Si falta TENANT_SECRETS_KEYS se registra el error y la tienda nace igual, sin push.
   */
  async ensureWebPushKeys(tenantId: string, subject: string): Promise<void> {
    try {
      if (await this.secrets.get('WEBPUSH', tenantId)) return;
      const { publicKey, privateKey } = webpush.generateVAPIDKeys();
      await this.secrets.set(tenantId, 'WEBPUSH', { publicKey, privateKey, subject });
    } catch (e: any) {
      this.logger.error(`No se pudo generar el par VAPID de ${tenantId}: ${e.message}`);
    }
  }

  private async latestMigration(schemaName: string): Promise<string | null> {
    const rows = await this.control.$queryRawUnsafe<{ migration_name: string }[]>(
      `SELECT migration_name FROM ${quoteIdent(schemaName)}."_prisma_migrations"
        WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
        ORDER BY finished_at DESC LIMIT 1`,
    );
    return rows[0]?.migration_name ?? null;
  }
}

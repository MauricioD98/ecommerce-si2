import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PrismaService } from '../../prisma/prisma.service';
import { Permission } from '../../common/constants/permissions';
import { hasPermission } from '../../common/utils/permission.util';
import type { AuthUser } from '../../common/decorators/interfaces/request-with-user.interface';
import { ValidationFailedException } from '../../i18n/i18n-exception.filter';
import { i18nMessage } from '../../i18n/i18n-message';
import { ProductsService } from '../products/products.service';
import { CategoryService } from '../category/category.service';
import { CollectionsService } from '../collections/collections.service';
import { OrdersService } from '../orders/orders.service';
import { UpdateProductDto } from '../products/dto/update-product.dto';
import { CreateCategoryDto } from '../category/dto/create-category.dto';
import { UpdateCategoryDto } from '../category/dto/update-category.dto';
import { CreateCollectionDto } from '../collections/dto/create-collection.dto';
import { UpdateCollectionDto } from '../collections/dto/update-collection.dto';
import { UpdateOrderDto } from '../orders/dto/update-order.dto';
import { readTranslations } from '../products/product-translations';
import type { WriteGuard } from '../../common/offline/write-guard';
import type { OfflineChangeDto, OfflineEntity } from './dto/offline-change.dto';

// Campos que se pueden cambiar sin conexión, por entidad. Lo demás (stock, descuentos, borrar, cancelar un
// pedido, aprobar comprobantes) exige conexión: depende de stock o dinero que el servidor decide en el momento.
const UPDATABLE: Record<OfflineEntity, readonly string[]> = {
  product: ['name', 'description', 'categoryId', 'sku', 'price', 'sizes', 'imageUrl', 'isActive', 'branchId', 'collectionIds', 'translations'],
  category: ['name', 'description', 'slug', 'imageUrl', 'isActive'],
  collection: ['name', 'description', 'slug', 'bannerImageUrl', 'isActive'],
  order: ['status'],
};
const CREATABLE: Partial<Record<OfflineEntity, true>> = { category: true, collection: true };

const PERMISSION: Record<OfflineEntity, string> = {
  product: Permission.MANAGE_PRODUCTS,
  category: Permission.MANAGE_PRODUCTS,
  collection: Permission.MANAGE_PRODUCTS,
  order: Permission.VIEW_ORDERS,
};

// Forma canónica para comparar: "" / null / undefined son lo mismo, números por valor, objetos con claves
// ordenadas y sin valores vacíos (las traducciones vacías se quitan al guardar). collectionIds sin orden.
export function canonical(field: string, value: unknown): string {
  const clean = (v: unknown): unknown => {
    if (v === undefined || v === null) return null;
    if (typeof v === 'string') return v.trim() === '' ? null : v.trim();
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (Array.isArray(v)) {
      const items = v.map(clean);
      return field === 'collectionIds' ? [...items].map(String).sort() : items;
    }
    if (typeof v === 'object') {
      const entries = Object.entries(v as Record<string, unknown>)
        .map(([k, inner]) => [k, clean(inner)] as const)
        .filter(([, inner]) => inner !== null && !(typeof inner === 'object' && !Array.isArray(inner) && Object.keys(inner as object).length === 0))
        .sort(([a], [b]) => a.localeCompare(b));
      return entries.length ? Object.fromEntries(entries) : null;
    }
    return v;
  };
  const cleaned = field === 'price' && value !== null && value !== undefined && value !== '' ? Number(value) : value;
  return JSON.stringify(clean(cleaned));
}

class AlreadyApplied extends Error {}

export interface OfflineSyncResult {
  entity: OfflineEntity;
  entityId: string;
  alreadyApplied: boolean;
  data?: unknown;
}

/**
 * Aplica un cambio del panel hecho sin conexión. Reglas:
 *   - Mismos permisos y validaciones que el endpoint normal (se llama al mismo servicio).
 *   - Solo escribe si cada campo cambiado sigue con el valor que leyó el dispositivo (o ya tiene el nuevo).
 *     La comprobación corre dentro de la transacción de la escritura, con la fila bloqueada. Si no, 409
 *     OFFLINE_CONFLICT con los valores actuales: nunca se pisa a ciegas lo que cambió otro dispositivo.
 *   - Recibo por changeId en la misma transacción: un reintento confirma sin volver a escribir.
 */
@Injectable()
export class OfflineSyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly products: ProductsService,
    private readonly categories: CategoryService,
    private readonly collections: CollectionsService,
    private readonly orders: OrdersService,
  ) {}

  async apply(actor: AuthUser, dto: OfflineChangeDto): Promise<OfflineSyncResult> {
    if (!hasPermission(actor, PERMISSION[dto.entity])) throw new ForbiddenException();

    const done = await this.receiptOf(actor, dto);
    if (done) return done;

    try {
      if (dto.op === 'create') return await this.create(actor, dto);
      return await this.update(actor, dto);
    } catch (error) {
      if (error instanceof AlreadyApplied) return { entity: dto.entity, entityId: dto.entityId, alreadyApplied: true };
      // Dos pestañas mandaron el mismo cambio a la vez: el recibo de la otra ganó, este ya está aplicado
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const again = await this.receiptOf(actor, dto);
        if (again) return again;
      }
      throw error;
    }
  }

  private async receiptOf(actor: AuthUser, dto: OfflineChangeDto): Promise<OfflineSyncResult | null> {
    const receipt = await this.prisma.offlineSyncReceipt.findUnique({ where: { changeId: dto.changeId } });
    if (!receipt) return null;
    // Un changeId de otra cuenta o de otro dato no revela ni modifica nada
    if (receipt.userId !== actor.id || receipt.entity !== dto.entity || receipt.entityId !== dto.entityId) {
      throw new ConflictException(i18nMessage('errors.OFFLINE_SYNC_CHANGE_REUSED'));
    }
    return { entity: dto.entity, entityId: dto.entityId, alreadyApplied: true };
  }

  private fieldsOf(dto: OfflineChangeDto, allowed: readonly string[]): string[] {
    const fields = Object.keys(dto.changes ?? {});
    if (fields.length === 0) throw new BadRequestException(i18nMessage('errors.PROFILE_SYNC_EMPTY'));
    const notAllowed = fields.filter((f) => !allowed.includes(f));
    if (notAllowed.length) {
      throw new BadRequestException(i18nMessage('errors.OFFLINE_ACTION_REQUIRES_CONNECTION', { fields: notAllowed.join(', ') }));
    }
    return fields;
  }

  // Mismo DTO y mismas reglas que el endpoint normal (whitelist, transformaciones, mensajes traducidos)
  private async validated<T extends object>(cls: new () => T, plain: Record<string, unknown>): Promise<T> {
    const instance = plainToInstance(cls, plain, { enableImplicitConversion: true });
    const errors = await validate(instance, { whitelist: true });
    if (errors.length) throw new ValidationFailedException(errors);
    return instance;
  }

  private async create(actor: AuthUser, dto: OfflineChangeDto): Promise<OfflineSyncResult> {
    if (!CREATABLE[dto.entity]) {
      throw new BadRequestException(i18nMessage('errors.OFFLINE_ACTION_REQUIRES_CONNECTION', { fields: dto.entity }));
    }
    // El id lo generó el dispositivo: si ya existe, este mismo cambio ya se aplicó (respuesta perdida)
    const exists =
      dto.entity === 'category'
        ? await this.prisma.category.findUnique({ where: { id: dto.entityId }, select: { id: true } })
        : await this.prisma.collection.findUnique({ where: { id: dto.entityId }, select: { id: true } });
    let data: unknown;
    if (!exists) {
      data =
        dto.entity === 'category'
          ? await this.categories.create(await this.validated(CreateCategoryDto, dto.changes), dto.entityId)
          : await this.collections.create(await this.validated(CreateCollectionDto, dto.changes), dto.entityId);
    }
    await this.prisma.offlineSyncReceipt.create({
      data: { changeId: dto.changeId, userId: actor.id, entity: dto.entity, entityId: dto.entityId },
    });
    return { entity: dto.entity, entityId: dto.entityId, alreadyApplied: !!exists, data };
  }

  private async update(actor: AuthUser, dto: OfflineChangeDto): Promise<OfflineSyncResult> {
    const fields = this.fieldsOf(dto, UPDATABLE[dto.entity]);
    const missing = fields.filter((f) => !Object.prototype.hasOwnProperty.call(dto.expected ?? {}, f));
    // Sin valor esperado sería una sobrescritura ciega: justo lo que este endpoint existe para evitar
    if (missing.length) {
      throw new BadRequestException(i18nMessage('errors.OFFLINE_SYNC_EXPECTED_MISSING', { fields: missing.join(', ') }));
    }

    const guard = <T>(currentValues: (row: T) => Record<string, unknown>): WriteGuard<T> =>
      async (tx, row) => {
        const current = currentValues(row);
        const conflicts = fields.filter((f) => {
          const now = canonical(f, current[f]);
          return now !== canonical(f, dto.expected[f]) && now !== canonical(f, dto.changes[f]);
        });
        if (conflicts.length) {
          throw new ConflictException({
            code: 'OFFLINE_CONFLICT',
            message: i18nMessage('errors.OFFLINE_CONFLICT'),
            fields: conflicts,
            current: Object.fromEntries(fields.map((f) => [f, current[f] ?? null])),
          });
        }
        const receipt = await tx.offlineSyncReceipt.findUnique({ where: { changeId: dto.changeId } });
        if (receipt) throw new AlreadyApplied();
        await tx.offlineSyncReceipt.create({
          data: { changeId: dto.changeId, userId: actor.id, entity: dto.entity, entityId: dto.entityId },
        });
      };

    let data: unknown;
    switch (dto.entity) {
      case 'product': {
        const body = await this.validated(UpdateProductDto, dto.changes);
        data = await this.products.update(
          dto.entityId,
          body,
          actor,
          guard((p) => ({
            name: p.name,
            description: p.description,
            categoryId: p.categoryId,
            sku: p.sku,
            price: Number(p.price),
            sizes: p.sizes,
            imageUrl: p.imageUrl,
            isActive: p.isActive,
            branchId: p.branchId,
            collectionIds: p.collections.map((c) => c.id),
            translations: readTranslations(p.translations),
          })),
        );
        break;
      }
      case 'category': {
        const body = await this.validated(UpdateCategoryDto, dto.changes);
        data = await this.categories.update(dto.entityId, body, guard((c) => ({ ...c })));
        break;
      }
      case 'collection': {
        const body = await this.validated(UpdateCollectionDto, dto.changes);
        data = await this.collections.update(dto.entityId, body, guard((c) => ({ ...c })));
        break;
      }
      case 'order': {
        const body = await this.validated(UpdateOrderDto, dto.changes);
        // Cancelar devuelve stock y resuelve el pago: siempre con conexión, por su endpoint
        if (!body.status || body.status === OrderStatus.CANCELADO) {
          throw new BadRequestException(i18nMessage('errors.OFFLINE_ACTION_REQUIRES_CONNECTION', { fields: 'status' }));
        }
        data = await this.orders.update(dto.entityId, { status: body.status }, undefined, actor, guard((o) => ({ status: o.status })));
        break;
      }
    }
    return { entity: dto.entity, entityId: dto.entityId, alreadyApplied: false, data };
  }
}

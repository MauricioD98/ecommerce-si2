import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ItemCondition,
  OrderStatus,
  PaymentStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BranchesService } from '../branches/branches.service';
import { InventoryService } from '../branches/inventory.service';
import { round2 } from '../../common/utils/pricing';
import { hasAllBranches } from '../../common/utils/permission.util';
import type { AuthUser } from '../../common/decorators/interfaces/request-with-user.interface';
import { ProcessReturnDto } from './dto/process-return.dto';
import { QueryReturnsDto, SearchOrderDto } from './dto/query-returns.dto';
import {
  PaginatedReturnsDto,
  ReturnableOrderDto,
  ReturnResponseDto,
} from './dto/return-response.dto';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Cuántas ventas devuelve el buscador de mostrador: es una búsqueda para atender a alguien que está
// esperando, no un listado, así que se corta corto y se ordena por la más reciente.
const SEARCH_RESULT_LIMIT = 10;

type OrderWithItems = Prisma.OrderGetPayload<{
  include: { orderItems: { include: { product: true } }; user: true; branch: true };
}>;

@Injectable()
export class ReturnsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchesService: BranchesService,
    private readonly inventoryService: InventoryService,
  ) {}

  // Busca la venta original por código de ticket, ID, NIT, razón social o datos del cliente.
  // Solo trae ventas cobradas y no anuladas: no se reembolsa lo que nunca se pagó.
  async searchOrder(staff: AuthUser, dto: SearchOrderDto): Promise<ReturnableOrderDto[]> {
    const term = dto.query.trim();
    if (!term) {
      throw new BadRequestException('Escribe un código de ticket, NIT o cliente para buscar');
    }

    const orders = await this.prisma.order.findMany({
      where: {
        AND: [
          this.buildOrderScope(staff, dto.branchId),
          {
            OR: [
              { orderNumber: { contains: term, mode: 'insensitive' } },
              // El ID solo se compara cuando el texto ES un uuid: con `contains` Prisma falla sobre una columna uuid
              ...(UUID_PATTERN.test(term) ? [{ id: term }] : []),
              { nit: { contains: term, mode: 'insensitive' } },
              { razonSocial: { contains: term, mode: 'insensitive' } },
              { user: { email: { contains: term, mode: 'insensitive' } } },
              { user: { firstName: { contains: term, mode: 'insensitive' } } },
              { user: { lastName: { contains: term, mode: 'insensitive' } } },
            ],
          },
          { status: { not: OrderStatus.CANCELADO } },
          { paymentStatus: PaymentStatus.COMPLETADO },
        ],
      },
      include: { orderItems: { include: { product: true } }, user: true, branch: true },
      orderBy: { createdAt: 'desc' },
      take: SEARCH_RESULT_LIMIT,
    });

    if (orders.length === 0) return [];

    const returnedByItem = await this.getReturnedByOrderItem(
      this.prisma,
      orders.flatMap((order) => order.orderItems.map((item) => item.id)),
    );

    return orders.map((order) => this.toReturnableOrder(order, returnedByItem));
  }

  // Procesa la devolución completa en una sola transacción: valida el tope, guarda el registro y
  // reingresa cada prenda al inventario que le corresponde según su estado físico.
  async process(staff: AuthUser, dto: ProcessReturnDto): Promise<ReturnResponseDto> {
    // Sucursal que RECIBE la mercadería: la del cajero que atiende (o la elegida, con alcance global).
    // No es necesariamente la que vendió: un pedido web se puede devolver en cualquier tienda, y el
    // stock tiene que aparecer donde la prenda quedó físicamente.
    const branchId = hasAllBranches(staff) ? (dto.branchId ?? staff.branchId) : staff.branchId;
    if (!branchId) {
      throw new BadRequestException('Tu usuario no tiene una sucursal asignada para recibir devoluciones');
    }
    await this.branchesService.findActiveOrFail(branchId);

    const returnId = await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: dto.orderId },
        include: { orderItems: { include: { product: true } }, user: true, branch: true },
      });
      if (!order) {
        throw new NotFoundException('No se encontró la venta indicada');
      }
      this.assertOrderInScope(staff, order.branchId);
      this.assertRefundable(order);

      // Lo ya devuelto se lee DENTRO de la transacción: es lo que evita que dos cajas abiertas a la vez
      // devuelvan la misma unidad dos veces (cada una vería el tope viejo si se leyera antes).
      const orderItemIds = order.orderItems.map((item) => item.id);
      const returnedByItem = await this.getReturnedByOrderItem(tx, orderItemIds);
      const itemsById = new Map(order.orderItems.map((item) => [item.id, item]));

      // REGLA DE NEGOCIO 1: nunca más de lo que esa línea vendió, contando devoluciones anteriores.
      // Se agrupa lo pedido por línea porque el DTO permite repetirla con distinta condición (2 unidades
      // de vuelta: 1 vendible + 1 dañada), y el tope aplica a la suma, no a cada fila por separado.
      const requestedByItem = new Map<string, number>();
      for (const line of dto.items) {
        requestedByItem.set(line.orderItemId, (requestedByItem.get(line.orderItemId) ?? 0) + line.quantity);
      }

      for (const [orderItemId, requested] of requestedByItem) {
        const orderItem = itemsById.get(orderItemId);
        if (!orderItem) {
          throw new BadRequestException('Uno de los ítems a devolver no pertenece a esta venta');
        }
        const already = returnedByItem.get(orderItemId) ?? 0;
        const remaining = orderItem.quantity - already;
        const label = `"${orderItem.product.name}"${orderItem.size ? ` (talla ${orderItem.size})` : ''}`;
        if (remaining <= 0) {
          throw new BadRequestException(`${label} ya fue devuelto por completo en esta venta`);
        }
        if (requested > remaining) {
          throw new BadRequestException(
            `No se pueden devolver ${requested} unidades de ${label}: se vendieron ${orderItem.quantity} y ya se devolvieron ${already} (máximo ${remaining})`,
          );
        }
      }

      // El reembolso sale del precio histórico de la línea, nunca de lo que manda el cliente ni del
      // precio actual del producto (que pudo cambiar de oferta desde la venta).
      const lines = dto.items.map((line) => {
        const orderItem = itemsById.get(line.orderItemId)!;
        if (!orderItem.size) {
          throw new BadRequestException(
            `La venta no registró la talla de "${orderItem.product.name}", así que no se puede saber a qué ` +
              'inventario devolverla. Ajusta el stock manualmente desde Inventario.',
          );
        }
        return {
          orderItemId: orderItem.id,
          productId: orderItem.productId,
          size: orderItem.size,
          unitPrice: orderItem.price,
          quantity: line.quantity,
          reason: line.reason,
          condition: line.condition,
        };
      });

      const totalRefunded = round2(
        lines.reduce((sum, line) => sum + Number(line.unitPrice) * line.quantity, 0),
      );

      const created = await tx.return.create({
        data: {
          orderId: order.id,
          branchId,
          userId: order.userId,
          cashierId: staff.id,
          totalRefunded,
          notes: dto.notes,
          items: {
            create: lines.map((line) => ({
              productId: line.productId,
              orderItemId: line.orderItemId,
              quantity: line.quantity,
              size: line.size,
              unitPrice: line.unitPrice,
              reason: line.reason,
              condition: line.condition,
            })),
          },
        },
      });

      // REGLA DE NEGOCIO 2: el estado físico decide a qué inventario entra cada prenda.
      for (const line of lines) {
        if (line.condition === ItemCondition.SELLABLE) {
          await this.inventoryService.increment(tx, line.productId, branchId, line.size, line.quantity);
        } else {
          await this.inventoryService.incrementDamaged(tx, line.productId, branchId, line.size, line.quantity);
        }
      }

      // Si ya no queda nada por devolver, la venta entera queda reembolsada
      const soldUnits = order.orderItems.reduce((sum, item) => sum + item.quantity, 0);
      const returnedBefore = [...returnedByItem.values()].reduce((sum, quantity) => sum + quantity, 0);
      const returnedNow = lines.reduce((sum, line) => sum + line.quantity, 0);
      if (returnedBefore + returnedNow >= soldUnits) {
        await tx.order.update({
          where: { id: order.id },
          data: { paymentStatus: PaymentStatus.REEMBOLSADO },
        });
      }

      return created.id;
    });

    return this.findOne(returnId);
  }

  // Historial de devoluciones para auditoría (mermas y reingresos), filtrable por producto
  async findAll(staff: AuthUser, query: QueryReturnsDto): Promise<PaginatedReturnsDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Prisma.ReturnWhereInput = {
      ...(query.productId ? { items: { some: { productId: query.productId } } } : {}),
      ...this.buildReturnScope(staff, query.branchId),
    };

    const [total, returns] = await Promise.all([
      this.prisma.return.count({ where }),
      this.prisma.return.findMany({
        where,
        include: this.returnInclude(),
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      data: returns.map((row) => this.toReturnResponse(row)),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) || 1 },
    };
  }

  async findOne(id: string): Promise<ReturnResponseDto> {
    const row = await this.prisma.return.findUnique({ where: { id }, include: this.returnInclude() });
    if (!row) {
      throw new NotFoundException('Devolución no encontrada');
    }
    return this.toReturnResponse(row);
  }

  // Sin ALL_BRANCHES solo se ven las devoluciones recibidas en la sucursal propia
  private buildReturnScope(staff: AuthUser, requestedBranchId?: string): Prisma.ReturnWhereInput {
    if (!hasAllBranches(staff)) {
      return { branchId: staff.branchId ?? '__sin_sucursal__' };
    }
    return requestedBranchId ? { branchId: requestedBranchId } : {};
  }

  // Alcance del buscador de ventas. Sin ALL_BRANCHES se limita a las ventas de la sucursal propia más
  // las que no tienen sucursal asignada (pedidos web que ninguna tienda "posee"), para que un pedido
  // en línea se pueda devolver en mostrador sin abrir las ventas de las demás sucursales.
  private buildOrderScope(staff: AuthUser, requestedBranchId?: string): Prisma.OrderWhereInput {
    if (!hasAllBranches(staff)) {
      return { OR: [{ branchId: staff.branchId ?? '__sin_sucursal__' }, { branchId: null }] };
    }
    return requestedBranchId ? { OR: [{ branchId: requestedBranchId }, { branchId: null }] } : {};
  }

  private assertOrderInScope(staff: AuthUser, orderBranchId: string | null): void {
    if (hasAllBranches(staff)) return;
    if (orderBranchId !== null && orderBranchId !== staff.branchId) {
      throw new ForbiddenException('Esta venta pertenece a otra sucursal');
    }
  }

  private assertRefundable(order: { status: OrderStatus; paymentStatus: PaymentStatus }): void {
    if (order.status === OrderStatus.CANCELADO) {
      throw new BadRequestException('La venta está anulada: no hay nada que devolver');
    }
    if (order.paymentStatus === PaymentStatus.REEMBOLSADO) {
      throw new BadRequestException('Esta venta ya fue reembolsada por completo');
    }
    if (order.paymentStatus !== PaymentStatus.COMPLETADO) {
      throw new BadRequestException('Solo se pueden devolver ventas ya cobradas');
    }
  }

  // { [orderItemId]: unidades ya devueltas }. Acepta el cliente de transacción para poder leerlo
  // dentro de process() y que el tope no se calcule sobre datos viejos.
  private async getReturnedByOrderItem(
    client: Prisma.TransactionClient | PrismaService,
    orderItemIds: string[],
  ): Promise<Map<string, number>> {
    if (orderItemIds.length === 0) return new Map();
    const grouped = await client.returnItem.groupBy({
      by: ['orderItemId'],
      where: { orderItemId: { in: orderItemIds } },
      _sum: { quantity: true },
    });
    return new Map(grouped.map((row) => [row.orderItemId, row._sum.quantity ?? 0]));
  }

  private returnInclude() {
    return {
      items: { include: { product: true } },
      order: { select: { orderNumber: true } },
      branch: { select: { name: true } },
      user: true,
      cashier: true,
    } satisfies Prisma.ReturnInclude;
  }

  private toReturnableOrder(
    order: OrderWithItems,
    returnedByItem: Map<string, number>,
  ): ReturnableOrderDto {
    const items = order.orderItems.map((item) => {
      const alreadyReturned = returnedByItem.get(item.id) ?? 0;
      return {
        orderItemId: item.id,
        productId: item.productId,
        productName: item.product.name,
        sku: item.product.sku,
        size: item.size,
        quantity: item.quantity,
        unitPrice: Number(item.price),
        alreadyReturned,
        returnableQuantity: Math.max(item.quantity - alreadyReturned, 0),
      };
    });

    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      source: order.source,
      paymentMethod: order.paymentMethod,
      status: order.status,
      totalAmount: Number(order.totalAmount),
      branchName: order.branch?.name ?? null,
      customerName: this.fullName(order.user),
      customerEmail: order.user.email,
      nit: order.nit,
      razonSocial: order.razonSocial,
      createdAt: order.createdAt,
      items,
      fullyReturned: items.every((item) => item.returnableQuantity === 0),
    };
  }

  private toReturnResponse(
    row: Prisma.ReturnGetPayload<{ include: ReturnType<ReturnsService['returnInclude']> }>,
  ): ReturnResponseDto {
    const countUnits = (condition: ItemCondition) =>
      row.items
        .filter((item) => item.condition === condition)
        .reduce((sum, item) => sum + item.quantity, 0);

    return {
      id: row.id,
      returnNumber: row.returnNumber,
      orderId: row.orderId,
      orderNumber: row.order.orderNumber,
      branchId: row.branchId,
      branchName: row.branch?.name ?? null,
      totalRefunded: Number(row.totalRefunded),
      notes: row.notes,
      customerName: this.fullName(row.user),
      cashierName: this.fullName(row.cashier),
      sellableUnits: countUnits(ItemCondition.SELLABLE),
      damagedUnits: countUnits(ItemCondition.DAMAGED),
      items: row.items.map((item) => ({
        id: item.id,
        productId: item.productId,
        productName: item.product.name,
        sku: item.product.sku,
        size: item.size,
        quantity: item.quantity,
        unitPrice: Number(item.unitPrice),
        subtotal: round2(Number(item.unitPrice) * item.quantity),
        reason: item.reason,
        condition: item.condition,
      })),
      createdAt: row.createdAt,
    };
  }

  private fullName(user: { firstName: string | null; lastName: string | null; email: string }): string {
    return `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || user.email;
  }
}

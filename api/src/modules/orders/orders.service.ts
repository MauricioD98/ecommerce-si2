import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrderApiResponseDto, OrderResponseDto } from './dto/order-response.dto';
import { FulfillmentType, Order, OrderItem, OrderStatus, Product, User } from '@prisma/client';
import { QueryOrderDto } from './dto/query-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { BranchesService } from '../branches/branches.service';
import { InventoryService } from '../branches/inventory.service';
import type { AuthUser } from '../../common/decorators/interfaces/request-with-user.interface';
import { hasAllBranches } from '../../common/utils/permission.util';
import { calculateTotals, getBranchPrice, getEmployeeDiscountPercent, round2 } from '../../common/utils/pricing';
import { DELIVERY_SHIPPING_COST } from '../../common/constants/pricing';
import { NotificationsService } from '../notifications/notifications.service';

// Mensaje claro y específico por estado (no un genérico "tu pedido ahora está X")
const ORDER_STATUS_MESSAGE: Record<OrderStatus, string> = {
  PENDIENTE: 'Tu pedido fue recibido y está pendiente de confirmación.',
  PROCESANDO: 'Tu pedido está siendo preparado.',
  ENVIADO: 'Tu pedido está en camino.',
  ENTREGADO: '¡Tu pedido fue entregado!',
  CANCELADO: 'Tu pedido fue cancelado.',
};

@Injectable()
export class OrdersService {
    constructor(
        private prisma: PrismaService,
        private branchesService: BranchesService,
        private inventoryService: InventoryService,
        private notificationsService: NotificationsService,
    ){}

  // Best-effort: una notificación push nunca debe romper el flujo de actualización del pedido
  private notifyStatusChange(order: Order): void {
    this.notificationsService
      .sendPushNotification(order.userId, {
        title: `Pedido ${order.orderNumber}`,
        body: ORDER_STATUS_MESSAGE[order.status],
        url: `/account/orders/${order.id}`,
      })
      .catch(() => undefined);
  }

  // Create
  async create(
    user: AuthUser,
    createOrderDto: CreateOrderDto,
  ): Promise<OrderApiResponseDto<OrderResponseDto>> {
    const { items, shippingAddress, branchId, latitude, longitude, paymentMethod } = createOrderDto;
    const fulfillmentType = createOrderDto.fulfillmentType ?? FulfillmentType.DELIVERY;
    const userId = user.id;

    let targetBranchId = branchId;
    if (fulfillmentType === FulfillmentType.PICKUP && !targetBranchId) {
      const defaultBranch = await this.branchesService.findFirstActive();
      if (defaultBranch) {
        targetBranchId = defaultBranch.id;
      } else {
        throw new BadRequestException('A branch is required for PICKUP orders');
      }
    }
    if (targetBranchId) {
      await this.branchesService.findActiveOrFail(targetBranchId);
    }
    // La ubicación de entrega va completa (latitud y longitud) o no va
    if ((latitude === undefined) !== (longitude === undefined)) {
      throw new BadRequestException('latitude and longitude must be sent together');
    }

    // Precios calculados en el servidor (descuento de la sucursal), nunca los enviados por el cliente
    const lines: { productId: string; quantity: number; unitPrice: number; size: string }[] = [];

    for (const item of items) {
      const product = await this.prisma.product.findUnique({
        where: { id: item.productId },
      });

      if (!product || !product.isActive) {
        throw new NotFoundException(
          `Product with ID ${item.productId} not found`,
        );
      }

      if (!product.sizes.includes(item.size)) {
        throw new BadRequestException(
          `Invalid size for product ${product.name}. Available: ${product.sizes.join(', ')}`,
        );
      }

      // Con sucursal se valida el stock de esa talla puntual; sin sucursal, el stock global
      // (retrocompatible, no distingue talla) y el precio base
      const inventoryForSize = branchId
        ? await this.inventoryService.getInventoryForSize(product.id, branchId, item.size)
        : null;
      // El descuento del producto sigue siendo agregado (igual en todas las tallas)
      const inventoryAggregate = branchId ? await this.inventoryService.getInventory(product.id, branchId) : null;
      const available = branchId ? (inventoryForSize?.stock ?? 0) : product.stock;

      if (available < item.quantity) {
        throw new BadRequestException(
          `Insufficient stock for size ${item.size} of product ${product.name}. Available: ${available}, Requested:${item.quantity}`,
        );
      }

      lines.push({
        productId: product.id,
        quantity: item.quantity,
        unitPrice: getBranchPrice(product, inventoryAggregate),
        size: item.size,
      });
    }

    // Descuento de trabajador: se lee de la BD (no del JWT) para no aplicar un porcentaje desactualizado
    const buyer = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { employeeDiscount: true },
    });
    const { discountApplied, total: itemsTotal } = calculateTotals(
      lines,
      getEmployeeDiscountPercent(buyer ?? { employeeDiscount: 0 }),
    );

    // Envío a domicilio suma un costo fijo (no se descuenta); retiro en sucursal no tiene costo de envío
    const shippingCost = fulfillmentType === FulfillmentType.DELIVERY ? DELIVERY_SHIPPING_COST : 0;
    const total = round2(itemsTotal + shippingCost);

    const latestCart = await this.prisma.cart.findFirst({
  where: {
    userId,
    checkout: false,
  },
  orderBy: {
    createdAt: 'desc',
  },
  }); 

  const order = await this.prisma.$transaction(async (tx) => {

  const newOrder = await tx.order.create({
    data: {
      userId,
      status: OrderStatus.PENDIENTE,
      totalAmount: total,
      discountApplied,
      shippingCost,
      ...(paymentMethod ? { paymentMethod } : {}),
      fulfillmentType,
      branchId: targetBranchId,
      shippingAddress,
      // La ubicación solo tiene sentido en envíos a domicilio
      ...(fulfillmentType === FulfillmentType.DELIVERY ? { latitude, longitude } : {}),
      cartId: latestCart?.id,
      orderItems: {
        create: lines.map((line) => ({
          product: {
            connect: { id: line.productId },
          },
          quantity: line.quantity,
          price: line.unitPrice,
          size: line.size,
        }))
      }
    },
        include: {
        orderItems: {
          include: {
            product: true,
          },
        },
        user:true,
      },
    
  })

  for (const line of lines) {
        if (targetBranchId) {
          await this.inventoryService.decrement(tx, line.productId, targetBranchId, line.size, line.quantity);
        } else {
          const result = await tx.product.updateMany({
            where: { id: line.productId, stock: { gte: line.quantity } },
            data: { stock: { decrement: line.quantity } },
          });
          if (result.count === 0) {
            throw new BadRequestException('Insufficient stock');
          }
        }
      }

      return newOrder;
});

    return this.wrap(order);
  } 

  async findAllForAdmin(query: QueryOrderDto, actor?: AuthUser): Promise<{
  data: OrderResponseDto[];
  total: number;
  page: number;
  limit: number;
}> {
  const { page = 1, limit = 10, status, search } = query;
  const skip = (page - 1) * limit;

const where: any = {};
this.applyBranchScope(where, actor);
if (status) where.status = status;
if (search) where.OR = [{ id: { contains: search, mode: 'insensitive' } },
  {orderNumber:{contains: search, mode:'insensitive'}},
];

  const [orders, total] = await Promise.all([
  this.prisma.order.findMany({
    where,
    skip,
    take: limit,
    include: {
      orderItems: {
        include: {
          product: true,
        },
      },
      user: true,
    },
    orderBy:{createdAt:'desc'},
  }),

  this.prisma.order.count({where}),

]);

return {
  data: orders.map((o) => this.map(o)),
  total,
  page,
  limit
}

}


async findAll(
  userId: string,
  query: QueryOrderDto,
): Promise<{
  data: OrderResponseDto[];
  total: number;
  page: number;
  limit: number;
}> {

  const { page = 1, limit = 10, status, search } = query;
  const skip = (page - 1) * limit;

  const where: any = { userId };
  if (status) where.status = status;
  if (search) where.OR = [{ id: { contains: search, mode: 'insensitive' } }];

  const [orders, total] = await Promise.all([
  this.prisma.order.findMany({
    where,
    skip,
    take: limit,
    include: {
      orderItems: {
        include: {
          product: true,
        },
      },
        user:true,
    },
      orderBy:{ createdAt:'desc'},
  }),
    this.prisma.order.count({where}),
]);

  return {
  data: orders.map((o) => this.map(o)),
  total,
  page,
  limit,
};

}


async findOne(id: string, userId?: string, actor?: AuthUser): Promise<OrderApiResponseDto<OrderResponseDto>> {

  const where: any = { id }
  if (userId) where.userId = userId;
  this.applyBranchScope(where, actor);

  const order = await this.prisma.order.findFirst({
    where,
    include: {
      orderItems: {
        include: {
          product: true
        },
      },
      user:true,
    },
  });

  if (!order) {
  throw new NotFoundException(`Order with ID ${id} not found`);
  }
    return this.wrap(order);
}


async update(
  id: string,
  updateOrderDto: UpdateOrderDto,
  userId?: string,
  actor?: AuthUser,
): Promise<OrderApiResponseDto<OrderResponseDto>> {
  const where: any = { id };
  if (userId) where.userId = userId;
  this.applyBranchScope(where, actor);

  const existing = await this.prisma.order.findFirst({
    where,
  });
  if (!existing) throw new NotFoundException(`Order ${id} not found`);

    const updated = await this.prisma.order.update({
  where: { id },
  data: updateOrderDto,
  include: {
    orderItems: {
      include: {
        product: true,
        },
      },
      user: true,
    },
  });

  if (updateOrderDto.status && updateOrderDto.status !== existing.status) {
    this.notifyStatusChange(updated);
  }

  return this.wrap(updated);

 }


async cancel(
  id: string,
  userId?: string,
  actor?: AuthUser,
): Promise<OrderApiResponseDto<OrderResponseDto>> {
  const where: any = { id };
  if (userId) where.userId = userId;
  this.applyBranchScope(where, actor);

  const order = await this.prisma.order.findFirst({
    where,
    include: {
      orderItems: true,
      user:true,
    },
  });

  if (!order) {
  throw new NotFoundException(`Order ${id} not found`);
  }

  if (order.status !== OrderStatus.PENDIENTE) {
  throw new BadRequestException('Only pending orders can be cancelled');
  }

    const cancelled = await this.prisma.$transaction(async (tx) => {
  for (const item of order.orderItems) {
    if (order.branchId) {
      // Pedidos creados antes de esta migración pueden no tener talla guardada; sin talla no hay
      // dónde reponer el stock por talla, así que ese caso queda igual que antes (no se repone)
      if (item.size) {
        await this.inventoryService.increment(tx, item.productId, order.branchId, item.size, item.quantity);
      }
    } else {
      await tx.product.update({
        where: { id: item.productId },
        data: { stock: { increment: item.quantity } },
      });
    }
   }

    return tx.order.update({
    where: { id },
    data: { status: OrderStatus.CANCELADO },
    include: {
      orderItems: {
        include: {
          product: true,
        },
      },
      user:true,
    },
   });
  });
  this.notifyStatusChange(cancelled);
  return this.wrap(cancelled);

}



  // Sin el permiso ALL_BRANCHES solo se ven/gestionan pedidos de la sucursal propia
  private applyBranchScope(where: any, actor?: AuthUser): void {
    if (!actor || hasAllBranches(actor)) return;
    if (!actor.branchId) {
      throw new ForbiddenException('User is not assigned to a branch');
    }
    where.branchId = actor.branchId;
  }

  private wrap(
    order: Order &{
      orderItems: (OrderItem &{ product: Product})[];
      user:User; 
    },
  ): OrderApiResponseDto<OrderResponseDto> {
  return {
    success: true,
    message: 'Order retreived successfully',
    data: this.map(order),
  };
}

private map(order: Order & { orderItems: (OrderItem &{ product: Product})[];
  user:User; 
  },
): OrderResponseDto {
  return {
    id: order.id,
    userId: order.userId,
    status: order.status,
    paymentStatus: order.paymentStatus,
    total: Number(order.totalAmount),
    shippingCost: Number(order.shippingCost),
    shippingAddress: order.shippingAddress ?? '',
    fulfillmentType: order.fulfillmentType,
    latitude: order.latitude,
    longitude: order.longitude,
    branchId: order.branchId,
    discountApplied: Number(order.discountApplied),
    source: order.source,
    paymentMethod: order.paymentMethod,
    cashierId: order.cashierId,
    items: order.orderItems.map((item) => ({
      id: item.id,
      productId: item.productId,
      productName: item.product.name,
      size: item.size,
      quantity: item.quantity,
      price: Number(item.price),
      subtotal: Number(item.price) * item.quantity,
      createdAt: order.createdAt,
      updateAt: order.updatedAt,
    })),

    ...(order.user && {
  userEmail: order.user.email,
  userName:
    `${order.user.firstName || ''} ${order.user.lastName || ''}`.trim(),
  }),
  createdAt: order.createdAt,
  updateAt: order.updatedAt,
  };
}
  
}

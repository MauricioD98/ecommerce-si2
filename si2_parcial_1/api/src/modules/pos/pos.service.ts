import { randomUUID } from 'crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { FulfillmentType, OrderSource, OrderStatus, PaymentMethod, PaymentStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BranchesService } from '../branches/branches.service';
import { InventoryService } from '../branches/inventory.service';
import { ProductsService } from '../products/products.service';
import { calculateTotals, getBranchPrice, getEmployeeDiscountPercent, round2 } from '../../common/utils/pricing';
import { DEFAULT_ROLE } from '../../common/constants/permissions';
import { hasAllBranches } from '../../common/utils/permission.util';
import type { AuthUser } from '../../common/decorators/interfaces/request-with-user.interface';
import { PosCheckoutDto } from './dto/pos-checkout.dto';
import { PosCheckoutResponseDto } from './dto/pos-receipt.dto';

// Cliente placeholder para ventas de caja sin cuenta registrada. Se crea una sola vez (lazy) y se reutiliza.
const WALK_IN_CUSTOMER_EMAIL = 'consumidor-final@pos.stellafemme.internal';

@Injectable()
export class PosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchesService: BranchesService,
    private readonly inventoryService: InventoryService,
    private readonly productsService: ProductsService,
  ) {}

  // Catálogo del POS: solo productos con stock en la sucursal del cajero (o la elegida, si tiene alcance global)
  async getCatalog(
    cashier: AuthUser,
    query: { branchId?: string; search?: string; page?: number; limit?: number },
  ) {
    const branchId = hasAllBranches(cashier) ? (query.branchId ?? cashier.branchId) : cashier.branchId;
    if (!branchId) {
      throw new BadRequestException('El cajero no tiene una sucursal asignada');
    }

    return this.productsService.findAll({
      branchId,
      inStockOnly: true,
      isActive: true,
      search: query.search,
      page: query.page ?? 1,
      limit: query.limit ?? 24,
    });
  }

  async checkout(cashier: AuthUser, dto: PosCheckoutDto): Promise<PosCheckoutResponseDto> {
    const branchId = dto.branchId ?? cashier.branchId;
    if (!branchId) {
      throw new BadRequestException('El cajero no tiene una sucursal asignada para cobrar');
    }
    const branch = await this.branchesService.findActiveOrFail(branchId);

    // El JWT solo trae id/email/rol; el nombre real del cajero (para el recibo) se lee de la BD
    const cashierRecord = await this.prisma.user.findUnique({ where: { id: cashier.id } });
    const cashierName =
      `${cashierRecord?.firstName ?? ''} ${cashierRecord?.lastName ?? ''}`.trim() || cashier.email;

    const customer = dto.customerId
      ? await this.getRegisteredCustomer(dto.customerId)
      : await this.getOrCreateWalkInCustomer();

    // Precios y stock siempre desde la BD, con el descuento vigente de esta sucursal (nunca del cliente)
    const lines: { productId: string; productName: string; quantity: number; unitPrice: number }[] = [];

    for (const item of dto.items) {
      const product = await this.prisma.product.findUnique({ where: { id: item.productId } });
      if (!product || !product.isActive) {
        throw new NotFoundException(`Product with ID ${item.productId} not found`);
      }

      const inventory = await this.inventoryService.getInventory(product.id, branchId);
      if ((inventory?.stock ?? 0) < item.quantity) {
        throw new BadRequestException(
          `Insufficient stock for product ${product.name}. Available: ${inventory?.stock ?? 0}, Requested: ${item.quantity}`,
        );
      }

      lines.push({
        productId: product.id,
        productName: product.name,
        quantity: item.quantity,
        unitPrice: getBranchPrice(product, inventory),
      });
    }

    const { subtotal, discountApplied, total } = calculateTotals(
      lines,
      getEmployeeDiscountPercent(customer),
    );

    // El cambio siempre se calcula en el servidor (nunca se confía en el que muestra el cliente)
    let change: number | null = null;
    if (dto.paymentMethod === 'CASH') {
      if (dto.amountReceived == null) {
        throw new BadRequestException('amountReceived is required for CASH payments');
      }
      if (dto.amountReceived < total) {
        throw new BadRequestException(
          `Insufficient amount received. Total: ${total}, Received: ${dto.amountReceived}`,
        );
      }
      change = round2(dto.amountReceived - total);
    }

    const order = await this.prisma.$transaction(async (tx) => {
      const newOrder = await tx.order.create({
        data: {
          userId: customer.id,
          cashierId: cashier.id,
          branchId,
          status: OrderStatus.ENTREGADO,
          paymentStatus: PaymentStatus.COMPLETADO,
          paymentMethod: dto.paymentMethod as PaymentMethod,
          source: OrderSource.POS,
          fulfillmentType: FulfillmentType.PICKUP,
          totalAmount: total,
          discountApplied,
          shippingCost: 0,
          shippingAddress: dto.notes,
          nit: dto.nit,
          razonSocial: dto.razonSocial,
          orderItems: {
            create: lines.map((line) => ({
              product: { connect: { id: line.productId } },
              quantity: line.quantity,
              price: line.unitPrice,
            })),
          },
        },
      });

      for (const line of lines) {
        await this.inventoryService.decrement(tx, line.productId, branchId, line.quantity);
      }

      return newOrder;
    });

    return {
      success: true,
      message: 'Sale completed successfully',
      data: {
        orderId: order.id,
        orderNumber: order.orderNumber,
        items: lines.map((line) => ({
          productName: line.productName,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          subtotal: Math.round(line.unitPrice * line.quantity * 100) / 100,
        })),
        subtotal,
        discountApplied,
        total,
        paymentMethod: dto.paymentMethod,
        branchName: branch.name,
        cashierName,
        customerName:
          customer.email === WALK_IN_CUSTOMER_EMAIL
            ? 'Consumidor Final'
            : `${customer.firstName ?? ''} ${customer.lastName ?? ''}`.trim() || customer.email,
        nit: dto.nit ?? null,
        razonSocial: dto.razonSocial ?? null,
        amountReceived: dto.amountReceived ?? null,
        change,
        createdAt: order.createdAt,
      },
    };
  }

  private async getRegisteredCustomer(customerId: string) {
    const customer = await this.prisma.user.findUnique({ where: { id: customerId } });
    if (!customer) {
      throw new NotFoundException('Customer not found');
    }
    return customer;
  }

  private async getOrCreateWalkInCustomer() {
    const existing = await this.prisma.user.findUnique({ where: { email: WALK_IN_CUSTOMER_EMAIL } });
    if (existing) return existing;

    const clienteRole = await this.prisma.role.findUnique({ where: { name: DEFAULT_ROLE } });
    if (!clienteRole) {
      throw new BadRequestException(`Base role "${DEFAULT_ROLE}" not found: run the seed first`);
    }

    // Password aleatoria e inutilizable: esta cuenta nunca inicia sesión, solo agrupa ventas de mostrador
    const password = await bcrypt.hash(randomUUID(), 10);
    return this.prisma.user.create({
      data: {
        email: WALK_IN_CUSTOMER_EMAIL,
        password,
        firstName: 'Consumidor',
        lastName: 'Final',
        roleId: clienteRole.id,
      },
    });
  }
}

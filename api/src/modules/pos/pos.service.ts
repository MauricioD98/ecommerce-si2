import { randomUUID } from 'crypto';
import {
  BadRequestException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { FulfillmentType, OrderSource, OrderStatus, PaymentMethod, PaymentStatus, Prisma } from '@prisma/client';
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
  private readonly logger = new Logger(PosService.name);

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

    // Precios y stock siempre desde la BD, con el descuento vigente de esta sucursal (nunca del cliente).
    // Se lee TODO de una vez (2 queries) en lugar de 4 por línea: con la base remota, esas 4 idas y
    // vueltas por ítem hacían que una venta de 5 líneas tardara ~10s en total.
    const productIds = [...new Set(dto.items.map((item) => item.productId))];
    const [products, inventoryRows] = await Promise.all([
      this.prisma.product.findMany({ where: { id: { in: productIds } } }),
      this.prisma.productInventory.findMany({ where: { branchId, productId: { in: productIds } } }),
    ]);

    const productById = new Map(products.map((product) => [product.id, product]));
    const stockByProductSize = new Map<string, number>();
    const discountByProduct = new Map<string, { discountPrice: Prisma.Decimal | null; discountPercentage: number | null }>();

    for (const row of inventoryRows) {
      stockByProductSize.set(`${row.productId}|${row.size}`, row.stock);
      // El descuento se mantiene sincronizado entre las tallas de un mismo producto+sucursal, así que
      // la primera fila que aparezca ya lo representa (mismo criterio que InventoryService.getInventory)
      if (!discountByProduct.has(row.productId)) {
        discountByProduct.set(row.productId, {
          discountPrice: row.discountPrice,
          discountPercentage: row.discountPercentage,
        });
      }
    }

    // Cantidad total pedida de cada producto+talla. Se agrupa ANTES de validar porque si el ticket
    // manda dos líneas de la misma talla, validarlas por separado deja pasar una venta que después no
    // tiene stock (cada línea cabía sola, las dos juntas no).
    const requested = new Map<string, { productId: string; size: string; quantity: number }>();
    for (const item of dto.items) {
      const key = `${item.productId}|${item.size}`;
      const accumulated = requested.get(key);
      requested.set(key, {
        productId: item.productId,
        size: item.size,
        quantity: (accumulated?.quantity ?? 0) + item.quantity,
      });
    }

    const lines: { productId: string; productName: string; quantity: number; unitPrice: number; size: string }[] = [];

    for (const item of dto.items) {
      const product = productById.get(item.productId);
      if (!product || !product.isActive) {
        throw new NotFoundException(`Product with ID ${item.productId} not found`);
      }

      if (!product.sizes.includes(item.size)) {
        throw new BadRequestException(`Invalid size for product ${product.name}. Available: ${product.sizes.join(', ')}`);
      }

      lines.push({
        productId: product.id,
        productName: product.name,
        quantity: item.quantity,
        unitPrice: getBranchPrice(product, discountByProduct.get(product.id) ?? null),
        size: item.size,
      });
    }

    for (const line of requested.values()) {
      const available = stockByProductSize.get(`${line.productId}|${line.size}`) ?? 0;
      if (available < line.quantity) {
        const product = productById.get(line.productId);
        throw new BadRequestException(
          `Insufficient stock for size ${line.size} of product ${product?.name ?? line.productId}. Available: ${available}, Requested: ${line.quantity}`,
        );
      }
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

    let order: { id: string; orderNumber: string; createdAt: Date };
    try {
      order = await this.prisma.$transaction(async (tx) => {
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
              size: line.size,
            })),
          },
        },
      });

      // Un updateMany condicional por talla (la garantía atómica contra sobreventa) y UN solo
      // recálculo del stock global al final, en vez de dos queries extra por línea.
      for (const line of requested.values()) {
        await this.inventoryService.decrement(tx, line.productId, branchId, line.size, line.quantity, {
          syncGlobal: false,
        });
      }
      await this.inventoryService.syncGlobalStockMany(tx, productIds);

      return newOrder;
      });
    } catch (error) {
      // Las excepciones HTTP ya son mensajes pensados para el cajero (stock insuficiente, monto que no
      // alcanza): se dejan pasar tal cual. Cualquier otra cosa es un fallo real que el cliente veía
      // como "Internal server error" sin ningún detalle, así que acá queda registrado con contexto.
      if (error instanceof HttpException) throw error;

      const prismaCode = (error as { code?: string })?.code;
      this.logger.error(
        `Falló el cobro en caja: sucursal ${branchId}, ${dto.items.length} línea(s), método ${dto.paymentMethod}` +
          (prismaCode ? ` — código Prisma ${prismaCode}` : ''),
        error instanceof Error ? error.stack : String(error),
      );
      throw new InternalServerErrorException(
        'No se pudo registrar la venta. No se descontó stock ni se cobró: volvé a intentar.',
      );
    }

    return {
      success: true,
      message: 'Sale completed successfully',
      data: {
        orderId: order.id,
        orderNumber: order.orderNumber,
        items: lines.map((line) => ({
          productName: line.productName,
          size: line.size,
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

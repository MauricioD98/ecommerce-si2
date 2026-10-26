import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryService } from '../branches/inventory.service';
import { ControlPrismaService } from '../../tenancy/control-prisma.service';
import { runInTenant } from '../../tenancy/tenant-context';

// El carrito reserva stock real al agregar un ítem (CartService.addItem). Si el cliente lo
// abandona sin pagar, ese stock queda descontado para siempre a menos que algo lo libere: este
// cron corre cada 15 minutos y libera los carritos sin actividad por más de 1 hora.
const ABANDONED_CART_TTL_MS = 60 * 60 * 1000;

@Injectable()
export class CartCleanupService {
  private readonly logger = new Logger(CartCleanupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly inventoryService: InventoryService,
    private readonly control: ControlPrismaService,
  ) {}

  // Esta versión de @nestjs/schedule no trae CronExpression.EVERY_15_MINUTES: se usa la expresión cron directa.
  // El cron corre fuera de cualquier request, así que no hay tenant: se abre el contexto de cada
  // tienda activa a mano para que this.prisma apunte a su schema.
  @Cron('*/15 * * * *')
  async releaseAbandonedCarts(): Promise<void> {
    const tenants = await this.control.tenant.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, schemaName: true },
    });
    for (const t of tenants) {
      try {
        await runInTenant({ tenantId: t.id, schemaName: t.schemaName }, () => this.releaseForCurrentTenant());
      } catch (error) {
        this.logger.error(`Falló la limpieza de carritos en ${t.schemaName}`, error as Error);
      }
    }
  }

  private async releaseForCurrentTenant(): Promise<void> {
    const cutoff = new Date(Date.now() - ABANDONED_CART_TTL_MS);

    // updatedAt del Cart se toca a propósito en cada addItem/updateItemQuantity (ver CartService):
    // es la señal de "última actividad" que usamos acá para detectar abandono.
    const abandonedCarts = await this.prisma.cart.findMany({
      where: { checkout: false, updatedAt: { lt: cutoff }, cartItems: { some: {} } },
      include: { cartItems: true },
    });

    if (abandonedCarts.length === 0) return;

    let released = 0;
    for (const cart of abandonedCarts) {
      try {
        await this.prisma.$transaction(async (tx) => {
          for (const item of cart.cartItems) {
            if (item.quantity <= 0) continue;

            if (item.branchId) {
              await this.inventoryService.increment(tx, item.productId, item.branchId, item.size ?? '', item.quantity);
            } else {
              await tx.product.update({
                where: { id: item.productId },
                data: { stock: { increment: item.quantity } },
              });
            }
          }
          await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
        });
        released += 1;
      } catch (error) {
        // Un carrito que falla no debe frenar la liberación del resto
        this.logger.error(`No se pudo liberar el carrito abandonado ${cart.id}`, error as Error);
      }
    }

    this.logger.log(`Carritos abandonados liberados: ${released}/${abandonedCarts.length}`);
  }
}

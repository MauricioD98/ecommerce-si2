import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryService } from '../branches/inventory.service';

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
  ) {}

  // Esta versión de @nestjs/schedule no trae CronExpression.EVERY_15_MINUTES: se usa la expresión cron directa.
  @Cron('*/15 * * * *')
  async releaseAbandonedCarts(): Promise<void> {
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

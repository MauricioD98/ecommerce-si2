import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ReservationStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CartService } from './cart.service';
import { ControlPrismaService } from '../../tenancy/control-prisma.service';
import { runInTenant } from '../../tenancy/tenant-context';
import { backgroundJobsEnabled } from '../../common/checkout/checkout-policy';
import { lockCart, withTxRetry } from '../../common/checkout/tx.util';
import { failpoint } from '../../common/checkout/failpoints';

// El carrito reserva stock real al agregar un ítem. Si el cliente lo abandona sin pagar, este barrido
// libera lo vencido (TTL explícito en cada reserva). La lista inicial es solo una pista: cada carrito se
// reclama y se revalida DENTRO de su transacción, así que dos réplicas (o el cron contra un checkout en
// curso) producen una única liberación o un único consumo, nunca ambos. Tras un reinicio prolongado la
// primera pasada recupera todo lo vencido.
@Injectable()
export class CartCleanupService {
  private readonly logger = new Logger(CartCleanupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cartService: CartService,
    private readonly control: ControlPrismaService,
  ) {}

  // Esta versión de @nestjs/schedule no trae CronExpression.EVERY_15_MINUTES: se usa la expresión cron directa.
  // El cron corre fuera de cualquier request, así que no hay tenant: se abre el contexto de cada
  // tienda activa a mano para que this.prisma apunte a su schema.
  @Cron('*/15 * * * *')
  async releaseAbandonedCarts(): Promise<void> {
    if (!backgroundJobsEnabled()) return;
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

  async releaseForCurrentTenant(now = new Date()): Promise<number> {
    const candidates = await this.prisma.stockReservation.findMany({
      where: { status: ReservationStatus.ACTIVE, expiresAt: { lt: now }, cartId: { not: null } },
      select: { cartId: true },
      distinct: ['cartId'],
    });

    let released = 0;
    for (const { cartId } of candidates) {
      try {
        await failpoint('cartCleanup.beforeClaim');
        released += await withTxRetry(() =>
          this.prisma.$transaction(async (tx) => {
            await lockCart(tx, cartId!);
            return this.cartService.expireLocked(tx, cartId!, now);
          }),
        );
      } catch (error) {
        // Un carrito que falla no debe frenar la liberación del resto
        this.logger.error(`No se pudo liberar el carrito abandonado ${cartId}`, error as Error);
      }
    }

    if (released > 0) this.logger.log(`Reservas vencidas liberadas: ${released}`);
    return released;
  }
}

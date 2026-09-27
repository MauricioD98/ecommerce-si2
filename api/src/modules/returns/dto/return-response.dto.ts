import { ApiProperty } from '@nestjs/swagger';
import { ItemCondition, ReturnReason } from '@prisma/client';

// Línea de la venta original, con lo que ya se devolvió y lo que todavía se puede devolver
export class ReturnableOrderItemDto {
  @ApiProperty() orderItemId: string;
  @ApiProperty() productId: string;
  @ApiProperty({ example: 'Vestido largo rojo de fiesta' }) productName: string;
  @ApiProperty({ example: 'VES-001' }) sku: string;
  @ApiProperty({ example: 'M', nullable: true }) size: string | null;
  @ApiProperty({ example: 2, description: 'Unidades vendidas en esta línea' }) quantity: number;
  @ApiProperty({ example: 129.9, description: 'Precio unitario histórico al que se vendió' }) unitPrice: number;

  @ApiProperty({ example: 1, description: 'Unidades ya devueltas de esta línea en devoluciones anteriores' })
  alreadyReturned: number;

  @ApiProperty({ example: 1, description: 'Tope que acepta el endpoint de devolución (quantity - alreadyReturned)' })
  returnableQuantity: number;
}

// Venta encontrada por el buscador del punto de devolución
export class ReturnableOrderDto {
  @ApiProperty() orderId: string;
  @ApiProperty({ example: 'ckv8v1f2p0000' }) orderNumber: string;
  @ApiProperty({ example: 'POS', description: 'WEB (tienda en línea) o POS (caja física)' }) source: string;
  @ApiProperty({ example: 'CASH' }) paymentMethod: string;
  @ApiProperty({ example: 'ENTREGADO' }) status: string;
  @ApiProperty({ example: 259.8 }) totalAmount: number;
  @ApiProperty({ example: 'Sucursal Centro', nullable: true }) branchName: string | null;
  @ApiProperty({ example: 'Consumidor Final' }) customerName: string;
  @ApiProperty({ example: 'cliente@correo.com' }) customerEmail: string;
  @ApiProperty({ example: '1234567', nullable: true }) nit: string | null;
  @ApiProperty({ example: 'Comercial XYZ', nullable: true }) razonSocial: string | null;
  @ApiProperty() createdAt: Date;

  @ApiProperty({ type: [ReturnableOrderItemDto] })
  items: ReturnableOrderItemDto[];

  @ApiProperty({
    example: false,
    description: 'true cuando ya no queda ninguna unidad por devolver en toda la orden',
  })
  fullyReturned: boolean;
}

export class ReturnItemResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() productId: string;
  @ApiProperty({ example: 'Vestido largo rojo de fiesta' }) productName: string;
  @ApiProperty({ example: 'VES-001' }) sku: string;
  @ApiProperty({ example: 'M', nullable: true }) size: string | null;
  @ApiProperty({ example: 1 }) quantity: number;
  @ApiProperty({ example: 129.9 }) unitPrice: number;
  @ApiProperty({ example: 129.9, description: 'unitPrice * quantity' }) subtotal: number;
  @ApiProperty({ enum: ReturnReason }) reason: ReturnReason;
  @ApiProperty({ enum: ItemCondition }) condition: ItemCondition;
}

export class ReturnResponseDto {
  @ApiProperty() id: string;
  @ApiProperty({ example: 'ckv8v1f2p0000' }) returnNumber: string;
  @ApiProperty() orderId: string;
  @ApiProperty({ example: 'ckv8v1f2p0000' }) orderNumber: string;
  @ApiProperty() branchId: string;
  @ApiProperty({ example: 'Sucursal Centro', nullable: true }) branchName: string | null;
  @ApiProperty({ example: 129.9 }) totalRefunded: number;
  @ApiProperty({ example: 'Cliente trajo la boleta', nullable: true }) notes: string | null;
  @ApiProperty({ example: 'Consumidor Final' }) customerName: string;
  @ApiProperty({ example: 'Ana Pérez' }) cashierName: string;

  @ApiProperty({ example: 1, description: 'Unidades que volvieron al stock vendible' })
  sellableUnits: number;

  @ApiProperty({ example: 1, description: 'Unidades que entraron a mermas (no vendibles)' })
  damagedUnits: number;

  @ApiProperty({ type: [ReturnItemResponseDto] })
  items: ReturnItemResponseDto[];

  @ApiProperty() createdAt: Date;
}

export class PaginatedReturnsDto {
  @ApiProperty({ type: [ReturnResponseDto] })
  data: ReturnResponseDto[];

  @ApiProperty({ example: { total: 12, page: 1, limit: 20, totalPages: 1 } })
  meta: { total: number; page: number; limit: number; totalPages: number };
}

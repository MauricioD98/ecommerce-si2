import { ApiProperty } from '@nestjs/swagger';

export class BranchResponseDto {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  id: string;

  @ApiProperty({ example: 'Sucursal Centro' })
  name: string;

  @ApiProperty({ example: 'Calle Libertad #245, Santa Cruz de la Sierra', nullable: true })
  address: string | null;

  @ApiProperty({ example: -17.7833, nullable: true })
  latitude: number | null;

  @ApiProperty({ example: -63.1821, nullable: true })
  longitude: number | null;

  @ApiProperty({ example: '+591 3 3345678', nullable: true })
  phone: string | null;

  @ApiProperty({ example: true })
  isActive: boolean;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class InventorySizeStockDto {
  @ApiProperty({ example: 'M' })
  size: string;

  @ApiProperty({ example: 10 })
  stock: number;
}

export class InventoryResponseDto {
  @ApiProperty()
  productId: string;

  @ApiProperty()
  branchId: string;

  @ApiProperty({ example: 25, description: 'Suma del stock de todas las tallas' })
  stock: number;

  @ApiProperty({ type: [InventorySizeStockDto], description: 'Stock desglosado por talla' })
  sizes: InventorySizeStockDto[];

  @ApiProperty({ example: 'Vestido largo rojo de fiesta' })
  productName: string;

  @ApiProperty({ example: 'VES-001' })
  sku: string;

  @ApiProperty({ example: 129.9, description: 'Precio base del producto' })
  price: number;

  @ApiProperty({ example: 99.9, nullable: true })
  discountPrice: number | null;

  @ApiProperty({ example: 20, nullable: true })
  discountPercentage: number | null;

  @ApiProperty({ example: 99.9, description: 'Precio vigente en la sucursal tras el descuento' })
  effectivePrice: number;
}

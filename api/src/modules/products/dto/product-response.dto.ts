
import { ApiProperty } from '@nestjs/swagger';
import { WomenSize } from './create-product.dto';

export class ProductResponseDto {
  @ApiProperty({
    description: 'Product ID',
    example: '46545646sds-4584s68sd-4654684sd',
  })
  id: string;

  @ApiProperty({
    description: 'Product name',
    example:'Dress'
  })
  name: string;

  @ApiProperty({
    description: 'Tallas disponibles de la prenda',
    enum: WomenSize,
    isArray: true,
    example: [WomenSize.S, WomenSize.M, WomenSize.L],
  })
  sizes: WomenSize[];

  @ApiProperty({
    description: 'Colores disponibles de la prenda',
    isArray: true,
    example: ['negro', 'blanco'],
  })
  colors: string[];

  @ApiProperty({
    description: 'Colecciones a las que pertenece el producto',
    isArray: true,
    example: [{ id: '550e8400-e29b-41d4-a716-446655440001', name: 'Otoño-Invierno', slug: 'otono-invierno' }],
  })
  collections: { id: string; name: string; slug: string }[];

  @ApiProperty({
    description: 'Product description',
    example: 'High quality',
  })
  description?: string | null;

  @ApiProperty({
    description: 'Product price',
    example: 99.99,
  })
  price: number;

  @ApiProperty({
    description: 'Precio vigente en la sucursal indicada con ?branchId, tras su descuento (sin descuento de trabajador). Sin sucursal es el precio base',
    example: 79.99,
  })
  effectivePrice: number;

  @ApiProperty({
    description: 'Product stock (global, suma de todas las sucursales)',
    example: 100,
  })
  stock: number;

  @ApiProperty({
    description: 'Stock en la sucursal indicada con ?branchId (null si no se indicó sucursal)',
    example: 25,
    nullable: true,
  })
  branchStock: number | null;

  @ApiProperty({
    description: 'Descuento del producto en la sucursal indicada con ?branchId (null si no hay sucursal o descuento)',
    nullable: true,
    example: { discountPrice: 79.99, discountPercentage: null },
  })
  discount: { discountPrice: number | null; discountPercentage: number | null } | null;

  @ApiProperty({
    description: 'Stock keeping Unit',
    example: 'WH-001',
  })
  sku: string;

  @ApiProperty({
    description: 'Product image url',
    example: 'https://example.com/image.jpg',

  })
  imageUrl: string | null;

   @ApiProperty({
    description: 'Product category',
    example: 'Dress',
   
  })
  category: string | null;

  @ApiProperty({
    description: 'Product availability status',
    example: true,
  })
  isActive: boolean;

  @ApiProperty({
    description: 'Cantidad de líneas de pedido que referencian este producto (si es > 0, no se puede eliminar; solo desactivar)',
    example: 0,
  })
  orderCount: number;

  @ApiProperty({
    description: 'Sucursal a la que el producto es exclusivo (null = global, visible en todas)',
    nullable: true,
    example: null,
  })
  branchId: string | null;

  @ApiProperty({
    description: 'Creation timestamp',
  })
  createdAt: Date;

  @ApiProperty({
    description: 'last update timestamp',
  })
  updatedAt: Date;
}
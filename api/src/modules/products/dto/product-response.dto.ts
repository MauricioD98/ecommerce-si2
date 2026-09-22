
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
    description: 'Talle de prenda femenina',
    enum: WomenSize,
    example: WomenSize.M,
    nullable: true,
  })
  size: WomenSize | null;

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
    description: 'Product stock',
    example: 100,
  })
  stock: number;

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
    description: 'Creation timestamp',
  })
  createdAt: Date;

  @ApiProperty({
    description: 'last update timestamp',
  })
  updatedAt: Date;
}
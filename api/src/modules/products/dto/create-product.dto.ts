
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {ArrayNotEmpty,ArrayUnique,IsArray,IsBoolean,IsEnum,IsNotEmpty,IsNumber,IsOptional,IsString,IsUUID,MaxLength,Min,} from 'class-validator';

export enum WomenSize {
  XS = 'XS',
  S = 'S',
  M = 'M',
  L = 'L',
  XL = 'XL',
  XXL = 'XXL',
}

export class CreateProductDto {
  @ApiProperty({
    description: 'Product name',
    example: 'Dress',
    maxLength: 200,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @ApiProperty({
    description: 'Tallas disponibles de la prenda (una o varias)',
    enum: WomenSize,
    isArray: true,
    example: [WomenSize.S, WomenSize.M, WomenSize.L],
  })
  @IsArray({ message: 'Las tallas deben enviarse como una lista' })
  @ArrayNotEmpty({ message: 'Debe indicar al menos una talla' })
  @ArrayUnique({ message: 'Las tallas no pueden repetirse' })
  @IsEnum(WomenSize, {
    each: true,
    message: 'Cada talla debe ser un valor válido (XS, S, M, L, XL, XXL)',
  })
  sizes: WomenSize[];

  @ApiProperty({
    description: 'Product description',
    example: 'High quality',
    required:false,
  })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({
    description: 'Product price Bs',
    example: 99.99,
    minimum:0,
  })
  @IsNumber({
    maxDecimalPlaces:2
  })
  @Min(0)
  @Type(() => Number)
  price: number;

  @ApiProperty({
    description: 'Stock keeping Unit (Sku) -unique identifier',
    example: 'WH-001',
    maxLength: 50,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  sku: string;

  @ApiProperty({
    description: 'Product image url',
    example: 'https://example.com/image.jpg',
    required:false,
  })
  @IsString()
  @IsOptional()
  imageUrl?: string;

  @ApiProperty({
    description: 'Product category ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
    required: true,
  })
  @IsUUID()
  @IsNotEmpty()
  categoryId: string;

  @ApiPropertyOptional({
    description: 'Whether product is active and available for purchase',
    example: true,
    default: true,
    required:false,
  })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ApiPropertyOptional({
    description:
      'Sucursal a la que el producto queda exclusivo (no aparece en el catálogo de otras). Omitido o null: global, visible en todas. ' +
      'Solo tiene efecto para quien tiene el permiso ALL_BRANCHES: sin ese permiso, el servidor siempre usa la sucursal del propio usuario e ignora este valor.',
  })
  @IsOptional()
  @IsUUID()
  branchId?: string;

}
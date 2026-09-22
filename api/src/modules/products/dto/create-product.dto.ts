
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {IsBoolean,IsEnum,IsNotEmpty,IsNumber,IsOptional,IsString,IsUUID,MaxLength,Min,} from 'class-validator';

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
    description: 'Talle de prenda femenina',
    enum: WomenSize,
    example: WomenSize.M,
  })
  @IsEnum(WomenSize, {
    message: 'La talla debe ser un valor válido (XS, S, M, L, XL, XXL)',
  })
  size: WomenSize;

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
    description: 'Available stock quantity',
    example: 50,
    minimum:0,
  })
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  stock: number;

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
    example: 'Dress',
    required: true,
  })
  @IsString()
  @IsOptional()
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

}
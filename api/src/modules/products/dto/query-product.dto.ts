
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsArray, IsBoolean, IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';

// Acepta tanto ?sizes=S&sizes=M (array nativo de query) como ?sizes=S (un solo valor)
const toArray = ({ value }: { value: unknown }) => (value === undefined ? undefined : Array.isArray(value) ? value : [value]);



export class QueryProductDto {
  @ApiPropertyOptional({
    description: 'Filter by category',
    example: 'Dress',
  })
  @IsString()
  @IsOptional()
  category?: string;

  @ApiPropertyOptional({
    description: 'Filter by active status',
    example: true,
  })
  @Transform(({ value }) => {
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    return undefined;
  })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ApiPropertyOptional({
    description: 'Branch ID: includes the stock of each product in that branch (branchStock)',
  })
  @IsUUID()
  @IsOptional()
  branchId?: string;

  @ApiPropertyOptional({
    description: 'With branchId: only return products with stock > 0 in that branch (used by the POS catalog)',
  })
  @Transform(({ value }) => {
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    return undefined;
  })
  @IsBoolean()
  @IsOptional()
  inStockOnly?: boolean;

  @ApiPropertyOptional({
    description: 'Search by product name',
    example: 'Dress',
  })
  @IsString()
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({
    description: 'Page number for pagination',
    example: 1,
    minimum: 1,
    default: 1,
  })
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @IsOptional()
  page: number = 1;


  @ApiPropertyOptional({
    description: 'Number of items per page',
    example: 10,
    minimum: 1,
    default: 10,
  })
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @IsOptional()
  limit: number = 10;

  @ApiPropertyOptional({
    description: 'Filter by collection slug (ej. "otono-invierno")',
    example: 'otono-invierno',
  })
  @IsString()
  @IsOptional()
  collectionSlug?: string;

  @ApiPropertyOptional({
    description: 'Filter by sizes: matches products that have AT LEAST ONE of the given sizes',
    isArray: true,
    example: ['S', 'M'],
  })
  @Transform(toArray)
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  sizes?: string[];

  @ApiPropertyOptional({
    description: 'Filter by colors: matches products that have AT LEAST ONE of the given colors',
    isArray: true,
    example: ['negro', 'blanco'],
  })
  @Transform(toArray)
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  colors?: string[];

  @ApiPropertyOptional({
    description: 'Minimum price (inclusive)',
    example: 20,
    minimum: 0,
  })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  minPrice?: number;

  @ApiPropertyOptional({
    description: 'Maximum price (inclusive)',
    example: 150,
    minimum: 0,
  })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  maxPrice?: number;

}
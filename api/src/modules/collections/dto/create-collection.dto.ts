import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateCollectionDto {
  @ApiProperty({
    example: 'Otoño-Invierno',
    description: 'The name of the collection',
    maxLength: 100,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @ApiProperty({
    example: 'otono-invierno',
    description: 'The URL-friendly slug for the collection',
    required: false,
    maxLength: 100,
  })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  slug?: string;

  @ApiProperty({
    example: 'Prendas de abrigo para la temporada Otoño-Invierno',
    description: 'A brief description of the collection',
    required: false,
    maxLength: 255,
  })
  @IsString()
  @IsOptional()
  @MaxLength(255)
  description?: string;

  @ApiProperty({
    example: 'https://example.com/images/otono-invierno-banner.jpg',
    description: 'Banner image URL for the collection page',
    required: false,
    maxLength: 500,
  })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  bannerImageUrl?: string;

  @ApiProperty({
    example: true,
    description: 'Indicates if the collection is active (visible in the store)',
    required: false,
    default: true,
  })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

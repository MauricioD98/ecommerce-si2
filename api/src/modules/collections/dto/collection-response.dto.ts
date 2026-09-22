import { ApiProperty } from '@nestjs/swagger';

export class CollectionResponseDto {
  @ApiProperty({ example: '550e484-ere8458454-45erer4844858', description: 'The unique identifier of the collection' })
  id: string;

  @ApiProperty({ example: 'Otoño-Invierno', description: 'The name of the collection' })
  name: string;

  @ApiProperty({ example: 'otono-invierno', description: 'The URL-friendly slug for the collection' })
  slug: string;

  @ApiProperty({ example: 'Prendas de abrigo para la temporada', description: 'A brief description of the collection', nullable: true })
  description: string | null;

  @ApiProperty({ example: 'https://example.com/images/banner.jpg', description: 'Banner image URL for the collection page', nullable: true })
  bannerImageUrl: string | null;

  @ApiProperty({ example: true, description: 'Indicates if the collection is active' })
  isActive: boolean;

  @ApiProperty({ example: 24, description: 'Number of active products in this collection' })
  productCount: number;

  @ApiProperty({ example: '2026-01-01T12:00:00Z', description: 'Creation timestamp' })
  createdAt: Date;

  @ApiProperty({ example: '2026-01-10T15:30:00Z', description: 'Last update timestamp' })
  updatedAt: Date;
}

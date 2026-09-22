import { ApiProperty } from '@nestjs/swagger';

export class AddressResponseDto {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  id: string;

  @ApiProperty({ example: 'Casa' })
  title: string;

  @ApiProperty({ example: 'Av. San Martín #1050' })
  address: string;

  @ApiProperty({ example: 'Casa blanca con portón negro', nullable: true })
  reference: string | null;

  @ApiProperty({ example: -17.7833 })
  latitude: number;

  @ApiProperty({ example: -63.1821 })
  longitude: number;

  @ApiProperty({ example: true })
  isDefault: boolean;

  @ApiProperty()
  createdAt: Date;
}

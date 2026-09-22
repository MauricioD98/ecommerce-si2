import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class DynamicReportDto {
  @ApiProperty({
    example: '¿Cuáles fueron los 5 productos más vendidos este mes?',
    description: 'Pregunta en lenguaje natural',
    maxLength: 500,
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  prompt: string;
}

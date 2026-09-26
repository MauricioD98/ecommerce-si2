import { IsNotEmpty, IsString, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class GenerateQrDto {
  @ApiProperty({ description: 'ID de la orden a pagar con QR' })
  @IsNotEmpty()
  @IsString()
  orderId: string;
}

export class ConfirmQrDto {
  @ApiProperty({ description: 'ID de la orden pagada con QR' })
  @IsNotEmpty()
  @IsString()
  orderId: string;

  @ApiProperty({ required: false, description: 'ID de transacción o referencia' })
  @IsOptional()
  @IsString()
  transactionId?: string;
}

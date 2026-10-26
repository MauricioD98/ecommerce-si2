import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentMethod, UsdtNetwork } from '@prisma/client';
import { IsBoolean, IsEnum, IsIn, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';

// PATCH parcial: solo se cambia lo que viene. La imagen del QR va por su propio endpoint (multipart).
export class UpdatePaymentSettingsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  qrEnabled?: boolean;

  @ApiPropertyOptional({ description: 'Banco, titular, número de cuenta, glosa...' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  qrInstructions?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  usdtEnabled?: boolean;

  @ApiPropertyOptional({ enum: UsdtNetwork, nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsEnum(UsdtNetwork)
  usdtNetwork?: UsdtNetwork | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  usdtWalletAddress?: string;
}

export class SubmitPaymentProofDto {
  // El cliente puede haber cambiado de medio después de crear el pedido (p. ej. empezó con tarjeta)
  @ApiProperty({ enum: [PaymentMethod.BANK_QR, PaymentMethod.USDT] })
  @IsIn([PaymentMethod.BANK_QR, PaymentMethod.USDT])
  method: 'BANK_QR' | 'USDT';

  @ApiPropertyOptional({ description: 'Hash de la transacción USDT (obligatorio en USDT)' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  txId?: string;
}

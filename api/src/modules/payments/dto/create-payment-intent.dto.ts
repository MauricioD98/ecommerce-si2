
import { IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

// El monto NUNCA se confía del cliente: se calcula en el servidor a partir de order.totalAmount
export class CreatePaymentIntentDto {
  @IsNotEmpty()
  @IsString()
  orderId: string;

  @IsOptional()
  @IsNumber()
  amount?: number;

  @IsOptional()
  @IsString()
  currency?: string = 'usd';

  @IsOptional()
  @IsString()
  description?: string;
}
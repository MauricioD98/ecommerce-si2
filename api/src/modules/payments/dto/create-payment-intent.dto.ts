
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

// El monto NUNCA se recibe del cliente: se calcula en el servidor a partir de order.totalAmount
export class CreatePaymentIntentDto {
  @IsNotEmpty()
  @IsString()
  orderId: string;

  @IsOptional()
  @IsString()
  currency?: string = 'usd';

  @IsOptional()
  @IsString()
  description?: string;
}
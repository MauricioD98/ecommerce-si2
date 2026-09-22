
import { Type } from 'class-transformer';
import { IsOptional, IsString } from 'class-validator';

export enum OrderStatus {
  PENDIENTE = 'PENDIENTE',
  PROCESADO = 'PROCESADO',
  ENVIADO = 'ENVIADO',
  ENTREGADO = 'ENTREGADO',
  CANCELADO = 'CANCELADO',

}

export class QueryOrderDto {
  @IsOptional()
  @Type(() => Number)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  limit?: number = 10;

  @IsOptional()
  @Type(() => Number)
  status?: OrderStatus;

  @IsOptional()
  @IsString()
  search?: string;

}
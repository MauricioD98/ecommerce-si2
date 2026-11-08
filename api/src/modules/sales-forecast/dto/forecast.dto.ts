import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { FORECAST_SOURCES, type ForecastSource } from '../forecast-paths';

export class ForecastSourceDto {
  @ApiProperty({ enum: FORECAST_SOURCES, description: 'real = ventas de la tienda; demo = datos SIMULADOS aislados' })
  @IsIn(FORECAST_SOURCES)
  source!: ForecastSource;
}

export class ForecastQueryDto extends ForecastSourceDto {
  @ApiPropertyOptional({ description: 'Solo con alcance global (ALL_BRANCHES); sin él se usa la sucursal propia' })
  @IsOptional()
  @IsString()
  branchId?: string;
}

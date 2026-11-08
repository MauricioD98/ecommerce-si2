import { Module } from '@nestjs/common';
import { SalesForecastController } from './sales-forecast.controller';
import { SalesForecastService } from './sales-forecast.service';

@Module({
  controllers: [SalesForecastController],
  providers: [SalesForecastService],
})
export class SalesForecastModule {}

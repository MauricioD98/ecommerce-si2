import { Module } from '@nestjs/common';
import { CustomerSegmentationController } from './customer-segmentation.controller';
import { CustomerSegmentationService } from './customer-segmentation.service';

@Module({
  controllers: [CustomerSegmentationController],
  providers: [CustomerSegmentationService],
})
export class CustomerSegmentationModule {}

import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { SEGMENTATION_SOURCES, type SegmentationSource } from '../segmentation-paths';

export class SegmentationSourceDto {
  @ApiProperty({ enum: SEGMENTATION_SOURCES, description: 'real = compras de la tienda; demo = datos SIMULADOS aislados' })
  @IsIn(SEGMENTATION_SOURCES)
  source!: SegmentationSource;
}

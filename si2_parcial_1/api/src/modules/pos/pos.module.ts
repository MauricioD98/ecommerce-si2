import { Module } from '@nestjs/common';
import { PosController } from './pos.controller';
import { PosService } from './pos.service';
import { BranchesModule } from '../branches/branches.module';
import { ProductsModule } from '../products/products.module';

@Module({
  imports: [BranchesModule, ProductsModule],
  controllers: [PosController],
  providers: [PosService],
})
export class PosModule {}

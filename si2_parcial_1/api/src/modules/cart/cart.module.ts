import { Module } from '@nestjs/common';
import { CartController } from './cart.controller';
import { CartService } from './cart.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { BranchesModule } from '../branches/branches.module';

@Module({
  imports: [PrismaModule, BranchesModule],
  controllers: [CartController],
  providers: [CartService],
  exports: [CartService],
})
export class CartModule {}
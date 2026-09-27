import { Module } from '@nestjs/common';
import { CartController } from './cart.controller';
import { CartService } from './cart.service';
import { CartCleanupService } from './cart-cleanup.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { BranchesModule } from '../branches/branches.module';

@Module({
  imports: [PrismaModule, BranchesModule],
  controllers: [CartController],
  providers: [CartService, CartCleanupService],
  exports: [CartService],
})
export class CartModule {}
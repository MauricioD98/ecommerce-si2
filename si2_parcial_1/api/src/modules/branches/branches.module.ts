import { Module } from '@nestjs/common';
import { BranchesController } from './branches.controller';
import { BranchesService } from './branches.service';
import { InventoryService } from './inventory.service';

@Module({
  controllers: [BranchesController],
  providers: [BranchesService, InventoryService],
  exports: [BranchesService, InventoryService],
})
export class BranchesModule {}

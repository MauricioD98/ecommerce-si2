import { Module } from '@nestjs/common';
import { ReturnsController } from './returns.controller';
import { ReturnsService } from './returns.service';
import { BranchesModule } from '../branches/branches.module';

// BranchesModule aporta InventoryService (reingreso al stock o a mermas) y BranchesService
@Module({
  imports: [BranchesModule],
  controllers: [ReturnsController],
  providers: [ReturnsService],
})
export class ReturnsModule {}

import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { AddressesController } from './addresses/addresses.controller';
import { AddressesService } from './addresses/addresses.service';

@Module({
  controllers: [UsersController, AddressesController],
  providers: [UsersService, AddressesService]
})
export class UsersModule {}

import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { TenantPrismaService } from '../tenancy/tenant-prisma.service';
import { createTenantPrismaProxy } from '../tenancy/tenant-prisma.proxy';

// PrismaService ya no es un cliente único sobre "public": es un proxy al cliente del schema del
// tenant de la request (ver tenancy/tenant-prisma.proxy.ts).
@Global()
@Module({
  providers: [
    {
      provide: PrismaService,
      inject: [TenantPrismaService],
      useFactory: createTenantPrismaProxy,
    },
  ],
  exports: [PrismaService],
})
export class PrismaModule {}

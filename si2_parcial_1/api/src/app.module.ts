
import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { ConfigModule } from '@nestjs/config';
import { UsersModule } from './modules/users/users.module';
import { CategoryModule } from './modules/category/category.module';
import { ProductsModule } from './modules/products/products.module';
import { OrdersModule } from './modules/orders/orders.module';
import { ThrottlerModule } from '@nestjs/throttler';
import { PaymentsModule } from './modules/payments/payments.module';
import { CartModule } from './modules/cart/cart.module';
import { BranchesModule } from './modules/branches/branches.module';
import { RolesModule } from './modules/roles/roles.module';
import { MailModule } from './modules/mail/mail.module';
import { MarketingModule } from './modules/marketing/marketing.module';
import { ReportsModule } from './modules/reports/reports.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { PosModule } from './modules/pos/pos.module';


@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    ThrottlerModule.forRoot([
    {
    ttl: 60, // seconds
    limit: 10, // 10 requests per 60 seconds
    },
   ]),
    PrismaModule, AuthModule, UsersModule, CategoryModule, ProductsModule, OrdersModule, PaymentsModule, CartModule, BranchesModule, RolesModule, MailModule, MarketingModule, ReportsModule, NotificationsModule, PosModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
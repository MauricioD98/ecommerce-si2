
import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { join } from 'node:path';
import { AcceptLanguageResolver, HeaderResolver, I18nModule, QueryResolver } from 'nestjs-i18n';
import { I18nExceptionFilter } from './i18n/i18n-exception.filter';
import { FALLBACK_LANGUAGE } from './i18n/i18n-message';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { TenancyModule } from './tenancy/tenancy.module';
import { PlatformModule } from './modules/platform/platform.module';
import { StoreModule } from './modules/store/store.module';
import { TryOnModule } from './modules/try-on/try-on.module';
import { AuthModule } from './modules/auth/auth.module';
import { ConfigModule } from '@nestjs/config';
import { UsersModule } from './modules/users/users.module';
import { CategoryModule } from './modules/category/category.module';
import { CollectionsModule } from './modules/collections/collections.module';
import { ProductsModule } from './modules/products/products.module';
import { OrdersModule } from './modules/orders/orders.module';
import { ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { PaymentsModule } from './modules/payments/payments.module';
import { CartModule } from './modules/cart/cart.module';
import { BranchesModule } from './modules/branches/branches.module';
import { RolesModule } from './modules/roles/roles.module';
import { MailModule } from './modules/mail/mail.module';
import { MarketingModule } from './modules/marketing/marketing.module';
import { ReportsModule } from './modules/reports/reports.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { PosModule } from './modules/pos/pos.module';
import { ReturnsModule } from './modules/returns/returns.module';
import { ChatbotModule } from './modules/chatbot/chatbot.module';


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
    // Idioma del request para errores, validaciones y catálogo. Orden: ?lang=en → header x-lang →
    // Accept-Language ("fr-CA" cae en "fr") → español. Los diccionarios están en src/i18n/locales y
    // nest-cli.json los copia a dist/i18n/locales.
    I18nModule.forRoot({
      fallbackLanguage: FALLBACK_LANGUAGE,
      loaderOptions: {
        path: join(__dirname, 'i18n', 'locales'),
        watch: process.env.NODE_ENV !== 'production',
      },
      resolvers: [{ use: QueryResolver, options: ['lang'] }, new HeaderResolver(['x-lang']), AcceptLanguageResolver],
    }),
    // Habilita @Cron(...) en toda la app (usado por CartCleanupService para liberar carritos abandonados)
    ScheduleModule.forRoot(),
    TenancyModule, PlatformModule, PrismaModule, AuthModule, UsersModule, CategoryModule, CollectionsModule, ProductsModule, OrdersModule, PaymentsModule, CartModule, BranchesModule, RolesModule, MailModule, MarketingModule, ReportsModule, NotificationsModule, PosModule, ReturnsModule, ChatbotModule, TryOnModule, StoreModule],
  controllers: [AppController],
  providers: [AppService, { provide: APP_FILTER, useClass: I18nExceptionFilter }],
})
export class AppModule {}
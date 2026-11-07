import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { JwtStrategy } from './strategies/jwt.strategies';
import { RefreshTokenStrategy } from './strategies/refresh-token.strategy';
import { MobileAuthController } from './mobile-auth.controller';
import { MobileAccessModule } from '../mobile-access/mobile-access.module';


@Module({
 imports: [
  PassportModule.register({ defaultStrategy: 'jwt' }),
  MobileAccessModule,
  JwtModule.registerAsync({
    inject: [ConfigService],
    useFactory: async (configService: ConfigService) => ({
      secret: configService.get<string>('JWT_SECRET') ?? 'defaultSecret2025',
      signOptions: { 
        expiresIn: Number(configService.get<number>('JWT_EXPIRES_IN',900)), 

      },
   }),
 }),
],
  providers: [AuthService, JwtStrategy, RefreshTokenStrategy],
  controllers: [AuthController, MobileAuthController],
  exports: [AuthService],
})
export class AuthModule {}

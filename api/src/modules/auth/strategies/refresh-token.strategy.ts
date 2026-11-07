//import { RefreshTokenStrategy } from './refresh-token.strategy';
import { PassportStrategy } from "@nestjs/passport";
import { Strategy, ExtractJwt } from 'passport-jwt';
import { PrismaService } from "../../../prisma/prisma.service";
import { ConfigService } from "@nestjs/config";
import {Request} from 'express';
import { Injectable, UnauthorizedException } from "@nestjs/common";
import { hashToken } from '../../../common/utils/token-hash';
import type { MobileSessionClaims } from '../../mobile-access/mobile-access.errors';
import type { AttestationMethod, MobilePlatform } from '../../mobile-access/mobile-access.config';

interface RefreshPayload {
    sub: string;
    email: string;
    tenantId?: string;
    channel?: 'mobile';
    att?: AttestationMethod;
    platform?: MobilePlatform;
    attestedAt?: number;
}

export interface RefreshUser {
    id: string;
    email: string;
    role: unknown;
    channel: 'web' | 'mobile';
    // Datos de la última prueba de integridad (solo sesiones móviles)
    mobile: MobileSessionClaims | null;
}


@Injectable()
export class RefreshTokenStrategy extends PassportStrategy(Strategy, 'jwt-refresh'){

    constructor(
          private configService: ConfigService,
          private prisma: PrismaService,
    ){
        super({
            jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
            ignoreExpiration:false,
            secretOrKey: configService.get<string>('JWT_REFRESH_SECRET'),
            passReqToCallback:true,
        })
      
    }


    async validate(req:Request, payload:RefreshPayload): Promise<RefreshUser>{

        // Mismo criterio que JwtStrategy: el refresh solo vale en la tienda que lo emitió.
        // Además this.prisma ya apunta al schema de req.tenant, así que el lookup del usuario
        // de abajo nunca cruza tiendas.
        if(!payload.tenantId || !req.tenant || req.tenant.tenantId !== payload.tenantId){
            throw new UnauthorizedException('Invalid refresh token');
        }

        const authHeader = req.headers.authorization;
        if(!authHeader){
            console.log('No authorization header found');
            throw new UnauthorizedException('Refresh token not provided');
        }

        const refreshToken = authHeader.replace('Bearer','').trim();
        if(!refreshToken){
            throw new UnauthorizedException('Refresh token is empty after extraction');
        }

        const user = await this.prisma.user.findUnique({
            where:{id: payload.sub},
            select:{
                id:true,
                email:true,
                role: true,
                refreshToken:true,
            },
        });

        if(!user  || !user.refreshToken){
            throw new UnauthorizedException('Invalid refresh token');
        }

        // En la BD solo se guarda el hash del refresh token
        const refreshTokenMatches = hashToken(refreshToken) === user.refreshToken;

        if(!refreshTokenMatches){
            throw new UnauthorizedException('Invalid refresh does not match');
        }

        const mobile =
            payload.channel === 'mobile' && payload.att && payload.platform && typeof payload.attestedAt === 'number'
                ? { method: payload.att, platform: payload.platform, attestedAt: payload.attestedAt }
                : null;
        return {id:user.id, email: user.email, role: user.role, channel: mobile ? 'mobile' : 'web', mobile };
    }
}
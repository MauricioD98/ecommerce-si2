import { PassportStrategy } from "@nestjs/passport";
import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ExtractJwt, Strategy } from "passport-jwt";
import { Request } from "express";
import { AuthUser } from "../../../common/decorators/interfaces/request-with-user.interface";
import { getPlanFeatures } from "../../platform/plans";
import { isDevelopmentBypassAllowed } from "../../mobile-access/mobile-access.config";
import { mobilePlanForbidden } from "../../mobile-access/mobile-access.errors";

interface JwtPayload {
    sub: string;
    email: string;
    tenantId?: string;
    role?: { id: string; name: string };
    permissions?: string[];
    branchId?: string | null;
    // Solo los emite MobileAuthController (tras plan + prueba de integridad); firmados, no autodeclarables
    channel?: 'mobile';
    att?: string;
}

@Injectable()

export class JwtStrategy extends PassportStrategy(Strategy) {

    constructor(
        private configService: ConfigService
    ) {
        super({
            jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
            ignoreExpiration: false,
            secretOrKey: configService.get<string>('JWT_SECRET'),
            passReqToCallback: true,
        });
    }

    // El usuario se arma solo con el payload del JWT (rol y permisos incluidos): sin consultas a la BD por petición.
    validate(req: Request, payload: JwtPayload): AuthUser {
        // Tokens emitidos antes de los roles dinámicos o del multitenant no traen rol/tenant: el cliente debe renovarlos
        if (!payload.role || !payload.permissions || !payload.tenantId) {
            throw new UnauthorizedException('Token desactualizado, vuelve a iniciar sesión');
        }

        // Todas las tiendas comparten JWT_SECRET, así que la firma sola no basta: un token de la
        // tienda A con x-tenant-id de la tienda B le daría a un USE_POS de A acceso al schema de B.
        // TenantMiddleware ya fijó req.tenant (y el schema de Prisma) desde el header/subdominio;
        // acá se exige que sea la misma tienda que emitió el token.
        if (!req.tenant || req.tenant.tenantId !== payload.tenantId) {
            throw new UnauthorizedException('El token no pertenece a esta tienda');
        }

        // Sesión del canal móvil: vale solo mientras el plan de la tienda incluya la app. req.tenant.plan
        // viene del cache de TenantMiddleware (≤ 60 s; un cambio de plan por webhook lo invalida en el
        // acto en esta instancia). 403 y no 401: la app no debe intentar refrescar, sino avisar.
        if (payload.channel === 'mobile') {
            if (!getPlanFeatures(req.tenant.plan).mobileApp) throw mobilePlanForbidden();
            // Un token firmado por una API de desarrollo con el atajo no sirve donde el atajo no existe
            if (payload.att === 'development-bypass' && !isDevelopmentBypassAllowed()) {
                throw new UnauthorizedException('Sesión móvil de desarrollo no válida en este entorno');
            }
        }

        return {
            id: payload.sub,
            email: payload.email,
            role: {
                id: payload.role.id,
                name: payload.role.name,
                permissions: payload.permissions,
            },
            branchId: payload.branchId ?? null,
            tenantId: payload.tenantId,
            channel: payload.channel === 'mobile' ? 'mobile' : 'web',
        };
    }
}

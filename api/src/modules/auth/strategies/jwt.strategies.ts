import { PassportStrategy } from "@nestjs/passport";
import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ExtractJwt, Strategy } from "passport-jwt";
import { Request } from "express";
import { AuthUser } from "../../../common/decorators/interfaces/request-with-user.interface";

interface JwtPayload {
    sub: string;
    email: string;
    tenantId?: string;
    role?: { id: string; name: string };
    permissions?: string[];
    branchId?: string | null;
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
        };
    }
}

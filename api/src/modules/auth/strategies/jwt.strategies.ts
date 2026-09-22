import { PassportStrategy } from "@nestjs/passport";
import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ExtractJwt, Strategy } from "passport-jwt";
import { AuthUser } from "../../../common/decorators/interfaces/request-with-user.interface";

interface JwtPayload {
    sub: string;
    email: string;
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
        });
    }

    // El usuario se arma solo con el payload del JWT (rol y permisos incluidos): sin consultas a la BD por petición.
    validate(payload: JwtPayload): AuthUser {
        // Tokens emitidos antes de los roles dinámicos no traen rol: el cliente debe renovarlos
        if (!payload.role || !payload.permissions) {
            throw new UnauthorizedException('Token desactualizado, vuelve a iniciar sesión');
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
        };
    }
}

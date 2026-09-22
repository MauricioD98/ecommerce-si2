
import { PassportStrategy } from "@nestjs/passport";
import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PrismaService } from "../../../prisma/prisma.service";
import { ConfigService } from "@nestjs/config";
import { ExtractJwt, Strategy } from "passport-jwt";

@Injectable()

export class JwtStrategy extends PassportStrategy(Strategy) {

    constructor( 
        private prisma:PrismaService, 
        private configService: ConfigService
    ) {
        super({
            jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
            ignoreExpiration: false,
            secretOrKey: configService.get<string>('JWT_SECRET'),
        });
    }

    async validate(payload: {sub:string; email:string}) {
    
        const user = await this.prisma.user.findUnique({
            where:{id:payload.sub},
            select:{
                id: true,
                email: true,
                firstName: true,
                lastName: true,
                role: true,
                createdAt:true,
                updatedAt:true,
                password:false,
            }
        });
        
        if(!user){
            throw new UnauthorizedException('Usuario no encontrado');
        }

        return user;
    }   
}
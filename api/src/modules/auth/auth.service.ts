import { BadRequestException, ConflictException, HttpException, HttpStatus, Injectable, InternalServerErrorException, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthResponseDto } from './dto/auth-response.dto';
import { RegisterDto } from './dto/register.dto';
import * as bcrypt from 'bcrypt';
import { randomBytes, randomInt } from 'crypto';
import { hashToken } from '../../common/utils/token-hash';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { LoginDto } from './dto/login.dto';
import { DEFAULT_ROLE } from '../../common/constants/permissions';
import { MailService } from '../mail/mail.service';
import { USER_SELECT, UserWithRole, toUserResponse } from '../users/user.mapper';

@Injectable()
export class AuthService {

    private readonly SALT_ROUNDS = 12;
    private readonly OTP_TTL_MS = 10 * 60 * 1000;
    private readonly OTP_MAX_ATTEMPTS = 5;
    private readonly OTP_REUSE_MIN_MS = 5 * 60 * 1000; // si quedan más de 5 min, "reenviar" manda el mismo código
    private readonly LOGIN_MAX_ATTEMPTS = 3;
    private readonly LOGIN_LOCK_MS = 5 * 60 * 1000;
    constructor(
        private prisma: PrismaService,
        private jwtService: JwtService,
        private configService: ConfigService,
        private mailService: MailService,
    ) {}


    async register(registerDto: RegisterDto): Promise<AuthResponseDto> {
        const { email, password, firstName, lastName, phone } = registerDto;

        try {
            // Verificación temprana (evita hashear la contraseña de balde). La restricción única de la BD
            // sigue siendo la garantía real: si dos registros llegan a la vez, se captura P2002 más abajo
            const existingUser = await this.prisma.user.findUnique({ where: { email } });
            if (existingUser) {
                throw new ConflictException('El correo electrónico ya está registrado');
            }

            // Toda cuenta nueva parte con el rol base "Cliente"
            const defaultRole = await this.prisma.role.findUnique({ where: { name: DEFAULT_ROLE } });
            if (!defaultRole) {
                throw new Error(`No existe el rol base "${DEFAULT_ROLE}". Ejecuta el seed.`);
            }

            const hashedPassword = await bcrypt.hash(password, this.SALT_ROUNDS);
            const user = await this.prisma.user.create({
                data: {
                    email,
                    password: hashedPassword,
                    firstName,
                    lastName,
                    phone: phone?.trim() || null,
                    roleId: defaultRole.id,
                },
                select: USER_SELECT,
            });
            const tokens = await this.generateTokens(user);
            await this.updateRefreshToken(user.id, tokens.refreshToken);

            // Sin await: un fallo del correo nunca debe impedir que el registro termine
            void this.sendWelcomeEmail(user.email, user.firstName);

            return {
                ...tokens,
                user: toUserResponse(user),
            };
        } catch (error) {
            // Las excepciones HTTP ya tienen su status (p. ej. el 409 de arriba): se dejan pasar
            if (error instanceof HttpException) {
                throw error;
            }
            // Violación de la restricción única del correo (registro simultáneo con el mismo email)
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
                throw new ConflictException('El correo electrónico ya está registrado');
            }
            console.error('Error durante el registro del usuario', error);
            throw new InternalServerErrorException('Ocurrio un error durante el registro');
        }
    }

    // El SMTP puede fallar (servidor caído, credenciales): se registra el error y se sigue
    private async sendWelcomeEmail(email: string, firstName: string | null): Promise<void> {
        try {
            const sent = await this.mailService.sendWelcome(email, firstName);
            if (!sent) {
                console.error(`No se pudo enviar el correo de bienvenida a ${email}`);
            }
        } catch (error) {
            console.error(`Error al enviar el correo de bienvenida a ${email}`, error);
        }
    }

    // El access token lleva el rol y sus permisos: así los guards no consultan la BD en cada petición.
    // Los cambios de rol/permisos se reflejan al renovar el token (cada 15 min o al volver a iniciar sesión).
    private async generateTokens(user: Pick<UserWithRole, 'id' | 'email' | 'branchId' | 'role'>): Promise<{ accessToken: string; refreshToken: string }> {
      const accessPayload = {
        sub: user.id,
        email: user.email,
        role: { id: user.role.id, name: user.role.name },
        permissions: user.role.permissions,
        branchId: user.branchId,
      };
      const refreshPayload = { sub: user.id, email: user.email, refreshId: randomBytes(16).toString('hex') };
      const [accessToken, refreshToken] = await Promise.all([
        this.jwtService.signAsync(accessPayload,{expiresIn: '15m'}),
        // El refresh token se firma con su propio secreto: RefreshTokenStrategy lo verifica con JWT_REFRESH_SECRET
        this.jwtService.signAsync(refreshPayload,{
            expiresIn:'7d',
            secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
        }),
      ]);

      return{accessToken,refreshToken};
    }

    async updateRefreshToken(userId: string, refreshToken: string): Promise<void>{
        await this.prisma.user.update({
            where:{id: userId},
            data:{refreshToken: hashToken(refreshToken)},
        });
    }

    async refreshTokens(userId: string): Promise<AuthResponseDto>{
        // Se vuelve a leer el rol: el nuevo access token trae los permisos vigentes
        const user = await this.prisma.user.findUnique({
            where:{id:userId},
            select: USER_SELECT,
        });

        if(!user){
            throw new UnauthorizedException('Usuario no encontrado');
        }

        const tokens = await this.generateTokens(user);
        await this.updateRefreshToken(user.id,tokens.refreshToken);

        return {
            ...tokens,
            user: toUserResponse(user),
        }
    }

    // Siempre responde igual, exista o no el correo, para no revelar qué cuentas están registradas
    async forgotPassword(email: string): Promise<{ message: string }> {
        const user = await this.prisma.user.findFirst({
            where: { email: { equals: email.trim(), mode: 'insensitive' } },
            select: { id: true, email: true, firstName: true, resetPasswordOtp: true, resetPasswordExpires: true },
        });

        if (user) {
            // Si ya hay un código con vigencia de sobra, se reenvía el mismo: así no se invalida el del correo anterior
            // y pedir códigos nuevos no reinicia los intentos fallidos (evita adivinarlo a fuerza bruta)
            const reusable =
                user.resetPasswordOtp &&
                user.resetPasswordExpires &&
                user.resetPasswordExpires.getTime() - Date.now() > this.OTP_REUSE_MIN_MS;

            let otp = user.resetPasswordOtp as string;
            if (!reusable) {
                // Código de 6 dígitos (con ceros a la izquierda) que viaja solo en el correo y vence en 10 minutos
                otp = randomInt(0, 1_000_000).toString().padStart(6, '0');
                await this.prisma.user.update({
                    where: { id: user.id },
                    data: {
                        resetPasswordOtp: otp,
                        resetPasswordAttempts: 0,
                        resetPasswordExpires: new Date(Date.now() + this.OTP_TTL_MS),
                    },
                });
            }
            void this.mailService.sendPasswordReset(user.email, user.firstName, otp);
        }

        return { message: 'Si el correo está registrado, recibirás un código de 6 dígitos en breve' };
    }

    // Comprueba el OTP de un correo (sin borrarlo). Los fallos cuentan como intentos y anulan el código al llegar al límite.
    // Lo usan verify-otp y reset-password, así ningún camino permite adivinar el código sin límite.
    private async assertValidOtp(email: string, otp: string): Promise<string> {
        const invalid = () => new BadRequestException('El código no es válido o ya venció');
        const cleanOtp = otp.trim();

        const user = await this.prisma.user.findFirst({
            where: { email: { equals: email.trim(), mode: 'insensitive' } },
            select: { id: true, resetPasswordOtp: true, resetPasswordExpires: true, resetPasswordAttempts: true },
        });

        if (!user?.resetPasswordOtp || !user.resetPasswordExpires || user.resetPasswordExpires < new Date()) {
            throw invalid();
        }

        if (user.resetPasswordOtp !== cleanOtp) {
            const attempts = user.resetPasswordAttempts + 1;
            await this.prisma.user.update({
                where: { id: user.id },
                data:
                    attempts >= this.OTP_MAX_ATTEMPTS
                        ? { resetPasswordOtp: null, resetPasswordExpires: null, resetPasswordAttempts: 0 }
                        : { resetPasswordAttempts: attempts },
            });
            throw invalid();
        }

        return user.id;
    }

    async verifyOtp(email: string, otp: string): Promise<{ success: true }> {
        await this.assertValidOtp(email, otp);
        return { success: true };
    }

    async resetPassword(email: string, otp: string, newPassword: string): Promise<{ message: string }> {
        const userId = await this.assertValidOtp(email, otp);

        // Una sola escritura: la contraseña nueva y el borrado del OTP se guardan juntos (o ninguno)
        await this.prisma.user.update({
            where: { id: userId },
            data: {
                password: await bcrypt.hash(newPassword, this.SALT_ROUNDS),
                resetPasswordOtp: null,
                resetPasswordExpires: null,
                resetPasswordAttempts: 0,
                refreshToken: null,
            },
        });

        return { message: 'Contraseña actualizada. Ya puedes iniciar sesión' };
    }

    async logout(userId: string): Promise<void>{
        await this.prisma.user.update({
            where:{id: userId},
            data: {refreshToken:null},
        });
    }

    async login (loginDto: LoginDto): Promise<AuthResponseDto>{
        const {email,password}=loginDto

        const user = await this.prisma.user.findUnique({
            where:{email},
            select: { ...USER_SELECT, password: true, loginAttempts: true, lockedUntil: true },
        });

        // Cuenta bloqueada: se rechaza sin mirar la contraseña (aunque sea la correcta) hasta que pase el bloqueo
        if (user?.lockedUntil && user.lockedUntil > new Date()) {
            const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
            throw new HttpException(
                `Demasiados intentos fallidos. Inténtalo de nuevo en ${minutes} minuto${minutes === 1 ? '' : 's'}`,
                HttpStatus.TOO_MANY_REQUESTS,
            );
        }

        if(!user || !(await bcrypt.compare(password , user.password))){
            if (user) {
                // Si un bloqueo anterior ya venció, el conteo empieza de cero
                const attempts = (user.lockedUntil ? 0 : user.loginAttempts) + 1;
                const lock = attempts >= this.LOGIN_MAX_ATTEMPTS;
                await this.prisma.user.update({
                    where: { id: user.id },
                    data: lock
                        ? { loginAttempts: 0, lockedUntil: new Date(Date.now() + this.LOGIN_LOCK_MS) }
                        : { loginAttempts: attempts, lockedUntil: null },
                });
                if (lock) {
                    throw new HttpException(
                        'Demasiados intentos fallidos. Tu cuenta quedó bloqueada por 5 minutos',
                        HttpStatus.TOO_MANY_REQUESTS,
                    );
                }
            }
            throw new UnauthorizedException('Email o password invalido')
        }

        if (user.loginAttempts > 0 || user.lockedUntil) {
            await this.prisma.user.update({ where: { id: user.id }, data: { loginAttempts: 0, lockedUntil: null } });
        }

        const tokens = await this.generateTokens(user);
        await this.updateRefreshToken(user.id, tokens.refreshToken);

        return{
            ...tokens,
            user: toUserResponse(user),
        };
    }
}

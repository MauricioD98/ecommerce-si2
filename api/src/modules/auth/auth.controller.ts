import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { AuthResponseDto } from './dto/auth-response.dto';
import { RefreshTokenGuard } from './guards/refresh-token.guard';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { JwtAuthGuard } from '../../common/decorators/guards/jwt-auth.guard';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';

@Controller('auth')

export class AuthController {
    constructor(private readonly authService: AuthService) {}

    @Post('register')
    @HttpCode(201)
    @ApiOperation({summary:'Register a new user', description:'Creates a new user account',})
    @ApiResponse({
        status:201,
        description:'User successfully registered',
        type: AuthResponseDto,
    })
    @ApiResponse({
        status:400,
        description:'Bad Request. Validation failed or user already exists',
    })
    @ApiResponse({
        status:500,
        description:'Internal Server Error',
    })
    @ApiResponse({
        status:429,
        description:'Too Many Requests. Rate limit exceeded',
    })

    async register(@Body() registerDto: RegisterDto): Promise<AuthResponseDto>{

        return await this.authService.register(registerDto);
    }

    @Post('refresh')
    @HttpCode(HttpStatus.OK)
    @UseGuards(RefreshTokenGuard)
    @ApiBearerAuth('JWT-refresh')
    @ApiOperation({
    summary: 'Refresh access token',
    description: 'Generates a new access token using a valid refresh token',
    })
    @ApiResponse({
    status: 200,
    description: 'New access token generated successfully',
     type: AuthResponseDto,
    })
    @ApiResponse({
        status:401,
        description: 'Unauthorized. Invalid or expired refresh token',
    })
    @ApiResponse({
        status:429,
        description: 'Too Many Request. Rate limit exceeded',
    })
    async refresh( @GetUser('id') userId: string): Promise<AuthResponseDto> {
        return await this.authService.refreshTokens(userId);
    }

    @Post('logout')
    @HttpCode(HttpStatus.OK)
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('JWT-auth')
    @ApiOperation({summary:'Logout user', description:'Logs out the user and invalidates the refresh token',})
    @ApiResponse({
        status:200,
        description: 'User successfully logged out',
    })
    @ApiResponse({
    status: 401,
    description: 'Unauthorized. Invalid or expired access token',
    })
    @ApiResponse({
    status: 429,
    description: 'Too Many Requests. Rate limit exceeded',
    })
     async logout(@GetUser('id') userId: string): Promise<{message:string}>{
        await this.authService.logout(userId);
        return {message:'Deslogueado Satisfactoriamente'}
    }

    @Post('forgot-password')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({summary:'Request a password reset email', description:'Sends a reset link valid for 1 hour. Always responds the same, whether or not the email exists',})
    @ApiResponse({ status: 200, description: 'Request accepted' })
    @ApiResponse({ status: 400, description: 'Invalid email' })
    async forgotPassword(@Body() forgotPasswordDto: ForgotPasswordDto): Promise<{ message: string }> {
        return await this.authService.forgotPassword(forgotPasswordDto.email);
    }

    @Post('verify-otp')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({summary:'Check the emailed 6-digit code without consuming it', description:'Lets the UI validate the code before asking for the new password. Wrong attempts count towards the 5-attempt limit',})
    @ApiResponse({ status: 200, description: 'Code is valid' })
    @ApiResponse({ status: 400, description: 'Invalid or expired code' })
    async verifyOtp(@Body() verifyOtpDto: VerifyOtpDto): Promise<{ success: true }> {
        return await this.authService.verifyOtp(verifyOtpDto.email, verifyOtpDto.otp);
    }

    @Post('reset-password')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({summary:'Reset the password with the emailed 6-digit code', description:'The code is single-use, expires after 10 minutes and is voided after 5 wrong attempts',})
    @ApiResponse({ status: 200, description: 'Password updated' })
    @ApiResponse({ status: 400, description: 'Invalid or expired token, or weak password' })
    async resetPassword(@Body() resetPasswordDto: ResetPasswordDto): Promise<{ message: string }> {
        return await this.authService.resetPassword(resetPasswordDto.email, resetPasswordDto.otp, resetPasswordDto.newPassword);
    }

    @Post('login')
    @ApiOperation({summary:'User login', description:'Authenticates a user and returns access and refresh tokens',})
    @ApiResponse({
    status: 200,
    description: 'User successfully logged in',
    type: AuthResponseDto,
    })
    @ApiResponse({
    status: 401,
    description: 'Unauthorized. Invalid credentials',
    })
    @ApiResponse({
    status: 429,
    description: 'Too Many Requests. Rate limit exceeded',
    })
    @HttpCode(HttpStatus.OK)
    async login(@Body() loginDto:LoginDto): Promise<AuthResponseDto>{
        return await this.authService.login(loginDto);
    }

}

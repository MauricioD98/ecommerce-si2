import { Controller, Headers, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/decorators/guards/jwt-auth.guard';
import { TryOnService } from './try-on.service';

@ApiTags('try-on')
@Controller('try-on')
export class TryOnController {
  constructor(private readonly tryOnService: TryOnService) {}

  // Cada sesión cuesta dinero real: solo usuarios autenticados de ESTA tienda (JwtStrategy exige que
  // el tenantId del token coincida con x-tenant-id), y se cobra a la cuenta de Decart de la tienda.
  @Post('session')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Token efímero para el Probador Virtual (Decart) de la tienda actual' })
  createSession(@Headers('origin') origin?: string) {
    return this.tryOnService.createSession(origin);
  }
}

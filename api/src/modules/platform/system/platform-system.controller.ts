import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PLATFORM_KEY_HEADER, PlatformAdminGuard } from '../guards/platform-admin.guard';
import { PlatformSystemService } from './platform-system.service';

// Estado del sistema: solo administradores de plataforma (un usuario de tienda recibe 401)
@ApiTags('platform')
@Controller('platform/system')
@UseGuards(PlatformAdminGuard)
@ApiBearerAuth('JWT-auth')
@ApiHeader({ name: PLATFORM_KEY_HEADER, required: false })
export class PlatformSystemController {
  constructor(private readonly system: PlatformSystemService) {}

  @Get('status')
  @ApiOperation({ summary: 'Comprobaciones reales de API, base de datos, migraciones, respaldos y sincronización externa' })
  async status() {
    return { success: true, data: await this.system.status(), message: 'Estado del sistema' };
  }
}

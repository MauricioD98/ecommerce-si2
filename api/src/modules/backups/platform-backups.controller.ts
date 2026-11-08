import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { PlatformAdminGuard } from '../platform/guards/platform-admin.guard';
import { backupMaxBytes } from './backup-config';
import { BackupsService, type BackupActor } from './backups.service';
import { PlatformBackupListQueryDto, RestoreBackupDto } from './dto/backup.dto';

type UploadedBackup = { buffer: Buffer; size: number };
const PLATFORM = { kind: 'platform' } as const;

// Respaldos del administrador del SaaS: plataforma completa y gestión de respaldos de cualquier tienda.
// Mismo guard que el resto del plano de control (sesión de /plataforma o x-platform-key). Un token de
// tienda (aunque sea de un Super Admin) no sirve acá.
@ApiTags('platform-backups')
@Controller('platform/backups')
@UseGuards(PlatformAdminGuard)
export class PlatformBackupsController {
  constructor(private readonly backups: BackupsService) {}

  @Get('config')
  config() {
    return { success: true, data: this.backups.config() };
  }

  @Get()
  @ApiOperation({ summary: 'Respaldos y restauraciones (plataforma y tiendas)' })
  async list(@Query() query: PlatformBackupListQueryDto) {
    return { success: true, data: await this.backups.list(PLATFORM, query) };
  }

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Respaldo completo: plano de control + todas las tiendas, en una foto consistente' })
  async createPlatform(@Req() req: Request) {
    return { success: true, data: await this.backups.createPlatformBackup(actorOf(req)) };
  }

  @Post('tenants/:tenantId')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Respaldo de una tienda concreta (la tienda se valida contra public.tenants)' })
  async createTenant(@Req() req: Request, @Param('tenantId', ParseUUIDPipe) tenantId: string) {
    return { success: true, data: await this.backups.createTenantBackup(tenantId, actorOf(req), PLATFORM) };
  }

  @Post('upload')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: backupMaxBytes(), files: 1 } }))
  async upload(@Req() req: Request, @UploadedFile() file?: UploadedBackup) {
    return { success: true, data: await this.backups.upload(file?.buffer, PLATFORM, actorOf(req)) };
  }

  @Get(':id')
  async get(@Param('id', ParseUUIDPipe) id: string) {
    return { success: true, data: await this.backups.get(id, PLATFORM) };
  }

  @Get(':id/download')
  async download(@Param('id', ParseUUIDPipe) id: string) {
    const { file, downloadName } = await this.backups.download(id, PLATFORM);
    return new StreamableFile(file, { type: 'application/octet-stream', disposition: `attachment; filename="${downloadName}"`, length: file.length });
  }

  @Get(':id/preview')
  async preview(@Param('id', ParseUUIDPipe) id: string) {
    return { success: true, data: await this.backups.preview(id, PLATFORM) };
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Restaura una copia de tienda o de plataforma (validación aislada + transacción única)' })
  async restore(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RestoreBackupDto) {
    return { success: true, data: await this.backups.startRestore(id, PLATFORM, actorOf(req), dto) };
  }

  @Delete(':id')
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    return { success: true, data: await this.backups.remove(id, PLATFORM) };
  }
}

function actorOf(req: Request): BackupActor {
  return req.platformAdmin
    ? { type: 'PLATFORM_ADMIN', id: req.platformAdmin.id, email: req.platformAdmin.email }
    : { type: 'PLATFORM_KEY', id: null, email: null };
}

import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../common/decorators/guards/jwt-auth.guard';
import { GetUser } from '../../common/decorators/get-user.decorator';
import type { AuthUser } from '../../common/decorators/interfaces/request-with-user.interface';
import { SUPER_ADMIN_ROLE } from '../../common/constants/permissions';
import { i18nMessage } from '../../i18n/i18n-message';
import { backupMaxBytes } from './backup-config';
import { BackupsService, type BackupActor } from './backups.service';
import { RestoreBackupDto } from './dto/backup.dto';

type UploadedBackup = { buffer: Buffer; size: number };
type TenantAccess = { kind: 'tenant'; tenantId: string };

// Copias de seguridad de la tienda del request. La tienda es req.tenant (TenantMiddleware) y JwtStrategy
// garantiza que el token es de esa misma tienda: ningún id, nombre de schema ni ruta enviados por el
// navegador decide qué datos se respaldan o restauran. Solo el Super Admin (dueño), como la suscripción.
@ApiTags('backups')
@ApiBearerAuth('JWT-auth')
@Controller('backups')
@UseGuards(JwtAuthGuard)
export class BackupsController {
  constructor(private readonly backups: BackupsService) {}

  @Get('config')
  @ApiOperation({ summary: 'Si los respaldos están configurados en este servidor (clave presente) y el tamaño máximo' })
  config(@GetUser() user: AuthUser, @Req() req: Request) {
    this.access(user, req);
    return { success: true, data: this.backups.config() };
  }

  @Get()
  @ApiOperation({ summary: 'Respaldos y restauraciones de esta tienda' })
  async list(@GetUser() user: AuthUser, @Req() req: Request) {
    return { success: true, data: await this.backups.list(this.access(user, req)) };
  }

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Genera un respaldo cifrado de esta tienda (en segundo plano)' })
  async create(@GetUser() user: AuthUser, @Req() req: Request) {
    const access = this.access(user, req);
    return { success: true, data: await this.backups.createTenantBackup(access.tenantId, this.actor(user), access) };
  }

  @Post('upload')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: backupMaxBytes(), files: 1 } }))
  @ApiOperation({ summary: 'Sube una copia .sfbk de ESTA tienda (se verifica origen e integridad)' })
  async upload(@GetUser() user: AuthUser, @Req() req: Request, @UploadedFile() file?: UploadedBackup) {
    return { success: true, data: await this.backups.upload(file?.buffer, this.access(user, req), this.actor(user)) };
  }

  @Get(':id')
  async get(@GetUser() user: AuthUser, @Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    return { success: true, data: await this.backups.get(id, this.access(user, req)) };
  }

  @Get(':id/download')
  @ApiOperation({ summary: 'Descarga el archivo cifrado' })
  async download(@GetUser() user: AuthUser, @Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    const { file, downloadName } = await this.backups.download(id, this.access(user, req));
    return new StreamableFile(file, { type: 'application/octet-stream', disposition: `attachment; filename="${downloadName}"`, length: file.length });
  }

  @Get(':id/preview')
  @ApiOperation({ summary: 'Qué se restauraría: tienda, fecha, incluido/excluido, compatibilidad y frase de confirmación' })
  async preview(@GetUser() user: AuthUser, @Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    return { success: true, data: await this.backups.preview(id, this.access(user, req), this.actor(user)) };
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Valida en un schema temporal y restaura la tienda en una sola transacción' })
  async restore(@GetUser() user: AuthUser, @Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RestoreBackupDto) {
    return { success: true, data: await this.backups.startRestore(id, this.access(user, req), this.actor(user), dto) };
  }

  @Delete(':id')
  async remove(@GetUser() user: AuthUser, @Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    return { success: true, data: await this.backups.remove(id, this.access(user, req)) };
  }

  private access(user: AuthUser, req: Request): TenantAccess {
    if (user.role?.name !== SUPER_ADMIN_ROLE) throw new ForbiddenException(i18nMessage('errors.BACKUP_OWNER_ONLY'));
    // JwtStrategy ya exige token y tienda iguales; se repite porque esto decide de qué tienda son los datos
    if (!req.tenant || req.tenant.tenantId !== user.tenantId) throw new ForbiddenException(i18nMessage('errors.BACKUP_OWNER_ONLY'));
    return { kind: 'tenant', tenantId: req.tenant.tenantId };
  }

  private actor(user: AuthUser): BackupActor {
    return { type: 'TENANT_USER', id: user.id, email: user.email };
  }
}

import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { RoleResponseDto } from './dto/role-response.dto';
import { BASE_ROLE_NAMES, SUPER_ADMIN_ROLE } from '../../common/constants/permissions';
import { i18nMessage } from '../../i18n/i18n-message';
import { canAssignRole } from '../../common/utils/permission.util';
import type { AuthUser } from '../../common/decorators/interfaces/request-with-user.interface';

type RoleWithCount = Prisma.RoleGetPayload<{ include: { _count: { select: { users: true } } } }>;

@Injectable()
export class RolesService {
  constructor(private prisma: PrismaService) {}

  async findAll(): Promise<RoleResponseDto[]> {
    const roles = await this.prisma.role.findMany({
      include: { _count: { select: { users: true } } },
      orderBy: { name: 'asc' },
    });
    return roles.map((role) => this.toResponse(role));
  }

  // Roles que quien consulta puede asignar a un empleado (nunca más permisos de los propios)
  async findAssignable(actor: AuthUser): Promise<RoleResponseDto[]> {
    const roles = await this.findAll();
    return roles.filter((role) => canAssignRole(actor, role));
  }

  async findOne(id: string): Promise<RoleResponseDto> {
    const role = await this.prisma.role.findUnique({
      where: { id },
      include: { _count: { select: { users: true } } },
    });
    if (!role) {
      throw new NotFoundException('Role not found');
    }
    return this.toResponse(role);
  }

  async create(dto: CreateRoleDto, actor: AuthUser): Promise<RoleResponseDto> {
    this.assertCanGrant(actor, dto.permissions);
    await this.assertNameAvailable(dto.name);

    const role = await this.prisma.role.create({
      data: { name: dto.name, description: dto.description, permissions: dto.permissions },
      include: { _count: { select: { users: true } } },
    });
    return this.toResponse(role);
  }

  async update(id: string, dto: UpdateRoleDto, actor: AuthUser): Promise<RoleResponseDto> {
    const existing = await this.prisma.role.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Role not found');
    }
    // Sin escalar privilegios: no se edita un rol con permisos que el actor no tiene (incluido el
    // propio para sumarse permisos), ni se le agregan permisos ajenos
    if (!canAssignRole(actor, existing)) {
      throw new ForbiddenException(i18nMessage('errors.ROLE_TOO_POWERFUL'));
    }
    if (dto.permissions) this.assertCanGrant(actor, dto.permissions);

    // Super Admin es inmutable: si no, el sistema podría quedarse sin quien gestione roles
    if (existing.name === SUPER_ADMIN_ROLE) {
      throw new ForbiddenException('The Super Admin role cannot be modified');
    }
    if (dto.name !== undefined && dto.name !== existing.name) {
      if (BASE_ROLE_NAMES.includes(existing.name)) {
        throw new ForbiddenException('Base roles cannot be renamed');
      }
      await this.assertNameAvailable(dto.name);
    }

    const role = await this.prisma.role.update({
      where: { id },
      data: { name: dto.name, description: dto.description, permissions: dto.permissions },
      include: { _count: { select: { users: true } } },
    });
    return this.toResponse(role);
  }

  // Eliminar un rol es una acción de alto riesgo: reservada exclusivamente al Super Admin
  async remove(id: string, actor: AuthUser): Promise<{ message: string }> {
    if (actor.role.name !== SUPER_ADMIN_ROLE) {
      throw new ForbiddenException('Only Super Admin can delete roles');
    }

    const role = await this.prisma.role.findUnique({
      where: { id },
      include: { _count: { select: { users: true } } },
    });
    if (!role) {
      throw new NotFoundException('Role not found');
    }
    if (BASE_ROLE_NAMES.includes(role.name)) {
      throw new ForbiddenException('Base roles cannot be deleted');
    }
    if (role._count.users > 0) {
      throw new BadRequestException('No se puede eliminar el rol porque hay usuarios usándolo.');
    }

    await this.prisma.role.delete({ where: { id } });
    return { message: 'Role deleted successfully' };
  }

  private async assertNameAvailable(name: string): Promise<void> {
    const taken = await this.prisma.role.findUnique({ where: { name } });
    if (taken) {
      throw new ConflictException(`A role named "${name}" already exists`);
    }
  }

  // El Super Admin otorga cualquier permiso del catálogo; el resto, solo los que tiene su propio rol
  private assertCanGrant(actor: AuthUser, permissions: string[]): void {
    if (actor.role.name === SUPER_ADMIN_ROLE) return;
    const missing = permissions.filter((permission) => !actor.role.permissions.includes(permission));
    if (missing.length > 0) {
      throw new ForbiddenException(i18nMessage('errors.ROLE_PERMISSIONS_EXCEED', { permissions: missing.join(', ') }));
    }
  }

  private toResponse(role: RoleWithCount): RoleResponseDto {
    return {
      id: role.id,
      name: role.name,
      description: role.description,
      permissions: role.permissions,
      usersCount: role._count.users,
      isBase: BASE_ROLE_NAMES.includes(role.name),
      createdAt: role.createdAt,
      updatedAt: role.updatedAt,
    };
  }
}

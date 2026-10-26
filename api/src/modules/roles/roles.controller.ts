import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RolesService } from './roles.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { RoleResponseDto } from './dto/role-response.dto';
import { JwtAuthGuard } from '../../common/decorators/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/decorators/guards/permissions.guard';
import { AnyPermission, Permissions } from '../../common/decorators/permissions.decorator';
import { ALL_PERMISSIONS, Permission, SUPER_ADMIN_ROLE } from '../../common/constants/permissions';
import { GetUser } from '../../common/decorators/get-user.decorator';
import type { AuthUser } from '../../common/decorators/interfaces/request-with-user.interface';

@ApiTags('roles')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('roles')
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Get()
  @Permissions(Permission.MANAGE_ROLES)
  @ApiOperation({ summary: 'List all roles with their permissions (MANAGE_ROLES)' })
  @ApiResponse({ status: 200, type: [RoleResponseDto] })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async findAll(): Promise<RoleResponseDto[]> {
    return await this.rolesService.findAll();
  }

  // Declarado antes de :id para que "assignable" no se interprete como un ID
  @Get('assignable')
  @AnyPermission(Permission.MANAGE_USERS, Permission.MANAGE_ROLES)
  @ApiOperation({ summary: 'Roles the current user can assign to staff (never more permissions than their own)' })
  @ApiResponse({ status: 200, type: [RoleResponseDto] })
  async findAssignable(@GetUser() user: AuthUser): Promise<RoleResponseDto[]> {
    return await this.rolesService.findAssignable(user);
  }

  /**
   * Catálogo de permisos (lo define el código, no la tienda) para los checkboxes del formulario.
   * grantable: los que este usuario puede otorgar; el Super Admin, todos (ver RolesService.assertCanGrant).
   */
  @Get('permissions')
  @Permissions(Permission.MANAGE_ROLES)
  @ApiOperation({ summary: 'Permission catalog defined by the platform (MANAGE_ROLES)' })
  findPermissions(@GetUser() user: AuthUser): { permission: string; grantable: boolean }[] {
    const isSuperAdmin = user.role.name === SUPER_ADMIN_ROLE;
    return ALL_PERMISSIONS.map((permission) => ({
      permission,
      grantable: isSuperAdmin || user.role.permissions.includes(permission),
    }));
  }

  @Get(':id')
  @Permissions(Permission.MANAGE_ROLES)
  @ApiOperation({ summary: 'Get a role by ID (MANAGE_ROLES)' })
  @ApiParam({ name: 'id', description: 'Role ID' })
  @ApiResponse({ status: 200, type: RoleResponseDto })
  @ApiResponse({ status: 404, description: 'Role not found' })
  async findOne(@Param('id', ParseUUIDPipe) id: string): Promise<RoleResponseDto> {
    return await this.rolesService.findOne(id);
  }

  @Post()
  @Permissions(Permission.MANAGE_ROLES)
  @ApiOperation({ summary: 'Create a role (MANAGE_ROLES)' })
  @ApiBody({ type: CreateRoleDto })
  @ApiResponse({ status: 201, type: RoleResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  @ApiResponse({ status: 409, description: 'Role name already exists' })
  async create(@Body() dto: CreateRoleDto, @GetUser() actor: AuthUser): Promise<RoleResponseDto> {
    return await this.rolesService.create(dto, actor);
  }

  @Patch(':id')
  @Permissions(Permission.MANAGE_ROLES)
  @ApiOperation({ summary: 'Update a role (MANAGE_ROLES). The Super Admin role cannot be modified' })
  @ApiParam({ name: 'id', description: 'Role ID' })
  @ApiBody({ type: UpdateRoleDto })
  @ApiResponse({ status: 200, type: RoleResponseDto })
  @ApiResponse({ status: 403, description: 'Protected role' })
  @ApiResponse({ status: 404, description: 'Role not found' })
  @ApiResponse({ status: 409, description: 'Role name already exists' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRoleDto,
    @GetUser() actor: AuthUser,
  ): Promise<RoleResponseDto> {
    return await this.rolesService.update(id, dto, actor);
  }

  @Delete(':id')
  @Permissions(Permission.MANAGE_ROLES)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a role (Super Admin only). Base roles and roles with users cannot be deleted' })
  @ApiParam({ name: 'id', description: 'Role ID' })
  @ApiResponse({ status: 200, description: 'Role deleted successfully' })
  @ApiResponse({ status: 400, description: 'The role still has users' })
  @ApiResponse({ status: 403, description: 'Not a Super Admin, or the role is a protected base role' })
  @ApiResponse({ status: 404, description: 'Role not found' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @GetUser() actor: AuthUser,
  ): Promise<{ message: string }> {
    return await this.rolesService.remove(id, actor);
  }
}

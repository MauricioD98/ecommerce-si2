import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { UserResponseDto } from './dto/user-response.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateUserDto } from './dto/update-user.dto';
import * as bcrypt from 'bcrypt';
import { ChangePasswordDto } from './dto/change-password.dto';
import { CreateStaffDto } from './dto/create-staff.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';
import type { AuthUser } from '../../common/decorators/interfaces/request-with-user.interface';
import { canAssignRole, hasAllBranches } from '../../common/utils/permission.util';
import { USER_SELECT, toUserResponse } from './user.mapper';

@Injectable()
export class UsersService {
  private readonly SALT_ROUNDS =10;
constructor(private prisma: PrismaService) {} 
async findOne(userId: string): Promise<UserResponseDto> {
  const user = await this.prisma.user.findUnique({
    where: { id: userId },
    select: USER_SELECT,
  });
  
  if (!user) {
  throw new NotFoundException('User not found');
}

return toUserResponse(user);
 }

 async findAll(): Promise<UserResponseDto[]> {
  const users = await this.prisma.user.findMany({
    select: USER_SELECT,
    orderBy: { createdAt: 'desc' },
  });
  return users.map(toUserResponse);
}

async update(
  userId: string,
  updateUserDto: UpdateUserDto,
  ): Promise<UserResponseDto> {
  const existingUser = await this.prisma.user.findUnique({
    where: { id: userId },
  });

 if (!existingUser) {
  throw new NotFoundException('User not found');
}

if (updateUserDto.email && updateUserDto.email !== existingUser.email) {
  const emailTaken = await this.prisma.user.findUnique({
    where: { email: updateUserDto.email },
  })
  if (emailTaken) {
    throw new NotFoundException('Email is already taken');
    }
  }

// La sucursal favorita debe existir y estar activa
if (updateUserDto.preferredBranchId) {
  const branch = await this.prisma.branch.findFirst({
    where: { id: updateUserDto.preferredBranchId, isActive: true },
    select: { id: true },
  });
  if (!branch) {
    throw new BadRequestException('La sucursal favorita no existe o no está activa');
  }
}

const updatedUser = await this.prisma.user.update({
  where: { id: userId },
  data: updateUserDto,
  select: USER_SELECT,
    });
    return toUserResponse(updatedUser);
  }

  // Personal = usuarios asignados a una sucursal. Con alcance de sucursal solo se ven los de la propia
  async findAllStaff(actor: AuthUser): Promise<UserResponseDto[]> {
    const users = await this.prisma.user.findMany({
      where: {
        branchId: hasAllBranches(actor) ? { not: null } : this.requireOwnBranch(actor),
      },
      select: USER_SELECT,
      orderBy: { createdAt: 'desc' },
    });
    return users.map(toUserResponse);
  }

  async createStaff(actor: AuthUser, dto: CreateStaffDto): Promise<UserResponseDto> {
    const branchId = this.resolveBranchId(actor, dto.branchId);

    const branch = await this.prisma.branch.findUnique({ where: { id: branchId } });
    if (!branch) {
      throw new NotFoundException('Branch not found');
    }

    await this.assertAssignableRole(actor, dto.roleId);

    const emailTaken = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (emailTaken) {
      throw new ConflictException('Email is already taken');
    }

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        password: await bcrypt.hash(dto.password, this.SALT_ROUNDS),
        firstName: dto.firstName,
        lastName: dto.lastName,
        roleId: dto.roleId,
        branchId,
        employeeDiscount: dto.employeeDiscount ?? 0,
      },
      select: USER_SELECT,
    });
    return toUserResponse(user);
  }

  async updateStaff(actor: AuthUser, id: string, dto: UpdateStaffDto): Promise<UserResponseDto> {
    const target = await this.prisma.user.findUnique({ where: { id }, include: { role: true } });
    // Solo el personal (usuarios con sucursal) se gestiona aquí
    if (!target || !target.branchId) {
      throw new NotFoundException('Staff user not found');
    }

    if (!hasAllBranches(actor)) {
      if (target.branchId !== this.requireOwnBranch(actor)) {
        throw new ForbiddenException('You can only manage staff of your own branch');
      }
      // Evita que alguien se otorgue descuentos o cambie su propio rol
      if (target.id === actor.id) {
        throw new ForbiddenException('You cannot modify your own staff settings');
      }
      // No se puede editar a alguien con más permisos de los propios
      if (!canAssignRole(actor, target.role)) {
        throw new ForbiddenException('You cannot manage a user with a higher role');
      }
    }

    if (dto.roleId) {
      await this.assertAssignableRole(actor, dto.roleId);
    }

    const branchId = dto.branchId ? this.resolveBranchId(actor, dto.branchId) : undefined;
    if (branchId) {
      const branch = await this.prisma.branch.findUnique({ where: { id: branchId } });
      if (!branch) {
        throw new NotFoundException('Branch not found');
      }
    }

    const user = await this.prisma.user.update({
      where: { id },
      data: {
        roleId: dto.roleId,
        branchId,
        employeeDiscount: dto.employeeDiscount,
      },
      select: USER_SELECT,
    });
    return toUserResponse(user);
  }

  // El rol debe existir y no dar más permisos de los que tiene quien lo asigna
  private async assertAssignableRole(actor: AuthUser, roleId: string): Promise<void> {
    const role = await this.prisma.role.findUnique({ where: { id: roleId } });
    if (!role) {
      throw new NotFoundException('Role not found');
    }
    if (!canAssignRole(actor, role)) {
      throw new ForbiddenException('You cannot assign a role with more permissions than your own');
    }
  }

  private requireOwnBranch(actor: AuthUser): string {
    if (!actor.branchId) {
      throw new ForbiddenException('User is not assigned to a branch');
    }
    return actor.branchId;
  }

  // Con alcance global se elige la sucursal; con alcance de sucursal queda limitado a la propia
  private resolveBranchId(actor: AuthUser, requested?: string): string {
    if (hasAllBranches(actor)) {
      if (!requested) {
        throw new BadRequestException('branchId is required');
      }
      return requested;
    }
    const own = this.requireOwnBranch(actor);
    if (requested && requested !== own) {
      throw new ForbiddenException('You can only manage staff of your own branch');
    }
    return own;
  }

 async changePassword(
  userId: string,
  changePasswordDto: ChangePasswordDto,
): Promise<{ message: string }> {
  const { currentPassword, newPassword } = changePasswordDto;

  const user = await this.prisma.user.findUnique({
    where: { id: userId },
    }); 

    if (!user) {
  throw new NotFoundException('User not found');
}

const isPasswordValid = await bcrypt.compare(
  currentPassword,
  user.password,
);

if (!isPasswordValid) {
  throw new BadRequestException('La contraseña actual es incorrecta');
}

const isSamePassword = await bcrypt.compare(newPassword, user.password);

if (isSamePassword) {
  throw new BadRequestException('La nueva contraseña debe ser diferente a la actual');
}
const hashedNewPassword = await bcrypt.hash(newPassword, this.SALT_ROUNDS);

await this.prisma.user.update({
  where: { id: userId },
  data: { password: hashedNewPassword },
});
  return { message: 'Contraseña actualizada correctamente' };
  }

  async remove(userId: string): Promise<{ message: string }> {
  const user = await this.prisma.user.findUnique({
    where: { id: userId },
  });

  if (!user) {
    throw new NotFoundException('User not found');
  }
  
  await this.prisma.user.delete({
  where: { id: userId },
});

return { message: 'User account deleted successfully' };

  }
}


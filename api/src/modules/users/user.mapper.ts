import { Prisma } from '@prisma/client';
import { UserResponseDto } from './dto/user-response.dto';

// Campos públicos de un usuario (nunca la contraseña ni el refresh token) con su rol y permisos
export const USER_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  phone: true,
  preferredBranchId: true,
  branchId: true,
  employeeDiscount: true,
  createdAt: true,
  updatedAt: true,
  role: { select: { id: true, name: true, permissions: true } },
} satisfies Prisma.UserSelect;

export type UserWithRole = Prisma.UserGetPayload<{ select: typeof USER_SELECT }>;

// Respuesta de la API: el rol viaja resumido y sus permisos al nivel del usuario
export function toUserResponse(user: UserWithRole): UserResponseDto {
  const { role, ...rest } = user;
  return {
    ...rest,
    role: { id: role.id, name: role.name },
    permissions: role.permissions,
  };
}

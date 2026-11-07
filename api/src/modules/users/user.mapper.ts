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

// Respuesta de la API: el rol viaja resumido y sus permisos al nivel del usuario. Campo por campo, sin
// spread: el login lee además password, loginAttempts y lockedUntil, y nada de lo que se seleccione de
// más puede salir hacia el cliente.
export function toUserResponse(user: UserWithRole): UserResponseDto {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    phone: user.phone,
    preferredBranchId: user.preferredBranchId,
    branchId: user.branchId,
    employeeDiscount: user.employeeDiscount,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    role: { id: user.role.id, name: user.role.name },
    permissions: user.role.permissions,
  };
}

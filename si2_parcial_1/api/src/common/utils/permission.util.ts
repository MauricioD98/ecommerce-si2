import { Permission, SUPER_ADMIN_ROLE } from '../constants/permissions';
import type { AuthUser } from '../decorators/interfaces/request-with-user.interface';

type RoleLike = { name: string; permissions: string[] };

// "Super Admin" pasa cualquier verificación
export const hasPermission = (user: AuthUser, permission: string): boolean =>
  user.role.name === SUPER_ADMIN_ROLE || user.role.permissions.includes(permission);

// Alcance global: puede operar sobre todas las sucursales
export const hasAllBranches = (user: AuthUser): boolean =>
  hasPermission(user, Permission.ALL_BRANCHES);

// Anti-escalada de privilegios: un usuario solo puede asignar roles que no le den más de lo que ya tiene.
// El rol "Super Admin" y los roles con alcance global solo los asigna quien ya es Super Admin.
export const canAssignRole = (actor: AuthUser, role: RoleLike): boolean => {
  if (actor.role.name === SUPER_ADMIN_ROLE) return true;
  if (role.name === SUPER_ADMIN_ROLE) return false;
  return role.permissions.every((permission) => actor.role.permissions.includes(permission));
};

import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ANY_PERMISSION_KEY, PERMISSIONS_KEY } from '../permissions.decorator';
import { SUPER_ADMIN_ROLE } from '../../constants/permissions';

// Verifica los permisos del rol contra los que exige la ruta (@Permissions / @AnyPermission).
// Los permisos vienen en el JWT (req.user.role.permissions), por lo que no consulta la BD.
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    const requireAll = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, targets);
    const requireAny = this.reflector.getAllAndOverride<string[]>(ANY_PERMISSION_KEY, targets);

    if (!requireAll && !requireAny) {
      return true;
    }

    const { user, tenant } = context.switchToHttp().getRequest();
    if (!user?.role) {
      return false;
    }
    // JwtStrategy ya lo exige; se repite acá porque este guard es el que habilita los permisos
    // físicos (USE_POS, PROCESS_RETURNS): ninguno se concede fuera del schema de su tienda,
    // ni siquiera al Super Admin de otra tienda.
    if (!tenant || user.tenantId !== tenant.tenantId) {
      return false;
    }
    // Super Admin tiene acceso a todo
    if (user.role.name === SUPER_ADMIN_ROLE) {
      return true;
    }

    const granted: string[] = user.role.permissions ?? [];
    if (requireAll && !requireAll.every((permission) => granted.includes(permission))) {
      return false;
    }
    if (requireAny && !requireAny.some((permission) => granted.includes(permission))) {
      return false;
    }
    return true;
  }
}

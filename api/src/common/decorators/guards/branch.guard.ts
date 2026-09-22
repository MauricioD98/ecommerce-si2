import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { hasAllBranches } from '../../utils/permission.util';

// Restringe las rutas con :branchId a la sucursal asignada del usuario.
// Quien tiene el permiso ALL_BRANCHES accede a todas. Usar siempre junto a JwtAuthGuard y PermissionsGuard.
@Injectable()
export class BranchGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const { user, params } = context.switchToHttp().getRequest();
    if (!user) {
      return false;
    }
    if (hasAllBranches(user)) {
      return true;
    }
    if (!user.branchId || user.branchId !== params.branchId) {
      throw new ForbiddenException('No tienes acceso a los recursos de esta sucursal');
    }
    return true;
  }
}

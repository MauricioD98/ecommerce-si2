import { SetMetadata } from '@nestjs/common';
import { PermissionValue } from '../constants/permissions';

export const PERMISSIONS_KEY = 'permissions';
export const ANY_PERMISSION_KEY = 'any_permission';

// La ruta exige TODOS los permisos indicados
export const Permissions = (...permissions: PermissionValue[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

// La ruta exige AL MENOS UNO de los permisos indicados
export const AnyPermission = (...permissions: PermissionValue[]) =>
  SetMetadata(ANY_PERMISSION_KEY, permissions);

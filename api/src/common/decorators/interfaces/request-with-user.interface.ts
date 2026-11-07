import { Request } from 'express';

// Usuario autenticado, reconstruido desde el payload del JWT (sin consultar la BD en cada petición)
export interface AuthUser {
  id: string;
  email: string;
  role: {
    id: string;
    name: string;
    permissions: string[];
  };
  branchId: string | null;
  // Tienda que emitió el token; JwtStrategy garantiza que coincide con req.tenant
  tenantId: string;
  // "mobile" solo si el token lo emitió el canal móvil (plan con app + prueba de integridad)
  channel?: 'web' | 'mobile';
}

export interface RequestWithUser extends Request {
  user: AuthUser;
}

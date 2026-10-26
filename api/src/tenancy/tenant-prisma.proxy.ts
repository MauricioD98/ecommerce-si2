import type { PrismaService } from '../prisma/prisma.service';
import { tenantStorage } from './tenant-context';
import type { TenantPrismaService } from './tenant-prisma.service';

// Props que Nest (lifecycle hooks, await del factory) e inspectores consultan al arrancar, fuera
// de cualquier request: sin tenant devuelven undefined en vez de explotar.
const BOOT_PROPS = new Set<PropertyKey>([
  'then',
  'onModuleInit',
  'onApplicationBootstrap',
  'onModuleDestroy',
  'beforeApplicationShutdown',
  'onApplicationShutdown',
  'constructor',
  'toJSON',
]);

/**
 * Se registra bajo el token PrismaService: los ~30 servicios existentes (POS, devoluciones,
 * inventario…) siguen inyectando `PrismaService` y escribiendo `this.prisma.order.create(...)`,
 * pero cada acceso se resuelve contra el cliente del schema del tenant de la request en curso.
 */
export function createTenantPrismaProxy(tenants: TenantPrismaService): PrismaService {
  return new Proxy({} as PrismaService, {
    get(_target, prop) {
      // `prop in Object.prototype`: el ScheduleExplorer de @nestjs/schedule recorre los métodos
      // heredados (hasOwnProperty, toString…) de cada provider al arrancar, sin tenant
      if (!tenantStorage.getStore() && (typeof prop === 'symbol' || BOOT_PROPS.has(prop) || prop in Object.prototype)) {
        return undefined;
      }
      const client = tenants.client as unknown as Record<PropertyKey, unknown>;
      const value = client[prop];
      // $transaction, $queryRaw, etc. dependen de `this`
      return typeof value === 'function' ? value.bind(client) : value;
    },
  });
}

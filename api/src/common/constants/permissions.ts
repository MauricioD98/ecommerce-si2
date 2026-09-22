// Permisos granulares que se asignan a cada rol (Role.permissions).
// Si se agrega uno nuevo, también hay que sumarlo en el seed (prisma/seed.mjs) y en front/utils/permissions.ts.
export const Permission = {
  MANAGE_BRANCHES: 'MANAGE_BRANCHES', // crear, editar y eliminar sucursales
  MANAGE_USERS: 'MANAGE_USERS', // empleados y su descuento de trabajador
  MANAGE_INVENTORY: 'MANAGE_INVENTORY', // stock y ofertas por sucursal
  MANAGE_PRODUCTS: 'MANAGE_PRODUCTS', // catálogo de productos y categorías
  VIEW_ORDERS: 'VIEW_ORDERS', // ver y gestionar pedidos
  MANAGE_ROLES: 'MANAGE_ROLES', // crear y editar roles
  SEND_MARKETING: 'SEND_MARKETING', // enviar correos promocionales a clientes
  VIEW_REPORTS: 'VIEW_REPORTS', // reportes de ventas y consultas dinámicas con IA
  ALL_BRANCHES: 'ALL_BRANCHES', // alcance global: sin este permiso solo se opera sobre la sucursal propia
  USE_POS: 'USE_POS', // caja física (punto de venta) de la sucursal propia
} as const;

export type PermissionValue = (typeof Permission)[keyof typeof Permission];

export const ALL_PERMISSIONS: PermissionValue[] = Object.values(Permission);

// Roles base: no se pueden eliminar ni renombrar. "Super Admin" tampoco se puede modificar
// (evita que el sistema se quede sin nadie que gestione roles).
export const SUPER_ADMIN_ROLE = 'Super Admin';
export const DEFAULT_ROLE = 'Cliente';
export const BASE_ROLE_NAMES = [SUPER_ADMIN_ROLE, 'Admin Sucursal', 'Empleado', DEFAULT_ROLE];

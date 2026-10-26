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
  PROCESS_RETURNS: 'PROCESS_RETURNS', // punto de devolución: reingresar prendas al stock o a mermas
  MANAGE_PAYMENTS: 'MANAGE_PAYMENTS', // medios de cobro de la tienda: Stripe, QR bancario y USDT
  MANAGE_APPEARANCE: 'MANAGE_APPEARANCE', // logo, colores, descripción y redes sociales de la tienda pública
} as const;

export type PermissionValue = (typeof Permission)[keyof typeof Permission];

export const ALL_PERMISSIONS: PermissionValue[] = Object.values(Permission);

// Roles base: no se pueden eliminar ni renombrar. "Super Admin" tampoco se puede modificar
// (evita que el sistema se quede sin nadie que gestione roles).
export const SUPER_ADMIN_ROLE = 'Super Admin';
export const DEFAULT_ROLE = 'Cliente';
export const BASE_ROLE_NAMES = [SUPER_ADMIN_ROLE, 'Admin Sucursal', 'Empleado', DEFAULT_ROLE];

// Roles base con sus permisos: los crea TenantProvisioningService en cada tienda nueva.
// prisma/seed.mjs (JS plano, no puede importar este archivo) tiene una copia: mantener ambas iguales.
export const BASE_ROLES: { name: string; description: string; permissions: PermissionValue[] }[] = [
  { name: SUPER_ADMIN_ROLE, description: 'Acceso total al sistema', permissions: ALL_PERMISSIONS },
  {
    name: 'Admin Sucursal',
    description: 'Gestiona empleados, inventario y pedidos de su sucursal',
    permissions: [
      Permission.MANAGE_USERS,
      Permission.MANAGE_INVENTORY,
      Permission.MANAGE_PRODUCTS,
      Permission.VIEW_ORDERS,
      Permission.SEND_MARKETING,
      Permission.VIEW_REPORTS,
      Permission.USE_POS,
      Permission.PROCESS_RETURNS,
    ],
  },
  {
    name: 'Empleado',
    description: 'Personal de una sucursal (puede cobrar en caja y recibir devoluciones)',
    permissions: [Permission.USE_POS, Permission.PROCESS_RETURNS],
  },
  { name: DEFAULT_ROLE, description: 'Cliente de la tienda', permissions: [] },
];

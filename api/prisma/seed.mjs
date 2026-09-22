// Datos iniciales de desarrollo: administrador, categorías y ropa femenina de prueba.
// Es idempotente (usa upsert), se puede ejecutar varias veces:  npm run seed
import 'dotenv/config';
import bcrypt from 'bcrypt';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const img = (id) => `https://images.unsplash.com/photo-${id}?w=800&q=80`;

const ADMIN = {
  email: 'admin@stellafemme.com',
  password: 'Admin@123!$',
  firstName: 'Admin',
  lastName: 'Stella Femme',
};

const SUPERADMIN = {
  email: 'superadmin@stellafemme.com',
  password: 'Super@123!$',
  firstName: 'Super',
  lastName: 'Admin',
};

const BRANCH_ADMIN = {
  email: 'admin.centro@stellafemme.com',
  password: 'Sucursal@123!$',
  firstName: 'Admin',
  lastName: 'Sucursal Centro',
  branchName: 'Sucursal Centro',
};

// Sucursales físicas en Santa Cruz de la Sierra, Bolivia (se identifican por nombre)
const BRANCHES = [
  {
    name: 'Sucursal Centro',
    address: 'Calle Libertad #245, entre Junín y Sucre, Santa Cruz de la Sierra',
    phone: '+591 3 3345678',
  },
  {
    name: 'Sucursal Equipetrol',
    address: 'Av. San Martín #1050, Barrio Equipetrol, Santa Cruz de la Sierra',
    phone: '+591 3 3389012',
  },
];

// Roles base con sus permisos (espejo de api/src/common/constants/permissions.ts).
// Se sincronizan en cada ejecución; los roles creados desde el panel no se tocan.
const ALL_PERMISSIONS = [
  'MANAGE_BRANCHES',
  'MANAGE_USERS',
  'MANAGE_INVENTORY',
  'MANAGE_PRODUCTS',
  'VIEW_ORDERS',
  'MANAGE_ROLES',
  'SEND_MARKETING',
  'VIEW_REPORTS',
  'ALL_BRANCHES',
  'USE_POS',
];

const ROLES = [
  { name: 'Super Admin', description: 'Acceso total al sistema', permissions: ALL_PERMISSIONS },
  {
    name: 'Admin Sucursal',
    description: 'Gestiona empleados, inventario y pedidos de su sucursal',
    permissions: ['MANAGE_USERS', 'MANAGE_INVENTORY', 'MANAGE_PRODUCTS', 'VIEW_ORDERS', 'SEND_MARKETING', 'VIEW_REPORTS', 'USE_POS'],
  },
  { name: 'Empleado', description: 'Personal de una sucursal (puede cobrar en caja)', permissions: ['USE_POS'] },
  { name: 'Cliente', description: 'Cliente de la tienda', permissions: [] },
];

const CATEGORIES = [
  {
    name: 'Vestidos',
    slug: 'vestidos',
    description: 'Vestidos para toda ocasión: fiesta, playa y día a día.',
    imageUrl: img('1595777457583-95e059d581b8'),
  },
  {
    name: 'Blusas y Tops',
    slug: 'blusas-y-tops',
    description: 'Blusas, camisetas y tops en tejidos frescos y cómodos.',
    imageUrl: img('1564584217132-2271feaeb3c5'),
  },
  {
    name: 'Pantalones y Jeans',
    slug: 'pantalones-y-jeans',
    description: 'Jeans y pantalones de corte moderno para cualquier look.',
    imageUrl: img('1541099649105-f69ad21f3246'),
  },
];

// Cada producto puede tener varias tallas (Product.sizes); el stock es compartido por producto
const PRODUCTS = [
  {
    sku: 'VES-001',
    name: 'Vestido largo rojo de fiesta',
    category: 'vestidos',
    sizes: ['S', 'M', 'L'],
    price: 129.9,
    stock: 12,
    description: 'Vestido largo de satén rojo con espalda descubierta y falda amplia con vuelo. Ideal para bodas y galas.',
    imageUrl: img('1595777457583-95e059d581b8'),
  },
  {
    sku: 'VES-002',
    name: 'Vestido floral cruzado',
    category: 'vestidos',
    sizes: ['S', 'M'],
    price: 79.9,
    stock: 15,
    description: 'Vestido midi cruzado con estampado floral sobre fondo claro. Tela ligera y fresca para el verano.',
    imageUrl: img('1496747611176-843222e1e57c'),
  },
  {
    sku: 'VES-003',
    name: 'Vestido camisero de mezclilla',
    category: 'vestidos',
    sizes: ['M', 'L'],
    price: 69.9,
    stock: 10,
    description: 'Vestido corto estilo camisero en mezclilla suave, con botones al frente y bolsillos en el pecho.',
    imageUrl: img('1591369822096-ffd140ec948f'),
  },
  {
    sku: 'TOP-001',
    name: 'Camiseta básica de algodón celeste',
    category: 'blusas-y-tops',
    sizes: ['S', 'M', 'L'],
    price: 24.9,
    stock: 30,
    description: 'Camiseta de manga corta en algodón jaspeado color celeste. Un básico versátil para combinar con todo.',
    imageUrl: img('1564584217132-2271feaeb3c5'),
  },
  {
    sku: 'TOP-002',
    name: 'Poncho tejido con flecos',
    category: 'blusas-y-tops',
    sizes: ['M', 'L'],
    price: 59.9,
    stock: 8,
    description: 'Poncho de punto calado color crema con flecos en el borde. Perfecto para looks bohemios.',
    imageUrl: img('1434389677669-e08b4cac3105'),
  },
  {
    sku: 'PAN-001',
    name: 'Jeans mom con parches',
    category: 'pantalones-y-jeans',
    sizes: ['S', 'M', 'L'],
    price: 64.9,
    stock: 14,
    description: 'Jeans de tiro alto y corte recto con detalles rasgados y parches bordados. Estilo urbano y desenfadado.',
    imageUrl: img('1541099649105-f69ad21f3246'),
  },
  {
    sku: 'PAN-002',
    name: 'Pantalón ancho de rayas',
    category: 'pantalones-y-jeans',
    sizes: ['S', 'M'],
    price: 54.9,
    stock: 9,
    description: 'Pantalón palazzo negro con rayas blancas verticales, cintura alta y pierna muy amplia.',
    imageUrl: img('1509631179647-0177331693ae'),
  },
  {
    sku: 'PAN-003',
    name: 'Jeans de tiro alto celeste',
    category: 'pantalones-y-jeans',
    sizes: ['M', 'L'],
    price: 62.9,
    stock: 11,
    description: 'Jeans de mezclilla celeste lavada con cintura alta y detalles desgastados.',
    imageUrl: img('1602293589930-45aad59ba3ab'),
  },
];

async function main() {
  const roleIds = {};
  for (const { name, ...data } of ROLES) {
    const role = await prisma.role.upsert({
      where: { name },
      update: data,
      create: { name, ...data },
    });
    roleIds[name] = role.id;
    console.log(`Rol: ${role.name} (${role.permissions.length} permisos)`);
  }

  const hashedPassword = await bcrypt.hash(ADMIN.password, 12);
  const admin = await prisma.user.upsert({
    where: { email: ADMIN.email },
    update: { password: hashedPassword, roleId: roleIds['Super Admin'] },
    create: {
      email: ADMIN.email,
      password: hashedPassword,
      firstName: ADMIN.firstName,
      lastName: ADMIN.lastName,
      roleId: roleIds['Super Admin'],
    },
  });
  console.log(`Admin: ${admin.email} (Super Admin)`);

  // Branch.name no es único: se busca por nombre y se crea/actualiza (idempotente)
  const branches = [];
  for (const data of BRANCHES) {
    const existing = await prisma.branch.findFirst({ where: { name: data.name } });
    const branch = existing
      ? await prisma.branch.update({ where: { id: existing.id }, data })
      : await prisma.branch.create({ data });
    branches.push(branch);
    console.log(`Sucursal: ${branch.name}`);
  }

  const superAdminPassword = await bcrypt.hash(SUPERADMIN.password, 12);
  const superAdmin = await prisma.user.upsert({
    where: { email: SUPERADMIN.email },
    update: { password: superAdminPassword, roleId: roleIds['Super Admin'] },
    create: {
      email: SUPERADMIN.email,
      password: superAdminPassword,
      firstName: SUPERADMIN.firstName,
      lastName: SUPERADMIN.lastName,
      roleId: roleIds['Super Admin'],
    },
  });
  console.log(`Superadmin: ${superAdmin.email} (Super Admin)`);

  const { branchName, ...branchAdminData } = BRANCH_ADMIN;
  const branchAdminBranch = branches.find((branch) => branch.name === branchName);
  const branchAdminPassword = await bcrypt.hash(branchAdminData.password, 12);
  const branchAdmin = await prisma.user.upsert({
    where: { email: branchAdminData.email },
    update: { password: branchAdminPassword, roleId: roleIds['Admin Sucursal'], branchId: branchAdminBranch.id },
    create: {
      ...branchAdminData,
      password: branchAdminPassword,
      roleId: roleIds['Admin Sucursal'],
      branchId: branchAdminBranch.id,
    },
  });
  console.log(`Admin sucursal: ${branchAdmin.email} (Admin Sucursal) -> ${branchName}`);

  const categoryIds = {};
  for (const { slug, ...data } of CATEGORIES) {
    const category = await prisma.category.upsert({
      where: { slug },
      update: data,
      create: { slug, ...data },
    });
    categoryIds[slug] = category.id;
    console.log(`Categoría: ${category.name}`);
  }

  for (const { category, sku, ...data } of PRODUCTS) {
    const product = await prisma.product.upsert({
      where: { sku },
      update: { ...data, categoryId: categoryIds[category] },
      create: { sku, ...data, categoryId: categoryIds[category] },
    });
    console.log(`Producto: ${product.sku} - ${product.name} (tallas ${product.sizes.join("/")}, $${product.price}, stock ${product.stock})`);

    // Stock por sucursal y por talla: el stock global se reparte primero entre las sucursales y,
    // dentro de cada sucursal, entre las tallas del producto. Solo se define al crear; si ya existe
    // no se pisa (puede haber cambiado por ventas).
    const perBranch = Math.floor(product.stock / branches.length);
    for (const [branchIndex, branch] of branches.entries()) {
      const branchStock = branchIndex === 0 ? product.stock - perBranch * (branches.length - 1) : perBranch;
      const perSize = Math.floor(branchStock / product.sizes.length);
      for (const [sizeIndex, size] of product.sizes.entries()) {
        const stock = sizeIndex === 0 ? branchStock - perSize * (product.sizes.length - 1) : perSize;
        await prisma.productInventory.upsert({
          where: { productId_branchId_size: { productId: product.id, branchId: branch.id, size } },
          update: {},
          create: { productId: product.id, branchId: branch.id, size, stock },
        });
      }
    }
  }
}

main()
  .catch((error) => {
    console.error('Error al ejecutar el seed', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

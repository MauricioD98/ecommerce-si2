# PROJECT_CONTEXT — STELLA FEMME

> Documento maestro de contexto. Describe el estado real del proyecto para poder retomarlo en futuras sesiones.
> Última actualización: 2026-09-21. Si algo cambia (esquema, rutas, permisos, puertos), actualiza este archivo.

---

## 1. Visión general y stack tecnológico

**Stella Femme** (nombre oficial del proyecto y de la marca; antes "STOREFRONT") es un e-commerce **multi-sucursal** de **ropa femenina** (sucursales físicas en Santa Cruz de la Sierra, Bolivia). Incluye catálogo con stock y ofertas por sucursal, carrito, checkout con retiro en tienda o envío a domicilio (con mapa), pago con Stripe, correos transaccionales, facturas en PDF y un **dashboard administrativo** con roles y permisos dinámicos, marketing por correo y reportes con IA.

| Capa | Tecnología |
|---|---|
| Frontend | **Next.js 16** (App Router, Turbopack) · React 19 · TypeScript |
| Estilos | **SCSS / CSS Modules** (un `.module.scss` por componente) + variables CSS globales en `app/globals.css` |
| Estado (front) | Redux Toolkit + `redux-persist` (`auth`, `cart`, `branch`) |
| HTTP (front) | Axios (`service/api/axios.config.ts`) con interceptores |
| Pagos (front) | `@stripe/react-stripe-js` + `@stripe/stripe-js` (`PaymentElement`) |
| Mapas | `leaflet` + `react-leaflet` (mosaicos de OpenStreetMap) |
| Gráficos | `recharts` |
| Animación / íconos | `framer-motion` (solo en `PaymentMethodCard`) · `lucide-react` |
| Backend | **NestJS 12** · TypeScript · Swagger · class-validator · Passport JWT |
| ORM / BD | **Prisma 7** (`@prisma/adapter-pg`) · **PostgreSQL** |
| Pagos (back) | SDK `stripe` (PaymentIntents) |
| Correo (back) | `@nestjs-modules/mailer` + `nodemailer` (SMTP) |
| PDF (back) | `pdfkit` (facturas) |
| IA (back) | `@google/generative-ai` (Gemini, Text-to-SQL para reportes) |

**Reglas de producto que hay que respetar**
- Toda la interfaz está en **español latinoamericano**. La marca oficial es **"Stella Femme"** (en mayúsculas, `STELLA FEMME`, en logotipos y encabezados) y no se traduce. El nombre anterior "STOREFRONT" quedó descartado tras el rebranding y no debe volver a usarse en la interfaz, correos ni facturas.
- No se debe cambiar lógica de negocio al "arreglar" estilos o textos.
- El precio final **siempre lo calcula el backend** (el cliente nunca decide precios ni descuentos).

**Puertos y URLs**

| Servicio | URL |
|---|---|
| Frontend | `http://localhost:3000` |
| API | `http://localhost:3001/api/v1` (prefijo global `api/v1` en `api/src/main.ts`) |
| Swagger | `http://localhost:3001/api/docs` |
| PostgreSQL local | `localhost:5432`, base `ecommerce_si2` |

Páginas de la tienda: `/` (catálogo) · `/{productId}` (detalle) · `/cart` · `/checkout` · `/account` (Mi cuenta, requiere sesión) · `/auth/login` · `/auth/register` · `/auth/forgot-password` · `/auth/reset-password` (redirige a `/auth/forgot-password`; el flujo completo de recuperación vive en esa pantalla).
Panel: `/admin` · `/admin/products` · `/admin/inventory` · `/admin/orders` · `/admin/branches` · `/admin/staff` · `/admin/roles` · `/admin/marketing` · `/admin/reports`.

---

## 2. Estructura del repositorio (monorepo)

```
si2_parcial_1/                 ← raíz (repositorio git; rama main, 1 commit "v1.0.0"; todo lo posterior SIN commitear)
├── PROJECT_CONTEXT.md         ← este archivo
├── front/                     ← Next.js (proyecto autónomo: package.json, bun.lock, node_modules propios)
└── api/                       ← NestJS + Prisma (proyecto autónomo: package.json, package-lock.json)
```

- `front/` y `api/` son proyectos **independientes**; no hay workspaces. Cada uno ignora su `.env`.
- Saltos de línea: el repo mezcla CRLF y LF por archivo; al editar se conserva el de cada archivo.

### 2.1 Frontend (`front/`)

```
app/
  layout.tsx, globals.css, fonts.ts
  (lading)/page.tsx            ← "/" catálogo (carpeta con typo histórico "lading")
  (product)/[id]/page.tsx      ← detalle de producto
  auth/ login | register | forgot-password | reset-password  /page.tsx
  cart/, checkout/
  admin/                       ← layout.tsx (AdminShell) + page.tsx + products|inventory|orders|branches|staff|roles|marketing|reports /page.tsx
components/modules/
  auth/      LoginForm, RegisterForm, ForgotPasswordForm (recuperación en 3 pasos), auth-form.module.scss
  account/   AccountClient (layout con menú lateral/pestañas), ProfileTab, ChangePasswordCard, AddressesTab, AddressModal, account.module.scss
  landing/   Header, Footer, ProductList, ProductCard, BranchSelector (+ scss)
  product/   ProductDetail (incluye botón "Probador Virtual 3D" placeholder), ProductDetailClient, Breadcrumbs, SimilarProducts
  cart/      CartClient, CartItem (+ scss)
  checkout/  CheckoutClient, CheckoutHeader, CheckoutSteps, DeliveryStep, DeliveryAddressPicker, NewAddressForm, AddressMap,
             PaymentMethodCard, stripe-payment-form (+ scss)
  admin/     AdminShell, AdminModal, AdminHome, adminNav.ts, PermissionGate,
             ProductsClient, ProductFormModal, InventoryClient, OrdersClient, BranchesClient, StaffClient, RolesClient,
             MarketingClient, ReportsClient, GeneralMetrics, DynamicReportPanel,
             admin-layout.module.scss, admin-table.module.scss (estilos compartidos del panel)
hooks/       useAuth, useCart, useOrder, usePayment, useProducts, useBranches, useAddresses, useSpeechRecognition,
             useAdminAccess, useAdminBranches, useAdminOrders, useAdminProducts, useInventory, useStaff, useRoles, useReports
service/api/ axios.config, auth/product/category/cart/order/payment/branch/inventory/staff/roles/marketing/reports/address .service, error.utils
store/       index.tsx (store + persist), slices/authSlices, cartSlice, branchSlice
utils/       pricing.ts (espejo del cálculo de precios del backend), permissions.ts (permisos y helpers)
types/       auth, cart, category, orders, payment, product, branch, address, admin (.types.ts)
```
Alias de importación: `@/*` → raíz de `front/`.

### 2.2 Backend (`api/`)

```
prisma/        schema.prisma · migrations/ · seed.mjs
src/
  main.ts                      ← prefijo api/v1, ValidationPipe global, CORS, Swagger
  app.module.ts                ← ConfigModule global (.env), ThrottlerModule y todos los módulos
  prisma/                      ← PrismaService (adapter-pg)
  common/
    constants/permissions.ts   ← catálogo de permisos, roles base
    decorators/                ← GetUser, @Permissions/@AnyPermission, guards (JwtAuthGuard, PermissionsGuard, BranchGuard), throttlers
    utils/                     ← pricing.ts, permission.util.ts, token-hash.ts
  modules/
    auth · users (+ addresses, user.mapper) · products · category · cart · orders · payments
    branches (+ InventoryService) · roles · mail · invoices · marketing · reports
```

`ValidationPipe` global: `whitelist`, `forbidNonWhitelisted`, `transform`. **Cualquier campo que no esté en el DTO devuelve 400.**

---

## 3. Base de datos y modelos (Prisma / PostgreSQL)

Archivo: `api/prisma/schema.prisma`. Tablas: `users`, `roles`, `branches`, `products`, `product_inventories`, `categories`, `carts`, `cart_items`, `orders`, `order_items`, `payments`, `user_addresses`.

| Modelo | Campos clave |
|---|---|
| **Role** | `id`, `name` (único), `description?`, `permissions String[]` |
| **User** | `id`, `email` (único), `password` (bcrypt 12), `firstName?`, `lastName?`, `phone?`, `roleId` → Role, `branchId?` → Branch (solo personal; relación `StaffBranch`), `preferredBranchId?` → Branch (sucursal favorita del cliente para sus notificaciones; relación `PreferredBranch`, `onDelete: SetNull`), `employeeDiscount Int` (% de trabajador, 0–100), `refreshToken?` (**hash SHA-256**), `resetPasswordOtp?` (código de 6 dígitos como texto), `resetPasswordExpires?`, `resetPasswordAttempts Int` (intentos fallidos del código), `loginAttempts Int` y `lockedUntil?` (bloqueo de login) |
| **Branch** | `id`, `name`, `address?`, `phone?`, `isActive` |
| **Product** | `id`, `name`, `description?`, `sizes String[]`, `price Decimal(10,2)`, `stock Int` (**global, legado**: se mantiene como suma de las sucursales), `sku` (único), `imageUrl?`, `isActive`, `categoryId` |
| **ProductInventory** | `productId`, `branchId` (único el par), `stock`, **`discountPrice Decimal?`**, **`discountPercentage Int?`** (las ofertas son **por sucursal**) |
| **Category** | `id`, `name`, `description?`, `slug` (único), `imageUrl?`, `isActive` |
| **Cart / CartItem** | `Cart.checkout` pasa a `true` al pagar · `CartItem` único `(cartId, productId)` |
| **Order** | `orderNumber` (cuid), `status` (`PENDIENTE`, `PROCESANDO`, `ENVIADO`, `ENTREGADO`, `CANCELADO`), `totalAmount`, `discountApplied` (descuento de trabajador), `fulfillmentType` (`DELIVERY` \| `PICKUP`), `branchId?`, `shippingAddress?`, `latitude?`, `longitude?`, `userId`, `cartId?` |
| **OrderItem** | `orderId`, `productId`, `quantity`, `price` (precio unitario cobrado, ya con oferta; **no guarda talla**) |
| **Payment** | `orderId` (único), `userId`, `amount`, `status`, `currency` (`USD`), `paymentMethod?`, `transactionId?` |
| **UserAddress** | `userId`, `title`, `address`, `reference?`, `latitude`, `longitude`, `isDefault` (una sola por usuario) |

### 3.1 Tallas
`Product.sizes` es `TEXT[]`; valores del enum `WomenSize` (validado en el DTO): `XS, S, M, L, XL, XXL`. El stock **no es por talla** (es por producto y sucursal).

### 3.2 Stock y precios por sucursal
- El stock real vive en `ProductInventory`. `Product.stock` se recalcula como la suma de las sucursales (`InventoryService.syncGlobalStock`) y solo sirve de respaldo.
- Un **producto nuevo nace con stock 0 en todas las sucursales**; se asigna desde Inventario.
- **Precio efectivo** (`common/utils/pricing.ts` en el back, `utils/pricing.ts` en el front): `discountPrice` (si es menor al precio) › `discountPercentage` › precio base. Sin sucursal seleccionada no hay descuento.
- **Descuento de trabajador:** `User.employeeDiscount` % sobre el subtotal ya con ofertas (se acumulan). Solo se asigna desde `/users/staff`. En órdenes se lee de la BD, no del JWT.

### 3.3 Migraciones (`api/prisma/migrations/`)
1. `20260909022902_init`
2. `20260920160000_product_multiple_sizes` (a mano, sin perder datos)
3. `20260921013814_branches_inventory_roles` — sucursales, inventario, roles del enum, descuentos globales, campos de Order
4. `20260921021951_branch_level_discounts` — descuentos pasan de `Product` a `ProductInventory` (copia los datos antes de borrar)
5. `20260921025321_user_addresses` — direcciones y lat/lng de Order
6. `20260921030000_dynamic_roles` — (a mano) tabla `roles`, migra los usuarios del enum a los roles base y elimina el enum
7. `20260921031241_password_reset` — campos de recuperación de contraseña (versión con token; reemplazada por la 10)
8. `20260921040000_reporting_views` — (a mano, SQL puro) esquema `reporting`, rol `storefront_reports` y 7 vistas para el Text-to-SQL
9. `20260921120000_password_reset_otp` — reemplaza `resetPasswordToken` por `resetPasswordOtp` y añade `resetPasswordAttempts`
10. `20260921130000_login_lockout` — añade `loginAttempts` y `lockedUntil` al usuario
11. `20260921140000_account_profile` — añade `phone` y `preferredBranchId` (FK a `branches`, índice) al usuario

Comandos: `npx prisma migrate deploy` · `npx prisma generate` · `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script` (debe salir vacío). `migrate dev` no funciona cuando el cambio necesita migrar datos existentes: escribir la migración a mano y aplicar con `migrate deploy`. No se ha probado aplicar todo el historial sobre una BD vacía.

### 3.4 Datos iniciales (`npm run seed` en `api/`, idempotente)
- **Roles base** (se re-sincronizan en cada ejecución): ver §4.1.
- **Sucursales:** "Sucursal Centro" y "Sucursal Equipetrol" (Santa Cruz de la Sierra).
- **Usuarios de desarrollo** (no usar en producción):

| Correo | Contraseña | Rol |
|---|---|---|
| `superadmin@stellafemme.com` | `Super@123!$` | Super Admin |
| `admin@stellafemme.com` | `Admin@123!$` | Super Admin |
| `admin.centro@stellafemme.com` | `Sucursal@123!$` | Admin Sucursal (Sucursal Centro) |

- **Categorías:** Vestidos, Blusas y Tops, Pantalones y Jeans. **8 productos** (`VES-001/002/003`, `TOP-001/002`, `PAN-001/002/003`) con su stock **repartido entre las dos sucursales** (solo se define al crear; no pisa cambios posteriores).

---

## 4. Estado actual de funcionalidades

### 4.1 Autenticación, roles y permisos
- **API `/auth`:** `register`, `login`, `refresh`, `logout`, `forgot-password`, `verify-otp`, `reset-password`. Access token 15 min, refresh 7 días.
- **Registro:** toda cuenta nueva recibe el rol **Cliente** (no se puede elegir; el DTO no admite `role`). Correo duplicado → **409** (también ante registros simultáneos, vía `P2002`). El teléfono (`phone`, opcional) **se guarda**. Envía correo de bienvenida sin bloquear el registro (si el SMTP falla, solo `console.error`).
- **Roles dinámicos:** el enum desapareció; ahora son filas de `roles` con un array de permisos. Los crea el Super Admin en `/admin/roles`.
- **Permisos** (`api/src/common/constants/permissions.ts`, espejo en `front/utils/permissions.ts` y `seed.mjs`; si se agrega uno hay que sumarlo en los tres):

| Permiso | Da acceso a |
|---|---|
| `MANAGE_BRANCHES` | crear/editar/eliminar sucursales |
| `MANAGE_USERS` | empleados y su descuento |
| `MANAGE_INVENTORY` | stock y ofertas por sucursal |
| `MANAGE_PRODUCTS` | catálogo de productos y categorías |
| `VIEW_ORDERS` | ver y gestionar pedidos |
| `MANAGE_ROLES` | roles |
| `SEND_MARKETING` | campañas por correo |
| `VIEW_REPORTS` | reportes y consultas con IA |
| `ALL_BRANCHES` | **alcance global**: sin él solo se opera sobre la sucursal propia |

- **Roles base** (no se pueden eliminar ni renombrar; "Super Admin" tampoco se puede modificar): **Super Admin** = los 9 permisos · **Admin Sucursal** = `MANAGE_USERS, MANAGE_INVENTORY, MANAGE_PRODUCTS, VIEW_ORDERS, SEND_MARKETING, VIEW_REPORTS` · **Empleado** = ninguno · **Cliente** = ninguno.
- **Guards:** `@Permissions(A, B)` exige **todos**; `@AnyPermission(A, B)` exige **al menos uno**; "Super Admin" pasa siempre. `BranchGuard` limita las rutas `:branchId` a la sucursal del usuario (salvo `ALL_BRANCHES`).
- **JWT:** el access token lleva `role`, `permissions` y `branchId`; `JwtStrategy` arma `req.user` **sin consultar la BD**. Los cambios de rol/permisos se ven al renovar el token (≤15 min) o al re-loguearse; un usuario eliminado sigue siendo válido hasta que expire su token. Tokens antiguos sin `permissions` dan 401.
- **Refresh token** (arreglado): se firma con `JWT_REFRESH_SECRET` y en BD se guarda su hash SHA-256; rota en cada refresh.
- **Personal ("staff")** = usuarios con `branchId`. `POST/PATCH /users/staff`: solo se puede asignar un rol cuyos permisos sean subconjunto de los propios (anti-escalada); quien no tiene `ALL_BRANCHES` queda limitado a su sucursal y no puede editarse a sí mismo. `GET /roles/assignable` devuelve los roles asignables.
- **Recuperar contraseña (código OTP, sin enlaces):** flujo de 3 pasos en una sola pantalla, `/auth/forgot-password` (`ForgotPasswordForm`):
  1. **Correo** → `POST /auth/forgot-password { email }`. Responde siempre igual, exista o no la cuenta. Genera un OTP de **6 dígitos** (`crypto.randomInt`, con ceros a la izquierda; se guarda como texto) con **vencimiento de 10 minutos** y lo envía por correo. Si ya hay un código con más de 5 min de vigencia, "reenviar" manda el mismo (no invalida el correo anterior ni reinicia los intentos).
  2. **Código** → `POST /auth/verify-otp { email, otp }`. Devuelve `{ success: true }` sin consumir el código, o 400 "El código no es válido o ya venció". El front solo avanza al paso 3 si responde 200.
  3. **Nueva contraseña** → `POST /auth/reset-password { email, otp, newPassword }`. Vuelve a validar el código, guarda la contraseña (bcrypt), **borra el OTP en esa misma escritura** (un solo uso) y cierra las sesiones abiertas. Si falla por contraseña débil, el front se queda en el paso 3; solo vuelve al paso 2 si el código dejó de ser válido. Al terminar muestra un aviso y redirige a `/auth/login`.
  - **Límite estricto: 5 intentos fallidos.** `verify-otp` y `reset-password` comparten la validación (`assertValidOtp`): cada código erróneo suma un intento y al llegar a 5 el OTP se anula (hay que pedir otro). Sin este límite, un código de 6 dígitos se adivinaría por fuerza bruta.
  - El correo se busca sin distinguir mayúsculas y `email`/`otp` se recortan (`trim`). El `otp` es siempre `string`, nunca número.
  - Sin SMTP configurado, en desarrollo el código se imprime en el log de la API.
- **Bloqueo de login:** 3 contraseñas incorrectas seguidas bloquean la cuenta **5 minutos** (`loginAttempts`, `lockedUntil`). Estando bloqueada se responde **429** aunque la contraseña sea correcta; pasado el tiempo el conteo empieza de cero y un login correcto lo reinicia. Es por cuenta (no por IP) y solo aplica a correos registrados.
- **Mi cuenta (`/account`, cliente autenticado):** enlace con icono de usuario en el Header; sin sesión redirige a `/auth/login?redirect=/account`. Layout de dashboard (menú lateral; pestañas arriba en móvil) con dos secciones:
  - **Mi perfil:** `ProfileTab` (nombre, apellido, teléfono, select de **sucursal favorita** entre las activas; el correo es de solo lectura; `PATCH /users/me` y luego refresca el perfil en Redux) y `ChangePasswordCard` ("Seguridad": contraseña actual + nueva + confirmación con lista de requisitos; `PATCH /users/me/password`, limpia los campos al éxito y muestra el error de la API).
  - **Mis direcciones:** `AddressesTab` con tarjetas (predeterminada resaltada) y acciones "Marcar como predeterminada", "Editar" y "Eliminar" (con `window.confirm`). "Nueva dirección"/"Editar" abren `AddressModal`, que **reutiliza `checkout/AddressMap`** (Leaflet centrado en Santa Cruz); hay que mover el pin para guardar.
  - **Validaciones del backend:** `phone` = 7–20 caracteres (dígitos, `+`, espacios, guiones; vacío lo borra); `preferredBranchId` debe ser una sucursal **activa** (`null` la quita); `PATCH /users/me/password` responde **400** (no 404) si la contraseña actual es incorrecta, si la nueva es débil o si es igual a la actual. Mensajes en español.
  - La sucursal favorita **solo se guarda**: aún no la usa el envío de campañas de marketing.
- **Frontend:** `user` en Redux = `{ id, email, phone, preferredBranchId, role: {id, name}, permissions[], branchId, employeeDiscount, ... }`. Header y `AdminShell` llaman a `GET /users/me` para refrescarlo (el login no trae `branchId` de forma fiable). `hasPermission`/`canAccessAdmin` en `utils/permissions.ts`.
- **Formularios de auth:** los errores usan `styles.error` (flex, ícono de 20 px). Registro con checklist de contraseña (símbolo válido: `@ $ ! % * ? &`) y `?redirect=` solo a rutas internas. El registro **no envía** el teléfono.

### 4.2 Catálogo y sucursales (tienda)
- **`BranchSelector`** (Header): el cliente elige sucursal (`branchSlice.selectedBranchId`, persistido). Al cambiarla, catálogo, detalle y similares se recargan con `?branchId=`.
- `GET /products?branchId=` y `GET /products/:id?branchId=` devuelven `branchStock`, `effectivePrice` y `discount: { discountPrice, discountPercentage } | null`. `ProductService` (front) pone en `stock` el de la sucursal. `ProductCard`/`ProductDetail`/`CartItem` muestran precio con oferta y tachado el de lista.
- **Detalle:** selector de tallas (obligatorio), cantidad, "Agregar al carrito" y botón **"Probador Virtual 3D"** (placeholder: solo `alert("Próximamente: Probador Virtual")`, no toca el carrito).
- `next.config.ts` permite `images.unsplash.com` y `upload.wikimedia.org`, con `images.unoptimized: true`.

### 4.3 Carrito y checkout
- **Carrito (Redux):** líneas por `productId` + `selectedSize`. Guarda una **copia del producto** con la oferta/stock de la sucursal elegida; `syncCartProducts` la refresca al abrir el carrito, cambiar de sucursal y pasar al pago. `useCart` calcula `totals` (lista, descuento de productos, descuento de empleado, total).
- **Checkout en 3 pasos: Entrega → Pago → Completado.**
  - **Entrega (`DeliveryStep`):** `PICKUP` (retiro; envío $0) o `DELIVERY`. La sucursal es obligatoria y es la misma del Header. Con delivery: pestañas **"Mis Direcciones"** (guardadas, con predeterminada y eliminar) y **"Nueva Dirección"** (mapa Leaflet centrado en Santa Cruz `-17.7833, -63.1821`, marcador arrastrable, clic en el mapa, "Usar mi ubicación", formulario de calle/referencia y casilla "Guardar en mis direcciones").
  - `AddressMap` se carga con `dynamic(..., { ssr: false })` y el ícono del marcador viene del CDN de unpkg (`leaflet@1.9.4`), no de imports de imágenes (rompían con Turbopack).
  - **Pago:** al elegir el método se crea la orden y el PaymentIntent. `POST /orders` recibe por ítem solo `productId, quantity` (el `price` se ignora), más `fulfillmentType`, `branchId`, `shippingAddress`, `latitude`, `longitude`. El monto mostrado y cobrado es el `total` que devuelve el backend. Si falla la creación, se muestra el error y no se reintenta en bucle.
- Al pagar: `window.alert` temporal → paso 3 → se vacía el carrito.

### 4.4 Pedidos, pagos y facturas
- `OrdersService.create` calcula precios en el servidor con el inventario de la sucursal, valida y descuenta stock **de forma atómica** por sucursal (con `branchId`) o el stock global (sin él), aplica el descuento de trabajador y guarda `discountApplied`. Cancelar (solo `PENDIENTE`) devuelve el stock a la sucursal.
- Sin `ALL_BRANCHES`, las rutas `orders/admin/*` filtran por la sucursal propia.
- **Factura PDF:** `InvoiceService` (módulo `invoices`) tiene `generateOrderInvoice(orderId)` y `renderInvoice(data)` (independiente de Prisma, para reutilizar en el futuro POS). Al confirmar el pago (`PaymentsService.confirmPayment`) se genera y se envía por correo al cliente, sin bloquear la respuesta.

### 4.5 Panel administrativo (`/admin`)
Layout protegido (`AdminShell`): sin sesión → login; sin ningún permiso de panel → `/`. El menú lateral se arma por permisos (`adminNav.ts`); cada página se protege con `PermissionGate`.

| Ruta | Permiso | Qué hace |
|---|---|---|
| `/admin/products` | `MANAGE_PRODUCTS` | Tabla (imagen, nombre/SKU, categoría, tallas, precio, estado) con búsqueda y paginación; modal crear/editar (nombre, descripción, categoría, SKU, **precio**, tallas, imagen URL, activo) y botón placeholder **"Cargar modelo 3D (BETA)"** (solo `alert`). |
| `/admin/inventory` | `MANAGE_INVENTORY` | Stock **y** oferta (`discountPrice`/`discountPercentage`) por sucursal en una sola fila. Con `ALL_BRANCHES`: elige sucursal y botón "Aplicar descuento a todas las sucursales". |
| `/admin/orders` | `VIEW_ORDERS` | Estado, tipo de entrega, sucursal y total; cambio de estado y cancelación de pendientes. |
| `/admin/branches` | `MANAGE_BRANCHES` | Listado y modal crear/editar (crear y activar/desactivar requieren `ALL_BRANCHES`). |
| `/admin/staff` | `MANAGE_USERS` | Empleados con rol dinámico, sucursal (selector solo con `ALL_BRANCHES`) y descuento de trabajador. |
| `/admin/roles` | `MANAGE_ROLES` | Tabla de roles y formulario con checkboxes de permisos. |
| `/admin/marketing` | `SEND_MARKETING` | Asunto + mensaje; con `ALL_BRANCHES` elige audiencia (todas o una sucursal), si no, queda fija en la propia. |
| `/admin/reports` | `VIEW_REPORTS` | Pestañas "Métricas Generales" (tarjetas, gráfico de barras, top productos) y "Pregúntale a la IA". |

### 4.6 Marketing por correo
`POST /marketing/send-campaign` `{ subject, htmlBody, branchId? }` (permiso `SEND_MARKETING`). Audiencia: con `ALL_BRANCHES`, todos los usuarios o los clientes de una sucursal; sin él, siempre usuarios con **al menos un pedido** en su sucursal (otra sucursal → 403). Un correo individual por destinatario, en lotes de 10, dentro de la misma petición; devuelve `{ audience, recipients, sent, failed }`. El HTML se sanea (sin `<script>`, `<iframe>`, `on*=`, `javascript:`). El front convierte el textarea a HTML.

### 4.7 Correo (SMTP)
`MailModule` global con `MailService` (bienvenida, recuperación, factura, campañas). **Ningún método lanza error**: los fallos se registran en el log. Con `SMTP_USER` el transporte es Gmail por defecto (`smtp.gmail.com`); sin `SMTP_HOST` ni `SMTP_USER` se usa un transporte simulado (no envía nada; solo log). El endpoint temporal de prueba `GET /auth/test-email` **fue eliminado**. Ver variables en §6.3.

### 4.8 Reportes y consultas con IA
- **Genéricos** (Prisma): `GET /reports/sales-overview` (ingresos, pedidos por estado, ticket promedio, descuentos, ventas por día) y `GET /reports/top-products`; parámetros `branchId`, `from`, `to`, `limit`. "Ingresos" = pedidos pagados (`PROCESANDO`, `ENVIADO`, `ENTREGADO`). Sin `ALL_BRANCHES` se fuerza la sucursal propia (otra → 403).
- **Dinámicos** `POST /reports/dynamic { prompt }` (Gemini Text-to-SQL). Flujo: Gemini genera un SELECT → `validateGeneratedSql` (solo SELECT, una sentencia, sin comentarios ni comillas dobles, lista negra de palabras, **lista blanca de funciones**) → ejecución **aislada en la BD**: transacción de solo lectura, `SET LOCAL ROLE storefront_reports` (solo lee las 7 vistas del esquema `reporting`, sin contraseñas/tokens/correos), `search_path = reporting`, timeout de 5 s y 500 filas. El **filtro de sucursal lo aplican las vistas** leyendo la variable de sesión `app.branch_id` (`'*'` = todas; sin valor = ninguna fila). Devuelve `{ sql, columns, rows, rowCount }`. En la UI (`DynamicReportPanel`), mientras responde: input, botón, micrófono y ejemplos quedan deshabilitados, el botón muestra `Loader2` girando + "Procesando..." y aparece un aviso con pulso "Analizando datos y generando reporte..." (clases `.spinner`, `.loadingButton`, `.aiLoadingState` en `admin-table.module.scss`).
- El prompt de sistema (`report-prompt.ts`) describe solo las vistas en `snake_case`. Modelo por defecto `gemini-2.5-flash` (`GEMINI_MODEL`). Sin `GEMINI_API_KEY` responde 503.
- El front (`DynamicReportPanel`) muestra los resultados iterando `Object.keys/values`, con el SQL ejecutado en un desplegable y **dictado por voz** (`useSpeechRecognition`, Web Speech API, `es-BO`; requiere Chrome/Edge/Safari y `localhost` o HTTPS; solo transcribe, el usuario pulsa "Preguntar").

### 4.9 Contrato front ↔ API (puntos importantes)

| Tema | Detalle |
|---|---|
| URL base | `NEXT_PUBLIC_API_URL=http://localhost:3001/api/v1` |
| Pago | `POST /payments/create-intent` y `POST /payments/confirm` (`{ orderId, paymentIntentId }`) |
| Pedido | `items[].{productId, quantity}` (+ `selectedSize` se elimina antes de enviar) |
| Refresh | El refresh token va en `Authorization: Bearer`, no en el body |
| Errores | `error.utils.ts` → `getApiErrorMessage` convierte cualquier error en un mensaje en español |

### 4.10 Endpoints de la API (referencia rápida; detalle en Swagger)
- **auth:** `POST /auth/register|login|refresh|logout|forgot-password|verify-otp|reset-password`
- **users:** `GET /users/me`, `PATCH /users/me`, `PATCH /users/me/password`, `DELETE /users/me`, `GET|DELETE /users/:id` y `GET /users` (`MANAGE_USERS`+`ALL_BRANCHES`), `GET|POST /users/staff`, `PATCH /users/staff/:id` (`MANAGE_USERS`), `GET|POST /users/me/addresses`, `PUT|PATCH|DELETE /users/me/addresses/:id` (PUT y PATCH editan), `PATCH /users/me/addresses/:id/default` (marca la principal y quita el flag a las demás, en una transacción)
- **branches:** `GET /branches` (activas, público), `GET /branches/:id`, `GET /branches/manage/all`, `POST` y `DELETE` (`MANAGE_BRANCHES`+`ALL_BRANCHES`), `PATCH /branches/:id`, `GET|PUT /branches/:branchId/inventory[/:productId]` (`PUT` acepta `stock`, `discountPrice`, `discountPercentage`)
- **roles:** `GET|POST /roles`, `GET /roles/assignable`, `GET|PATCH|DELETE /roles/:id`
- **products:** `GET /products[?branchId]`, `GET /products/:id[?branchId]`, `POST|PATCH|DELETE` (`MANAGE_PRODUCTS`), `PUT /products/:productId/discounts/bulk` (`MANAGE_INVENTORY`+`ALL_BRANCHES`), `PATCH /products/:id/stock` (`MANAGE_PRODUCTS`+`ALL_BRANCHES`, stock global legado)
- **categories:** `GET` públicos; `POST|PATCH|DELETE` (`MANAGE_PRODUCTS`)
- **cart:** `GET /cart[?branchId]`, `POST /cart/items`, `PATCH|DELETE /cart/items/:itemId`, `DELETE /cart`
- **orders:** `POST|GET /orders`, `GET|PATCH|DELETE /orders/:id`, y `GET|PATCH|DELETE /orders/admin/...` (`VIEW_ORDERS`)
- **payments:** `POST /payments/create-intent|confirm`, `GET /payments[/:id]`, `GET /payments/order/:orderId`
- **marketing:** `POST /marketing/send-campaign`
- **reports:** `GET /reports/sales-overview|top-products`, `POST /reports/dynamic` (`VIEW_REPORTS`)

---

## 5. Limitaciones conocidas y deuda técnica

### 5.1 Pendientes explícitos
1. **Stripe real:** `STRIPE_SECRET_KEY=sk_test_xxx` es un relleno; poner la clave real en `api/.env` y la pública en `front/.env`. Un 401 de Stripe hace que el interceptor del front intente refrescar sesión.
2. **SMTP real:** sin `SMTP_HOST`/`SMTP_USER` los correos (bienvenida, recuperación, factura, campañas) **no salen**, solo se registran. Configurar `MAIL_FROM`, `SMTP_*` (Mailtrap/Ethereal para pruebas; SPF/DKIM en producción).
3. **`GEMINI_API_KEY`:** no está configurada; la llamada real a Gemini **nunca se ha probado** (el resto del motor se probó con SQL simulado). El SDK `@google/generative-ai` es el legado; Google recomienda `@google/genai`.
4. **Talla en `OrderItem`:** la talla elegida vive solo en el carrito del front y no se guarda en el pedido.
5. **`POST /payments/create-intent` cobra el `amount` que manda el cliente** (el front ya envía el total correcto del backend, pero el servidor no lo verifica contra la orden).
6. **Stock:** se descuenta al crear la orden (antes del pago); si el pago se abandona no se restituye (solo al cancelar un pedido pendiente).

### 5.2 Otros problemas y límites (no urgentes)
- **Permisos en el JWT:** cambios de rol/permisos y usuarios eliminados tardan hasta 15 min en surtir efecto; las sesiones abiertas antes de un cambio de permisos necesitan re-login (p. ej. `SEND_MARKETING`, `VIEW_REPORTS`, `MANAGE_PRODUCTS`).
- **Sin cierre de sesión forzado** al eliminar una cuenta: su token sigue válido hasta expirar.
- **Text-to-SQL:** el validador es por expresiones regulares; lo que da la seguridad es el rol de solo lectura + las vistas. En producción el usuario de la BD debe poder hacer `SET ROLE storefront_reports` (la migración hace el `GRANT`). Cada pregunta envía a Gemini solo el esquema y la pregunta, no los datos.
- **Marketing:** se envía dentro de la petición (10 en paralelo); con miles de destinatarios conviene una cola. Sin enlace de baja (unsubscribe).
- **Cambio de contraseña (`PATCH /users/me/password`):** no cuenta intentos fallidos de la contraseña actual (el bloqueo de 3 intentos solo aplica al login).
- **Mapa:** mosaicos del servidor público de OpenStreetMap (solo apto para desarrollo/tráfico bajo). No se valida que la ubicación esté dentro de Santa Cruz.
- **Admin Sucursal** puede administrar también categorías (mismo permiso `MANAGE_PRODUCTS`).
- **Facturas:** los precios ya incluyen las ofertas vigentes; no muestran el precio de lista tachado. Moneda `$`.
- **Throttling:** `ThrottlerModule` y sus decoradores existen, pero no hay `ThrottlerGuard` global registrado → probablemente **no se aplica**.
- **Rutas del front que no existen:** el botón "Ver mis pedidos" del checkout va a `/user/orders` → 404 (no hay panel de cliente).
- **Checkout:** el paso "Procesando" ya no existe; sigue el `window.alert` tras pagar.
- **Persistencia:** carritos guardados en el navegador con el formato anterior pierden la oferta hasta sincronizarse con una sucursal.
- **Detalles de UI:** `Breadcrumbs.tsx` y `Footer.tsx` importan `Link` de `lucide-react` en vez de `next/link`; el modo oscuro de `globals.css` casi no cambia colores; hay dos SCSS casi idénticos (`product-detail-client-module.scss` y `.module.scss`).
- **Lint (preexistente):** `next lint` marca `any` en `useOrder.ts`, `product.service.ts` (`filter`) y `CheckoutClient.tsx`, y `User.id: String` en `auth.types.ts`.
- **Backend:** los `*.spec.ts` son plantillas por defecto de Nest y no se han ejecutado (hay además dos configs de Jest: `jest.config.js` y `.ts`); `npm install` requiere `--legacy-peer-deps` porque `@nestjs/throttler@6` declara compatibilidad hasta Nest 11.
- **Git:** solo existe el commit `v1.0.0`; todo el trabajo posterior está sin commitear.

---

## 6. Guía rápida para levantar el entorno

### 6.0 Requisitos
Node ≥ 20 (probado con v24), npm, PostgreSQL local en el puerto 5432. `bun` está instalado y el frontend usa `bun.lock` (las dependencias `leaflet`, `react-leaflet`, `recharts` se agregaron con `bun add`); `npm install` también funciona.

### 6.1 Primera vez

**Base de datos:** crear una base vacía (p. ej. `ecommerce_si2`).

**Backend** (`api/`):
```bash
cd api
npm install --legacy-peer-deps
# crear api/.env  (ver api/.env.example)
npx prisma migrate deploy
npx prisma generate
npm run seed        # roles, sucursales, usuarios, categorías y productos con stock
```

**Frontend** (`front/`):
```bash
cd front
npm install          # o: bun install
# crear front/.env  (ver front/.env.example)
```

### 6.2 Arrancar (dos terminales)
```bash
# Terminal 1 — API → http://localhost:3001/api/v1  (Swagger: /api/docs)
cd api && npm run dev          # nest start --watch

# Terminal 2 — Frontend → http://localhost:3000
cd front && npm run dev
```
Primero la API y luego el front. Comprobar: `http://localhost:3001/api/v1/branches` (200) y `http://localhost:3000/` (catálogo).

### 6.3 Variables de entorno

**`api/.env`** (ignorado por git)
| Variable | Uso |
|---|---|
| `PORT`, `NODE_ENV`, `ALLOWED_ORIGINS` | Servidor y CORS (`http://localhost:3000`) |
| `DATABASE_URL` | `postgresql://USUARIO:CONTRASENA@localhost:5432/ecommerce_si2` |
| `JWT_SECRET`, `JWT_REFRESH_SECRET`, `JWT_EXPIRES_IN` | Firmas JWT (el refresh usa su propio secreto) |
| `STRIPE_SECRET_KEY` | Clave secreta de Stripe (`sk_test_...`) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` | Servidor de correo. Con `SMTP_HOST` vacío no se envía nada real |
| `MAIL_FROM` | Remitente que ven los clientes, p. ej. `"Stella Femme <ventas@tudominio.com>"` (con Gmail debe ser la misma cuenta de `SMTP_USER`) |
| `FRONTEND_URL` | URL pública de la tienda (enlaces de los correos), `http://localhost:3000` en local |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | IA de reportes (clave en https://aistudio.google.com/apikey; modelo por defecto `gemini-2.5-flash`) |

**`front/.env`** (ignorado por git)
| Variable | Uso |
|---|---|
| `NEXT_PUBLIC_API_URL` | `http://localhost:3001/api/v1` |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Clave pública de Stripe (`pk_test_...`) |

> Las credenciales reales (PostgreSQL, Stripe, SMTP, Gemini) **no se documentan aquí**: están solo en los `.env` locales. Las variables se leen al arrancar: reiniciar la API tras cambiarlas.

### 6.4 Comandos útiles
| Dónde | Comando | Para qué |
|---|---|---|
| `api/` | `npm run build` | Compilar (`nest build`) |
| `api/` | `npx tsc --noEmit -p tsconfig.json` | Verificar tipos |
| `api/` | `npm run seed` | Recargar roles, sucursales, usuarios y datos (idempotente) |
| `api/` | `npx prisma studio` | Explorar la BD |
| `front/` | `node node_modules/typescript/bin/tsc --noEmit` | Verificar tipos |
| `front/` | `npm run build` | Build de producción (no correrlo con `npm run dev` activo: comparten `.next`) |

### 6.5 Problemas frecuentes (Windows)
- **Puertos ocupados / procesos huérfanos:** al detener `npm run dev` pueden quedar procesos `node`. En PowerShell:
  ```powershell
  Get-NetTCPConnection -LocalPort 3000,3001 -State Listen | Select -Expand OwningProcess -Unique | % { Stop-Process -Id $_ -Force }
  ```
- **Cambios en `schema.prisma` con la API corriendo:** el modo watch se cae; tras `migrate deploy` + `generate`, reiniciar `npm run dev`.
- **Sesión "vieja" en el navegador:** Redux persiste en `localStorage`; si hay comportamientos raros de sesión (o tras cambios de permisos), cerrar sesión o borrar el almacenamiento del sitio.
- **El ícono del panel no aparece:** el rol del usuario no tiene ningún permiso de panel, o la sesión es anterior al cambio de permisos (volver a iniciar sesión).

---

## 7. Historial de cambios (resumen)

1. **Sucursales, inventario y descuento de trabajador:** modelos `Branch`/`ProductInventory`, roles del enum, carrito y órdenes con stock por sucursal, `fulfillmentType`, precios calculados en el servidor.
2. **Frontend multi-sucursal:** selector de sucursal, checkout Entrega/Pago, panel `/admin` (sucursales, staff, inventario, pedidos).
3. **Descuentos por sucursal:** `discountPrice`/`discountPercentage` pasan a `ProductInventory`; descuento masivo del Super Admin.
4. **Roles dinámicos con permisos** (`Role`, `PermissionsGuard`, JWT con permisos, `/admin/roles`); arreglo del refresh token.
5. **Direcciones guardadas con mapa** (Leaflet), lat/lng en la orden; gestión completa en **Mi cuenta** (`/account`), con perfil, sucursal favorita y cambio de contraseña.
6. **Correos y facturas:** recuperación de contraseña (OTP de 6 dígitos), bienvenida, factura PDF al pagar, marketing (`/admin/marketing`).
7. **Reportes:** métricas con Recharts y Text-to-SQL con Gemini aislado por rol/vistas; dictado por voz.
8. **Catálogo desde el panel** (`/admin/products`) con placeholders de modelo 3D y probador virtual.
9. **Registro:** 409 en correo duplicado, `phone` guardado, correo de bienvenida a prueba de fallos.

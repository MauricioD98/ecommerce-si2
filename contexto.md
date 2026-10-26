# CONTEXTO — STELLA FEMME

> Documento maestro para que un LLM pueda retomar este proyecto y tomar decisiones informadas sin tener que releer todo el código. Actualizado el 2026-10-24 a partir del estado real del repo (rama `main`, HEAD `ae38fe1`).
>
> **Regla de mantenimiento:** si cambias esquema, rutas, permisos, puertos o dependencias, actualiza este archivo en el mismo commit. Si algo aquí contradice el código, **el código manda** — este documento puede quedar desactualizado.
>
> **Advertencia sobre el propio repo:** el estado de git puede estar muy adelantado respecto a lo que sugiera cualquier snapshot o resumen previo (incluido este documento con el tiempo). Antes de asumir nada crítico, corre `git log --oneline -20` y `git status --short` para confirmar dónde está realmente HEAD.

---

## 1. Qué es el proyecto

**Stella Femme** es un e-commerce **multi-sucursal** de ropa femenina, con sucursales físicas en Santa Cruz de la Sierra, Bolivia. Cubre: catálogo con stock y ofertas por sucursal y por talla, carrito, checkout (retiro en tienda o envío a domicilio con mapa), pago con Stripe **o QR simulado**, punto de venta físico (POS) en caja, **devoluciones con reingreso a stock o mermas**, **probador virtual en tiempo real con Decart**, **chatbot de Botpress**, correos transaccionales, notificaciones push, facturas en PDF, un **dashboard administrativo** con roles/permisos dinámicos, marketing por correo, reportes con IA, una **PWA offline-first** y una **app móvil Expo** independiente que consume la misma API.

Es un monorepo sin workspaces: `front/`, `api/` y `app_movil/` son proyectos autónomos, cada uno con su propio `package.json`, lockfile y `.env`.

### 1.1 Stack tecnológico (versiones reales, confirmadas en `package.json`)

| Capa | Tecnología |
|---|---|
| Frontend web | **Next.js 16.3.4** (App Router, Turbopack) · **React 19.2.8** · TypeScript |
| Estilos (front) | SCSS / CSS Modules (`.module.scss` por componente) + variables en `app/globals.css` |
| Estado (front) | Redux Toolkit + `redux-persist` (`auth`, `cart`, `branch`) |
| HTTP (front) | Axios (`service/api/axios.config.ts`) |
| Pagos (front) | `@stripe/react-stripe-js` + `@stripe/stripe-js` (`PaymentElement`) + flujo QR propio |
| Mapas | `leaflet` + `react-leaflet` (mosaicos OpenStreetMap) |
| Gráficos / export | `recharts`, `jspdf` + `jspdf-autotable`, `xlsx` |
| PWA offline | Service Worker manual (`front/public/sw.js`), IndexedDB para cola de pedidos offline |
| Backend | **NestJS 12** · TypeScript · Swagger · class-validator · Passport JWT |
| ORM / BD | **Prisma 7.1** (`@prisma/adapter-pg`) · PostgreSQL (Neon en producción) |
| Pagos (back) | SDK `stripe` 22.6 (PaymentIntents + webhook firmado) + `qrcode` (QR simulado) |
| Correo (back) | `@nestjs-modules/mailer` + `nodemailer` (SMTP) |
| PDF (back) | `pdfkit` (facturas) |
| Push (back) | `web-push` (VAPID, Web Push estándar) |
| IA (back) | SDK `openai` contra **Groq** (no Gemini — migrado, ver §4.7) |
| Probador virtual (front) | `@decartai/sdk` 0.2.3 · modelo realtime `lucy-vton-latest` (Decart) vía Route Handlers de Next |
| Chatbot | Widget Botpress Webchat v3.7 en el front + endpoint público `GET /chatbot/products` en la API |
| Tareas programadas (back) | `@nestjs/schedule` (`ScheduleModule.forRoot`) — cron de liberación de carritos abandonados |
| App móvil | **Expo ~57.0.24**, **React Native 0.86.3**, React 19.2.3, React Navigation 7, AsyncStorage |
| Infra | Docker (`api/Dockerfile`, `front/Dockerfile`, `docker-compose.yml`) · deploy real en **Azure Container Apps** con BD **Neon** |

**Reglas de producto que hay que respetar**
- Toda la interfaz está en **español latinoamericano**. La marca es **"Stella Femme"** (no usar el nombre anterior "STOREFRONT").
- El precio final **siempre lo calcula el backend** (cliente nunca decide precios/descuentos/montos a cobrar).
- No cambiar lógica de negocio al "arreglar" estilos o textos.

**Puertos y URLs (desarrollo local)**

| Servicio | URL |
|---|---|
| Frontend | `http://localhost:3000` |
| API | `http://localhost:3001/api/v1` (prefijo global en `api/src/main.ts`) |
| Swagger | `http://localhost:3001/api/docs` |
| PostgreSQL local | `localhost:5432` |

**Producción:** API y front corren en **Azure Container Apps** (contenedores propios, ver `docker-compose.yml` y los `Dockerfile`); la base de datos real parece ser **Neon** (mencionado en `app_movil/README.md` y en el mensaje del commit `239dd94`). `main.ts` permite explícitamente orígenes que contengan `azurecontainerapps.io`.

**Páginas de la tienda (web):** `/` (catálogo) · `/{productId}` (detalle, con Probador Virtual) · `/cart` · `/checkout` (con paso QR en `/checkout/qr-confirm`, retorno de Stripe en `/checkout/success` y página estática `/checkout/offline-success`) · `/account` (+ `/account/orders/[id]`) · `/auth/login|register|forgot-password|reset-password` · `/offline` (fallback de la PWA).
**Panel (`/admin`):** `pos`, `returns`, `products`, `categories`, `collections`, `inventory`, `orders`, `branches`, `staff`, `roles`, `marketing`, `notifications`, `reports`, `settings/payments`, `settings/appearance`.

---

## 2. Estructura del repositorio

```
si2_parcial_1/
├── contexto.md            ← este archivo
├── docker-compose.yml      ← orquesta api (3001) + front (3000) en una red bridge
├── front/                  ← Next.js 16 (proyecto autónomo, usa bun; bun.lock)
├── api/                    ← NestJS 12 + Prisma 7 (proyecto autónomo, usa npm; package-lock.json)
└── app_movil/              ← Expo ~57 / React Native (cliente móvil independiente de la misma API)
```

### 2.1 Avisos importantes por carpeta (archivos `AGENTS.md` reales del repo)
- **`front/AGENTS.md`** (incluido vía `front/CLAUDE.md`): *"Esta NO es la versión de Next.js que conoces"* — Next 16 tiene cambios que rompen compatibilidad con lo que un LLM pueda "saber" de memoria. Antes de escribir código en `front/`, revisar `front/node_modules/next/dist/docs/`. Este bloque lo regenera `next dev` automáticamente.
- **`app_movil/AGENTS.md`**: *"Expo HA CAMBIADO"* — revisar la documentación versionada exacta de Expo 57 (`https://docs.expo.dev/versions/v57.0.0/`) antes de escribir código ahí.
- `api/` no tiene `AGENTS.md`/`CLAUDE.md` propios (solo el `README.md` boilerplate de Nest, sin info útil del proyecto).

### 2.2 Frontend (`front/`)

```
app/
  layout.tsx, globals.css, fonts.ts, manifest.ts, offline/, error.tsx, global-error.tsx
  (lading)/page.tsx            ← "/" catálogo (carpeta con typo histórico "lading")
  (product)/[id]/page.tsx      ← detalle de producto (monta el Probador Virtual)
  auth/ login | register | forgot-password | reset-password
  cart/, checkout/ (+ qr-confirm/, success/, offline-success/)
  account/ (+ orders/[id]/)     ← historial de pedidos del cliente (antes era un 404, ya resuelto)
  admin/                        ← pos/, returns/, products/, categories/, collections/, inventory/,
                                   orders/, branches/, staff/, roles/, marketing/, notifications/, reports/
  api/decart/                   ← Route Handlers de Next: firman la sesión del probador y proxean
                                   la imagen de la prenda (la API key de Decart no llega al navegador)
components/modules/
  auth/, account/, landing/, product/, cart/, checkout/, admin/, chatbot/
  (uno por dominio, + .module.scss). product/ incluye VirtualTryOnModal; chatbot/ el widget Botpress.
providers/   index.tsx (StateProvider + OfflineSyncProvider), OfflineSyncProvider.tsx, state-provider.tsx
hooks/       useAuth, useCart, useOrder, useMyOrders, useOrderDetail, usePayment, useProducts,
             useBranches, useAddresses, useSpeechRecognition, useAdminAccess/Branches/Categories/
             Collections/Orders/Products, useInventory, useOfflineInventorySync, useStaff, useRoles,
             useReports, useReturns, usePushNotifications, useOfflineOrderSync, useNetworkStatus,
             useRegisterServiceWorker
service/api/ axios.config + un *.service.ts por módulo del backend (incluye returns.service), error.utils
store/       index.tsx (Redux store + persist), slices/authSlices, cartSlice, branchSlice
utils/       pricing.ts (espejo del cálculo del backend), permissions.ts, offlineOrderQueue.ts,
             offlineInventoryQueue.ts, productStorage.ts, printPosReceipt.ts
types/       *.types.ts por dominio (incluye returns.types)
public/sw.js ← Service Worker manual (ver §4.10)
```
Alias `@/*` → raíz de `front/`. Gestor de paquetes: **bun** (`packageManager: bun@1.4.0`, `bun.lock`); `npm install` también funciona pero no es el flujo principal.

### 2.3 Backend (`api/`)

```
prisma/     schema.prisma · migrations/ (24 migraciones) · seed.mjs · prisma.config.ts
src/
  main.ts        ← prefijo api/v1, rawBody:true (webhook Stripe), ValidationPipe global, CORS, headers no-cache, Swagger
  app.module.ts  ← ConfigModule global, ThrottlerModule, ScheduleModule, todos los módulos (ver lista abajo)
  prisma/        ← PrismaService (adapter-pg)
  common/
    constants/permissions.ts   ← catálogo de permisos y roles base (ver §4.1)
    decorators/                ← GetUser, @Permissions/@AnyPermission, guards (Jwt, Permissions, Branch), throttlers
    utils/                     ← pricing.ts, permission.util.ts, token-hash.ts
  modules/
    auth · users (+ addresses) · products · category · collections · cart (+ CartCleanupService) · orders
    payments (+ webhook, dto/qr-payment) · branches (+ InventoryService) · roles · mail · marketing
    reports · pos · notifications · returns · chatbot
```
`ValidationPipe` global: `whitelist: true`, **`forbidNonWhitelisted: false`** (cambió — antes era `true`; ver §5), `transform: true`. Es decir: los campos que no están en el DTO se **descartan silenciosamente**, ya no dan 400 (se cambió a propósito para no romper el catálogo con parámetros extra como `_t`, commit `feb64e6`).

Gestor de paquetes: **npm** (`api/package-lock.json`). Desde el commit `6645f77` también está trackeado `api/bun.lock`, así que hoy conviven los dos lockfiles (la misma inconsistencia existe en `front/`, donde están `bun.lock` y `package-lock.json`). `api/package.json` está limpio, sin cambios pendientes de line-endings. Ver §5.1.5.

### 2.4 App móvil (`app_movil/`)

Cliente Expo/React Native independiente, **no** un simple wrapper — tiene pantallas propias para todo el flujo de compra, conectado a la **misma API NestJS**.

```
src/
  screens/  auth/{Login,Register}, shop/{Products,ProductDetail}, cart/{Cart,Checkout},
            orders/{Orders,OrderDetail}, payments/Payment, profile/{Profile,EditProfile,ChangePassword}
  context/  AuthContext, BranchContext (selector de sucursal, igual que en el front web), CartContext
            (carpeta en singular, no `contexts/`)
  api/      client.ts (axios) + *.api.ts por módulo (auth, branches, cart, categories, orders, payments, products, users)
            client.ts renueva el access token con el refresh token, encola las peticiones concurrentes
            y, si el refresh falla, limpia la sesión y dispara auto-logout (`setOnAuthFailureCallback`)
  config/env.ts  ← por defecto apunta a la API de Azure Container Apps (`CLOUD_API_URL`); si había una
                    URL vieja guardada (localhost/10.0.2.2/IP LAN) la migra a la nube. Sigue siendo
                    editable en runtime desde Login/Profile.
```
- **No existe `eas.json`** en disco (no hay config de EAS Build/Submit pese a lo que pudiera sugerir cualquier snapshot antiguo del repo).
- `app_movil/README.md` menciona cuentas de prueba (`admin@gmail.com` / `Admin123*`, `john.doe@example.com`) **distintas** a las del seed del backend (`superadmin@stellafemme.com`, etc.) y una BD Neon propia para desarrollo — **tratar esas credenciales del README con sospecha**, pueden estar desactualizadas; confiar en `api/prisma/seed.mjs` como fuente de verdad para usuarios de prueba.
- Cambios recientes (ver `git log`): selector de sucursal en el catálogo sincronizado con el stock, auto-refresh de stock al enfocar la pantalla, redirect al catálogo tras pagar, fix de un bug de `setState` durante el render al resetear la navegación, sincronización de stock de la compra móvil contra la sucursal (`4a6f91b`) y auto-logout limpio al expirar la sesión / faltar refresh token (`ae38fe1`).

---

## 3. Base de datos (Prisma / PostgreSQL)

Archivo: `api/prisma/schema.prisma`. 16 modelos: `Role`, `User`, `UserAddress`, `Product`, `Branch`, `ProductInventory`, `Collection`, `Category`, `OrderItem`, `CartItem`, `Order`, `Cart`, `Return`, `ReturnItem`, `PushSubscription`, `Payment` (+ enums `OrderStatus`, `FulfillmentType`, `OrderSource`, `PaymentMethod`, `PaymentStatus`, `ReturnReason`, `ItemCondition`).

| Modelo | Campos clave / notas |
|---|---|
| **Role** | `id`, `name` (único), `description?`, `permissions String[]` |
| **User** | `email` (único), `password` (bcrypt), `firstName?/lastName?/phone?`, `roleId`→Role, `branchId?`→Branch (personal, rel. `StaffBranch`), `preferredBranchId?`→Branch (rel. `PreferredBranch`, `onDelete: SetNull`), `employeeDiscount Int`, `refreshToken?` (hash SHA-256), `resetPasswordOtp?/Attempts/Expires`, `loginAttempts/lockedUntil`, relación `cashierOrders` (`CashierOrders`, ventas que cobró en POS), `returns`/`cashierReturns` (devoluciones como cliente / atendidas como cajero), `pushSubscriptions[]` |
| **Branch** | `name`, `address?`, **`latitude?/longitude?`** (nuevo), `phone?`, `isActive` |
| **Product** | `sizes String[]`, **`colors String[]`** (nuevo, mismo patrón que `sizes`: array simple, no variante independiente), `price`, `stock Int` (global, legado — suma de `ProductInventory`), `sku` (único), `imageUrl?`, `categoryId`, **`branchId?` + `exclusiveToBranch`** (nuevo: `null` = visible en todas las sucursales; con valor, solo esa sucursal lo muestra — **independiente del stock**), relación m2m con **`Collection`** |
| **ProductInventory** | **`@@unique([productId, branchId, size])`** — el stock ahora es **por producto + sucursal + talla** (antes era solo producto+sucursal; cambio de ruptura, migración `..190000_inventory_per_size`). **`damagedStock Int`** (nuevo): mermas, es decir, unidades devueltas en mal estado; no son vendibles, quedan fuera de `stock` y de `Product.stock`, y se gestionan con `InventoryService.incrementDamaged`. `discountPrice`/`discountPercentage` siguen siendo por producto+sucursal (se mantienen sincronizados entre las filas de todas las tallas por el servicio, la oferta no varía por talla) |
| **Collection** *(nuevo modelo)* | `name`, `slug` (único), `description?`, `bannerImageUrl?`, `isActive`, m2m con `Product`. Es ortogonal a `Category`: la categoría es "qué es" la prenda, la colección es "para qué campaña" se exhibe (ej. "Otoño-Invierno") |
| **Category** | Sin cambios: `name`, `slug` (único), `description?`, `imageUrl?`, `isActive` |
| **Cart / CartItem** | `CartItem` único por `(cartId, productId, size)` — una fila por talla — y con **`branchId?`**: la sucursal contra la que se **reservó (descontó) stock al agregar al carrito**; `null` = reserva contra el `Product.stock` global legado. `Cart.updatedAt` se toca en cada cambio y `CartCleanupService` lo usa para detectar abandono |
| **Order** | Campos nuevos: **`shippingCost`** (registro histórico, 0 en PICKUP), **`paymentStatus`** (enum `PaymentStatus`, separado del `status` logístico), **`stripePaymentIntentId`** (único), **`paymentMethod`** (enum: `STRIPE/CASH/PHYSICAL_CARD/QR`), **`source`** (enum `OrderSource`: `WEB/POS`), **`cashierId`** (→ User, null en ventas web), **`nit`/`razonSocial`** (facturación POS). Relación `returns[]` (una venta puede tener varias devoluciones parciales) |
| **OrderItem** | **`size String?`** (ya se guarda la talla comprada). Relación `returnItems[]`; la suma de lo devuelto no puede superar `quantity` |
| **Return** *(nuevo modelo)* | `returnNumber` (único), `totalRefunded` (calculado en servidor desde el precio histórico de cada `OrderItem`), `notes?`, `orderId`, `branchId` (sucursal que **recibe** la mercadería, no necesariamente la que vendió), `userId` (cliente), `cashierId` (empleado que atiende), `items[]` |
| **ReturnItem** *(nuevo modelo)* | `quantity`, `size?` (copiada del `OrderItem`), `unitPrice` (precio histórico), `reason` (enum `ReturnReason`: `WRONG_SIZE/DEFECTIVE/CHANGED_MIND/OTHER`), `condition` (enum `ItemCondition`: `SELLABLE/DAMAGED`), `returnId`, `productId`, `orderItemId`. Un mismo `OrderItem` puede partirse en varias filas si cambia la condición |
| **PushSubscription** *(nuevo modelo)* | `endpoint` (único), `p256dh`, `auth`, `userId?` (cascade delete con User) — suscripción Web Push por dispositivo |
| **Payment** | Sin cambios de esquema respecto al doc anterior |
| **UserAddress** | Sin cambios |

### 3.1 Migraciones nuevas desde el estado anterior (13, ya aplicadas)
`add_push_subscriptions` → `add_order_payment_tracking` → `add_order_shipping_cost` → `add_pos_orders` → `add_item_size` → `add_pos_billing_fields` → `add_product_branch_exclusivity` → `reporting_sales_product_views` → `add_collections_and_colors` → `inventory_per_size` → `add_branch_coordinates` → `cart_item_branch_reservation` (`20260926230000`) → `returns_and_damaged_stock` (`20260927120000`).

Las dos últimas son las que introducen la reserva de stock del carrito (`CartItem.branchId`) y las devoluciones/mermas (`Return`, `ReturnItem`, `ProductInventory.damagedStock`).

Comandos sin cambios: `npx prisma migrate deploy` · `npx prisma generate`. `migrate dev` no sirve cuando el cambio migra datos existentes (se escribe la migración a mano).

### 3.2 Datos iniciales (`npm run seed` en `api/`, idempotente, `api/prisma/seed.mjs`)
Roles base y permisos que asigna el seed (**cambiaron** respecto al doc anterior):

| Rol | Permisos |
|---|---|
| Super Admin | todos (`ALL_PERMISSIONS`) |
| Admin Sucursal | `MANAGE_USERS, MANAGE_INVENTORY, MANAGE_PRODUCTS, VIEW_ORDERS, SEND_MARKETING, VIEW_REPORTS, USE_POS, PROCESS_RETURNS` |
| **Empleado** | **`USE_POS, PROCESS_RETURNS`** (personal de caja: cobra en POS y recibe devoluciones) |
| Cliente | ninguno |

Sucursales, usuarios y categorías/productos de ejemplo: sin cambios de fondo respecto al doc anterior (revisar `seed.mjs` para las credenciales reales, no confiar en READMEs de otras carpetas).

---

## 4. Estado actual de funcionalidades

### 4.1 Autenticación, roles y permisos
Igual que antes en lo esencial (OTP de 6 dígitos para recuperar contraseña con 5 intentos y 10 min de vencimiento, bloqueo de login a 3 intentos por 5 min, JWT con `role/permissions/branchId` sin consultar la BD, refresh token hasheado SHA-256, "Mi cuenta" con perfil/direcciones/sucursal favorita). **Cambios reales:** el catálogo de permisos ganó **`USE_POS`** (caja física de la sucursal propia) y **`PROCESS_RETURNS`** (recibir devoluciones y reingresarlas al stock o a mermas). Los tres espejos que hay que mantener sincronizados si se agrega un permiso:
- `api/src/common/constants/permissions.ts` (fuente de verdad)
- `front/utils/permissions.ts` (`Permission`, `PERMISSION_OPTIONS`, `PANEL_PERMISSIONS`)
- `api/prisma/seed.mjs` (qué rol base lo trae)

`PANEL_PERMISSIONS` (qué permisos dan acceso a `/admin`) ahora incluye `USE_POS` y `PROCESS_RETURNS`. `front/components/modules/admin/adminNav.ts` define el menú lateral (incluye `/admin/returns`); la ruta `/admin/notifications` está gateada por `SEND_MARKETING` (no hay un permiso dedicado para push).

### 4.2 Catálogo, sucursales, colecciones y stock por talla
- El stock real vive en `ProductInventory`, ahora **por talla**: `InventoryService.getInventoryForSize/getStockForSize` (`api/src/modules/branches/inventory.service.ts`) son el chequeo real de stock (usado por POS y por la creación de órdenes); `getInventory/getInventoryMap` devuelven un **agregado** (`{stock: suma, damagedStock: suma, discountPrice, discountPercentage, sizes: [{size, stock, damagedStock}]}`) para mostrar en catálogo; `damagedStock` son las mermas (no vendibles) que dejan las devoluciones. Las ofertas siguen siendo por producto+sucursal, no por talla — el servicio las sincroniza entre las filas de talla.
- **Exclusividad de sucursal:** `Product.branchId/exclusiveToBranch` decide si un producto aparece en el catálogo de una sucursal (visibilidad), independiente de si tiene stock ahí (`ProductInventory`, cantidad). Un producto puede ser exclusivo de una sucursal y aun así no tener stock asignado.
- **Colecciones** (`api/src/modules/collections/`, `front/app/admin/collections/`): lectura pública (`GET /collections`, `GET /collections/slug/:slug`), CRUD gateado por `MANAGE_PRODUCTS`. Agrupación de campaña/temporada, ortogonal a `Category`.
- `Product.colors`: mismo patrón que `sizes` (array simple en el producto, no crea variantes independientes ni afecta el stock).
- El selector de sucursal (`BranchSelector` en el Header, y también existe en `app_movil` vía `BranchContext`) sigue siendo la fuente de `?branchId=` para catálogo/detalle/similares.
- **Probador Virtual (implementado, ver §4.12):** el detalle de producto monta `front/components/modules/product/VirtualTryOnModal.tsx` y ofrece "Probarme virtualmente". Usa Decart (`lucy-vton-latest`) en tiempo real por WebRTC a través de `front/app/api/decart/`. **No es un modelo 3D**: es prueba de ropa sobre el video de la cámara. El comentario de `ProductDetail.tsx:104` que dice que "aún no existe" quedó obsoleto.

### 4.3 Carrito y checkout (web)
- Carrito por Redux, líneas por `productId + selectedSize`; con `@@unique([cartId, productId, size])` cada talla es una fila propia también en el backend.
- **El carrito reserva stock real al agregar** (`CartService.addItem`): descuenta en `ProductInventory` por producto+sucursal+talla, o en el `Product.stock` global legado si se agregó sin sucursal. La reserva se guarda en `CartItem.branchId`.
  - `CartCleanupService` (`api/src/modules/cart/cart-cleanup.service.ts`) corre cada 15 minutos y libera los carritos sin actividad por más de 1 hora.
  - `OrdersService.create` no vuelve a descontar toda la cantidad: consume la reserva, descuenta solo la diferencia y libera el excedente o la reserva hecha en otra sucursal.
- Checkout en 3 pasos (Entrega → Pago → Completado), con dos añadidos:
  - **Pago por QR** (`front/app/checkout/qr-confirm/` + `QrConfirmClient.tsx`): alternativa a Stripe, simulada y confirmada contra la BD (`ConfirmQrDto`).
  - **Cola offline** (`front/utils/offlineOrderQueue.ts` + `front/hooks/useOfflineOrderSync.ts`): si `POST /orders` falla por falta de red, el pedido se guarda en IndexedDB (`stella-femme-offline` / store `orders`) y se reintenta al recuperar conexión; el usuario ve la página estática `/checkout/offline-success` (sin id de pedido dinámico, porque debe funcionar sin red).
- El paso "solo se ve la sucursal de la compra en Entrega" fue un fix (`fc000d8`). El retorno de Stripe aterriza en `/checkout/success`, que confirma el pago contra la API.

### 4.4 Pedidos, pagos, facturas y webhook de Stripe
- `OrdersService.create` calcula precios en servidor y ajusta el stock atómicamente por talla, consumiendo la reserva que ya hizo el carrito (ver §4.3).
- `POST /payments/create-intent` calcula el monto desde `order.totalAmount`; **el cliente no envía monto** (`payments.service.ts:67`).
- Al confirmarse el pago, `PaymentsService` elimina los ítems del carrito y marca `checkout: true`; **no** devuelve el stock ya vendido (fix `4a6f91b`, que corrigió el bug de liberar stock de una compra pagada).
- **Webhook real de Stripe** (`api/src/modules/payments/payments.webhook.controller.ts`): `POST /payments/webhook`, sin guards de auth — se confía únicamente en la firma `Stripe-Signature` verificada contra `STRIPE_WEBHOOK_SECRET` usando el `rawBody` que `main.ts` habilita (`NestFactory.create(AppModule, { rawBody: true })`). En desarrollo: `stripe listen --forward-to localhost:3001/api/v1/payments/webhook`.
- **QR de pago** (`api/src/modules/payments/dto/qr-payment.dto.ts`): `GenerateQrDto{orderId}` / `ConfirmQrDto{orderId, transactionId?}`; usa `qrcode` para generar la imagen. Es un flujo simulado (no hay pasarela QR real detrás), pero el pedido/pago se registra igual en la BD (`Order.paymentMethod = QR`).
- `Order.paymentStatus` (enum) ahora separa el estado del pago del `status` logístico (`OrderStatus`).
- Factura PDF sin cambios de fondo (`InvoiceService`/módulo `invoices`, se envía por correo al confirmar el pago).

### 4.5 Punto de venta físico (POS) — módulo nuevo
`api/src/modules/pos/` (`PosController`, `PosService`), permiso `USE_POS`, ruta `/admin/pos` en el front.
- `GET /pos/products`: catálogo con stock disponible **de la sucursal del cajero autenticado** (se toma de `@GetUser()`); solo quien tiene `ALL_BRANCHES` puede pasar `?branchId=` para operar otra caja.
- `POST /pos/checkout` (`PosCheckoutDto`): `items[] {productId, quantity, size}`, `paymentMethod` en `CASH/PHYSICAL_CARD/QR`, `amountReceived?` (solo CASH — **el servidor calcula y valida el cambio, nunca confía en el cliente**), `customerId?` (si no se manda, reutiliza/crea un usuario "Consumidor Final" con contraseña aleatoria inutilizable), `branchId?`, `nit?/razonSocial?` (facturación), `notes?`.
- La orden se crea directo como `ENTREGADO`/`COMPLETADO`, `source: POS`, `fulfillmentType: PICKUP`, **sin Stripe ni correos**. Descuenta stock por talla vía `InventoryService.decrement`.

### 4.6 Notificaciones push (Web Push) — módulo nuevo
`api/src/modules/notifications/`, `@Global()`, exporta `NotificationsService` inyectable desde cualquier módulo (ej. para avisar sobre el estado de un pedido). Usa `web-push` + claves VAPID (`VAPID_PUBLIC_KEY/PRIVATE_KEY/SUBJECT`); si no están configuradas, el servicio se autodeshabilita con un warning en el log (no rompe el arranque).
- `GET /notifications/vapid-public-key`, `POST /notifications/subscribe` (`SubscribePushDto`, forma estándar de `PushSubscription.toJSON()`, se hace upsert por `endpoint`).
- `sendPushNotification(userId, payload)` es best-effort/fire-and-forget; borra automáticamente la suscripción si el navegador la invalidó (404/410).
- Front: `front/hooks/usePushNotifications.ts` es una implementación real (no placeholder): chequea soporte de `serviceWorker`+`PushManager`, registra `/sw.js`, se suscribe con la VAPID key y hace `POST` al backend. UI en `/admin/notifications` (gateada por `SEND_MARKETING`).

### 4.7 Reportes con IA: migró de Gemini a **Groq**
`ReportsService` (`api/src/modules/reports/reports.service.ts`) ahora usa el SDK `openai` contra la API de **Groq** (compatible con el formato OpenAI), no `@google/generative-ai`. Variables: `GROQ_API_KEY`, `GROQ_MODEL` (default `openai/gpt-oss-120b`; clave en `console.groq.com/keys`). La arquitectura de seguridad **no cambió**: `validateGeneratedSql` + ejecución aislada con `SET LOCAL ROLE storefront_reports` sobre las vistas del esquema `reporting`, timeout de 5 s, 500 filas. Esto resuelve lo que el doc anterior marcaba como "nunca probado con la API real de Gemini" — ahora es un proveedor distinto y sí es el que está en uso.
Métricas genéricas (`/reports/sales-overview`, `/reports/top-products`) sin cambios de fondo.

### 4.8 Marketing por correo y SMTP
Sin cambios de fondo respecto al doc anterior (`POST /marketing/send-campaign`, saneo de HTML, lotes de 10, sin unsubscribe). `MailModule` sigue sin lanzar errores (solo loguea fallos).

### 4.9 Panel administrativo — rutas nuevas
Además de lo ya documentado (`products/inventory/orders/branches/staff/roles/marketing/reports`), el panel ganó: **`/admin/pos`** (`USE_POS`), **`/admin/returns`** (`PROCESS_RETURNS`, ver §4.11), **`/admin/categories`** (`MANAGE_PRODUCTS`), **`/admin/collections`** (`MANAGE_PRODUCTS`), **`/admin/notifications`** (`SEND_MARKETING`). Menú lateral generado dinámicamente en `adminNav.ts` con etiquetas distintas según `ALL_BRANCHES` (alcance global vs. sucursal propia).

### 4.10 PWA offline-first (front)
`front/public/sw.js`: Service Worker **escrito a mano** (explícitamente no usa Workbox/next-pwa — el propio comentario del archivo dice que son incompatibles con Turbopack). Estrategias `NetworkFirst`/`StaleWhileRevalidate`/`CacheFirst` sobre la Cache API nativa; `CACHE_VERSION = 'v7'`, tres caches (`sf-api-`, `sf-assets-`, `sf-pages-`). Solo intercepta `GET` (las mutaciones nunca pasan por el SW). Precachea `/`, `/offline`, `/checkout/offline-success` y `/cart` al instalar. Escucha un `postMessage` (`CLEAR_USER_CACHE`/`CLEAR_API_CACHE`, disparado desde `useAuth().logout()` y desde el sincronizador de inventario) para purgar el cache de API — medida anti-fuga de datos en dispositivos compartidos.
- **Catálogo offline:** `utils/productStorage.ts` guarda los productos vistos en `localStorage`; `useProducts` cae a esa copia si falla la red. `ProductCard` tiene quick-add (elige la primera talla con stock) además del detalle.
- **Cola de pedidos offline:** `utils/offlineOrderQueue.ts` + `useOfflineOrderSync` (IndexedDB `stella-femme-offline`, store `orders`). Ver §4.3.
- **Inventario offline (admin/staff):** `utils/offlineInventoryQueue.ts` usa la misma base IndexedDB (DB v2, store `inventory_queue`); `useOfflineInventorySync` (montado en `InventoryClient`) reintenta los cambios de stock al volver la conexión y emite `inventory-synced`. `providers/OfflineSyncProvider.tsx` monta globalmente la sincronización de pedidos y registra el SW; `useNetworkStatus` y `useRegisterServiceWorker` completan el soporte.
- `useAuth().logout()` limpia auth, carrito Redux (`clearAllCart`) y cache de API del SW.

### 4.11 Devoluciones y mermas — módulo nuevo
`api/src/modules/returns/` (`ReturnsController`, `ReturnsService`), permiso `PROCESS_RETURNS`, ruta `/admin/returns` en el front (`ReturnsClient`, `useReturns`, `returns.service`, `types/returns.types`).
- `GET /returns/search-order?query=&branchId?` (`PROCESS_RETURNS`): busca la venta original por ticket, UUID, NIT, razón social, email o nombre. Solo ventas cobradas (`paymentStatus = COMPLETADO`) y no canceladas; devuelve por ítem cuánto se vendió, cuánto ya se devolvió y cuánto queda. Sin `ALL_BRANCHES` limita a la sucursal propia más los pedidos web sin sucursal.
- `POST /returns/process` (`PROCESS_RETURNS`, `ProcessReturnDto`): en una transacción valida el tope contra devoluciones anteriores, calcula el reembolso desde el precio histórico del `OrderItem` (nunca desde el cliente) y reingresa cada prenda: `SELLABLE` → `ProductInventory.stock`; `DAMAGED` → `damagedStock` (merma, no vuelve al catálogo). Si ya no queda nada por devolver, marca `Order.paymentStatus = REEMBOLSADO`.
- `GET /returns` (`PROCESS_RETURNS` o `MANAGE_INVENTORY`): historial paginado, filtro `productId` para auditar mermas; `GET /returns/:id` para el detalle.
- Reglas: la talla se copia del `OrderItem` (no se pregunta); la sucursal que recibe la mercadería puede no ser la que vendió; una misma línea puede partirse en varias filas si cambia la condición. Inventario muestra `damagedStock` por talla.

### 4.12 Probador Virtual (Decart) — nuevo
- `front/components/modules/product/VirtualTryOnModal.tsx` se abre desde el botón "Probarme virtualmente" del detalle. Requiere sesión: si no hay usuario, redirige a `/auth/login?redirect=...`.
- Usa `@decartai/sdk` con el modelo realtime `lucy-vton-latest`: la cámara entra por WebRTC y vuelve el video con la prenda puesta. No es un modelo 3D.
- Rutas Next (`front/app/api/decart/`): `POST /api/decart/session` valida el access token contra `GET /users/me` y firma un token efímero (`ek_...`) con `allowedModels`, `allowedOrigins` y `maxSessionDuration`; `GET /api/decart/garment?url=` proxea la imagen de la prenda con bloqueo de hosts privados (SSRF).
- Control de costo por segundo: token de 60 s, techo de sesión de 25 s en el servidor, corte del cliente a los 15 s y botón para terminar antes.
- Requiere `DECART_API_KEY` (solo servidor, ver §6.4); el prompt se arma en inglés con nombre + primer color del producto.

### 4.13 Chatbot (Botpress) — nuevo
- API: `GET /chatbot/products` es **público** (sin JWT), con `ThrottlerGuard` + `RelaxedThrottle` (20 req/s). DTO `QueryChatbotProductsDto`: `search?`, `branchId?`, `inStockOnly?`, `limit?` (1-50, default 20). Devuelve el catálogo aplanado con stock por talla, precio efectivo de la sucursal y moneda `BOB`; si la BD falla responde **503** (distinto de "no hay stock").
- Front: `components/modules/chatbot/BotpressChat.tsx` se monta en `app/layout.tsx` y carga el widget de Botpress v3.7 (inject.js + configuración externa). La configuración del bot vive en Botpress, no en este repo.

### 4.13b Personalización de la tienda (apariencia) — nuevo
Modelo `StoreAppearance` (tabla `store_appearance` en cada schema de tienda, una fila `id = "default"`, migración `20261026120000_store_appearance`): `logoUrl`, `faviconUrl`, `primaryColor` (`#000000`), `secondaryColor` (`#ffffff`), `description`, `socialLinks` (JSONB `[{platform, url}]`). Permiso nuevo **`MANAGE_APPEARANCE`** (espejos en `permissions.ts`, `seed.mjs` y `front/utils/permissions.ts`, también en `PANEL_PERMISSIONS`).
- API (`api/src/modules/appearance/`): `GET|PATCH /admin/settings/appearance` (crea la fila con defaults si no existe), `PUT /admin/settings/appearance/logo|favicon` (multipart, PNG/JPEG/WebP validados por bytes, máx. 256 KB / 64 KB, se guardan como **data URL** en `logoUrl`/`faviconUrl` porque un `<img>` público no puede mandar `x-tenant-id`), y público `GET /store/appearance`.
- Front: `/admin/settings/appearance` (`components/modules/appearance/`, pantalla dividida con vista previa en vivo; ítem "Personalizar" con ícono `Palette` destacado en `adminNav.ts`). `app/layout.tsx` lee la apariencia en el servidor (`utils/storeAppearance.server.ts`, fetch cacheado 5 min con tag `store-appearance:<tenantId>` que el panel expira con la Server Action `refreshStoreAppearance`) e inyecta `--color-primary`/`--color-secondary` en `<body>`; logo en el `Header`, redes en el `Footer` (vía `StoreAppearanceProvider`), descripción y favicon en los metadatos.
- Tema granular (migración `20261026150000_store_appearance_theme`): `fontFamily` (catálogo cerrado `FONT_FAMILIES`: Inter, Playfair Display, Montserrat, Roboto, Poppins → `front/utils/fonts.ts`, todas con la variable `--font-store`), `navbarBackgroundColor`, `navbarTextColor`, `searchBarBackgroundColor`, `storeBackgroundColor`, `storeBackgroundImage` (`PUT .../background`, máx. 512 KB) y `adminMenuColor` (menú lateral del panel). `utils/appearanceTheme.ts` arma las variables (`--navbar-*`, `--search-*` con texto calculado legible, `--store-bg-*`, `--admin-menu-*`) para `<body>` y para la vista previa. El fondo subido (data URL) no va inline: lo sirve `app/store-assets/background/route.ts` y el CSS lo pide versionado con `?v=<updatedAt>`.

### 4.13c Dashboard interactivo de analítica — nuevo
Modelo `DashboardLayout` (tabla `dashboard_layouts`, uno por usuario, `widgetsConfig` JSONB `[{ i, x, y, w, h, type, metric }]`; migración `20261026180000_dashboard_layouts`). API `api/src/modules/analytics/` (permiso `VIEW_REPORTS`): `GET|PUT /analytics/layout` (sin diseño guardado devuelve el predeterminado sin escribirlo; valida ids únicos, que el widget entre en las 12 columnas y que el gráfico sirva para la métrica) y `GET /analytics/metrics?from&to&branchId` (Prisma `groupBy`/`_sum`: ingresos diarios, top 5 productos por unidades, totales). El alcance de sucursal y el rango salen de `reports/report-scope.ts`, compartido con `ReportsService`. Front: `/admin/reports/dashboard` (`components/modules/analytics/`, `react-grid-layout` 2.x + `recharts`), con acceso desde el encabezado de Reportes.

### 4.14 Contrato front ↔ API
`NEXT_PUBLIC_API_URL`, pago vía `/payments/create-intent|confirm`, pedido con `items[].{productId, quantity, size}` y carrito con `branchId`, refresh token en `Authorization: Bearer` (no en el body), devoluciones por `orderItemId`, probador virtual con `Authorization` hacia `/api/decart/session`, `error.utils.ts` centraliza mensajes de error en español.

### 4.15 Referencia rápida de endpoints (detalle real en Swagger `/api/docs`)
- **auth:** `register|login|refresh|logout|forgot-password|verify-otp|reset-password`
- **users:** `GET/PATCH /users/me`, `PATCH /users/me/password`, `DELETE /users/me`, `GET|POST /users/staff`, `PATCH /users/staff/:id`, `GET|POST /users/me/addresses`, `PUT|PATCH|DELETE /users/me/addresses/:id`, `PATCH /users/me/addresses/:id/default`
- **branches:** `GET /branches`, `GET /branches/manage/all`, `POST/PATCH/DELETE`, `GET|PUT /branches/:branchId/inventory[/:productId]`
- **roles:** `GET|POST /roles`, `GET /roles/assignable`, `GET|PATCH|DELETE /roles/:id`
- **products:** `GET /products[?branchId]`, `GET /products/:id[?branchId]`, `POST|PATCH|DELETE`, `PUT /products/:productId/discounts/bulk`, `PATCH /products/:id/stock`
- **categories:** `GET` público; `POST|PATCH|DELETE` (`MANAGE_PRODUCTS`)
- **collections** *(nuevo)*: `GET /collections`, `GET /collections/slug/:slug`, `POST|PATCH|DELETE` (`MANAGE_PRODUCTS`)
- **cart:** `GET /cart[?branchId]`, `POST /cart/items`, `PATCH|DELETE /cart/items/:itemId`, `DELETE /cart`
- **orders:** `POST /orders`, `GET /orders`, `GET /orders/me`, `GET /orders/:id`, `GET /orders/admin/all`, `GET /orders/admin/:id`, `PATCH|DELETE /orders/:id`, `PATCH|DELETE /orders/admin/:id`
- **payments:** `POST /payments/create-intent|confirm`, `GET /payments[/:id]`, `GET /payments/order/:orderId`, **`POST /payments/webhook`** *(sin guards, verificado por firma)*; QR: `POST /payments/qr/generate`, `GET /payments/qr/status/:orderId`, `POST /payments/qr/confirm`, `GET /payments/qr-confirm/:orderId` (HTML que se abre al escanear)
- **pos** *(nuevo)*: `GET /pos/products`, `POST /pos/checkout`
- **returns** *(nuevo)*: `GET /returns/search-order`, `POST /returns/process`, `GET /returns`, `GET /returns/:id`
- **notifications** *(nuevo)*: `GET /notifications/vapid-public-key`, `POST /notifications/subscribe`
- **chatbot** *(nuevo, público)*: `GET /chatbot/products`
- **marketing:** `POST /marketing/send-campaign`
- **reports:** `GET /reports/sales-overview|top-products`, `POST /reports/dynamic` (ahora vía Groq)

---

## 5. Limitaciones conocidas, deuda técnica y cosas a verificar antes de confiar en ellas

### 5.1 Bugs / decisiones riesgosas confirmadas leyendo el código actual
1. **CORS efectivamente abierto a cualquier origen.** En `api/src/main.ts`, el callback de `origin` termina en `return callback(null, true)` en **todas** las ramas (incluida la de "ningún caso anterior aplicó"), por lo que el chequeo contra `ALLOWED_ORIGINS`/`azurecontainerapps.io`/`localhost` es código muerto: cualquier origen es aceptado. Si se quiere restringir CORS de verdad, hay que arreglar ese último `return`.
2. **`ValidationPipe.forbidNonWhitelisted` ahora es `false`** (antes `true`). Los campos fuera del DTO ya no dan 400, se descartan en silencio. Es un cambio deliberado (commit `feb64e6`, para no romper el catálogo con `_t` de cache-busting), pero relaja la validación de entrada en toda la API.
3. **Clave pública de Stripe hardcodeada en `docker-compose.yml`** (`pk_test_51UIJq...`, en texto plano, dos veces). Es la clave *pública* (no la secreta), pero conviene confirmar con el usuario si es apropiado tenerla en un archivo que pueda compartirse/subirse a un repo público, y moverla a `.env`/secret si no.
4. **Webhook de Stripe sin guard de autenticación** por diseño (se valida solo por firma) — correcto en principio, pero cualquier cambio en `main.ts` que quite `rawBody: true` rompe la verificación de firma sin dar un error obvio.
5. **Doble lockfile en `api/` y en `front/`:** están trackeados `api/package-lock.json` + `api/bun.lock` y `front/bun.lock` + `front/package-lock.json`. `api/bun.lock` se commiteó en `6645f77`. Hay que decidir el gestor oficial por proyecto y dejar de trackear el lockfile del otro para evitar dependencias divergentes.
6. **`app_movil/README.md` documenta credenciales de prueba y una BD Neon distintas** a las del seed real del backend (`api/prisma/seed.mjs`). No asumir que ese README está al día — verificar contra el seed antes de dar credenciales a alguien.
7. **No existe `app_movil/eas.json`** — no hay pipeline de EAS Build/Submit configurado, aunque en algún momento se haya visto un `eas.json` untracked en un `git status` (puede haber sido un archivo local nunca commiteado, o ya se borró).
8. **El Probador Virtual ya existe (ver §4.12), pero `ProductDetail.tsx:104` conserva un comentario que dice que "aún no existe".** No confundir ese comentario con el estado real. Tampoco es un modelo 3D: es Decart sobre video en tiempo real.
9. **`DECART_API_KEY` está hardcodeada en `docker-compose.yml`** (clave real `dct_probador_...`, en texto plano). Moverla a `.env`/secret y rotarla antes de compartir el repo o hacerlo público; el front la necesita en runtime para `/api/decart/*`.

### 5.2 Pendientes ya conocidos que siguen sin resolver
- **Reserva de stock en carrito:** se descuenta al agregar y se libera al quitar/vaciar, al expirar por abandono (cron de 1 h) o al consumirse la orden. Si la API está caída, el cron no corre y la reserva puede quedar tomada hasta el siguiente arranque.
- Devoluciones: solo se procesan en mostrador (no hay autoservicio web); no existe endpoint para dar de baja mermas ni para reembolsar dinero real — el "reembolso" es un registro contable.
- Probador virtual: depende de `DECART_API_KEY` y cuesta por segundo; sin la key el endpoint responde 500.
- Chatbot: la configuración vive en Botpress (URLs hardcodeadas en `BotpressChat.tsx`); cambiar de bot exige tocar el front.
- Cambios de rol/permisos tardan hasta 15 min en verse (vida del access token); usuario eliminado sigue con token válido hasta que expire.
- Sin cierre de sesión forzado al eliminar una cuenta.
- Text-to-SQL: la seguridad real es el rol de solo lectura + vistas, no el validador por regex.
- Marketing: sin cola para miles de destinatarios, sin enlace de baja.
- Mapa: mosaicos públicos de OpenStreetMap (no apto para tráfico alto), sin validar que la ubicación esté dentro de Santa Cruz.
- Lint preexistente con varios `any` sin resolver; `*.spec.ts` son plantillas de Nest sin ejecutar de verdad.

### 5.3 Historial de commits recientes (más nuevo primero, `git log --oneline`)
```
ae38fe1 fix(app_movil): resolve 'No refresh token' error, handle expired sessions and auto logout cleanly
4a6f91b fix(mobile/api): resolve mobile purchase stock sync with Neon database and branch inventory
97c325b feat(pwa): offline cart selection and admin/staff offline stock inventory sync with Neon
8cd3d28 feat(pwa): optimizar funcionamiento offline, almacenamiento en IndexedDB y desplegar v2.7 en Azure
9efa4e8 chore(docker): add DECART_API_KEY to front in docker-compose
fffafec v2.0.0
7eda63c probador   ← Probador Virtual con Decart
6645f77 Implemenracion del area de devoluciòn para la venta fisica   ← devoluciones, mermas, reserva de stock del carrito
b675b6d fix: import PassportModule in PaymentsModule and define empty constructor on OptionalJwtAuthGuard
feb64e6 fix: remove _t query param and allow non-whitelisted params to prevent 400 on product catalog
239dd94 fix(store): descontar stock correctamente en compras, registrar pagos QR y Stripe en Neon, y eliminar cache estatico
395805c fix(web): corregir conexion con API en Azure, CORS y resolver dinamico de URL
d7cf20d fix(app_movil): resolve setState in render by decoupling navigation reset from state updater
6ede0b8 feat(app_movil): redirect to catalog after successful payment and auto-refresh stock on focus
3e2e396 feat(app_movil): add branch selector in catalog and sync stock with selected branch
a80c269 fix(payments): remover insignias de proyecto universitario demo y desplegar v2.1 en azure container apps
a67bd41 feat(payments): implementar metodo de pago por QR en web y movil con simulacion y confirmacion en BD
fc000d8 fix: mostrar unicamente la sucursal de la compra en el paso de entrega del checkout
55d8a86 fix: actualizacion automatica de stock post-pago, invalidacion de cache en SW y headers no-cache
3f59e4f feat: descripción de los cambios realizados   ← commit grande: POS, colecciones, stock por talla, QR, push (llegaron bundleados)
13262e6 v5
b2db73f v3.0.0
91b7b51 fix: precio checkout, carrito persistente, retiro en tienda, UI Stella Femme
```

### 5.4 Estado de git al escribir este documento
Rama `main`, HEAD `ae38fe1`, árbol de trabajo limpio (`git status --short` sin salida). Todo lo descrito arriba (POS, colecciones, stock por talla, push, QR, PWA offline, devoluciones, probador virtual, chatbot, selector de sucursal en móvil, deploy en Azure) **ya está commiteado**. `api/bun.lock` ya está trackeado (ver §5.1.5). Correr `git status --short` y `git log --oneline -10` de nuevo antes de asumir que sigue siendo así.

---

## 6. Guía rápida para levantar el entorno

### 6.0 Requisitos
Node ≥ 20, PostgreSQL (local o Neon), `bun` (front) y `npm` (api). Docker opcional para levantar todo con `docker-compose.yml`.

### 6.1 Backend (`api/`)
```bash
cd api
npm install --legacy-peer-deps
# crear api/.env  (ver api/.env.example — incluye Stripe, SMTP, GROQ_API_KEY/MODEL, VAPID_*)
npx prisma migrate deploy
npx prisma generate
npm run seed        # roles, sucursales, usuarios, categorías, productos
npm run dev          # nest start --watch → http://localhost:3001/api/v1 (Swagger en /api/docs)
```

### 6.2 Frontend (`front/`)
```bash
cd front
bun install          # o: npm install
# crear front/.env  (NEXT_PUBLIC_API_URL, NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY, DECART_API_KEY — no hay .env.example en front/)
bun run dev          # → http://localhost:3000
```
Primero la API, luego el front.

### 6.3 App móvil (`app_movil/`)
```bash
cd app_movil
npm install
# por defecto apunta a la API de Azure; ajustar src/config/env.ts o la pantalla de Login/Profile si se usa otra URL
npx expo start
```

### 6.4 Variables de entorno — `api/.env` (`api/.env.example` es la referencia real)
| Variable | Uso |
|---|---|
| `PORT`, `NODE_ENV`, `ALLOWED_ORIGINS` | Servidor y CORS (ver bug de §5.1.1: hoy no restringe nada realmente) |
| `DATABASE_URL` | PostgreSQL/Neon |
| `JWT_SECRET`, `JWT_REFRESH_SECRET`, `JWT_EXPIRES_IN` | Firmas JWT |
| `STRIPE_SECRET_KEY` | Clave secreta de Stripe |
| `STRIPE_WEBHOOK_SECRET` | Firma del webhook (`whsec_...`); con Stripe CLI: `stripe listen --forward-to localhost:3001/api/v1/payments/webhook` |
| `SMTP_HOST/PORT/SECURE/USER/PASS`, `MAIL_FROM` | Correo. Sin `SMTP_HOST` no se envía nada real (solo log) |
| `FRONTEND_URL` | Enlaces en los correos |
| `GROQ_API_KEY`, `GROQ_MODEL` | IA de reportes (Groq, default `openai/gpt-oss-120b`) — **ya no es Gemini** |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Web Push (`npx web-push generate-vapid-keys`) |

**`front/.env`** (no hay `.env.example` en `front/`, a diferencia de `api/` — crearlo a mano):
`NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `DECART_API_KEY` (solo servidor; la usan los Route Handlers de `/api/decart/*` y hoy también está hardcodeada en `docker-compose.yml`, ver §5.1.9). La configuración del chatbot Botpress no usa variables de entorno: las URLs están hardcodeadas en `BotpressChat.tsx`.

### 6.5 Docker
`docker-compose.yml` en la raíz levanta `api` (3001) y `front` (3000) en una red bridge. `api/Dockerfile`: Node 22-alpine, corre `prisma migrate deploy && node dist/main` al iniciar el contenedor (migraciones automáticas). `front/Dockerfile`: Node 20-alpine, `output: "standalone"`, las `NEXT_PUBLIC_*` se hornean en el build (hay que pasarlas como build args, no solo en runtime). **Revisar y rotar/mover a secret** las claves hardcodeadas antes de compartir este archivo: la pública de Stripe (§5.1.3) y `DECART_API_KEY` (§5.1.9).

### 6.6 Problemas frecuentes (Windows)
- Puertos ocupados tras detener `npm run dev`: `Get-NetTCPConnection -LocalPort 3000,3001 -State Listen | Select -Expand OwningProcess -Unique | % { Stop-Process -Id $_ -Force }`
- Cambios en `schema.prisma` con la API corriendo: reiniciar tras `migrate deploy` + `generate`.
- Sesión "vieja" en el navegador: Redux persiste en `localStorage`; si hay comportamientos raros tras cambios de permisos, cerrar sesión (dispara `CLEAR_USER_CACHE` al Service Worker) o borrar el almacenamiento del sitio.

---

## 7. Cómo usar este documento

- Si vas a tocar **permisos**, actualiza los tres espejos (§4.1) y este documento.
- Si vas a tocar **inventario/stock**, recuerda que es por **talla** y que hay dos cantidades por fila: `stock` (vendible) y `damagedStock` (mermas). `InventoryService` tiene métodos separados para el detalle por talla, el agregado para catálogo y el reingreso por devolución (`increment`/`incrementDamaged`).
- Si vas a tocar **devoluciones**, lee §4.11: el tope se valida contra los `OrderItem` ya devueltos y el reembolso se calcula desde el precio histórico, nunca desde el cliente.
- Si vas a tocar **CORS o validación de entrada**, lee primero §5.1.1 y §5.1.2 — son comportamientos actuales del código, no supuestos.
- Si una tarea menciona **probador virtual**, revisa §4.12: ya existe (Decart, no 3D). La clave `DECART_API_KEY` es un requisito real y hoy está hardcodeada (§5.1.9).
- Si una tarea menciona **chatbot**, revisa §4.13: el widget vive en Botpress y la API solo expone `GET /chatbot/products`.
- Antes de dar por buena cualquier afirmación de este archivo sobre un archivo, endpoint o campo específico, verifícalo en el código — este documento resume decisiones de diseño, pero el código es la fuente de verdad.

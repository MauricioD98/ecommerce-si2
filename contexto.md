# CONTEXTO — STELLA FEMME

> Documento maestro para que un LLM pueda retomar este proyecto y tomar decisiones informadas sin tener que releer todo el código. Generado el 2026-09-26 a partir del estado real del repo (rama `oscar`, HEAD `b675b6d`).
>
> **Regla de mantenimiento:** si cambias esquema, rutas, permisos, puertos o dependencias, actualiza este archivo en el mismo commit. Si algo aquí contradice el código, **el código manda** — este documento puede quedar desactualizado.
>
> **Advertencia sobre el propio repo:** el estado de git puede estar muy adelantado respecto a lo que sugiera cualquier snapshot o resumen previo (incluido este documento con el tiempo). Antes de asumir nada crítico, corre `git log --oneline -20` y `git status --short` para confirmar dónde está realmente HEAD.

---

## 1. Qué es el proyecto

**Stella Femme** es un e-commerce **multi-sucursal** de ropa femenina, con sucursales físicas en Santa Cruz de la Sierra, Bolivia. Cubre: catálogo con stock y ofertas por sucursal y por talla, carrito, checkout (retiro en tienda o envío a domicilio con mapa), pago con Stripe **o QR simulado**, punto de venta físico (POS) en caja, correos transaccionales, notificaciones push, facturas en PDF, un **dashboard administrativo** con roles/permisos dinámicos, marketing por correo, reportes con IA, una **PWA offline-first** y una **app móvil Expo** independiente que consume la misma API.

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
| IA (back) | SDK `openai` contra **Groq** (no Gemini — migrado, ver §4.8) |
| App móvil | **Expo ~57**, **React Native 0.86.3**, React 19.2.3, React Navigation 7, AsyncStorage |
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

**Páginas de la tienda (web):** `/` (catálogo) · `/{productId}` (detalle) · `/cart` · `/checkout` (con paso QR en `/checkout/qr-confirm` y página estática `/checkout/offline-success`) · `/account` (+ `/account/orders/[id]`) · `/auth/login|register|forgot-password|reset-password` · `/offline` (fallback de la PWA).
**Panel (`/admin`):** `pos`, `products`, `categories`, `collections`, `inventory`, `orders`, `branches`, `staff`, `roles`, `marketing`, `notifications`, `reports`.

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
  (product)/[id]/page.tsx      ← detalle de producto
  auth/ login | register | forgot-password | reset-password
  cart/, checkout/ (+ qr-confirm/, offline-success/)
  account/ (+ orders/[id]/)     ← historial de pedidos del cliente (antes era un 404, ya resuelto)
  admin/                        ← pos/, products/, categories/, collections/, inventory/, orders/,
                                   branches/, staff/, roles/, marketing/, notifications/, reports/
components/modules/
  auth/, account/, landing/, product/, cart/, checkout/, admin/  (uno por dominio, + .module.scss)
hooks/       useAuth, useCart, useOrder, usePayment, useProducts, useBranches, useAddresses,
             useSpeechRecognition, useAdminAccess/Branches/Orders/Products, useInventory, useStaff,
             useRoles, useReports, usePushNotifications, useOfflineOrderSync
service/api/ axios.config + un *.service.ts por módulo del backend, error.utils
store/       index.tsx (Redux store + persist), slices/authSlices, cartSlice, branchSlice
utils/       pricing.ts (espejo del cálculo del backend), permissions.ts, offlineOrderQueue.ts (IndexedDB)
types/       *.types.ts por dominio
public/sw.js ← Service Worker manual (ver §4.11)
```
Alias `@/*` → raíz de `front/`. Gestor de paquetes: **bun** (`packageManager: bun@1.4.0`, `bun.lock`); `npm install` también funciona pero no es el flujo principal.

### 2.3 Backend (`api/`)

```
prisma/     schema.prisma · migrations/ (22 migraciones) · seed.mjs
src/
  main.ts        ← prefijo api/v1, rawBody:true (webhook Stripe), ValidationPipe global, CORS, headers no-cache, Swagger
  app.module.ts  ← ConfigModule global, ThrottlerModule, todos los módulos (ver lista abajo)
  prisma/        ← PrismaService (adapter-pg)
  common/
    constants/permissions.ts   ← catálogo de permisos y roles base (ver §4.1)
    decorators/                ← GetUser, @Permissions/@AnyPermission, guards (Jwt, Permissions, Branch), throttlers
    utils/                     ← pricing.ts, permission.util.ts, token-hash.ts
  modules/
    auth · users (+ addresses) · products · category · collections · cart · orders · payments (+ webhook, dto/qr-payment)
    branches (+ InventoryService) · roles · mail · marketing · reports · pos · notifications
```
`ValidationPipe` global: `whitelist: true`, **`forbidNonWhitelisted: false`** (cambió — antes era `true`; ver §5), `transform: true`. Es decir: los campos que no están en el DTO se **descartan silenciosamente**, ya no dan 400 (se cambió a propósito para no romper el catálogo con parámetros extra como `_t`, commit `feb64e6`).

Gestor de paquetes: **npm** (`api/package-lock.json` es el lockfile trackeado). Hay un `api/bun.lock` **sin trackear** y `api/package.json` con una modificación sin commitear que resulta ser solo normalización de line-endings (CRLF/LF) — sin cambios reales de dependencias. Ver §5 sobre esta inconsistencia de tooling.

### 2.4 App móvil (`app_movil/`)

Cliente Expo/React Native independiente, **no** un simple wrapper — tiene pantallas propias para todo el flujo de compra, conectado a la **misma API NestJS**.

```
src/
  screens/  auth/{Login,Register}, shop/{Products,ProductDetail}, cart/{Cart,Checkout},
            orders/{Orders,OrderDetail}, payments/Payment, profile/{Profile,EditProfile,ChangePassword}
  contexts/ AuthContext, BranchContext (selector de sucursal, igual que en el front web), CartContext
  api/      client.ts (axios) + *.api.ts por módulo (auth, branches, cart, categories, orders, payments, products, users)
  config/env.ts  ← autodetecta la URL de la API: 10.0.2.2:3001 (emulador Android) / localhost / IP de LAN,
                    editable en runtime desde Login/Profile
```
- **No existe `eas.json`** en disco (no hay config de EAS Build/Submit pese a lo que pudiera sugerir cualquier snapshot antiguo del repo).
- `app_movil/README.md` menciona cuentas de prueba (`admin@gmail.com` / `Admin123*`, `john.doe@example.com`) **distintas** a las del seed del backend (`superadmin@stellafemme.com`, etc.) y una BD Neon propia para desarrollo — **tratar esas credenciales del README con sospecha**, pueden estar desactualizadas; confiar en `api/prisma/seed.mjs` como fuente de verdad para usuarios de prueba.
- Cambios recientes (ver `git log`): selector de sucursal en el catálogo sincronizado con el stock, auto-refresh de stock al enfocar la pantalla, redirect al catálogo tras pagar, fix de un bug de `setState` durante el render al resetear la navegación.

---

## 3. Base de datos (Prisma / PostgreSQL)

Archivo: `api/prisma/schema.prisma`. 12 modelos: `Role`, `User`, `UserAddress`, `Product`, `Branch`, `ProductInventory`, `Collection`, `Category`, `OrderItem`, `CartItem`, `Order`, `Cart`, `PushSubscription`, `Payment` (+ enums `OrderStatus`, `FulfillmentType`, `OrderSource`, `PaymentMethod`, `PaymentStatus`).

| Modelo | Campos clave / notas |
|---|---|
| **Role** | `id`, `name` (único), `description?`, `permissions String[]` |
| **User** | `email` (único), `password` (bcrypt), `firstName?/lastName?/phone?`, `roleId`→Role, `branchId?`→Branch (personal, rel. `StaffBranch`), `preferredBranchId?`→Branch (rel. `PreferredBranch`, `onDelete: SetNull`), `employeeDiscount Int`, `refreshToken?` (hash SHA-256), `resetPasswordOtp?/Attempts/Expires`, `loginAttempts/lockedUntil`, relación `cashierOrders` (`CashierOrders`, ventas que cobró en POS), `pushSubscriptions[]` |
| **Branch** | `name`, `address?`, **`latitude?/longitude?`** (nuevo), `phone?`, `isActive` |
| **Product** | `sizes String[]`, **`colors String[]`** (nuevo, mismo patrón que `sizes`: array simple, no variante independiente), `price`, `stock Int` (global, legado — suma de `ProductInventory`), `sku` (único), `imageUrl?`, `categoryId`, **`branchId?` + `exclusiveToBranch`** (nuevo: `null` = visible en todas las sucursales; con valor, solo esa sucursal lo muestra — **independiente del stock**), relación m2m con **`Collection`** |
| **ProductInventory** | **`@@unique([productId, branchId, size])`** — el stock ahora es **por producto + sucursal + talla** (antes era solo producto+sucursal; cambio de ruptura, migración `..190000_inventory_per_size`). `discountPrice`/`discountPercentage` siguen siendo por producto+sucursal (se mantienen sincronizados entre las filas de todas las tallas por el servicio, la oferta no varía por talla) |
| **Collection** *(nuevo modelo)* | `name`, `slug` (único), `description?`, `bannerImageUrl?`, `isActive`, m2m con `Product`. Es ortogonal a `Category`: la categoría es "qué es" la prenda, la colección es "para qué campaña" se exhibe (ej. "Otoño-Invierno") |
| **Category** | Sin cambios: `name`, `slug` (único), `description?`, `imageUrl?`, `isActive` |
| **Cart / CartItem** | `CartItem` ahora único por `(cartId, productId, size)` (antes solo `(cartId, productId)`) — una fila distinta por talla |
| **Order** | Campos nuevos: **`shippingCost`** (registro histórico, 0 en PICKUP), **`paymentStatus`** (enum `PaymentStatus`, separado del `status` logístico), **`stripePaymentIntentId`** (único), **`paymentMethod`** (enum: `STRIPE/CASH/PHYSICAL_CARD/QR`), **`source`** (enum `OrderSource`: `WEB/POS`), **`cashierId`** (→ User, null en ventas web), **`nit`/`razonSocial`** (facturación POS) |
| **OrderItem** | **`size String?`** (nuevo — ya se guarda la talla comprada, cierra un gap del doc anterior) |
| **PushSubscription** *(nuevo modelo)* | `endpoint` (único), `p256dh`, `auth`, `userId?` (cascade delete con User) — suscripción Web Push por dispositivo |
| **Payment** | Sin cambios de esquema respecto al doc anterior |
| **UserAddress** | Sin cambios |

### 3.1 Migraciones nuevas desde el estado anterior (11, ya aplicadas)
`add_push_subscriptions` → `add_order_payment_tracking` → `add_order_shipping_cost` → `add_pos_orders` → `add_item_size` → `add_pos_billing_fields` → `add_product_branch_exclusivity` → `reporting_sales_product_views` → `add_collections_and_colors` → `inventory_per_size` → `add_branch_coordinates`.

Comandos sin cambios: `npx prisma migrate deploy` · `npx prisma generate`. `migrate dev` no sirve cuando el cambio migra datos existentes (se escribe la migración a mano).

### 3.2 Datos iniciales (`npm run seed` en `api/`, idempotente, `api/prisma/seed.mjs`)
Roles base y permisos que asigna el seed (**cambiaron** respecto al doc anterior):

| Rol | Permisos |
|---|---|
| Super Admin | todos (`ALL_PERMISSIONS`) |
| Admin Sucursal | `MANAGE_USERS, MANAGE_INVENTORY, MANAGE_PRODUCTS, VIEW_ORDERS, SEND_MARKETING, VIEW_REPORTS, USE_POS` |
| **Empleado** | **`USE_POS`** (antes no tenía ningún permiso — ahora el personal de caja puede cobrar) |
| Cliente | ninguno |

Sucursales, usuarios y categorías/productos de ejemplo: sin cambios de fondo respecto al doc anterior (revisar `seed.mjs` para las credenciales reales, no confiar en READMEs de otras carpetas).

---

## 4. Estado actual de funcionalidades

### 4.1 Autenticación, roles y permisos
Igual que antes en lo esencial (OTP de 6 dígitos para recuperar contraseña con 5 intentos y 10 min de vencimiento, bloqueo de login a 3 intentos por 5 min, JWT con `role/permissions/branchId` sin consultar la BD, refresh token hasheado SHA-256, "Mi cuenta" con perfil/direcciones/sucursal favorita). **Cambio real:** el catálogo de permisos ganó **`USE_POS`** (caja física de la sucursal propia). Los tres espejos que hay que mantener sincronizados si se agrega un permiso:
- `api/src/common/constants/permissions.ts` (fuente de verdad)
- `front/utils/permissions.ts` (`Permission`, `PERMISSION_OPTIONS`, `PANEL_PERMISSIONS`)
- `api/prisma/seed.mjs` (qué rol base lo trae)

`PANEL_PERMISSIONS` (qué permisos dan acceso a `/admin`) ahora incluye `USE_POS`. `front/components/modules/admin/adminNav.ts` define el menú lateral; la ruta `/admin/notifications` está gateada por `SEND_MARKETING` (no hay un permiso dedicado para push).

### 4.2 Catálogo, sucursales, colecciones y stock por talla
- El stock real vive en `ProductInventory`, ahora **por talla**: `InventoryService.getInventoryForSize/getStockForSize` (`api/src/modules/branches/inventory.service.ts`) son el chequeo real de stock (usado por POS y por la creación de órdenes); `getInventory/getInventoryMap` devuelven un **agregado** (`{stock: suma, discountPrice, discountPercentage, sizes: [{size, stock}]}`) para mostrar en catálogo. Las ofertas siguen siendo por producto+sucursal, no por talla — el servicio las sincroniza entre las filas de talla.
- **Exclusividad de sucursal:** `Product.branchId/exclusiveToBranch` decide si un producto aparece en el catálogo de una sucursal (visibilidad), independiente de si tiene stock ahí (`ProductInventory`, cantidad). Un producto puede ser exclusivo de una sucursal y aun así no tener stock asignado.
- **Colecciones** (`api/src/modules/collections/`, `front/app/admin/collections/`): lectura pública (`GET /collections`, `GET /collections/slug/:slug`), CRUD gateado por `MANAGE_PRODUCTS`. Agrupación de campaña/temporada, ortogonal a `Category`.
- `Product.colors`: mismo patrón que `sizes` (array simple en el producto, no crea variantes independientes ni afecta el stock).
- El selector de sucursal (`BranchSelector` en el Header, y también existe en `app_movil` vía `BranchContext`) sigue siendo la fuente de `?branchId=` para catálogo/detalle/similares.
- El botón "Probador Virtual 3D" del detalle de producto y el modelo 3D de productos **nunca se implementaron** — cualquier referencia a `Model3DModal.tsx`, `VirtualTryOn.tsx`, `common/storage/`, `common/filters/`, `api/store/` o una migración de "model3d" **no existe en el código actual**; si aparecen en algún estado de git antiguo o en una tarea pendiente, es trabajo que no llegó a implementarse (o se revirtió).

### 4.3 Carrito y checkout (web)
- Carrito por Redux, líneas por `productId + selectedSize`; con el nuevo `@@unique([cartId, productId, size])` cada talla es una fila propia también en el backend.
- Checkout en 3 pasos (Entrega → Pago → Completado), con dos añadidos:
  - **Pago por QR** (`front/app/checkout/qr-confirm/` + `QrConfirmClient.tsx`): alternativa a Stripe, simulada y confirmada contra la BD (`ConfirmQrDto`).
  - **Cola offline** (`front/utils/offlineOrderQueue.ts` + `front/hooks/useOfflineOrderSync.ts`): si `POST /orders` falla por falta de red, el pedido se guarda en IndexedDB (`stella-femme-offline` / store `orders`) y se reintenta al recuperar conexión; el usuario ve la página estática `/checkout/offline-success` (sin id de pedido dinámico, porque debe funcionar sin red).
- El paso "solo se ve la sucursal de la compra en Entrega" fue un fix reciente (`fc000d8`) — antes se podía confundir con otra sucursal.

### 4.4 Pedidos, pagos, facturas y webhook de Stripe
- `OrdersService.create` sigue calculando precios en servidor y descontando stock atómicamente, ahora **por talla**.
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
Además de lo ya documentado (`products/inventory/orders/branches/staff/roles/marketing/reports`), el panel ganó: **`/admin/pos`** (`USE_POS`), **`/admin/categories`** (`MANAGE_PRODUCTS`), **`/admin/collections`** (`MANAGE_PRODUCTS`), **`/admin/notifications`** (`SEND_MARKETING`). Menú lateral generado dinámicamente en `adminNav.ts` con etiquetas distintas según `ALL_BRANCHES` (alcance global vs. sucursal propia).

### 4.10 PWA offline-first (front) — no existía en el doc anterior
`front/public/sw.js`: Service Worker **escrito a mano** (explícitamente no usa Workbox/next-pwa — el propio comentario del archivo dice que son incompatibles con Turbopack). Estrategias `NetworkFirst`/`StaleWhileRevalidate`/`CacheFirst` sobre la Cache API nativa; `CACHE_VERSION = 'v6'`, tres caches (`sf-api-`, `sf-assets-`, `sf-pages-`). Solo intercepta `GET` (las mutaciones nunca pasan por el SW). Precachea `/offline` y `/checkout/offline-success` al instalar. Escucha un `postMessage` (`CLEAR_USER_CACHE`/`CLEAR_API_CACHE`, disparado desde `useAuth().logout()`) para purgar el cache de API al cerrar sesión — medida anti-fuga de datos en dispositivos compartidos.
Cola de pedidos offline: ver §4.3.

### 4.11 Contrato front ↔ API (puntos importantes, sin cambios de fondo)
`NEXT_PUBLIC_API_URL`, pago vía `/payments/create-intent|confirm`, pedido con `items[].{productId, quantity, selectedSize→size}`, refresh token en `Authorization: Bearer` (no en el body), `error.utils.ts` centraliza mensajes de error en español.

### 4.12 Referencia rápida de endpoints (detalle real en Swagger `/api/docs`)
- **auth:** `register|login|refresh|logout|forgot-password|verify-otp|reset-password`
- **users:** `GET/PATCH /users/me`, `PATCH /users/me/password`, `DELETE /users/me`, `GET|POST /users/staff`, `PATCH /users/staff/:id`, `GET|POST /users/me/addresses`, `PUT|PATCH|DELETE /users/me/addresses/:id`, `PATCH /users/me/addresses/:id/default`
- **branches:** `GET /branches`, `GET /branches/manage/all`, `POST/PATCH/DELETE`, `GET|PUT /branches/:branchId/inventory[/:productId]`
- **roles:** `GET|POST /roles`, `GET /roles/assignable`, `GET|PATCH|DELETE /roles/:id`
- **products:** `GET /products[?branchId]`, `GET /products/:id[?branchId]`, `POST|PATCH|DELETE`, `PUT /products/:productId/discounts/bulk`, `PATCH /products/:id/stock`
- **categories:** `GET` público; `POST|PATCH|DELETE` (`MANAGE_PRODUCTS`)
- **collections** *(nuevo)*: `GET /collections`, `GET /collections/slug/:slug`, `POST|PATCH|DELETE` (`MANAGE_PRODUCTS`)
- **cart:** `GET /cart[?branchId]`, `POST /cart/items`, `PATCH|DELETE /cart/items/:itemId`, `DELETE /cart`
- **orders:** `POST|GET /orders`, `GET|PATCH|DELETE /orders/:id`, `GET|PATCH|DELETE /orders/admin/...`
- **payments:** `POST /payments/create-intent|confirm`, `GET /payments[/:id]`, `GET /payments/order/:orderId`, **`POST /payments/webhook`** *(nuevo, sin guards, verificado por firma)*, QR (`GenerateQrDto`/`ConfirmQrDto`)
- **pos** *(nuevo)*: `GET /pos/products`, `POST /pos/checkout`
- **notifications** *(nuevo)*: `GET /notifications/vapid-public-key`, `POST /notifications/subscribe`
- **marketing:** `POST /marketing/send-campaign`
- **reports:** `GET /reports/sales-overview|top-products`, `POST /reports/dynamic` (ahora vía Groq)

---

## 5. Limitaciones conocidas, deuda técnica y cosas a verificar antes de confiar en ellas

### 5.1 Bugs / decisiones riesgosas confirmadas leyendo el código actual
1. **CORS efectivamente abierto a cualquier origen.** En `api/src/main.ts`, el callback de `origin` termina en `return callback(null, true)` en **todas** las ramas (incluida la de "ningún caso anterior aplicó"), por lo que el chequeo contra `ALLOWED_ORIGINS`/`azurecontainerapps.io`/`localhost` es código muerto: cualquier origen es aceptado. Si se quiere restringir CORS de verdad, hay que arreglar ese último `return`.
2. **`ValidationPipe.forbidNonWhitelisted` ahora es `false`** (antes `true`). Los campos fuera del DTO ya no dan 400, se descartan en silencio. Es un cambio deliberado (commit `feb64e6`, para no romper el catálogo con `_t` de cache-busting), pero relaja la validación de entrada en toda la API.
3. **Clave pública de Stripe hardcodeada en `docker-compose.yml`** (`pk_test_51UIJq...`, en texto plano, dos veces). Es la clave *pública* (no la secreta), pero conviene confirmar con el usuario si es apropiado tenerla en un archivo que pueda compartirse/subirse a un repo público, y moverla a `.env`/secret si no.
4. **Webhook de Stripe sin guard de autenticación** por diseño (se valida solo por firma) — correcto en principio, pero cualquier cambio en `main.ts` que quite `rawBody: true` rompe la verificación de firma sin dar un error obvio.
5. **Mezcla de gestores de paquete en `api/`:** el lockfile trackeado es `package-lock.json` (npm), pero existe un `api/bun.lock` sin trackear (sugiere que alguien corrió `bun install` ahí en algún momento). Si se sigue usando `bun` en `api/`, hay que decidir cuál lockfile es la fuente de verdad y trackear el correcto; si fue un error, borrar `api/bun.lock`.
6. **`app_movil/README.md` documenta credenciales de prueba y una BD Neon distintas** a las del seed real del backend (`api/prisma/seed.mjs`). No asumir que ese README está al día — verificar contra el seed antes de dar credenciales a alguien.
7. **No existe `app_movil/eas.json`** — no hay pipeline de EAS Build/Submit configurado, aunque en algún momento se haya visto un `eas.json` untracked en un `git status` (puede haber sido un archivo local nunca commiteado, o ya se borró).
8. **El "Probador Virtual 3D" y el modelo 3D de producto no existen.** Cualquier tarea, ticket o memoria que hable de subir modelos 3D, `Model3DModal`, `VirtualTryOn`, `api/store/`, `common/storage/`, `common/filters/` describe trabajo **no implementado** en el estado actual del código — no asumir que existe solo porque aparezca mencionado en otro lado.

### 5.2 Pendientes ya conocidos que siguen sin resolver
- `POST /payments/create-intent` — verificar si sigue confiando en el `amount` que manda el cliente sin validarlo contra la orden (el front ya envía el total correcto, pero conviene revisar el servicio antes de asumir que el backend lo re-valida).
- Stock se descuenta al crear la orden (antes del pago); si el pago se abandona no se restituye salvo cancelación manual de un pedido `PENDIENTE`.
- Cambios de rol/permisos tardan hasta 15 min en verse (vida del access token); usuario eliminado sigue con token válido hasta que expire.
- Sin cierre de sesión forzado al eliminar una cuenta.
- Text-to-SQL: la seguridad real es el rol de solo lectura + vistas, no el validador por regex.
- Marketing: sin cola para miles de destinatarios, sin enlace de baja.
- Mapa: mosaicos públicos de OpenStreetMap (no apto para tráfico alto), sin validar que la ubicación esté dentro de Santa Cruz.
- Lint preexistente con varios `any` sin resolver; `*.spec.ts` son plantillas de Nest sin ejecutar de verdad.

### 5.3 Historial de commits recientes (más nuevo primero, `git log --oneline`)
```
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
Rama `oscar`, HEAD `b675b6d`. Todo lo de arriba (POS, colecciones, stock por talla, push, QR, PWA offline, selector de sucursal en móvil, deploy en Azure) **ya está commiteado**. Lo único sin commitear en ese momento era: `PROJECT_CONTEXT.md` borrado (reemplazado por este archivo), un cambio trivial de line-endings en `api/package.json`, y un `api/bun.lock` sin trackear (ver §5.1.5). Correr `git status --short` de nuevo antes de asumir que sigue siendo así.

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
# crear front/.env  (NEXT_PUBLIC_API_URL, NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY — no hay .env.example en front/)
bun run dev          # → http://localhost:3000
```
Primero la API, luego el front.

### 6.3 App móvil (`app_movil/`)
```bash
cd app_movil
npm install
# ajustar src/config/env.ts o la pantalla de Login/Profile si la API no está en localhost/emulador estándar
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
`NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`.

### 6.5 Docker
`docker-compose.yml` en la raíz levanta `api` (3001) y `front` (3000) en una red bridge. `api/Dockerfile`: Node 22-alpine, corre `prisma migrate deploy && node dist/main` al iniciar el contenedor (migraciones automáticas). `front/Dockerfile`: Node 20-alpine, `output: "standalone"`, las `NEXT_PUBLIC_*` se hornean en el build (hay que pasarlas como build args, no solo en runtime). **Revisar y posiblemente rotar/mover a secret** la clave pública de Stripe hardcodeada antes de compartir este archivo (ver §5.1.3).

### 6.6 Problemas frecuentes (Windows)
- Puertos ocupados tras detener `npm run dev`: `Get-NetTCPConnection -LocalPort 3000,3001 -State Listen | Select -Expand OwningProcess -Unique | % { Stop-Process -Id $_ -Force }`
- Cambios en `schema.prisma` con la API corriendo: reiniciar tras `migrate deploy` + `generate`.
- Sesión "vieja" en el navegador: Redux persiste en `localStorage`; si hay comportamientos raros tras cambios de permisos, cerrar sesión (dispara `CLEAR_USER_CACHE` al Service Worker) o borrar el almacenamiento del sitio.

---

## 7. Cómo usar este documento

- Si vas a tocar **permisos**, actualiza los tres espejos (§4.1) y este documento.
- Si vas a tocar **inventario/stock**, recuerda que ahora es por **talla**, no solo por sucursal — `InventoryService` tiene métodos separados para el detalle por talla y el agregado para catálogo.
- Si vas a tocar **CORS o validación de entrada**, lee primero §5.1.1 y §5.1.2 — son comportamientos actuales del código, no supuestos.
- Si una tarea menciona **modelo 3D / probador virtual**, confirma primero que no se está confundiendo con una versión antigua de este documento o con una idea que nunca se implementó (§5.1.8).
- Antes de dar por buena cualquier afirmación de este archivo sobre un archivo, endpoint o campo específico, verifícalo en el código — este documento resume decisiones de diseño, pero el código es la fuente de verdad.

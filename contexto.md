# CONTEXTO — STELLA FEMME

> Documento maestro para que un LLM pueda retomar este proyecto y tomar decisiones informadas sin tener que releer todo el código. Actualizado el 2026-10-31 a partir del estado real del repo (rama `main`, HEAD `a2107ab`).
>
> **Regla de mantenimiento:** si cambias esquema, rutas, permisos, puertos o dependencias, actualiza este archivo en el mismo commit. Si algo aquí contradice el código, **el código manda** — este documento puede quedar desactualizado.
>
> **Advertencia sobre el propio repo:** el estado de git puede estar muy adelantado respecto a lo que sugiera cualquier snapshot o resumen previo (incluido este documento con el tiempo). Antes de asumir nada crítico, corre `git log --oneline -20` y `git status --short` para confirmar dónde está realmente HEAD.
>
> **Ramas:** trabajar sobre `main`. La rama `oscar` (HEAD `fffafec v2.0.0`) es **anterior a la migración multitenant** y **no funciona contra la BD Neon actual**: busca las tablas en `public`, que ahora solo tiene el plano de control, y el login responde 500 (`relation "public.users" does not exist`). Ver §5.1.10.

---

## 1. Qué es el proyecto

**Stella Femme** empezó como un e-commerce **multi-sucursal** de ropa femenina (sucursales físicas en Santa Cruz de la Sierra, Bolivia) y desde el commit `edb3598` es además un **SaaS multitenant**: cada tienda vive en su propio schema de PostgreSQL. Las tiendas se dan de alta pagando un plan con Stripe (`/planes`) y un panel de plataforma (`/plataforma`) las administra. La tienda original quedó como el tenant `tenant_legacy` ("Stella Femme").

Cada tienda cubre: catálogo con stock y ofertas por sucursal y por talla (con **traducciones**), carrito con reserva de stock, checkout (retiro en tienda o envío a domicilio con mapa), cobro con **tarjeta vía Stripe Connect**, **QR bancario** o **USDT** (verificados a mano), QR simulado (heredado), punto de venta físico (POS), devoluciones con reingreso a stock o mermas, probador virtual en tiempo real con Decart, chatbot de Botpress, correos transaccionales, notificaciones push, facturas en PDF, panel administrativo con roles/permisos dinámicos, **personalización visual de la tienda**, **dashboard de analítica arrastrable**, marketing por correo, reportes con IA, una PWA offline-first y una app móvil Expo independiente. Interfaz, errores de la API y app móvil en **4 idiomas** (es, en, fr, zh).

Es un monorepo sin workspaces: `front/`, `api/` y `app_movil/` son proyectos autónomos, cada uno con su propio `package.json`, lockfile y `.env`.

### 1.1 Stack tecnológico (versiones reales, confirmadas en `package.json`)

| Capa | Tecnología |
|---|---|
| Frontend web | **Next.js 16.3.4** (App Router, Turbopack, `proxy.ts` = el antiguo middleware) · **React 19.2.8** · TypeScript |
| i18n (front) | **`next-intl` 4** — sin prefijo en la URL, el idioma vive en la cookie `NEXT_LOCALE` (`front/i18n/`, `front/messages/{es,en,fr,zh}.json`) |
| Estilos (front) | SCSS / CSS Modules (`.module.scss` por componente) + variables en `app/globals.css` + tema por tienda inyectado en `<body>` |
| Estado (front) | Redux Toolkit + `redux-persist` (`auth`, `cart`, `branch`), con claves por tienda |
| HTTP (front) | Axios (`service/api/axios.config.ts`), agrega `x-tenant-id` y el idioma |
| Pagos (front) | `@stripe/react-stripe-js` + `@stripe/stripe-js` (`PaymentElement`) + flujos QR/USDT propios |
| Mapas | `leaflet` + `react-leaflet` (mosaicos OpenStreetMap) |
| Gráficos / export | `recharts`, `react-grid-layout` 2.x (dashboard), `jspdf` + `jspdf-autotable`, `xlsx` |
| PWA offline | Service Worker manual (`front/public/sw.js`), IndexedDB para colas offline (una base por tienda) |
| Backend | **NestJS 12** · TypeScript · Swagger · class-validator · Passport JWT · **`nestjs-i18n`** |
| ORM / BD | **Prisma 7.1** (`@prisma/adapter-pg`) · PostgreSQL (Neon). **Dos clientes Prisma:** tiendas (`@prisma/client`, `prisma/schema.prisma`) y plano de control (`src/generated/control`, `prisma/control/schema.prisma`) |
| Pagos (back) | SDK `stripe` 22.6: PaymentIntents con **Connect (destination charges)**, suscripciones del SaaS (Checkout + Billing Portal), webhook firmado · `qrcode` |
| Cifrado (back) | AES-256-GCM nativo (`common/encryption/encryption.service.ts`) para credenciales de terceros por tienda |
| Correo (back) | `@nestjs-modules/mailer` + `nodemailer` (SMTP) |
| PDF (back) | `pdfkit` (facturas) |
| Push (back) | `web-push` (VAPID por tienda) |
| IA (back) | SDK `openai` contra **Groq** (no Gemini — ver §4.7) |
| Probador virtual | `@decartai/sdk` 0.2.3 · modelo realtime `lucy-vton-latest`. El token efímero ahora lo firma **la API** (`POST /try-on/session`) con la key de la tienda |
| Chatbot | Widget Botpress Webchat v3.7 en el front + endpoint público `GET /chatbot/products` en la API |
| Tareas programadas (back) | `@nestjs/schedule` — cron de liberación de carritos abandonados |
| App móvil | **Expo ~58.0.0**, **React Native 0.88.1**, React 19.3.0, React Navigation 7, AsyncStorage, **`i18next` + `react-i18next` + `expo-localization`** |
| Infra | Docker (`api/Dockerfile`, `front/Dockerfile`, `docker-compose.yml`) · deploy real en **Azure Container Apps** con BD **Neon** |

**Reglas de producto que hay que respetar**
- El idioma base es **español latinoamericano**; todo texto nuevo de UI va a los 4 diccionarios (`front/messages/*.json`, `api/src/i18n/locales/*/`, `app_movil/src/i18n/locales/*.json`). La marca de la plataforma es **"Stella Femme"**, pero dentro de una tienda se muestra **el nombre de esa tienda** (`GET /store`, `StoreInfoProvider`).
- El precio final **siempre lo calcula el backend** (cliente nunca decide precios/descuentos/montos a cobrar). Lo mismo con el plan del SaaS: el front manda la **clave** del plan, nunca un `price_id`.
- **Nunca** cruzar datos entre tiendas: todo acceso a datos de negocio pasa por el tenant del request (§4.0).
- No cambiar lógica de negocio al "arreglar" estilos o textos.

**Puertos y URLs (desarrollo local)**

| Servicio | URL |
|---|---|
| Frontend | `http://localhost:3000` |
| API | `http://localhost:3001/api/v1` (prefijo global en `api/src/main.ts`) |
| Swagger | `http://localhost:3001/api/docs` |
| PostgreSQL | En la práctica se usa **Neon** también en local (`api/.env` apunta a Neon). Una BD local en `localhost:5432` funciona si se le aplican las migraciones de control y de tienda (§6.1) |

**Producción:** API y front en **Azure Container Apps**; BD en **Neon** (`DATABASE_URL` con pooler, `DIRECT_URL` sin pooler para migrar). `main.ts` confía en `TRUST_PROXY_HOPS` saltos de proxy (ingress de Azure) para leer la IP real.

**Páginas de la tienda (web):** `/` (catálogo) · `/{productId}` (detalle, con Probador Virtual) · `/cart` · `/checkout` (paso QR simulado en `/checkout/qr-confirm`, retorno de Stripe en `/checkout/success`, página estática `/checkout/offline-success`) · `/account` (+ `/account/orders/[id]`, donde el cliente sube el comprobante de QR/USDT) · `/auth/login|register|forgot-password|reset-password` · `/offline` (fallback de la PWA).
**Páginas del SaaS (sin tienda):** `/planes` (+ `/planes/exito`, vuelta de Stripe Checkout), `/contacto`, `/plataforma` (panel del plano de control, entra con la llave de plataforma). Listadas en `front/utils/platformPaths.ts`.
**Panel de tienda (`/admin`):** `pos`, `returns`, `products`, `categories`, `collections`, `inventory`, `orders`, `branches`, `staff`, `roles`, `marketing`, `notifications`, `reports` (+ `reports/dashboard`), `suscripcion` (solo Super Admin), `settings/payments`, `settings/appearance`. `/admin/pagos` es una ruta vieja que redirige a `settings/payments`.

---

## 2. Estructura del repositorio

```
ecommerce-si2/
├── contexto.md            ← este archivo
├── docker-compose.yml      ← orquesta api (3001) + front (3000) en una red bridge
├── front/                  ← Next.js 16 (proyecto autónomo, usa bun; bun.lock)
├── api/                    ← NestJS 12 + Prisma 7 (proyecto autónomo, usa npm; package-lock.json)
├── app_movil/              ← Expo ~57 / React Native (cliente móvil independiente de la misma API)
└── IA/                     ← carpeta vacía
```

### 2.1 Avisos importantes por carpeta (archivos `AGENTS.md` reales del repo)
- **`front/AGENTS.md`** (incluido vía `front/CLAUDE.md`): *"Esta NO es la versión de Next.js que conoces"* — Next 16 tiene cambios que rompen compatibilidad con lo que un LLM pueda "saber" de memoria (por ejemplo, `middleware.ts` ahora se llama `proxy.ts`). Antes de escribir código en `front/`, revisar `front/node_modules/next/dist/docs/`.
- **`app_movil/AGENTS.md`**: *"Expo HA CAMBIADO"* — revisar la documentación versionada exacta de Expo 57 (`https://docs.expo.dev/versions/v57.0.0/`) antes de escribir código ahí.
- `api/` no tiene `AGENTS.md`/`CLAUDE.md` propios (solo el `README.md` boilerplate de Nest).

### 2.2 Frontend (`front/`)

```
proxy.ts         ← enrutamiento por dominio propio de cada tienda + negociación de idioma (ver §4.0 y §4.16)
app/
  layout.tsx, globals.css, fonts.ts, manifest.ts, offline/, error.tsx, global-error.tsx
  (lading)/page.tsx            ← "/" catálogo (carpeta con typo histórico "lading")
  (product)/[id]/page.tsx      ← detalle de producto (monta el Probador Virtual)
  (platform)/                  ← SaaS: planes/ (+ exito/), contacto/
  (platform-admin)/plataforma/ ← panel del plano de control (llave de plataforma)
  auth/ login | register | forgot-password | reset-password
  cart/, checkout/ (+ qr-confirm/, success/, offline-success/)
  account/ (+ orders/[id]/)
  admin/                       ← pos/, returns/, products/, categories/, collections/, inventory/,
                                  orders/, branches/, staff/, roles/, marketing/, notifications/,
                                  reports/ (+ dashboard/), suscripcion/, settings/{payments,appearance}/,
                                  pagos/ (redirect legado)
  api/decart/garment/          ← Route Handler: proxea la imagen de la prenda (anti-SSRF). La sesión
                                  del probador ya NO se firma acá (pasó a la API, §4.12)
  store-assets/background/     ← sirve la imagen de fondo de la tienda (data URL guardada en la BD)
components/modules/
  auth/, account/, landing/, product/, cart/, checkout/, admin/, chatbot/,
  platform/ (landing de planes, plans.ts), platform-admin/, tenant/ (TenantGate + selector),
  appearance/, analytics/, i18n/ (LanguageSwitcher)
providers/   index.tsx, state-provider.tsx, OfflineSyncProvider.tsx, StoreAppearanceProvider.tsx,
             StoreInfoProvider.tsx (nombre de la tienda), LocaleCartSync.tsx
i18n/        config.ts (LOCALES, cookie), request.ts, client.ts   ·   messages/{es,en,fr,zh}.json
hooks/       useAuth, useCart, useOrder, useMyOrders, useOrderDetail, usePayment, useProducts, useBranches,
             useAddresses, useSpeechRecognition, useAdminAccess/Branches/Categories/Collections/Orders/
             Products, useInventory, useOfflineInventorySync, useStaff, useRoles, useReports, useReturns,
             usePos, usePushNotifications, useOfflineOrderSync, useNetworkStatus,
             useRegisterServiceWorker, useLocaleVersion
service/api/ axios.config + un *.service.ts por módulo del backend (incluye platform, platformAdmin,
             subscription, paymentSettings, appearance, analytics), error.utils
store/       index.tsx (Redux store + persist con clave por tienda), slices/
utils/       tenant.ts (tienda activa), legacyStorageMigration.ts, platformPaths.ts, storeName(.server).ts,
             storeAppearance.server.ts, appearanceTheme.ts, fonts.ts, offlineDb.ts, pricing.ts,
             permissions.ts, offlineOrderQueue.ts, offlineInventoryQueue.ts, productStorage.ts,
             printPosReceipt.ts
types/       *.types.ts por dominio
public/sw.js ← Service Worker manual (ver §4.10)
```
Alias `@/*` → raíz de `front/`. Gestor de paquetes: **bun** (`bun.lock`); `npm install` también funciona. Variables en **`front/.env.local`** (§6.4).

### 2.3 Backend (`api/`)

```
prisma/
  schema.prisma + migrations/      ← schema de TIENDA (se aplica a cada tenant_<uuid> y a tenant_legacy)
  control/schema.prisma + migrations/ ← plano de CONTROL (schema "public")
  control/sql/001_…, 002_…         ← scripts manuales de la migración única a multitenant (§3.3)
  seed.mjs                         ← datos demo, exige TENANT_SCHEMA
prisma.config.ts                   ← config de Prisma para tiendas
prisma.control.config.ts           ← config de Prisma para el plano de control (fuerza ?schema=public)
src/
  main.ts        ← prefijo api/v1, rawBody:true, trust proxy, ValidationPipe → I18nExceptionFilter, CORS, no-cache, Swagger
  app.module.ts  ← ConfigModule, ThrottlerModule, I18nModule, ScheduleModule, TenancyModule, todos los módulos
  tenancy/       ← TenantMiddleware, TenantPrismaService, proxy de PrismaService, ControlPrismaService,
                   TenantProvisioningService, TenantMigrationService, TenantSecretsService, caché de resolución
  generated/control/ ← cliente Prisma del plano de control (generado, ignorado por git)
  i18n/          ← i18n-message.ts, i18n-exception.filter.ts, locales/{es,en,fr,zh}/{errors,validation}.json
  scripts/       ← migrate.ts (corre al arrancar el contenedor), import-legacy-integrations.ts,
                   create-platform-admin.ts (npm run platform:admin)
  prisma/        ← PrismaModule: registra el proxy multitenant bajo el token PrismaService
  common/
    constants/permissions.ts   ← catálogo de permisos + BASE_ROLES (ver §4.1)
    decorators/                ← GetUser, @Permissions/@AnyPermission, guards (Jwt, Permissions, Branch), throttlers
    encryption/                ← EncryptionService (AES-256-GCM)
    utils/                     ← pricing.ts, permission.util.ts, token-hash.ts
  modules/
    auth · users (+ addresses) · products (+ product-translations) · category · collections
    cart (+ CartCleanupService) · orders · payments (+ webhook, Stripe Connect, payment-settings,
    payment-proofs) · branches (+ InventoryService) · roles · mail · marketing · reports (+ report-scope)
    pos · notifications · returns · chatbot · platform · store · try-on · appearance · analytics
```
`ValidationPipe` global: `whitelist: true`, **`forbidNonWhitelisted: false`** (ver §5.1.2), `transform: true`, `enableImplicitConversion`. Los errores de validación se lanzan como `ValidationFailedException` y los traduce `I18nExceptionFilter`.

Gestor de paquetes: **npm** (`api/package-lock.json`); también está trackeado `api/bun.lock` (§5.1.5). `postinstall` genera **los dos** clientes Prisma.

### 2.4 App móvil (`app_movil/`)

Cliente Expo/React Native independiente conectado a la **misma API NestJS**.

```
src/
  screens/  auth/{Login,Register}, shop/{Products,ProductDetail}, cart/{Cart,Checkout},
            orders/{Orders,OrderDetail}, payments/Payment, profile/{Profile,EditProfile,ChangePassword},
            tenant/TenantSelectorScreen (nuevo)
  context/  AuthContext, BranchContext, CartContext, TenantContext (nuevo)
  config/   env.ts (URL de la API; por defecto la de Azure) · tenant.ts (tienda activa en memoria + AsyncStorage)
  api/      client.ts (axios: x-tenant-id, refresh token con cola, auto-logout; ante TENANT_REQUIRED
            muestra el selector de tienda en vez de cerrar sesión) + *.api.ts por módulo
  i18n/     index.ts + locales/{es,en,fr,zh}.json · components/LanguageSelector.tsx
```
- Builds de una sola tienda: `EXPO_PUBLIC_TENANT_ID`. Sin eso, el usuario elige la tienda en `TenantSelectorScreen`. Los tokens y la sucursal guardados quedan atados a la tienda que los emitió.
- **No existe `eas.json`.**
- `app_movil/README.md` menciona cuentas de prueba (`admin@gmail.com` / `Admin123*`) **distintas** a las del seed (`superadmin@stellafemme.com`): no confiar en ese README; la fuente de verdad es `api/prisma/seed.mjs`.

---

## 3. Base de datos (Prisma / PostgreSQL, multi-schema)

**Modelo de aislamiento: un schema de PostgreSQL por tienda**, en la misma base:

| Schema | Contenido |
|---|---|
| `public` | **Plano de control** (`prisma/control/schema.prisma`): `tenants`, `tenant_signups`, `tenant_integrations`, `tenant_credentials` + su `_prisma_migrations` |
| `tenant_legacy` | La tienda original (el antiguo `public` renombrado). Id fijo `00000000-0000-4000-8000-000000000001`, slug `stella-femme` |
| `tenant_<uuid sin guiones>` | Cada tienda nueva. Mismas tablas que `tenant_legacy` (`prisma/schema.prisma`) y su propia `_prisma_migrations` |
| `<schema>_reporting` | Vistas de solo lectura para los reportes con IA de cada tienda, con un rol `reports_<sufijo>` NOLOGIN |

Al escribir este documento, la BD Neon tiene `public`, `tenant_legacy`, `tenant_9107a2f4…` y sus dos `_reporting`.

### 3.1 Plano de control (`public`)
| Modelo | Campos clave / notas |
|---|---|
| **Tenant** | `id` (uuid), `slug` (único, subdominio), `name`, `schemaName` (único), `domain?` + `domainVerifiedAt?` (dominio propio; **solo se enruta si está verificado**), `status` (`PROVISIONING/ACTIVE/SUSPENDED/FAILED`), `plan`, `schemaVersion` (última migración aplicada), `provisionError?`. Stripe Connect: `stripeAccountId`, `stripeChargesEnabled`, `platformFeeBps` (comisión en puntos básicos). Suscripción al SaaS: `stripeCustomerId`, `stripeSubscriptionId`, `subscriptionStatus` |
| **TenantSignup** | Alta self-service pendiente de pago (`PENDING/PROVISIONING/COMPLETED/FAILED/EXPIRED`). Guarda el hash bcrypt de la contraseña del dueño para que **no viaje en la metadata de Stripe**; se vacía al completar o expirar. `tenantId` se fija antes de aprovisionar para que un reintento retome la misma tienda |
| **TenantIntegration** | PK `(tenantId, provider)`, `provider` ∈ `DECART`, `WEBPUSH`, `STRIPE` (reservado). `encryptedData` = `"<versión de llave>:<base64(ciphertext‖tag)>"` + `iv`. AAD = `"<tenantId>:<provider>"`: copiar el valor a otra tienda no descifra |
| **TenantCredential** | `OWNER_PASSWORD` / `API_KEY`, `identifier`, `secretHash` (bcrypt), expiración y revocación |
| **PlatformAdmin** | Administradores del SaaS (`/plataforma`): `email` (único, en minúsculas), `passwordHash` (bcrypt), `name?`, `isActive`, `loginAttempts`/`lockedUntil`, `lastLoginAt`. Ver §4.17 |

### 3.2 Schema de tienda (`prisma/schema.prisma`)
Modelos: `Role`, `User`, `UserAddress`, `Product`, `Branch`, `ProductInventory`, `Collection`, `Category`, `OrderItem`, `CartItem`, `Order`, `Cart`, `Return`, `ReturnItem`, `PushSubscription`, `Payment`, **`PaymentSettings`**, **`PaymentProof`**, **`StoreAppearance`**, **`DashboardLayout`** (+ enums `OrderStatus`, `FulfillmentType`, `OrderSource`, `PaymentMethod`, **`UsdtNetwork`**, **`PaymentProofStatus`**, `PaymentStatus`, `ReturnReason`, `ItemCondition`).

| Modelo | Campos clave / notas |
|---|---|
| **Role** | `id`, `name` (único), `description?`, `permissions String[]` |
| **User** | `email` (único **dentro de la tienda**: el mismo email puede existir en dos tiendas), `password` (bcrypt), `roleId`, `branchId?` (personal), `preferredBranchId?`, `employeeDiscount`, `refreshToken?` (hash SHA-256), OTP de recuperación, `loginAttempts/lockedUntil`, relaciones de POS, devoluciones y push |
| **Branch** | `name`, `address?`, `latitude?/longitude?`, `phone?`, `isActive` |
| **Product** | `name`/`description` (texto base en español: búsqueda, reportes, POS, pedidos), **`translations Json`** (`{ en: {name, description}, fr: …, zh: … }`; la API devuelve name/description ya resueltos según el idioma del request), `sizes[]`, `colors[]`, `price`, `stock` (global, legado), `sku` (único), `imageUrl?`, `categoryId`, `branchId?` + `exclusiveToBranch`, m2m con `Collection` |
| **ProductInventory** | `@@unique([productId, branchId, size])`: stock **por producto + sucursal + talla**. `damagedStock` (mermas). `discountPrice`/`discountPercentage` por producto+sucursal (sincronizados entre tallas) |
| **Collection** / **Category** | Sin cambios: colección = campaña, categoría = tipo de prenda |
| **Cart / CartItem** | `CartItem` único por `(cartId, productId, size)`, con `branchId?` = sucursal donde se reservó el stock |
| **Order** | `shippingCost`, `paymentStatus`, `stripePaymentIntentId` (único), `paymentMethod`, `source` (`WEB/POS`), `cashierId`, `nit`/`razonSocial`, `returns[]`, `paymentProof?` |
| **PaymentMethod** (enum) | `STRIPE`, `CASH`, `PHYSICAL_CARD`, `QR` (simulado), **`BANK_QR`**, **`USDT`** |
| **PaymentSettings** *(nuevo)* | Fila única `id = "default"`: `qrEnabled`, `qrImage` (BYTEA) + `qrImageType`, `qrInstructions`, `usdtEnabled`, `usdtNetwork` (`TRC20/ERC20/BEP20/POLYGON`), `usdtWalletAddress` |
| **PaymentProof** *(nuevo)* | Uno por pedido (`orderId` único): `method`, `image?` (BYTEA, comprobante QR) o `txId?` (USDT, único entre pedidos), `status` (`PENDIENTE/APROBADO/RECHAZADO`), `reviewedById`, `reviewedAt` |
| **StoreAppearance** *(nuevo)* | Ver §4.13b |
| **DashboardLayout** *(nuevo)* | Ver §4.13c |
| **Return / ReturnItem / PushSubscription / Payment / UserAddress** | Sin cambios de fondo (ver §4.11) |

### 3.3 Migraciones
**Tienda** (`prisma/migrations/`, 30 en total). Las últimas, posteriores al doc anterior: `returns_and_damaged_stock` (`20260927120000`) → **`tenant_scoped_reporting`** (`20261024120000`, crea `<schema>_reporting` y el rol `reports_<sufijo>` para la tienda que se está migrando, y elimina el viejo schema `reporting`) → **`product_translations`** (`20261025090000`) → **`manual_payments`** (`20261025180000`) → **`store_appearance`** (`20261026120000`) → **`store_appearance_theme`** (`20261026150000`) → **`dashboard_layouts`** (`20261026180000`).

**Control** (`prisma/control/migrations/`): `20261024130000_control_init` → `20261031120000_platform_admins` (aplicada en Neon el 2026-10-31).

**Paso único a multitenant (ya ejecutado en Neon):** `control/sql/001_split_public_into_tenant_legacy.sql` (renombra `public` → `tenant_legacy` y crea un `public` vacío) → `npx prisma migrate deploy --config prisma.control.config.ts` → `control/sql/002_register_legacy_tenant.sql` (registra la tienda legacy con el id fijo). No volver a correrlos.

**Comandos (desde `api/`):**
- `npm run migrate:control` → migra `public`.
- `npm run build && npm run migrate:all` → migra `public` y **todas** las tiendas ACTIVE/SUSPENDED (`dist/scripts/migrate.js`; es lo que corre el contenedor al arrancar). Si una tienda falla se loguea y se sigue; `MIGRATE_STRICT=true` lo vuelve fatal.
- **No correr `npx prisma migrate deploy` a secas:** con `prisma.config.ts` aplicaría las migraciones de tienda sobre `public`.
- Migrar siempre con la **URL directa** de Neon (`DIRECT_URL`, sin `-pooler`): PgBouncer rompe los advisory locks de `migrate`. En producción es obligatoria.
- `npx prisma generate` (tiendas) y `npx prisma generate --config prisma.control.config.ts` (control); `postinstall` corre los dos.
- `migrate dev` sigue sin servir cuando el cambio migra datos existentes (la migración se escribe a mano).

### 3.4 Datos iniciales (`api/prisma/seed.mjs`)
Siembra **un** schema de tienda, nunca `public`: `TENANT_SCHEMA=tenant_legacy npm run seed` (sin `TENANT_SCHEMA` válido aborta). Es idempotente y solo para desarrollo. Las tiendas nuevas ya nacen con roles base y su Super Admin (el dueño) vía `TenantProvisioningService`.

| Rol | Permisos |
|---|---|
| Super Admin | todos (`ALL_PERMISSIONS`) |
| Admin Sucursal | `MANAGE_USERS, MANAGE_INVENTORY, MANAGE_PRODUCTS, VIEW_ORDERS, SEND_MARKETING, VIEW_REPORTS, USE_POS, PROCESS_RETURNS` |
| Empleado | `USE_POS, PROCESS_RETURNS` |
| Cliente | ninguno |

---

## 4. Estado actual de funcionalidades

### 4.0 Multitenancy — cómo se resuelve la tienda de cada request
- **API (`api/src/tenancy/`):** `TenantMiddleware` corre en todas las rutas bajo `/api/v1`, salvo `platform/*`, `GET /` (health), `POST /payments/webhook` y Swagger. Resuelve la tienda por **header `x-tenant-id` (UUID)** o, si no viene, por **subdominio** (`<slug>.<TENANT_BASE_DOMAIN>`). Si falta, es inválida o la tienda no está `ACTIVE`, responde **401 con `code: "TENANT_REQUIRED"`** (mismo mensaje en todos los casos, para no revelar qué tiendas existen). La resolución se cachea 60 s (`TenantResolutionCache`; suspender una tienda invalida la caché).
- El contexto (`tenantId`, `schemaName`) queda en `req.tenant` y en un `AsyncLocalStorage` (`tenant-context.ts`). Para crons, colas y scripts: `runInTenant(ctx, fn)`.
- **Acceso a datos:** `TenantPrismaService` mantiene un `PrismaClient` por schema (LRU, `TENANT_CLIENT_CACHE`, default 100) sobre **un solo `pg.Pool`**, con `PrismaPg(pool, { schema })`, así las queries de modelos van calificadas con el schema. Los ~30 servicios existentes siguen inyectando `PrismaService`: `PrismaModule` registra bajo ese token un **Proxy** (`tenant-prisma.proxy.ts`) que resuelve cada acceso al cliente de la tienda del request.
  - **SQL crudo:** Prisma no califica `$queryRaw`. Usar `tenantSchemaSql()` (`Prisma.sql\`... FROM ${tenantSchemaSql()}.orders\``) o `TenantPrismaService.transaction()`, que hace `SET LOCAL search_path` (seguro con PgBouncer). Una tabla sin calificar cae en `public` y da "relation does not exist".
  - Los nombres de schema se validan contra `^tenant_([a-f0-9]{32}|legacy)$` antes de interpolarse en SQL.
- **JWT atado a la tienda:** access y refresh token llevan `tenantId`. `JwtStrategy` rechaza un token cuyo `tenantId` no coincide con `req.tenant`; los tokens anteriores al multitenant (sin `tenantId`) deben renovarse.
- **Links salientes** (correos, QR, push) llevan `?tenant=<id>` (`withTenantParam`) para que quien los abra caiga en la tienda correcta.
- **Front (`front/utils/tenant.ts`):** la tienda activa se resuelve una vez por carga de página, en este orden: cookie `sf_tenant` (dominio propio, la pone `proxy.ts`) → `?tenant=<uuid>` (se recuerda en `localStorage`) → la última recordada → `NEXT_PUBLIC_TENANT_ID`. Axios manda `x-tenant-id`; ante `TENANT_REQUIRED`, `<TenantGate/>` muestra el selector de tienda. `switchTenant()` cambia y recarga. Redux-persist, IndexedDB y la caché del SW usan claves **por tienda**; `legacyStorageMigration.ts` migra los datos locales de antes del multitenant solo si el navegador opera la tienda legacy.
- **Dominios propios (`front/proxy.ts`):** en un Host que no es de la plataforma (`PLATFORM_HOSTS`, default `localhost,127.0.0.1` + IPs privadas), el proxy consulta `GET /platform/tenants/by-domain` (con `INTERNAL_API_KEY`), cachea el resultado, reescribe `/api/v1/*` hacia la API **pisando** el `x-tenant-id` del navegador, fija la cookie `sf_tenant` y responde 404 en las páginas del SaaS. En `localhost` no resuelve nada: el navegador manda el header directo a la API.
- **Alta de tiendas (`TenantProvisioningService`):** crea el schema, corre las migraciones de tienda (`TenantMigrationService`, invoca el CLI de Prisma como proceso hijo en cola), crea los roles base y el Super Admin, y opcionalmente genera claves VAPID. Si falla queda `FAILED` y se reintenta con `POST /platform/tenants/:id/retry`.
- **Credenciales por tienda (`TenantSecretsService`):** Decart y Web Push ya **no** usan variables de entorno globales; viven cifradas en `public.tenant_integrations` con la llave maestra `TENANT_SECRETS_KEYS` (rotable por versión). Se cargan desde el panel de plataforma. `src/scripts/import-legacy-integrations.ts` importó una vez las claves globales viejas a la tienda legacy.

### 4.1 Autenticación, roles y permisos
OTP de 6 dígitos para recuperar contraseña (5 intentos, 10 min), bloqueo de login a 3 intentos por 5 min, JWT con `role/permissions/branchId/tenantId` sin consultar la BD, refresh token hasheado SHA-256, "Mi cuenta" con perfil/direcciones/sucursal favorita. Permisos nuevos: **`MANAGE_PAYMENTS`** (medios de cobro: Stripe, QR bancario, USDT) y **`MANAGE_APPEARANCE`** (apariencia de la tienda); antes ya se habían sumado `USE_POS` y `PROCESS_RETURNS`. Los espejos que hay que mantener sincronizados si se agrega un permiso:
- `api/src/common/constants/permissions.ts` (fuente de verdad, incluye `BASE_ROLES`, que usa el aprovisionamiento)
- `front/utils/permissions.ts` (`Permission`, `PERMISSION_OPTIONS`, `PANEL_PERMISSIONS`)
- `api/prisma/seed.mjs` (copia de `BASE_ROLES`, JS plano)
- las claves de traducción del permiso en los 4 `front/messages/*.json`

`front/components/modules/admin/adminNav.ts` define el menú lateral; `/admin/suscripcion` es `superAdminOnly`. Un Super Admin **de una tienda** no es administrador **de la plataforma** (eso es la llave `PLATFORM_ADMIN_KEY`, §4.17).

### 4.2 Catálogo, sucursales, colecciones y stock por talla
- El stock real vive en `ProductInventory`, **por talla**: `InventoryService.getInventoryForSize/getStockForSize` son el chequeo real (POS y órdenes); `getInventory/getInventoryMap` devuelven el agregado para el catálogo. Ofertas por producto+sucursal, sincronizadas entre tallas.
- **Exclusividad de sucursal** (`Product.branchId/exclusiveToBranch`) = visibilidad, independiente del stock.
- **Colecciones**: lectura pública, CRUD con `MANAGE_PRODUCTS`.
- **Traducciones del catálogo:** `Product.translations` (en, fr, zh); el panel de productos las edita. Validación propia en `products/product-translations.ts` (`@IsProductTranslations`, rechaza idiomas o campos extra). La respuesta de la API ya viene en el idioma del request.
- Selector de sucursal (`BranchSelector` en web, `BranchContext` en móvil) = fuente de `?branchId=`.

### 4.3 Carrito y checkout (web)
- Carrito por Redux, líneas por `productId + selectedSize`; una fila por talla en el backend.
- **El carrito reserva stock real al agregar** (`CartService.addItem`), guardado en `CartItem.branchId`. `CartCleanupService` corre cada 15 min y libera carritos sin actividad por más de 1 h (recorre las tiendas con `runInTenant`). `OrdersService.create` consume la reserva y descuenta solo la diferencia.
- Checkout en 3 pasos (Entrega → Pago → Completado). Medios ofrecidos según `GET /store/payment-options` y `GET /payments/connect/availability`: **tarjeta** (solo si la tienda completó Stripe Connect), **QR bancario** y **USDT** (si están activos y completos; `ManualPaymentSection.tsx`) y el QR simulado heredado.
- **Cola offline**: si `POST /orders` falla por red, el pedido va a IndexedDB y se reintenta; el usuario ve `/checkout/offline-success`.

### 4.4 Pedidos, pagos, facturas y webhook de Stripe
- `OrdersService.create` calcula precios en servidor y ajusta el stock por talla.
- **Tarjeta = Stripe Connect con destination charges** (`payments/stripe-connect.service.ts`): el PaymentIntent se crea en la cuenta de la plataforma con `transfer_data.destination = acct_` de la tienda y `application_fee_amount` según `Tenant.platformFeeBps`. **Sin cuenta conectada y habilitada, el pago con tarjeta responde 400**: nunca se cobra a la cuenta central. Onboarding desde `/admin/settings/payments` (`POST /admin/settings/payments/stripe/onboarding`, cuenta Express); `DELETE .../stripe` desvincula sin borrar la cuenta en Stripe. La tienda legacy necesita su `stripe_account_id` cargado a mano (ver comentario de `002_register_legacy_tenant.sql`).
- `POST /payments/create-intent` calcula el monto desde `order.totalAmount`; el cliente no envía monto.
- **Pagos manuales (QR bancario y USDT)** — `payment-settings.service.ts` / `payment-proofs.service.ts`:
  - La tienda configura en `/admin/settings/payments` la imagen de su QR bancario (PNG/JPEG/WebP validados **por bytes**) e instrucciones, y/o red + wallet USDT (dirección validada según la red). Un medio solo se activa completo.
  - El cliente crea el pedido (queda `PENDIENTE` con el stock reservado) y sube el comprobante (`POST /orders/:id/payment-proof`): imagen para QR, TxID para USDT (un TxID no puede pagar dos pedidos). Puede reemplazarlo mientras no se revisó.
  - El admin lo revisa en Pedidos (`VIEW_ORDERS`): **aprobar** = mismo cierre que una tarjeta (Payment COMPLETADO, pedido PROCESANDO, carrito cerrado, factura); **rechazar** = cancela el pedido y repone el stock. La aprobación está condicionada a `PENDIENTE` (dos clics no aprueban dos veces).
- **Webhook de Stripe** (`POST /payments/webhook`, sin tenant ni JWT; validado por firma con `rawBody`). Acepta **dos secretos**: `STRIPE_WEBHOOK_SECRET` (cuenta de la plataforma: `payment_intent.*`, `checkout.session.*`, `customer.subscription.*`) y `STRIPE_CONNECT_WEBHOOK_SECRET` (cuentas conectadas: `account.updated`). Resuelve la tienda desde `metadata.tenantId` + `transfer_data.destination`; PaymentIntents viejos sin `tenantId` caen en **`LEGACY_TENANT_ID`**. En local: `stripe listen --forward-to localhost:3001/api/v1/payments/webhook` (para eventos de Connect hace falta `--forward-connect-to`).
- QR simulado (`/payments/qr/*`) sigue existiendo (`Order.paymentMethod = QR`).
- Factura PDF sin cambios (`InvoiceService`, se envía por correo al confirmar el pago).

### 4.5 Punto de venta físico (POS)
`api/src/modules/pos/`, permiso `USE_POS`, ruta `/admin/pos`. `GET /pos/products` (stock de la sucursal del cajero; `?branchId=` solo con `ALL_BRANCHES`), `POST /pos/checkout` (`CASH/PHYSICAL_CARD/QR`, el servidor calcula el cambio, "Consumidor Final" automático, NIT/razón social). Orden `ENTREGADO`/`COMPLETADO`, `source: POS`, sin Stripe ni correos.

### 4.6 Notificaciones push (Web Push)
`NotificationsService` (`@Global()`). Las claves VAPID son **por tienda** (`TenantSecretsService`, provider `WEBPUSH`); se cargan o generan desde `/plataforma` (`PUT|POST /platform/tenants/:id/integrations/web-push[/generate]`). Sin claves, el envío se omite sin romper nada. `GET /notifications/vapid-public-key` devuelve la de la tienda del request. Suscripción por `POST /notifications/subscribe` (upsert por `endpoint`); borra suscripciones invalidadas (404/410). UI en `/admin/notifications` y en "Mi cuenta".

### 4.7 Reportes con IA (Groq)
`ReportsService` usa el SDK `openai` contra **Groq** (`GROQ_API_KEY`, `GROQ_MODEL`, default `openai/gpt-oss-120b`). Seguridad **por tienda**: `validateGeneratedSql` (`reports/sql-guard.ts`) + ejecución con `SET LOCAL ROLE reports_<sufijo>` sobre las vistas de `<schema>_reporting`, timeout de 5 s, 500 filas. Aunque la IA nombre las vistas de otra tienda, PostgreSQL lo rechaza por permisos. El alcance de sucursal y el rango de fechas salen de `reports/report-scope.ts` (compartido con analítica).

### 4.8 Marketing por correo y SMTP
Sin cambios de fondo (`POST /marketing/send-campaign`, saneo de HTML, lotes de 10, sin unsubscribe). `MailModule` no lanza errores (solo loguea). Sin `SMTP_HOST`, los correos solo se loguean.

### 4.9 Panel administrativo
Rutas en §1. Destacados nuevos: **`/admin/settings/payments`** ("Gestión de pagos": Stripe Connect + QR bancario + USDT, `MANAGE_PAYMENTS`), **`/admin/settings/appearance`** (`MANAGE_APPEARANCE`), **`/admin/reports/dashboard`** (`VIEW_REPORTS`), **`/admin/suscripcion`** (plan del SaaS de la tienda, solo Super Admin, §4.17). Pedidos muestra y revisa los comprobantes de pago manual.

### 4.10 PWA y compra resistente a fallos
Operación, políticas y despliegue en `docs/checkout-resiliente.md`. Comprobado con `api/test/acceptance` (PostgreSQL real, dos procesos, Chromium sobre build de producción).
- **Inventario:** `ProductInventory.stock` = disponibles. Reservas explícitas (`StockReservation`), movimientos con `effectId` único e `inventory.version`. Sin fallback a otra sucursal ni al stock global; `Product.stock` es solo informativo. Todos los escritores (carrito, checkout, cron, POS, cancelación, devolución, aprobación, panel) pasan por `InventoryService`.
- **Checkout:** `POST /orders` exige `Idempotency-Key` y `cartVersion`; todo se confirma en una transacción (`CheckoutAttempt`). Carrito activo único (`Cart.activeUserId`) con revisión. El web sincroniza con `PUT /cart`.
- **Pagos:** intento durable antes de llamar a Stripe (`PaymentAttempt`), inbox de webhooks en el plano de control (`ProviderEventInbox`), outbox de correo/push (`OutboxEvent`), compensaciones (`PaymentCompensation`) y anomalías (`OperationalIssue`). `CheckoutMaintenanceService` corre cada minuto. QR simulado y autoconfirmación solo con `ALLOW_SIMULATED_PAYMENTS` fuera de producción.
- **Web:** `front/public/sw.js` escrito a mano (no Workbox/next-pwa, incompatibles con Turbopack), con lista permitida: solo catálogo público, páginas públicas por tienda e idioma, y assets. Lo privado nunca entra a Cache Storage. Actualización con aviso, sin recarga automática. Intentos recuperables en IndexedDB (`utils/checkoutAttempts.ts`, `useCheckoutRecovery`) por tienda y usuario. Los borradores offline (`/checkout/drafts`) nunca se envían solos. Manifest en `/web-manifest` e íconos en `/pwa-icon`, por tienda.
- **Móvil:** mismo contrato, con `src/utils/checkoutAttempts.ts` (AsyncStorage) y `CheckoutRecovery` (AppState). La tarjeta real sigue pendiente de un SDK de Stripe.

### 4.11 Devoluciones y mermas
`api/src/modules/returns/`, permiso `PROCESS_RETURNS`, ruta `/admin/returns`. `GET /returns/search-order` (ventas cobradas y no canceladas), `POST /returns/process` (transacción: tope contra devoluciones anteriores, reembolso desde el precio histórico, `SELLABLE` → `stock`, `DAMAGED` → `damagedStock`, `REEMBOLSADO` si ya no queda nada), `GET /returns`, `GET /returns/:id`. La talla se copia del `OrderItem`; la sucursal que recibe puede no ser la que vendió.

### 4.12 Probador Virtual (Decart)
- `front/components/modules/product/VirtualTryOnModal.tsx`, botón "Probarme virtualmente" en el detalle; requiere sesión.
- **Cambio:** el token efímero (`ek_...`) ahora lo firma **la API** (`POST /api/v1/try-on/session`, `JwtAuthGuard`, `api/src/modules/try-on/`) con la **key Decart de la tienda** (cifrada en `tenant_integrations`). Sin key configurada responde **503** ("no está habilitado en esta tienda"). Se eliminó `front/app/api/decart/session/route.ts`; queda `GET /api/decart/garment?url=` (proxy de la imagen con bloqueo de hosts privados).
- Control de costo: token de 60 s, techo de sesión de 25 s, corte del cliente a los 15 s.
- Modelo `lucy-vton-latest`, WebRTC sobre la cámara. **No es 3D.**

### 4.13 Chatbot (Botpress)
- API: `GET /chatbot/products` público (sin JWT, pero **sí con tienda**), throttle relajado, catálogo aplanado con stock por talla y precio de la sucursal, moneda `BOB`; 503 si la BD falla.
- Front: `components/modules/chatbot/BotpressChat.tsx` (Botpress v3.7, configuración externa hardcodeada).

### 4.13b Personalización de la tienda (apariencia)
Modelo `StoreAppearance` (tabla `store_appearance` en cada schema de tienda, una fila `id = "default"`, migración `20261026120000_store_appearance`): `logoUrl`, `faviconUrl`, `primaryColor` (`#000000`), `secondaryColor` (`#ffffff`), `description`, `socialLinks` (JSONB `[{platform, url}]`). Permiso **`MANAGE_APPEARANCE`**.
- API (`api/src/modules/appearance/`): `GET|PATCH /admin/settings/appearance` (crea la fila con defaults si no existe), `PUT /admin/settings/appearance/logo|favicon|background` (multipart, PNG/JPEG/WebP validados por bytes, máx. 256 KB / 64 KB / 512 KB, guardados como **data URL** porque un `<img>` público no puede mandar `x-tenant-id`) y público `GET /store/appearance`.
- Front: `/admin/settings/appearance` (`components/modules/appearance/`, vista previa en vivo). `app/layout.tsx` lee la apariencia en el servidor (`utils/storeAppearance.server.ts`, fetch cacheado 5 min con tag `store-appearance:<tenantId>`, que el panel expira con la Server Action `refreshStoreAppearance`) e inyecta `--color-primary`/`--color-secondary` en `<body>`; logo en el `Header`, redes en el `Footer` (`StoreAppearanceProvider`), descripción y favicon en los metadatos.
- Tema granular (migración `20261026150000_store_appearance_theme`): `fontFamily` (catálogo cerrado `FONT_FAMILIES`: Inter, Playfair Display, Montserrat, Roboto, Poppins → `front/utils/fonts.ts`, variable `--font-store`), `navbarBackgroundColor`, `navbarTextColor`, `searchBarBackgroundColor`, `storeBackgroundColor`, `storeBackgroundImage` y `adminMenuColor`. `utils/appearanceTheme.ts` arma las variables CSS. El fondo lo sirve `app/store-assets/background/route.ts`, versionado con `?v=<updatedAt>`.

### 4.13c Dashboard interactivo de analítica
Modelo `DashboardLayout` (tabla `dashboard_layouts`, uno por usuario, `widgetsConfig` JSONB `[{ i, x, y, w, h, type, metric }]`; migración `20261026180000_dashboard_layouts`). API `api/src/modules/analytics/` (`VIEW_REPORTS`): `GET|PUT /analytics/layout` (sin diseño guardado devuelve el predeterminado sin escribirlo; valida ids únicos, 12 columnas y compatibilidad gráfico/métrica) y `GET /analytics/metrics?from&to&branchId` (ingresos diarios, top 5 productos, totales). Front: `/admin/reports/dashboard` (`components/modules/analytics/`, `react-grid-layout` 2.x + `recharts`), con acceso desde Reportes.

### 4.14 Contrato front ↔ API
`NEXT_PUBLIC_API_URL`; **toda request lleva `x-tenant-id`** (salvo `/platform/*`) y el idioma (`Accept-Language` / `x-lang` / `?lang=`); 401 con `code: TENANT_REQUIRED` ≠ sesión vencida (no hacer refresh ni logout, mostrar selector de tienda). Pedido con `items[].{productId, quantity, size}`, carrito con `branchId`, refresh token en `Authorization: Bearer`, devoluciones por `orderItemId`, probador con `Authorization` hacia `POST /try-on/session`. Los mensajes de error de la API llegan ya traducidos; `error.utils.ts` los centraliza en el front.

### 4.15 Referencia rápida de endpoints (detalle real en Swagger `/api/docs`)
- **auth:** `register|login|refresh|logout|forgot-password|verify-otp|reset-password`
- **users:** `GET/PATCH /users/me`, `PATCH /users/me/password`, `DELETE /users/me`, `GET|POST /users/staff`, `PATCH /users/staff/:id`, direcciones en `/users/me/addresses[...]`
- **branches:** `GET /branches`, `GET /branches/manage/all`, `POST/PATCH/DELETE`, `GET|PUT /branches/:branchId/inventory[/:productId]`
- **roles:** `GET|POST /roles`, `GET /roles/assignable`, `GET|PATCH|DELETE /roles/:id`
- **products:** `GET /products[?branchId]`, `GET /products/:id[?branchId]`, `POST|PATCH|DELETE` (con `translations`), `PUT /products/:productId/discounts/bulk`, `PATCH /products/:id/stock`
- **categories / collections:** lectura pública; escritura con `MANAGE_PRODUCTS`
- **cart:** `GET /cart[?branchId]`, `POST /cart/items`, `PATCH|DELETE /cart/items/:itemId`, `DELETE /cart`
- **orders:** `POST /orders`, `GET /orders`, `GET /orders/me`, `GET /orders/:id`, `GET /orders/admin/all`, `GET /orders/admin/:id`, `PATCH|DELETE /orders/:id`, `PATCH|DELETE /orders/admin/:id`; **comprobantes:** `POST /orders/:id/payment-proof`, `GET /orders/admin/:id/payment-proof/image`, `POST /orders/admin/:id/payment-proof/approve|reject` (`VIEW_ORDERS`)
- **payments:** `POST /payments/create-intent|confirm`, `GET /payments[/:id]`, `GET /payments/order/:orderId`, `POST /payments/webhook` *(sin tenant ni guards, por firma)*, `GET /payments/connect/availability`; QR simulado: `POST /payments/qr/generate`, `GET /payments/qr/status/:orderId`, `POST /payments/qr/confirm`, `GET /payments/qr-confirm/:orderId`
- **gestión de pagos** (`MANAGE_PAYMENTS`): `GET|PATCH /admin/settings/payments`, `GET|PUT|DELETE /admin/settings/payments/qr-image`, `POST /admin/settings/payments/stripe/onboarding`, `DELETE /admin/settings/payments/stripe`; público: `GET /store/payment-options`, `GET /store/payment-options/qr-image`
- **store** (público, con tienda): `GET /store` (nombre y slug), `GET /store/appearance`
- **appearance** (`MANAGE_APPEARANCE`): `GET|PATCH /admin/settings/appearance`, `PUT /admin/settings/appearance/logo|favicon|background`
- **analytics** (`VIEW_REPORTS`): `GET|PUT /analytics/layout`, `GET /analytics/metrics`
- **try-on:** `POST /try-on/session` (JWT)
- **subscription** (JWT, tienda actual): `GET /subscription`, `POST /subscription/checkout`, `POST /subscription/portal`
- **platform** (sin tienda): `POST /platform/auth/login`, `GET /platform/auth/me` (Bearer de plataforma); `POST /platform/contact`; `POST /platform/subscriptions/checkout`, `GET /platform/subscriptions/checkout/:sessionId/status`; `GET /platform/tenants/resolve/:slug`; `GET /platform/tenants/by-domain` (`x-internal-key`); con sesión de administrador de plataforma o `x-platform-key`: `GET|POST /platform/tenants`, `GET /platform/tenants/metrics`, `PATCH /platform/tenants/:id/status|domain`, `POST /platform/tenants/:id/retry`, `PUT /platform/tenants/:id/integrations/decart|web-push`, `POST .../web-push/generate`, `DELETE .../integrations/:provider`, `POST /platform/subscriptions/signups/:id/retry`
- **pos:** `GET /pos/products`, `POST /pos/checkout` · **returns:** `GET /returns/search-order`, `POST /returns/process`, `GET /returns`, `GET /returns/:id`
- **notifications:** `GET /notifications/vapid-public-key`, `POST /notifications/subscribe` · **chatbot:** `GET /chatbot/products`
- **marketing:** `POST /marketing/send-campaign` · **reports:** `GET /reports/sales-overview|top-products`, `POST /reports/dynamic`

### 4.16 Internacionalización (es, en, fr, zh)
- **API:** `nestjs-i18n`; el idioma sale de `?lang=` → header `x-lang` → `Accept-Language` → español. Las excepciones llevan una **clave** (`i18nMessage('errors.PRODUCT_NOT_FOUND', args)`) que `I18nExceptionFilter` traduce; los mensajes libres viejos pasan tal cual. Diccionarios en `api/src/i18n/locales/<idioma>/{errors,validation}.json` (`nest-cli.json` los copia a `dist`).
- **Front:** `next-intl` sin prefijo de URL; `proxy.ts` negocia `Accept-Language` en la primera visita y fija la cookie `NEXT_LOCALE`; `LanguageSwitcher` la cambia. `LocaleCartSync` refresca los nombres del carrito al cambiar de idioma.
- **Móvil:** `i18next` + `expo-localization`, `LanguageSelector`.
- **Catálogo:** `Product.translations` (§4.2).

### 4.17 Plataforma SaaS (alta, suscripción y administración de tiendas)
- **Planes:** `starter`, `growth`, `pro` (`api/src/modules/platform/plans.ts`). El `price_id` sale de `STRIPE_PRICE_*`; los montos que muestra la landing (`front/components/modules/platform/plans.ts`) tienen que coincidir con los Prices de Stripe. Al arrancar, la API avisa qué variables de facturación faltan sin caerse.
- **Alta self-service:** `/planes` → `POST /platform/subscriptions/checkout` crea un `TenantSignup` y una sesión de Stripe Checkout (solo viaja `signupId` en la metadata) → el webhook `checkout.session.completed` aprovisiona la tienda y su Super Admin → `/planes/exito` consulta el estado. Si el aprovisionamiento falla, se reintenta desde la plataforma.
- **Suscripción de la tienda:** `/admin/suscripcion` (Super Admin) muestra el plan y abre Checkout o el Billing Portal de Stripe. Los webhooks `customer.subscription.updated|deleted` actualizan el estado y **suspenden** la tienda si deja de pagar.
- **Panel de plataforma (`/plataforma`):** se entra con **email y contraseña** de un administrador de la plataforma (tabla `public.platform_admins`, bcrypt). `POST /platform/auth/login` devuelve un JWT de 8 h con audience `stella-platform` (firmado con `PLATFORM_JWT_SECRET` o, si no está, `JWT_SECRET`), sin refresh; el panel lo guarda solo en `sessionStorage`. Bloqueo de 5 min tras 5 intentos fallidos y throttle de 10 logins/min por IP. `PlatformAdminGuard` acepta ese Bearer (y en cada request verifica que la cuenta siga activa) **o** la llave `PLATFORM_ADMIN_KEY` en `x-platform-key` (≥ 32 caracteres, para scripts). Un token de tienda no sirve en la plataforma ni viceversa. Los administradores se crean o se les cambia la contraseña con `npm run build && npm run platform:admin -- <email> <contraseña> ["Nombre"]` (también desbloquea y reactiva); no hay pantalla para gestionarlos. El panel permite listar, crear, suspender y reactivar tiendas, ver métricas, verificar dominios propios, reintentar altas y cargar las integraciones Decart y Web Push.
- **Contacto:** `POST /platform/contact` (throttle, la IP real sale de `trust proxy`) → correo a `SUPPORT_EMAIL`.

---

## 5. Limitaciones conocidas, deuda técnica y cosas a verificar antes de confiar en ellas

### 5.1 Bugs / decisiones riesgosas confirmadas leyendo el código actual
1. **CORS efectivamente abierto a cualquier origen.** En `api/src/main.ts`, el callback de `origin` termina en `return callback(null, true)` en todas las ramas: el chequeo contra `ALLOWED_ORIGINS` es código muerto. Para restringir CORS hay que arreglar ese último `return`.
2. **`ValidationPipe.forbidNonWhitelisted` es `false`:** los campos fuera del DTO se descartan en silencio (commit `feb64e6`, por el `_t` de cache-busting). Relaja la validación de entrada en toda la API.
3. **Clave pública de Stripe hardcodeada en `docker-compose.yml`** (`pk_test_...`). Es la pública, pero conviene moverla a `.env`/secret si el repo se comparte.
4. **Webhook de Stripe sin guard** por diseño (firma). Quitar `rawBody: true` de `main.ts` rompe la verificación sin un error obvio; sacar la ruta de la exclusión de `TenantMiddleware` haría que Stripe reciba 401 y ningún pago se confirme (hay una doble barrera en `TENANTLESS_ROUTES`).
5. **Doble lockfile en `api/` y en `front/`** (`package-lock.json` + `bun.lock` en ambos). Hay que decidir el gestor oficial por proyecto.
6. **`app_movil/README.md` documenta credenciales y una BD Neon distintas** a las del seed. Verificar contra `api/prisma/seed.mjs`.
7. **No existe `app_movil/eas.json`.**
8. **`ProductDetail.tsx:106` conserva un comentario que dice que el probador "aún no existe".** Es obsoleto (§4.12).
9. **`DECART_API_KEY` ya se sacó de `docker-compose.yml`**, pero la key vieja (`dct_probador_...`) **sigue en el historial de git**: hay que rotarla en Decart si no se hizo. `api/.env` todavía tiene `DECART_API_KEY`, que solo lee el script `import-legacy-integrations`.
10. **La rama `oscar` es incompatible con la BD actual.** Es anterior a `edb3598` y usa un único `PrismaService` contra `public`; como el SQL `001_…` ya renombró `public` a `tenant_legacy`, cualquier query de negocio falla con `P2021 TableDoesNotExist`. Para trabajar con la BD actual usar `main`; para revivir `oscar` habría que rebasarla sobre `main` o darle su propia BD.
11. **`api/.env.example` está desactualizado:** no tiene `DIRECT_URL`, `TENANT_SECRETS_KEYS`, `PLATFORM_ADMIN_KEY`, `INTERNAL_API_KEY`, `STRIPE_CONNECT_WEBHOOK_SECRET`, `LEGACY_TENANT_ID` ni `TENANT_BASE_DOMAIN`, y todavía documenta `VAPID_*` globales (ya son por tienda). Usar la tabla de §6.4.
12. **`LEGACY_TENANT_ID` no está en `api/.env`.** Es el fallback del webhook para PaymentIntents creados antes del multitenant (sin `tenantId` en la metadata): sin la variable, esos eventos no encuentran tienda. Debería valer `00000000-0000-4000-8000-000000000001`.
13. **Docker del front sin tienda por defecto:** ni `front/Dockerfile` ni `docker-compose.yml` pasan `NEXT_PUBLIC_TENANT_ID`/`NEXT_PUBLIC_LEGACY_TENANT_ID` como build args (son `NEXT_PUBLIC_*`, se hornean en el build), ni `INTERNAL_API_KEY`/`PLATFORM_HOSTS` en runtime. Una imagen construida así abre el selector de tienda y no resuelve dominios propios. Confirmar cómo está configurado el deploy real en Azure.
14. **Comentarios desalineados sobre idiomas del catálogo:** la migración `product_translations` y `schema.prisma` mencionan `pt`, pero `TRANSLATABLE_LANGUAGES` solo acepta `en`, `fr`, `zh` (un `pt` se rechaza).
15. **El mismo email puede ser usuario de varias tiendas** (son tablas distintas). Es intencional, pero el login siempre es contra la tienda del request: entrar a la tienda equivocada da "credenciales inválidas", no "no existe".

### 5.2 Pendientes ya conocidos que siguen sin resolver
- **Reserva de stock en carrito:** si la API está caída, el cron no corre y la reserva queda tomada hasta el siguiente arranque.
- **Pagos manuales:** la verificación es 100 % humana; no hay consulta automática a la blockchain para USDT ni al banco para el QR, ni vencimiento automático de pedidos con comprobante sin revisar.
- **Stripe Connect:** la tienda legacy cobra con tarjeta solo si se le cargó `stripe_account_id` a mano o completó el onboarding.
- **Dominios propios:** la verificación del DNS la hace una persona desde `/plataforma` (no hay chequeo automático de TXT/CNAME).
- **Escala del multitenant:** un `PrismaClient` por schema en una LRU de 100 y las migraciones se aplican tienda por tienda al arrancar el contenedor; con cientos de tiendas el arranque se alarga.
- Devoluciones solo en mostrador; no hay baja de mermas ni reembolso de dinero real.
- Probador virtual: cuesta por segundo y depende de la key Decart de cada tienda.
- Chatbot: configuración en Botpress con URLs hardcodeadas; un solo bot para todas las tiendas.
- Cambios de rol/permisos tardan hasta 15 min (vida del access token); usuario eliminado sigue con token válido hasta que expire.
- Text-to-SQL: la seguridad real es el rol de solo lectura + vistas, no el validador por regex.
- Marketing: sin cola para miles de destinatarios, sin enlace de baja.
- Mapa: mosaicos públicos de OpenStreetMap, sin validar que la ubicación esté en la ciudad.
- Lint preexistente con varios `any`; los `*.spec.ts` (salvo `product-translations.spec.ts`) son plantillas sin ejecutar de verdad.

### 5.3 Historial de commits recientes (más nuevo primero, `git log --oneline`)
```
a2107ab reportes dashboard                              ← apariencia de la tienda + dashboard de analítica
271a5f3 Integracion de nuevos metodos de pago           ← QR bancario, USDT, comprobantes, MANAGE_PAYMENTS
edb3598 Migración a Multitenant                         ← schema por tienda, plataforma SaaS, Stripe Connect, i18n, try-on en la API
ae38fe1 fix(app_movil): resolve 'No refresh token' error, handle expired sessions and auto logout cleanly
4a6f91b fix(mobile/api): resolve mobile purchase stock sync with Neon database and branch inventory
97c325b feat(pwa): offline cart selection and admin/staff offline stock inventory sync with Neon
8cd3d28 feat(pwa): optimizar funcionamiento offline, almacenamiento en IndexedDB y desplegar v2.7 en Azure
9efa4e8 chore(docker): add DECART_API_KEY to front in docker-compose
fffafec v2.0.0                                          ← HEAD de la rama oscar
7eda63c probador
6645f77 Implemenracion del area de devoluciòn para la venta fisica
b675b6d fix: import PassportModule in PaymentsModule and define empty constructor on OptionalJwtAuthGuard
feb64e6 fix: remove _t query param and allow non-whitelisted params to prevent 400 on product catalog
239dd94 fix(store): descontar stock correctamente en compras, registrar pagos QR y Stripe en Neon, y eliminar cache estatico
```

### 5.4 Estado de git al escribir este documento
Rama `main`, HEAD `a2107ab`, sincronizada con `origin/main`; árbol de trabajo limpio. Existen también `oscar` y `origin/oscar` (en `fffafec`, ver §5.1.10). Correr `git status --short` y `git log --oneline -10` de nuevo antes de asumir que sigue siendo así.

---

## 6. Guía rápida para levantar el entorno

### 6.0 Requisitos
Node ≥ 22 para la API (lo exigen `openai@7` y `@nestjs/schematics@12`), Node ≥ 20 para el front, PostgreSQL (Neon o local), `bun` (front) y `npm` (api). Docker opcional.

### 6.1 Backend (`api/`)
```bash
cd api
npm install --legacy-peer-deps      # postinstall genera los dos clientes Prisma
# crear api/.env (ver §6.4; api/.env.example está incompleto)
# BD que ya está migrada a multitenant (la de Neon): no hay que migrar nada para levantar.
# BD nueva/vacía:
npm run migrate:control              # crea public (plano de control)
#   …y registrar una tienda (alta desde /plataforma, o 002_register_legacy_tenant.sql + migrar su schema)
npm run build && npm run migrate:all # migra public + todas las tiendas
TENANT_SCHEMA=tenant_legacy npm run seed   # datos demo, opcional
npm run dev                          # nest start --watch → http://localhost:3001/api/v1 (Swagger en /api/docs)
```

### 6.2 Frontend (`front/`)
```bash
cd front
bun install          # o: npm install
# crear front/.env.local (ver §6.4)
bun run dev          # → http://localhost:3000
```
Primero la API, luego el front. En `localhost` la tienda sale de `NEXT_PUBLIC_TENANT_ID` (o de `?tenant=<uuid>` en la URL); sin eso aparece el selector de tienda.

### 6.3 App móvil (`app_movil/`)
```bash
cd app_movil
npm install
# por defecto apunta a la API de Azure; ajustar src/config/env.ts o la pantalla de Login/Profile si se usa otra URL
# EXPO_PUBLIC_TENANT_ID fija la tienda; sin eso se elige en TenantSelectorScreen
npx expo start
```

### 6.4 Variables de entorno
**`api/.env`:**

| Variable | Uso |
|---|---|
| `PORT`, `NODE_ENV`, `ALLOWED_ORIGINS` | Servidor y CORS (ver §5.1.1: hoy no restringe nada) |
| `TRUST_PROXY_HOPS` | Saltos de proxy para la IP real (default 1) |
| `DATABASE_URL` | PostgreSQL/Neon (en Neon, la URL con `-pooler` sirve para la app) |
| `DIRECT_URL` | URL **directa** de Neon (sin `-pooler`), para migraciones. Obligatoria en producción |
| `DB_POOL_MAX`, `TENANT_CLIENT_CACHE` | Tamaño del pool (10) y de la LRU de clientes por tienda (100) |
| `JWT_SECRET`, `JWT_REFRESH_SECRET`, `JWT_EXPIRES_IN` | Firmas JWT |
| `TENANT_SECRETS_KEYS` | Llave maestra para cifrar credenciales de tiendas: `1:<base64 de 32 bytes>[,2:…]`. Generar: `node -e "console.log('1:'+require('crypto').randomBytes(32).toString('base64'))"` |
| `PLATFORM_ADMIN_KEY` | Llave de plataforma para scripts (`x-platform-key`, ≥ 32 caracteres). El panel `/plataforma` ya no la usa: entra con email y contraseña |
| `PLATFORM_JWT_SECRET` | Opcional: secreto de los tokens de administradores de plataforma (si falta se usa `JWT_SECRET`) |
| `INTERNAL_API_KEY` | Compartida con el front: autoriza `GET /platform/tenants/by-domain` desde `proxy.ts` |
| `TENANT_BASE_DOMAIN` | Opcional: resolver la tienda por subdominio (`<slug>.<dominio>`) |
| `LEGACY_TENANT_ID` | Id de la tienda legacy (fallback del webhook, §5.1.12) |
| `MIGRATE_STRICT`, `PRISMA_CWD` | Migraciones: fallar si una tienda no migra / cwd del CLI de Prisma |
| `STRIPE_SECRET_KEY` | Clave secreta de Stripe de la plataforma |
| `STRIPE_WEBHOOK_SECRET` | Webhook de la cuenta de la plataforma (`whsec_...`) |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | Webhook de cuentas conectadas (`account.updated`) |
| `STRIPE_PRICE_STARTER/GROWTH/PRO` | `price_...` de los planes del SaaS (sin ellos, ese checkout responde 503) |
| `SMTP_HOST/PORT/SECURE/USER/PASS`, `MAIL_FROM`, `SUPPORT_EMAIL` | Correo (sin `SMTP_HOST` solo se loguea) y bandeja del formulario de contacto |
| `FRONTEND_URL`, `PLATFORM_URL`, `PLATFORM_NAME` | Enlaces de correos de la tienda / landing del SaaS (success/cancel de Checkout) / nombre de la plataforma |
| `GROQ_API_KEY`, `GROQ_MODEL` | IA de reportes |
| `DECART_API_KEY`, `VAPID_*` | **Ya no los usa la API en runtime** (son por tienda). Solo los lee `import-legacy-integrations` |

**`front/.env.local`:** `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_TENANT_ID` (tienda por defecto; en local es la legacy `00000000-0000-4000-8000-000000000001`), `INTERNAL_API_KEY` (la misma que en la API). Opcionales: `NEXT_PUBLIC_LEGACY_TENANT_ID`, `API_INTERNAL_URL` (URL de la API vista desde el servidor del front), `PLATFORM_HOSTS` / `NEXT_PUBLIC_PLATFORM_HOSTS`. Ya **no** necesita `DECART_API_KEY`. El chatbot no usa variables.

**`app_movil`:** `EXPO_PUBLIC_TENANT_ID` (opcional).

### 6.5 Docker
`docker-compose.yml` levanta `api` (3001) y `front` (3000). `api/Dockerfile` (Node 22-alpine) genera los dos clientes Prisma y al iniciar corre `node dist/scripts/migrate.js && node dist/main` (migra control + todas las tiendas; requiere `DIRECT_URL`). `front/Dockerfile` (Node 20-alpine, `output: "standalone"`): las `NEXT_PUBLIC_*` se hornean en el build (ver §5.1.13 sobre las que faltan).

### 6.6 Problemas frecuentes (Windows)
- Puertos ocupados tras detener `npm run dev`: `Get-NetTCPConnection -LocalPort 3000,3001 -State Listen | Select -Expand OwningProcess -Unique | % { Stop-Process -Id $_ -Force }`
- **Cambiar de rama con `npm run dev` corriendo** deja a `nest --watch` compilando archivos que ya no existen (`TS6053 File ... not found`). Detener, borrar `api/tsconfig.build.tsbuildinfo`, volver a generar los clientes Prisma y relanzar.
- **401 `TENANT_REQUIRED`** al llamar a la API a mano: falta el header `x-tenant-id`.
- **500 `relation "public.<tabla>" does not exist`**: código pre-multitenant (rama `oscar`) o SQL crudo sin calificar con `tenantSchemaSql()`.
- Cambios en `schema.prisma` con la API corriendo: reiniciar tras migrar y regenerar.
- Sesión "vieja" en el navegador: Redux persiste en `localStorage` (por tienda); cerrar sesión o borrar el almacenamiento del sitio. Los tokens de antes del multitenant no traen `tenantId` y se rechazan.

---

## 7. Cómo usar este documento

- Si vas a tocar **datos de negocio**, lee §4.0: nunca uses `ControlPrismaService` para datos de una tienda, ni SQL crudo sin `tenantSchemaSql()`, ni un cron sin `runInTenant()`.
- Si vas a agregar una **migración**, va en `prisma/migrations/` (tienda) o en `prisma/control/migrations/` (control), y se aplica con `migrate:all` / `migrate:control`, nunca con `prisma migrate deploy` a secas (§3.3).
- Si vas a tocar **permisos**, actualiza los espejos de §4.1 y este documento.
- Si vas a agregar **texto de UI o mensajes de error**, agrégalo en los 4 idiomas (§4.16).
- Si vas a tocar **pagos**, recuerda que la tarjeta pasa por Stripe Connect (nunca cobrar sin `destination`) y que QR/USDT se aprueban a mano (§4.4).
- Si vas a tocar **inventario/stock**, recuerda que es por **talla** y que hay `stock` (vendible) y `damagedStock` (mermas).
- Si vas a tocar **devoluciones**, lee §4.11.
- Si vas a tocar **CORS o validación de entrada**, lee §5.1.1 y §5.1.2.
- Si una tarea menciona **probador virtual**, revisa §4.12: el token lo firma la API con la key de la tienda.
- Si una tarea menciona **chatbot**, revisa §4.13.
- Antes de dar por buena cualquier afirmación de este archivo sobre un archivo, endpoint o campo específico, verifícalo en el código: el código es la fuente de verdad.

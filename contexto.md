# CONTEXTO — STELLA FEMME

> Documento maestro para que un LLM pueda retomar este proyecto y tomar decisiones informadas sin tener que releer todo el código. Actualizado el 2026-11-06 a partir del estado real del repo (rama `integracion/correcciones` sobre `e809a64`, con las seis correcciones del 2026-11-06 integradas; ver §5.4).
>
> **Regla de mantenimiento:** si cambias esquema, rutas, permisos, puertos o dependencias, actualiza este archivo en el mismo commit. Si algo aquí contradice el código, **el código manda** — este documento puede quedar desactualizado.
>
> **Advertencia sobre el propio repo:** el estado de git puede estar muy adelantado respecto a lo que sugiera cualquier snapshot o resumen previo (incluido este documento con el tiempo). Antes de asumir nada crítico, corre `git log --oneline -20` y `git status --short` para confirmar dónde está realmente HEAD.
>
> **Ramas:** trabajar sobre `main`. La rama `oscar` (HEAD `fffafec v2.0.0`) es **anterior a la migración multitenant** y **no funciona contra la BD Neon actual**: busca las tablas en `public`, que ahora solo tiene el plano de control, y el login responde 500 (`relation "public.users" does not exist`). Ver §5.1.10.

---

## 1. Qué es el proyecto

**Stella Femme** empezó como un e-commerce **multi-sucursal** de ropa femenina (sucursales físicas en Santa Cruz de la Sierra, Bolivia) y desde el commit `edb3598` es además un **SaaS multitenant**: cada tienda vive en su propio schema de PostgreSQL. Las tiendas se dan de alta pagando un plan con Stripe (`/planes`) y un panel de plataforma (`/plataforma`) las administra. La tienda original quedó como el tenant `tenant_legacy` ("Stella Femme"). La plataforma SaaS se presenta con la marca **"NovaSoft"** (landing `/planes`, panel `/plataforma`, correos de alta y contacto; `PLATFORM_BRAND` en `front/utils/storeName.ts`, `PLATFORM_NAME` en la API).

Desde `a860fbe` **cada plan (Starter / Growth / Pro / Legacy) habilita o limita funcionalidades** (POS, devoluciones, IA, probador, campañas, billeteras, app móvil, dominio propio, tope de sucursales y productos). Ver §4.18.

Cada tienda cubre: catálogo con stock y ofertas por sucursal y por talla (con **traducciones**), carrito con reserva de stock, checkout (retiro en tienda o envío a domicilio con mapa), cobro con **tarjeta vía Stripe Connect**, **QR bancario**, **USDT** o **billetera digital P2P** (Airtm / Takenos / Wallbit) (verificados a mano), QR simulado (heredado), punto de venta físico (POS), devoluciones con reingreso a stock o mermas, probador virtual en tiempo real con Decart, chatbot de Botpress, correos transaccionales, notificaciones push, facturas en PDF, panel administrativo con roles/permisos dinámicos, **personalización visual de la tienda**, **dashboard de analítica arrastrable**, marketing por correo, reportes con IA, una PWA offline-first y una app móvil Expo independiente. Interfaz, errores de la API y app móvil en **4 idiomas** (es, en, fr, zh).

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
- El idioma base es **español latinoamericano**; todo texto nuevo de UI va a los 4 diccionarios (`front/messages/*.json`, `api/src/i18n/locales/*/`, `app_movil/src/i18n/locales/*.json`). La marca de la plataforma es **"NovaSoft"** (antes "Stella Femme", que ahora es solo el nombre de la tienda legacy), pero dentro de una tienda se muestra **el nombre de esa tienda** (`GET /store`, `StoreInfoProvider`).
- El precio final **siempre lo calcula el backend** (cliente nunca decide precios/descuentos/montos a cobrar). Lo mismo con el plan del SaaS: el front manda la **clave** del plan, nunca un `price_id`.
- **Nunca** cruzar datos entre tiendas: todo acceso a datos de negocio pasa por el tenant del request (§4.0). El login tampoco cruza tiendas: `POST /platform/auth/tenant-login` exige la tienda elegida y consulta solo esa (§4.1).
- Una funcionalidad de pago o de panel nueva debe decidir **en qué planes está incluida** (`api/src/modules/platform/plans.ts`, §4.18) y bloquearse en la API, no solo ocultarse en el front.
- No cambiar lógica de negocio al "arreglar" estilos o textos.

**Puertos y URLs (desarrollo local)**

| Servicio | URL |
|---|---|
| Frontend | `http://localhost:3000` |
| API | `http://localhost:3001/api/v1` (prefijo global en `api/src/main.ts`) |
| Swagger | `http://localhost:3001/api/docs` |
| PostgreSQL | En la práctica se usa **Neon** también en local (`api/.env` apunta a Neon). Una BD local en `localhost:5432` funciona si se le aplican las migraciones de control y de tienda (§6.1) |

**Producción:** API y front en **Azure Container Apps**; BD en **Neon** (`DATABASE_URL` con pooler, `DIRECT_URL` sin pooler para migrar). `main.ts` confía en `TRUST_PROXY_HOPS` saltos de proxy (ingress de Azure) para leer la IP real.

**Páginas de la tienda (web):** `/` (catálogo) · `/{productId}` (detalle, con Probador Virtual) · `/cart` · `/checkout` (paso QR simulado en `/checkout/qr-confirm`, retorno de Stripe en `/checkout/success`, página estática `/checkout/offline-success`, borradores offline en **`/checkout/drafts`**) · `/account` (+ `/account/orders/[id]`, donde el cliente sube el comprobante de QR/USDT/billetera) · `/auth/login` (**primero se elige la tienda, después se piden las credenciales**; enlace al panel de NovaSoft, §4.1) `|register` (con selector de tienda) `|forgot-password|reset-password` · `/offline` (fallback de la PWA). Manifest por tienda en `/web-manifest` e íconos en `/pwa-icon/[size][/maskable]` (reemplazan al viejo `app/manifest.ts`).
**Páginas del SaaS (sin tienda):** `/planes` (+ `/planes/exito`, vuelta de Stripe Checkout), `/contacto`, `/plataforma` (panel del plano de control, entra con la llave de plataforma). Listadas en `front/utils/platformPaths.ts`.
**Panel de tienda (`/admin`):** (los ítems con `planFeature` en `adminNav.ts` se ocultan o muestran aviso de "actualiza tu plan" si el plan no los incluye) `pos`, `returns`, `products`, `categories`, `collections`, `inventory`, `orders`, `branches`, `staff`, `roles`, `marketing`, `notifications`, `reports` (+ `reports/dashboard`), `suscripcion` (solo Super Admin), `settings/payments`, `settings/appearance`. `/admin/pagos` es una ruta vieja que redirige a `settings/payments`.

---

## 2. Estructura del repositorio

```
ecommerce-si2/
├── contexto.md            ← este archivo
├── docker-compose.yml      ← orquesta api (3001) + front (3000) en una red bridge
├── front/                  ← Next.js 16 (proyecto autónomo, usa bun; bun.lock)
├── api/                    ← NestJS 12 + Prisma 7 (proyecto autónomo, usa npm; package-lock.json)
├── app_movil/              ← Expo ~58 / React Native 0.88 (cliente móvil independiente de la misma API)
├── docs/checkout-resiliente.md ← operación y políticas del checkout resistente a fallos (§4.10)
└── IA/                     ← carpeta vacía
```

### 2.1 Avisos importantes por carpeta (archivos `AGENTS.md` reales del repo)
- **`front/AGENTS.md`** (incluido vía `front/CLAUDE.md`): *"Esta NO es la versión de Next.js que conoces"* — Next 16 tiene cambios que rompen compatibilidad con lo que un LLM pueda "saber" de memoria (por ejemplo, `middleware.ts` ahora se llama `proxy.ts`). Antes de escribir código en `front/`, revisar `front/node_modules/next/dist/docs/`.
- **`app_movil/AGENTS.md`**: *"Expo HA CAMBIADO"* — revisar la documentación versionada exacta de Expo antes de escribir código ahí. Ojo: el `AGENTS.md` sigue apuntando a v57, pero desde `a860fbe` el proyecto está en **Expo 58** (`https://docs.expo.dev/versions/v58.0.0/`).
- `api/` no tiene `AGENTS.md`/`CLAUDE.md` propios (solo el `README.md` boilerplate de Nest).

### 2.2 Frontend (`front/`)

```
proxy.ts         ← enrutamiento por dominio propio de cada tienda + negociación de idioma (ver §4.0 y §4.16)
app/
  layout.tsx, globals.css, fonts.ts, offline/, error.tsx, global-error.tsx
  web-manifest/route.ts, pwa-icon/[size]/(maskable/)route.tsx ← manifest e íconos PWA por tienda
  (lading)/page.tsx            ← "/" catálogo (carpeta con typo histórico "lading")
  (product)/[id]/page.tsx      ← detalle de producto (monta el Probador Virtual)
  (platform)/                  ← SaaS: planes/ (+ exito/), contacto/
  (platform-admin)/plataforma/ ← panel del plano de control (llave de plataforma)
  auth/ login | register | forgot-password | reset-password
  cart/, checkout/ (+ qr-confirm/, success/, offline-success/, drafts/)
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
             StoreInfoProvider.tsx (nombre, plan y `features` de la tienda, cacheados en localStorage),
             LocaleCartSync.tsx
i18n/        config.ts (LOCALES, cookie), request.ts, client.ts   ·   messages/{es,en,fr,zh}.json
hooks/       useAuth, useCart, useOrder, useMyOrders, useOrderDetail, usePayment, useProducts, useBranches,
             useAddresses, useSpeechRecognition, useAdminAccess/Branches/Categories/Collections/Orders/
             Products, useInventory, useOfflineInventorySync, useStaff, useRoles, useReports, useReturns,
             usePos, usePushNotifications, useCheckoutRecovery, useNetworkStatus, usePublicTenants,
             useRegisterServiceWorker, useLocaleVersion   (useOfflineOrderSync se eliminó)
service/api/ axios.config + un *.service.ts por módulo del backend (incluye platform, platformAdmin,
             subscription, paymentSettings, appearance, analytics), error.utils
store/       index.tsx (Redux store + persist con clave por tienda), slices/
utils/       tenant.ts (tienda activa), legacyStorageMigration.ts, platformPaths.ts, storeName(.server).ts,
             storeAppearance.server.ts, appearanceTheme.ts, fonts.ts, offlineDb.ts, pricing.ts,
             permissions.ts, offlineOrderQueue.ts, offlineInventoryQueue.ts, checkoutAttempts.ts,
             productStorage.ts, printPosReceipt.ts
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
                   create-platform-admin.ts (npm run platform:admin),
                   audit-wallet-samples.ts (npm run wallet:audit, solo lectura, §5.1.19)
  prisma/        ← PrismaModule: registra el proxy multitenant bajo el token PrismaService
  common/
    constants/permissions.ts   ← catálogo de permisos + BASE_ROLES (ver §4.1)
    decorators/                ← GetUser, @Permissions/@AnyPermission, @RequirePlanFeature, guards (Jwt,
                                 Permissions, Branch, PlanFeature), throttlers
    checkout/                  ← checkout-policy.ts (TTLs), checkout-errors.ts, tx.util.ts, failpoints.ts (tests)
    encryption/                ← EncryptionService (AES-256-GCM)
    utils/                     ← pricing.ts, permission.util.ts, token-hash.ts
  modules/
    auth · users (+ addresses) · products (+ product-translations) · category · collections
    cart (+ CartCleanupService) · orders · payments (+ webhook, Stripe Connect, payment-settings,
    payment-proofs) · branches (+ InventoryService) · roles · mail · marketing · reports (+ report-scope)
    pos · notifications · returns · chatbot · platform (+ plans.ts con las features por plan) · store
    · try-on · appearance · analytics · mobile-access (canal móvil: desafíos, Play Integrity, App Attest, §4.19)
test/acceptance/   ← suite de aceptación del checkout/PWA (`npm run test:acceptance`, PostgreSQL real, Stripe falso)
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
  config/   env.ts (URL de la API, ver abajo) · apiUrl.js (+ .d.ts / .test.js: validación compartida con
            app.config.js) · tenant.ts (tienda activa en memoria + AsyncStorage)
  components/ CheckoutRecovery.tsx (retoma intentos de checkout al volver la app al frente)
  utils/    checkoutAttempts.ts (intentos de checkout en AsyncStorage)
  api/      client.ts (axios: x-tenant-id, refresh token con cola, auto-logout; ante TENANT_REQUIRED
            muestra el selector de tienda en vez de cerrar sesión) + *.api.ts por módulo
  i18n/     index.ts + locales/{es,en,fr,zh}.json · components/LanguageSelector.tsx
```
- **Sesión del canal móvil (§4.19):** login y registro van a `POST /auth/mobile/login|register` con una prueba de integridad (`src/security/mobileAttestation.ts`, `@expo/app-integrity`: Play Integrity en Android, App Attest en iOS) y el refresh a `POST /auth/mobile/refresh`. La API emite tokens con `channel: "mobile"` solo si el plan **vigente** es Pro/Legacy. El header `x-client-platform: mobile` se sigue mandando, pero es solo una pista: no autoriza nada. Ante `403 MOBILE_APP_NOT_IN_PLAN` la app cierra la sesión y muestra el selector con el aviso; ante `401 MOBILE_ATTESTATION_REQUIRED` en el refresh genera una prueba nueva y reintenta.
- `src/security/` = prueba de integridad (nuevo). El nombre de la tienda se muestra dinámicamente en Login, Registro, Catálogo, Perfil y Pagos. `PaymentScreen` soporta QR bancario, USDT y billetera.
- Builds de una sola tienda: `EXPO_PUBLIC_TENANT_ID`. Sin eso, el usuario elige la tienda en `TenantSelectorScreen`. Los tokens y la sucursal guardados quedan atados a la tienda que los emitió.
- **URL de la API** (`src/config/env.ts` + `src/config/apiUrl.js`): siempre se normaliza a `…/api/v1` (se agrega si falta, nunca se duplica; los endpoints van como `/auth/login`). **Desarrollo** (`__DEV__`): `EXPO_PUBLIC_API_URL` opcional; si falta → IP del host de Metro (`hostUri`):3001 (dispositivo físico) → `10.0.2.2:3001` (emulador Android) → `localhost:3001` (iOS/web). **Producción**: `EXPO_PUBLIC_API_URL` obligatoria, `https` y host público. `app.config.js` (envuelve `app.json` sin cambiarlo) hace fallar `expo export` / EAS Build si falta, es inválida o apunta a localhost/IP privada; en ejecución, si aun así faltara, las peticiones se rechazan con `ERR_API_URL_MISSING` en vez de usar una IP de desarrollo, y una URL personalizada guardada en AsyncStorage que no sea pública se descarta. Pruebas: `npm run test:config`.
- **`eas.json`** (sin `projectId`: nunca se corrió `eas init`): perfiles `development` (dev client, `APP_ENV=development`; requiere instalar `expo-dev-client` antes), `preview` (APK interno) y `production`. Cada perfil fija `APP_ENV`, que es lo que lee `app.config.js` (en SDK 58 `expo config` evalúa la config en modo development, `expo export` en production). La URL de producción **no** está en `eas.json`: va en el entorno de EAS o en `.env.production` (gitignored; solo `.env.example` se versiona).
- `app_movil/README.md` menciona cuentas de prueba (`admin@gmail.com` / `Admin123*`) **distintas** a las del seed (`superadmin@stellafemme.com`): no confiar en ese README; la fuente de verdad es `api/prisma/seed.mjs`.

---

## 3. Base de datos (Prisma / PostgreSQL, multi-schema)

**Modelo de aislamiento: un schema de PostgreSQL por tienda**, en la misma base:

| Schema | Contenido |
|---|---|
| `public` | **Plano de control** (`prisma/control/schema.prisma`): `tenants`, `tenant_signups`, `tenant_integrations`, `tenant_credentials`, `platform_admins`, `provider_event_inbox` + su `_prisma_migrations` |
| `tenant_legacy` | La tienda original (el antiguo `public` renombrado). Id fijo `00000000-0000-4000-8000-000000000001`, slug `stella-femme` |
| `tenant_<uuid sin guiones>` | Cada tienda nueva. Mismas tablas que `tenant_legacy` (`prisma/schema.prisma`) y su propia `_prisma_migrations` |
| `<schema>_reporting` | Vistas de solo lectura para los reportes con IA de cada tienda, con un rol `reports_<sufijo>` NOLOGIN |

Al escribir este documento, la BD Neon tiene `public`, `tenant_legacy`, `tenant_9107a2f4…` y sus dos `_reporting`.

### 3.1 Plano de control (`public`)
| Modelo | Campos clave / notas |
|---|---|
| **Tenant** | `id` (uuid), `slug` (único, subdominio), `name`, `schemaName` (único), `domain?` + `domainVerifiedAt?` (dominio propio; **solo se enruta si está verificado**), `status` (`PROVISIONING/ACTIVE/SUSPENDED/FAILED`), `plan` (default `"free"` → se trata como Starter; valores con sentido: `starter`/`growth`/`pro`/`legacy`, §4.18), `schemaVersion` (última migración aplicada), `provisionError?`. Stripe Connect: `stripeAccountId`, `stripeChargesEnabled`, `platformFeeBps` (comisión en puntos básicos). Suscripción al SaaS: `stripeCustomerId`, `stripeSubscriptionId`, `subscriptionStatus` |
| **TenantSignup** | Alta self-service pendiente de pago (`PENDING/PROVISIONING/COMPLETED/FAILED/EXPIRED`). Guarda el hash bcrypt de la contraseña del dueño para que **no viaje en la metadata de Stripe**; se vacía al completar o expirar. `tenantId` se fija antes de aprovisionar para que un reintento retome la misma tienda |
| **TenantIntegration** | PK `(tenantId, provider)`, `provider` ∈ `DECART`, `WEBPUSH`, `STRIPE` (reservado). `encryptedData` = `"<versión de llave>:<base64(ciphertext‖tag)>"` + `iv`. AAD = `"<tenantId>:<provider>"`: copiar el valor a otra tienda no descifra |
| **TenantCredential** | `OWNER_PASSWORD` / `API_KEY`, `identifier`, `secretHash` (bcrypt), expiración y revocación |
| **PlatformAdmin** | Administradores del SaaS (`/plataforma`): `email` (único, en minúsculas), `passwordHash` (bcrypt), `name?`, `isActive`, `loginAttempts`/`lockedUntil`, `lastLoginAt`. Ver §4.17 |
| **ProviderEventInbox** | Inbox de webhooks de proveedores (Stripe): deduplica y reprocesa eventos (`InboxStatus`). Ver §4.10 |
| **MobileAttestationChallenge** | Desafío de un solo uso para la prueba de integridad de la app (`tenantId`, `challenge`, `expiresAt`, `consumedAt`). Se consume con un UPDATE condicionado. Ver §4.19 |
| **MobileAppAttestKey** | Claves de App Attest (iOS) ya atestiguadas: `keyId` (PK), `publicKey` (PEM), `signCount` (solo crece), `environment`, `revokedAt`. Ver §4.19 |

### 3.2 Schema de tienda (`prisma/schema.prisma`)
Modelos: `Role`, `User`, `UserAddress`, `Product`, `Branch`, `ProductInventory`, `Collection`, `Category`, `OrderItem`, `CartItem`, `Order`, `Cart`, `Return`, `ReturnItem`, `PushSubscription`, `Payment`, **`PaymentSettings`**, **`PaymentProof`**, **`StoreAppearance`**, **`DashboardLayout`** y, desde el commit `2291d1c` (checkout resiliente), **`StockReservation`**, **`InventoryMovement`**, **`CheckoutAttempt`**, **`PaymentAttempt`**, **`PaymentCompensation`**, **`OutboxEvent`**, **`OperationalIssue`** (+ enums `OrderStatus`, `FulfillmentType`, `OrderSource`, `PaymentMethod`, `UsdtNetwork`, `PaymentProofStatus`, `PaymentStatus`, `ReturnReason`, `ItemCondition`, `ReservationStatus`, `CheckoutAttemptStatus`, `PaymentAttemptStatus`, `CompensationStatus`, `OutboxStatus`).

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
| **PaymentMethod** (enum) | `STRIPE`, `CASH`, `PHYSICAL_CARD`, `QR` (simulado), `BANK_QR`, `USDT`, **`WALLET`** (billetera P2P, nuevo) |
| **PaymentSettings** | Fila única `id = "default"`: `qrEnabled`, `qrImage` (BYTEA) + `qrImageType`, `qrInstructions`, `usdtEnabled`, `usdtNetwork` (`TRC20/ERC20/BEP20/POLYGON`), `usdtWalletAddress`, **`walletEnabled`, `walletProvider`, `walletAccount`, `walletInstructions`** (nuevo) |
| **PaymentProof** | Uno por pedido (`orderId` único): `method`, `image?` (BYTEA, comprobante QR) o `txId?` (USDT / referencia de billetera, único entre pedidos), `status` (`PENDIENTE/APROBADO/RECHAZADO`), `reviewedById`, `reviewedAt` |
| **StoreAppearance** *(nuevo)* | Ver §4.13b |
| **DashboardLayout** *(nuevo)* | Ver §4.13c |
| **Return / ReturnItem / PushSubscription / Payment / UserAddress** | Sin cambios de fondo (ver §4.11) |
| **StockReservation / InventoryMovement** | Reservas explícitas de stock con TTL y movimientos con `effectId` único (idempotencia). Ver §4.10 |
| **CheckoutAttempt / PaymentAttempt / PaymentCompensation / OutboxEvent / OperationalIssue** | Intentos durables de checkout (clave de idempotencia) y de pago, compensaciones, outbox de correo/push y anomalías para revisión. Ver §4.10 y `docs/checkout-resiliente.md` |

### 3.3 Migraciones
**Tienda** (`prisma/migrations/`, 32 en total). Las dos más nuevas: **`wallet_payments`** (`20261102000000`, idempotente con `IF NOT EXISTS`: valor `WALLET` del enum + columnas `wallet*`) y **`checkout_resilience`** (`20261103120000`, tablas de reservas, movimientos, intentos, outbox, etc. con backfill). Antes: `returns_and_damaged_stock` (`20260927120000`) → **`tenant_scoped_reporting`** (`20261024120000`, crea `<schema>_reporting` y el rol `reports_<sufijo>` para la tienda que se está migrando, y elimina el viejo schema `reporting`) → **`product_translations`** (`20261025090000`) → **`manual_payments`** (`20261025180000`) → **`store_appearance`** (`20261026120000`) → **`store_appearance_theme`** (`20261026150000`) → **`dashboard_layouts`** (`20261026180000`).

**Control** (`prisma/control/migrations/`): `20261024130000_control_init` → `20261031120000_platform_admins` (aplicada en Neon el 2026-10-31) → **`20261103120000_provider_event_inbox`** → **`20261106120000_mobile_attestation`** (rama `fix/plan-app-movil`, **no aplicada en Neon**: tablas `mobile_attestation_challenges` y `mobile_app_attest_keys`; se aplica con `migrate:control` / al arrancar el contenedor). Confirmar en Neon que `wallet_payments`, `checkout_resilience` y `provider_event_inbox` estén aplicadas (el contenedor las aplica al arrancar con `migrate:all`).

**Paso único a multitenant (ya ejecutado en Neon):** `control/sql/001_split_public_into_tenant_legacy.sql` (renombra `public` → `tenant_legacy` y crea un `public` vacío) → `npx prisma migrate deploy --config prisma.control.config.ts` → `control/sql/002_register_legacy_tenant.sql` (registra la tienda legacy con el id fijo). No volver a correrlos.

**Comandos (desde `api/`):**
- `npm run migrate:control` → migra `public`.
- `npm run build && npm run migrate:all` → migra `public` y **todas** las tiendas ACTIVE/SUSPENDED (`dist/scripts/migrate.js`; es lo que corre el contenedor al arrancar). Si una tienda falla se loguea y se sigue; `MIGRATE_STRICT=true` lo vuelve fatal.
- **No correr `npx prisma migrate deploy` a secas:** con `prisma.config.ts` aplicaría las migraciones de tienda sobre `public`.
- Migrar siempre con la **URL directa** de Neon (`DIRECT_URL`, sin `-pooler`): PgBouncer rompe los advisory locks de `migrate`. En producción es obligatoria.
- `npx prisma generate` (tiendas) y `npx prisma generate --config prisma.control.config.ts` (control); `postinstall` corre los dos.
- `migrate dev` sigue sin servir cuando el cambio migra datos existentes (la migración se escribe a mano).

### 3.4 Datos iniciales (`api/prisma/seed.mjs`)
Siembra **un** schema de tienda, nunca `public`: `TENANT_SCHEMA=tenant_legacy npm run seed` (sin `TENANT_SCHEMA` válido aborta). Es idempotente y solo para desarrollo. Las tiendas nuevas ya nacen con roles base y su Super Admin (el dueño) vía `TenantProvisioningService`, y además (desde `a860fbe`) con una fila de `store_appearance` por defecto y una fila de `payment_settings` **vacía, con todos los medios desactivados** (también la billetera, aunque el plan la incluya: no se generan cuentas, correos ni proveedores). Hasta la rama `fix/configuracion-billetera` se sembraba `walletEnabled = true` con una cuenta de ejemplo — ver §5.1.19.

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
- El contexto (`tenantId`, `schemaName`, **`plan`**) queda en `req.tenant` y en un `AsyncLocalStorage` (`tenant-context.ts`). Para crons, colas y scripts: `runInTenant(ctx, fn)`.
- **Acceso a datos:** `TenantPrismaService` mantiene un `PrismaClient` por schema (LRU, `TENANT_CLIENT_CACHE`, default 100) sobre **un solo `pg.Pool`**, con `PrismaPg(pool, { schema })`, así las queries de modelos van calificadas con el schema. Los ~30 servicios existentes siguen inyectando `PrismaService`: `PrismaModule` registra bajo ese token un **Proxy** (`tenant-prisma.proxy.ts`) que resuelve cada acceso al cliente de la tienda del request.
  - **SQL crudo:** Prisma no califica `$queryRaw`. Usar `tenantSchemaSql()` (`Prisma.sql\`... FROM ${tenantSchemaSql()}.orders\``) o `TenantPrismaService.transaction()`, que hace `SET LOCAL search_path` (seguro con PgBouncer). Una tabla sin calificar cae en `public` y da "relation does not exist".
  - Los nombres de schema se validan contra `^tenant_([a-f0-9]{32}|legacy)$` antes de interpolarse en SQL.
- **JWT atado a la tienda:** access y refresh token llevan `tenantId`. `JwtStrategy` rechaza un token cuyo `tenantId` no coincide con `req.tenant`; los tokens anteriores al multitenant (sin `tenantId`) deben renovarse.
- **Links salientes** (correos, QR, push) llevan `?tenant=<id>` (`withTenantParam`) para que quien los abra caiga en la tienda correcta.
- **Front (`front/utils/tenant.ts`):** la tienda activa se resuelve una vez por carga de página, en este orden: cookie `sf_tenant` (dominio propio, la pone `proxy.ts`) → `?tenant=<uuid>` (se recuerda en `localStorage`) → la última recordada → `NEXT_PUBLIC_TENANT_ID`. Axios manda `x-tenant-id`; ante `TENANT_REQUIRED`, `<TenantGate/>` muestra el selector de tienda. `switchTenant()` cambia y recarga. Redux-persist, IndexedDB y la caché del SW usan claves **por tienda**; `legacyStorageMigration.ts` migra los datos locales de antes del multitenant solo si el navegador opera la tienda legacy.
- **Dominios propios (`front/proxy.ts`):** en un Host que no es de la plataforma (`PLATFORM_HOSTS`, default `localhost,127.0.0.1` + IPs privadas), el proxy consulta `GET /platform/tenants/by-domain` (con `INTERNAL_API_KEY`), cachea el resultado, reescribe `/api/v1/*` hacia la API **pisando** el `x-tenant-id` del navegador, fija la cookie `sf_tenant` y responde 404 en las páginas del SaaS. En `localhost` no resuelve nada: el navegador manda el header directo a la API.
- **Alta de tiendas (`TenantProvisioningService`):** crea el schema, corre las migraciones de tienda (`TenantMigrationService`, invoca el CLI de Prisma como proceso hijo en cola), crea los roles base y el Super Admin, y opcionalmente genera claves VAPID. Si falla queda `FAILED` y se reintenta con `POST /platform/tenants/:id/retry`.
- **Credenciales por tienda (`TenantSecretsService`):** Web Push ya **no** usa variables de entorno globales y Decart usa primero la clave de la tienda; ambas viven cifradas en `public.tenant_integrations` con la llave maestra `TENANT_SECRETS_KEYS` (rotable por versión). Se cargan desde el panel de plataforma. `src/scripts/import-legacy-integrations.ts` importó una vez las claves globales viejas a la tienda legacy. **Probador:** si la tienda no tiene clave propia, `TryOnService` usa `DECART_API_KEY` del entorno (compartida por todas las tiendas con el probador en su plan; el consumo va a esa cuenta).

### 4.1 Autenticación, roles y permisos
**Login de tienda (tienda elegida antes de autenticar, rama `fix/login-multitenant`):** reemplaza al "login unificado" de `a860fbe`, que buscaba el email en **todos** los schemas activos (costo creciente con cada tienda) y, con varias coincidencias, devolvía la lista de tiendas donde estaba registrado el correo.
- **API:** `POST /platform/auth/tenant-login` (sin tenant en el middleware, throttle 20/min por IP) recibe `email`, `password` y **`tenantId` obligatorio** (`dto/tenant-login.dto.ts`; sin él → 400). `PlatformAuthService.tenantLogin` hace **una** consulta al plano de control (tienda `ACTIVE` por id) y delega en `AuthService.login` dentro de `runInTenant`: solo se toca el schema elegido, la cantidad de consultas no depende del número de tiendas. Respuesta: `{ tenant: {id, slug, name, plan}, auth: AuthResponseDto }`. Ya **no existen** `preferredTenantId`, `requiresTenantSelection` ni la lista `tenants`, y este endpoint **ya no detecta administradores de plataforma**.
- **Respuesta genérica:** `AuthService.login` (lo usan `tenant-login`, `POST /auth/login` de la app móvil y los dominios propios) responde **siempre 401 `errors.LOGIN_FAILED`** ante correo inexistente, contraseña incorrecta o cuenta bloqueada; `tenant-login` responde lo mismo si la tienda no existe o no está `ACTIVE`. Los casos sin usuario/bloqueados comparan contra un hash ficticio de costo 12 para no delatarse por tiempo. El bloqueo sigue igual (3 fallos → 5 min, por tienda), pero **ya no responde 429 `TOO_MANY_ATTEMPTS`/`ACCOUNT_LOCKED`**: el mensaje genérico dice "si fallaste varias veces, espera unos minutos". El email sigue normalizándose (trim + búsqueda sin distinguir mayúsculas).
- **Front (`LoginForm.tsx`):** la tienda sale de (1) el dominio propio verificado (cookie `sf_tenant` → `POST /auth/login`, el `x-tenant-id` lo pone `proxy.ts`), (2) la tienda activa del navegador (`getCurrentTenantId()`: `?tenant=`, la recordada o `NEXT_PUBLIC_TENANT_ID`) o (3) un **selector de tiendas** (`GET /platform/tenants/public`) que se muestra **antes** del formulario de credenciales. Con tienda conocida se muestra su nombre y "Cambiar tienda". Si la tienda elegida no es la activa, `switchTenantWithAuth` guarda la sesión en la clave de esa tienda y recarga. Un 401 se muestra como `Auth.login.invalidCredentials` (4 idiomas).
- **Administradores de NovaSoft:** enlace "¿Eres administrador de NovaSoft? Ingresar al panel de plataforma" en `/auth/login` (oculto en dominios propios) → `/plataforma`, que usa su propio login (`POST /platform/auth/login`, JWT con audience `stella-platform`). El JWT de plataforma y el de tienda siguen sin servir uno en lugar del otro.
- **Efectos:** las sesiones ya emitidas (tokens de tienda y `sf_platform_session`) siguen valiendo. Un front viejo cacheado que llame a `tenant-login` sin `tenantId` recibe 400 hasta actualizarse. Un administrador que antes entraba escribiendo sus credenciales en `/auth/login` ahora debe usar el enlace o ir a `/plataforma`. Registro, recuperación de contraseña y cambio de tienda no cambiaron (ya eran por tienda). La app móvil no cambia de contrato (usa `POST /auth/login` con la tienda de `TenantSelectorScreen`/`EXPO_PUBLIC_TENANT_ID`); solo deja de ver los mensajes de bloqueo, que ahora son el genérico.
- **Pruebas:** `api/test/acceptance/tenant-login.spec.ts` (`npm run test:acceptance tenant-login`, requiere `ACCEPTANCE_DATABASE_URL` local).

El registro (`RegisterForm`) muestra un selector de tienda alimentado por `GET /platform/tenants/public` (`usePublicTenants`). Los emails se normalizan a minúsculas al registrarse y se buscan sin distinguir mayúsculas.

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
- **El carrito reserva stock real al agregar** mediante `StockReservation` con TTL explícito (`CART_RESERVATION_TTL_MS`, default 1 h). `CartCleanupService` corre cada 15 min y libera lo vencido (recorre las tiendas con `runInTenant`). El front sincroniza el carrito completo con `PUT /cart` (con revisión, `Cart.activeUserId`).
- Checkout en 3 pasos (Entrega → Pago → Completado). Medios ofrecidos según `GET /store/payment-options` y `GET /payments/connect/availability`, **filtrados por plan**: **tarjeta** (solo si la tienda completó Stripe Connect), **QR bancario**, **USDT** y **billetera digital** (si están activos, completos y el plan los incluye; `ManualPaymentSection.tsx`) y el QR simulado heredado.
- **Offline**: los pedidos sin red quedan como **borradores** en IndexedDB (`/checkout/drafts`) y **nunca se envían solos**; los intentos interrumpidos se retoman con `useCheckoutRecovery` (ver §4.10).

### 4.4 Pedidos, pagos, facturas y webhook de Stripe
- `OrdersService.create` calcula precios en servidor y ajusta el stock por talla.
- **Tarjeta = Stripe Connect con destination charges** (`payments/stripe-connect.service.ts`): el PaymentIntent se crea en la cuenta de la plataforma con `transfer_data.destination = acct_` de la tienda y `application_fee_amount` según `Tenant.platformFeeBps`. **Sin cuenta conectada y habilitada, el pago con tarjeta responde 400**: nunca se cobra a la cuenta central. Onboarding desde `/admin/settings/payments` (`POST /admin/settings/payments/stripe/onboarding`, cuenta Express); `DELETE .../stripe` desvincula sin borrar la cuenta en Stripe. La tienda legacy necesita su `stripe_account_id` cargado a mano (ver comentario de `002_register_legacy_tenant.sql`).
- `POST /payments/create-intent` calcula el monto desde `order.totalAmount`; el cliente no envía monto.
- **Pagos manuales (QR bancario, USDT y billetera)** — `payment-settings.service.ts` / `payment-proofs.service.ts`:
  - La tienda configura en `/admin/settings/payments` la imagen de su QR bancario (PNG/JPEG/WebP validados **por bytes**) e instrucciones, red + wallet USDT (dirección validada según la red) y/o **billetera digital P2P** (`walletProvider` — Airtm / Takenos / Wallbit —, `walletAccount`, `walletInstructions`; requiere plan con `digitalWallet` y el permiso `MANAGE_PAYMENTS`). Un medio solo se activa completo: la billetera exige **proveedor y cuenta** (`isWalletComplete` / `isWalletReady` en `payment-settings.service.ts`, el mismo criterio en `getPublicOptions`, `OrdersService.assertManualMethodEnabled` y `PaymentProofsService`). Leer la configuración (`PaymentSettingsService.read()`) **nunca escribe**. El checkout web y la app móvil solo muestran la billetera si `GET /store/payment-options` devuelve `wallet` no nulo (la app muestra la cuenta y las instrucciones reales de la tienda).
  - El cliente crea el pedido (queda `PENDIENTE` con el stock reservado) y sube el comprobante (`POST /orders/:id/payment-proof`): imagen para QR, TxID para USDT, referencia de la transferencia para billetera (un TxID/referencia no puede pagar dos pedidos). Puede reemplazarlo mientras no se revisó.
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
*(Entró con el commit `2291d1c "PWA"`, ~7.700 líneas: reescritura de `orders.service`, `payments.service`, `cart.service` e `inventory.service`.)*
- **Inventario:** `ProductInventory.stock` = disponibles. Reservas explícitas (`StockReservation`), movimientos con `effectId` único e `inventory.version`. Sin fallback a otra sucursal ni al stock global; `Product.stock` es solo informativo. Todos los escritores (carrito, checkout, cron, POS, cancelación, devolución, aprobación, panel) pasan por `InventoryService`.
- **Checkout:** `POST /orders` exige `Idempotency-Key` y `cartVersion`; todo se confirma en una transacción (`CheckoutAttempt`). Carrito activo único (`Cart.activeUserId`) con revisión. El web sincroniza con `PUT /cart`.
- **Pagos:** intento durable antes de llamar a Stripe (`PaymentAttempt`), inbox de webhooks en el plano de control (`ProviderEventInbox`), outbox de correo/push (`OutboxEvent`), compensaciones (`PaymentCompensation`) y anomalías (`OperationalIssue`). `CheckoutMaintenanceService` corre cada minuto (vence pedidos impagos: tarjeta y el resto `ORDER_TTL_CARD_MS` 1 h, QR bancario/USDT/billetera `ORDER_TTL_MANUAL_MS` 24 h según `MANUAL_PAYMENT_METHODS` de `checkout-policy.ts` (la misma lista que usa `PaymentProofsService`); el plazo se fija al crear el pedido (`orders.paymentExpiresAt`) y no se recalcula; con comprobante `PENDIENTE` no vence ni se extiende; reconciliación `PAYMENT_RECONCILIATION_HOLD_MS` 6 h; `DISABLE_BACKGROUND_JOBS` lo apaga). Métricas en `GET /checkout-ops/metrics` (`VIEW_REPORTS`). Si un checkout se cae a medias, `GET /orders/attempts/:key` devuelve el estado del intento. QR simulado y autoconfirmación con la tarjeta de prueba solo con `ALLOW_SIMULATED_PAYMENTS=true` fuera de producción (una clave `sk_test_` sola no alcanza, §5.1.21).
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
- **auth:** `register|login|refresh|logout|forgot-password|verify-otp|reset-password` (canal web; `/auth/refresh` rechaza un refresh móvil con `MOBILE_CHANNEL_MISMATCH`)
- **auth/mobile** (canal móvil, §4.19): `POST /auth/mobile/challenge` (throttle 30/min), `POST /auth/mobile/login`, `POST /auth/mobile/register` (body + `attestation`), `POST /auth/mobile/refresh` (Bearer refresh móvil, `attestation` opcional)
- **users:** `GET/PATCH /users/me`, `PATCH /users/me/password`, `DELETE /users/me`, `GET|POST /users/staff`, `PATCH /users/staff/:id`, direcciones en `/users/me/addresses[...]`
- **branches:** `GET /branches`, `GET /branches/manage/all`, `POST/PATCH/DELETE`, `GET|PUT /branches/:branchId/inventory[/:productId]`
- **roles:** `GET|POST /roles`, `GET /roles/assignable`, `GET|PATCH|DELETE /roles/:id`
- **products:** `GET /products[?branchId]`, `GET /products/:id[?branchId]`, `POST|PATCH|DELETE` (con `translations`), `PUT /products/:productId/discounts/bulk`, `PATCH /products/:id/stock`
- **categories / collections:** lectura pública; escritura con `MANAGE_PRODUCTS`
- **cart:** `GET /cart[?branchId]`, `POST /cart/items`, `PATCH|DELETE /cart/items/:itemId`, `DELETE /cart`
- **orders:** `POST /orders`, `GET /orders`, `GET /orders/me`, `GET /orders/:id`, `GET /orders/admin/all`, `GET /orders/admin/:id`, `PATCH|DELETE /orders/:id`, `PATCH|DELETE /orders/admin/:id`; **comprobantes:** `POST /orders/:id/payment-proof`, `GET /orders/admin/:id/payment-proof/image`, `POST /orders/admin/:id/payment-proof/approve|reject` (`VIEW_ORDERS`)
- **payments:** `POST /payments/create-intent|confirm`, `GET /payments[/:id]`, `GET /payments/order/:orderId`, `POST /payments/webhook` *(sin tenant ni guards, por firma)*, `GET /payments/connect/availability`; QR simulado: `POST /payments/qr/generate`, `GET /payments/qr/status/:orderId`, `POST /payments/qr/confirm`, `GET /payments/qr-confirm/:orderId`
- **gestión de pagos** (`MANAGE_PAYMENTS`): `GET|PATCH /admin/settings/payments`, `GET|PUT|DELETE /admin/settings/payments/qr-image`, `POST /admin/settings/payments/stripe/onboarding`, `DELETE /admin/settings/payments/stripe`; público: `GET /store/payment-options`, `GET /store/payment-options/qr-image`
- **store** (público, con tienda): `GET /store` (nombre, slug, **`plan` y `features`**), `GET /store/appearance`
- **cart (nuevo):** `PUT /cart` (sincroniza el carrito completo) · **orders (nuevo):** `GET /orders/attempts/:key` (estado de un intento de checkout; `POST /orders` exige `Idempotency-Key`) · **checkout-ops:** `GET /checkout-ops/metrics` (`VIEW_REPORTS`)
- **appearance** (`MANAGE_APPEARANCE`): `GET|PATCH /admin/settings/appearance`, `PUT /admin/settings/appearance/logo|favicon|background`
- **analytics** (`VIEW_REPORTS`): `GET|PUT /analytics/layout`, `GET /analytics/metrics`
- **try-on:** `POST /try-on/session` (JWT)
- **subscription** (JWT, tienda actual): `GET /subscription`, `POST /subscription/checkout`, `POST /subscription/portal`
- **platform** (sin tienda): `POST /platform/auth/login`, **`POST /platform/auth/tenant-login`** (login en la tienda elegida, `tenantId` obligatorio, §4.1), `GET /platform/auth/me` (Bearer de plataforma); **`GET /platform/tenants/public`** (directorio público de tiendas activas: id, slug, nombre, plan, `mobileApp`); `POST /platform/contact`; `POST /platform/subscriptions/checkout`, `GET /platform/subscriptions/checkout/:sessionId/status`; `GET /platform/tenants/resolve/:slug` (ahora acepta **UUID, slug o nombre** de la tienda; con `x-client-platform: mobile` responde 403 si el plan no incluye app móvil); `GET /platform/tenants/by-domain` (`x-internal-key`; 404 si el plan no incluye dominio propio); con sesión de administrador de plataforma o `x-platform-key`: `GET|POST /platform/tenants`, `GET /platform/tenants/metrics`, `PATCH /platform/tenants/:id/status|domain`, `POST /platform/tenants/:id/retry`, `PUT /platform/tenants/:id/integrations/decart|web-push`, `POST .../web-push/generate`, `DELETE .../integrations/:provider`, `POST /platform/subscriptions/signups/:id/retry`
- **pos:** `GET /pos/products`, `POST /pos/checkout` · **returns:** `GET /returns/search-order`, `POST /returns/process`, `GET /returns`, `GET /returns/:id`
- **notifications:** `GET /notifications/vapid-public-key`, `POST /notifications/subscribe` · **chatbot:** `GET /chatbot/products`
- **marketing:** `POST /marketing/send-campaign` · **reports:** `GET /reports/sales-overview|top-products`, `POST /reports/dynamic`

### 4.16 Internacionalización (es, en, fr, zh)
- **API:** `nestjs-i18n`; el idioma sale de `?lang=` → header `x-lang` → `Accept-Language` → español. Las excepciones llevan una **clave** (`i18nMessage('errors.PRODUCT_NOT_FOUND', args)`) que `I18nExceptionFilter` traduce; los mensajes libres viejos pasan tal cual. Diccionarios en `api/src/i18n/locales/<idioma>/{errors,validation}.json` (`nest-cli.json` los copia a `dist`).
- **Front:** `next-intl` sin prefijo de URL; `proxy.ts` negocia `Accept-Language` en la primera visita y fija la cookie `NEXT_LOCALE`; `LanguageSwitcher` la cambia. `LocaleCartSync` refresca los nombres del carrito al cambiar de idioma.
- **Móvil:** `i18next` + `expo-localization`, `LanguageSelector`.
- **Catálogo:** `Product.translations` (§4.2).

### 4.17 Plataforma SaaS (alta, suscripción y administración de tiendas)
- **Planes:** `starter` ($11.50), `growth` ($21.50, destacado), `pro` ($36.00) (`api/src/modules/platform/plans.ts`). El `price_id` sale de `STRIPE_PRICE_*`; los montos que muestra la landing (`front/components/modules/platform/plans.ts`) tienen que coincidir con los Prices de Stripe. Qué incluye cada plan: §4.18. Al arrancar, la API avisa qué variables de facturación faltan sin caerse.
- **Alta self-service:** `/planes` → `POST /platform/subscriptions/checkout` crea un `TenantSignup` y una sesión de Stripe Checkout (solo viaja `signupId` en la metadata) → el webhook `checkout.session.completed` aprovisiona la tienda y su Super Admin → `/planes/exito` consulta el estado. Si el aprovisionamiento falla, se reintenta desde la plataforma.
- **Suscripción de la tienda:** `/admin/suscripcion` (Super Admin) muestra el plan y abre Checkout o el Billing Portal de Stripe. Los webhooks `customer.subscription.updated|deleted` actualizan el estado y **suspenden** la tienda si deja de pagar.
- **Panel de plataforma NovaSoft (`/plataforma`):** se entra con **email y contraseña** (en su propio login de `/plataforma`, al que se llega también desde el enlace de `/auth/login`; `tenant-login` ya no detecta administradores) de un administrador de la plataforma (tabla `public.platform_admins`, bcrypt). `POST /platform/auth/login` devuelve un JWT de 8 h con audience `stella-platform` (firmado con `PLATFORM_JWT_SECRET` o, si no está, `JWT_SECRET`), sin refresh; el panel lo guarda solo en `sessionStorage`. Bloqueo de 5 min tras 5 intentos fallidos y throttle de 10 logins/min por IP. `PlatformAdminGuard` acepta ese Bearer (y en cada request verifica que la cuenta siga activa) **o** la llave `PLATFORM_ADMIN_KEY` en `x-platform-key` (≥ 32 caracteres, para scripts). Un token de tienda no sirve en la plataforma ni viceversa. Los administradores se crean o se les cambia la contraseña con `npm run build && npm run platform:admin -- <email> <contraseña> ["Nombre"]` (también desbloquea y reactiva); no hay pantalla para gestionarlos. El panel permite listar, crear, suspender y reactivar tiendas, ver métricas, verificar dominios propios, reintentar altas y cargar las integraciones Decart y Web Push.
- **Contacto:** `POST /platform/contact` (throttle, la IP real sale de `trust proxy`) → correo a `SUPPORT_EMAIL`.

### 4.18 Funcionalidades por plan (nuevo, commit `a860fbe`)
Fuente de verdad: `PLAN_FEATURES_MAP` en `api/src/modules/platform/plans.ts`. `getPlanFeatures(tenant.plan)` normaliza el texto; **cualquier valor desconocido (incluido el default `"free"`) cae en Starter**. `legacy` = igual que Pro.

| Funcionalidad | Starter | Growth | Pro / Legacy |
|---|---|---|---|
| Sucursales (`maxBranches`) | 1 | 5 | ilimitadas |
| Productos activos (`maxProducts`) | 200 | ilimitados | ilimitados |
| POS (`pos`) · Devoluciones (`returns`) | — | ✔ | ✔ |
| Inventario multi-sucursal / descuentos masivos (`multiBranchInventory`) | — | ✔ | ✔ |
| Dominio propio (`customDomain`) | — | ✔ | ✔ |
| Pagos QR (`qrPayments`) | ✔ | ✔ | ✔ |
| Billetera digital (`digitalWallet`) | — | ✔ | ✔ |
| Reportes con IA (`aiReports`) · Probador virtual (`virtualTryOn`) | — | — | ✔ |
| Campañas de email y push (`campaigns`) | — | — | ✔ |
| App móvil para clientes (`mobileApp`) | — | — | ✔ |

**Cómo se aplica en la API:**
- `@RequirePlanFeature('<feature>')` + `PlanFeatureGuard` (no es global: hay que ponerlo en `@UseGuards`): marketing (`campaigns`), POS (`pos`), devoluciones (`returns`), `POST /reports/dynamic` (`aiReports`), `POST /try-on/session` (`virtualTryOn`).
- `assertPlanFeature()` / `currentPlanFeatures()` dentro de servicios: notificaciones push (`campaigns`), creación de pedidos y comprobantes según el medio (`qrPayments` / `digitalWallet`), gestión de pagos, descuentos masivos (`multiBranchInventory`), topes de sucursales (crear y reactivar) y de productos activos (crear y reactivar).
- **App móvil (`mobileApp`): la decide la API con el canal móvil de §4.19** (tokens `channel: "mobile"` emitidos tras plan vigente + prueba de integridad). `TenantMiddleware` todavía rechaza con 403 `MOBILE_APP_NOT_IN_PLAN` las requests con `x-client-platform: mobile` a tiendas sin `mobileApp`, solo para cortar temprano a los builds viejos: **no es un control de seguridad**.
- Dominio propio: `PATCH /platform/tenants/:id/domain` y `by-domain` exigen `customDomain`.
- Los errores de plan son **claves i18n** que traduce `I18nExceptionFilter` (mismo status HTTP y mismo cuerpo `{ statusCode, message, error }`; el front y la app muestran `message` tal cual): `errors.PLAN_FEATURE.<feature>` (`planFeatureMessage()`, con `{plan}`), `PLAN_BRANCH_LIMIT` / `PLAN_ACTIVE_BRANCH_LIMIT` / `PLAN_PRODUCT_LIMIT` (plurales `one/other` con `{count}` y `{plan}`; el de productos además `{upgradePlan}`), `PLAN_STORE_MOBILE_APP`, `PLAN_STORE_CUSTOM_DOMAIN` y `PLAN_SIGNUP_CUSTOM_DOMAIN`. El plan necesario **no se escribe en el texto**: lo calcula `minimumPlanName()` desde `PLAN_FEATURES_MAP`, así que mover una funcionalidad de plan no deja mensajes desalineados. Los nombres de plan (Starter/Growth/Pro) son marca y no se traducen. Prueba: `api/test/acceptance/plan-errors-i18n.spec.ts` (no usa la base).
- El plan viaja en el contexto del tenant, que se cachea 60 s: un cambio de plan tarda hasta un minuto en reflejarse.

**En el front:** (el front web no usa el canal móvil: la tienda web funciona en todos los planes, también desde el navegador del teléfono) `StoreInfoProvider` expone `plan` y `features` (de `GET /store`, cacheados en `localStorage` con la clave `tenant_plan_features:<tenantId>`); `adminNav.ts` usa `planFeature` / `requiredPlanName` para ocultar ítems o mostrar el aviso de upgrade; `PaymentSettingsClient`, `InventoryClient`, `ProductsClient`, `BranchesClient`, `ReportsClient` y el checkout se adaptan al plan.

### 4.19 Canal móvil protegido por plan e integridad (rama `fix/plan-app-movil`, 2026-11-06)
Reemplaza al bloqueo que dependía solo de `x-client-platform: mobile`. Código: `api/src/modules/mobile-access/` (config, verificadores, servicio, DTO), `api/src/modules/auth/mobile-auth.controller.ts`, `jwt.strategies.ts`, `refresh-token.strategy.ts`; app: `app_movil/src/security/mobileAttestation.ts`, `src/api/auth.api.ts`, `src/api/client.ts`.

**Flujo**
1. `POST /auth/mobile/challenge` (con `x-tenant-id`): lee el plan **directo de `public.tenants`** (sin el cache de 60 s). Sin `mobileApp` → 403 `MOBILE_APP_NOT_IN_PLAN`. Si no, crea un desafío de 32 bytes que vence en 5 min (`MOBILE_ATTESTATION_CHALLENGE_TTL_MS`) y devuelve `requestHash` (Android) y `clientData` (iOS), ambos derivados de `stella-mobile-attestation:v1:<tenantId>:<challenge>`: la prueba queda **ligada a la tienda**.
2. La app firma con el SO: Android `requestIntegrityCheckAsync(requestHash)`; iOS `attestKeyAsync(keyId, clientData)` la primera vez y `generateAssertionAsync(keyId, clientData)` después (Expo hace SHA-256 del string antes de llamar a DCAppAttestService; verificado en `@expo/app-integrity` 58.0.2, `ios/IntegrityModule.swift`).
3. `POST /auth/mobile/login|register`: plan vigente → **consume el desafío** (UPDATE condicionado `consumed_at IS NULL AND expires_at > now()`, atado al tenant) → verifica la prueba → recién entonces mira la contraseña → emite tokens con `channel: "mobile"`, `att` (método) y, en el refresh, `platform` + `attestedAt`.
   - **Android:** descifra el token con `playintegrity.googleapis.com/v1/<package>:decodeIntegrityToken` (OAuth con JWT de la cuenta de servicio, sin `googleapis`) y exige: `requestPackageName` y `packageName` = `PLAY_INTEGRITY_PACKAGE_NAME`, `requestHash` exacto, token de < 5 min, `PLAY_RECOGNIZED`, certificado en `PLAY_INTEGRITY_CERT_SHA256` (obligatorio en producción), dispositivo ≥ `PLAY_INTEGRITY_MIN_DEVICE_VERDICT` (default `MEETS_DEVICE_INTEGRITY`), licencia opcional.
   - **iOS:** valida la atestación según Apple (cadena x5c hasta `APP_ATTEST_ROOT_CA_PEM`, nonce de la extensión `1.2.840.113635.100.8.2`, keyId = SHA-256 de la clave pública, `rpIdHash` = SHA-256 de `APP_ATTEST_APP_ID`, contador 0, aaguid de producción salvo `APP_ATTEST_ALLOW_DEVELOPMENT` fuera de producción) y guarda la clave; las aserciones verifican la firma ECDSA y que el contador **crezca** (UPDATE condicionado). Una clave desconocida responde `APP_ATTEST_KEY_UNKNOWN` y la app genera otra. No se valida el *receipt* ni la métrica de fraude de Apple.
4. **Cada request** con token móvil: `JwtStrategy` exige `mobileApp` en `req.tenant.plan` (403 `MOBILE_APP_NOT_IN_PLAN`) y rechaza tokens `att: development-bypass` donde el atajo no está permitido. El token sigue atado al tenant como cualquier JWT (§4.0).
5. **Renovación:** `POST /auth/mobile/refresh` vuelve a leer el plan **sin cache**, rota el refresh y exige prueba nueva si la anterior tiene más de `MOBILE_REATTEST_AFTER_MS` (24 h) → 401 `MOBILE_ATTESTATION_REQUIRED`. Un refresh **web** no se convierte en móvil (`MOBILE_CHANNEL_MISMATCH`) y un refresh móvil no se canjea en `/auth/refresh`.
6. **Cambio de plan:** `SubscriptionsService.syncTenant` ya invalidaba el cache de resolución → en esa instancia el access token móvil deja de valer en el acto; en otras réplicas tarda ≤ 60 s (cache por proceso), y el refresh siempre lee el plan vigente.

**Fail closed y desarrollo:** sin configuración válida de una plataforma, sus pruebas responden 503 `MOBILE_ATTESTATION_UNAVAILABLE` (nunca acceso). Si Google no responde, también 503. El atajo `platform: "development"` solo existe con `MOBILE_ATTESTATION_DEV_BYPASS=true` **y** `NODE_ENV` = `development`/`test`; en la app además exige `__DEV__` y `EXPO_PUBLIC_MOBILE_ATTESTATION_DEV_BYPASS=true`. Con `NODE_ENV=production` se ignora y los tokens emitidos con él dejan de valer.

**Lo que falta para que la verificación real funcione (no se pudo hacer ni probar desde el repo):**
- Android: app publicada en Google Play (al menos un track de prueba interna) con Play App Signing; proyecto de Google Cloud vinculado en Play Console con la API Play Integrity habilitada; cuenta de servicio con su JSON (`PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON`); `PLAY_INTEGRITY_PACKAGE_NAME`, `PLAY_INTEGRITY_CERT_SHA256`; en la app, `EXPO_PUBLIC_PLAY_INTEGRITY_CLOUD_PROJECT_NUMBER`. `app.json` todavía no define `android.package` ni `ios.bundleIdentifier` (hay que fijarlos y que coincidan con lo de arriba).
- iOS: cuenta Apple Developer, App ID con la capacidad **App Attest** y el entitlement `com.apple.developer.devicecheck.appattest-environment` = `production` (en Expo: `ios.entitlements` de `app.json` o Xcode; **no se agregó** para no romper la firma de builds sin esa capacidad); `APP_ATTEST_APP_ID` = `<TEAM_ID>.<bundle id>`; descargar de Apple el PEM de "Apple App Attestation Root CA" en `APP_ATTEST_ROOT_CA_PEM` (no está en el repo).
- Un **development build / EAS** (no existe `eas.json`): en Expo Go la prueba atestigua a Expo Go, no a esta app, y el servidor la rechaza.
- Aplicar la migración de control `20261106120000_mobile_attestation`.

**Compatibilidad de dispositivos:** sin acceso al canal móvil (y con el aviso `mobileAccess.deviceUnsupported`, que sugiere la tienda web) quedan: simuladores iOS y equipos sin App Attest (`isSupported = false`), extensiones de app, Android sin Google Play Services o sin Play Store (Huawei sin GMS, GrapheneOS sin Play, AOSP), dispositivos rooteados/desbloqueados o con ROM que no cumplan `MEETS_DEVICE_INTEGRITY` (bajar a `MEETS_BASIC_INTEGRITY` amplía la cobertura a costa de seguridad), emuladores Android y apps instaladas fuera de Play (si `PLAY_INTEGRITY_REQUIRE_LICENSED=true`). Reinstalar o restaurar el iPhone invalida la clave de App Attest: la app genera otra sola. Una alternativa para Android sin Google sería la atestación de clave por hardware (`generateHardwareAttestedKeyAsync` de `@expo/app-integrity`), **no implementada**.

**Límites que permanecen (no es invulnerable):** la API web es pública y la tienda web vale en todos los planes. Un cliente propio que use los endpoints web (catálogo, `/auth/login`, carrito, pedidos) hace exactamente lo que haría un navegador: eso no se puede impedir sin romper la web, y no es "la app móvil" en términos del servidor. Lo que sí garantiza el cambio: la **app oficial** solo obtiene sesión en tiendas Pro/Legacy y solo en dispositivos íntegros, ningún header/User-Agent/secreto embebido habilita el canal móvil, y una sesión móvil cae al bajar de plan. Un atacante con un dispositivo íntegro real podría automatizar la app oficial (la integridad prueba app + dispositivo, no a la persona). Las funciones exclusivas de la app que se agreguen en el futuro deben exigir `req.user.channel === 'mobile'` para quedar protegidas por este canal.

---

## 5. Limitaciones conocidas, deuda técnica y cosas a verificar antes de confiar en ellas

### 5.1 Bugs / decisiones riesgosas confirmadas leyendo el código actual
1. **CORS efectivamente abierto a cualquier origen.** En `api/src/main.ts`, el callback de `origin` termina en `return callback(null, true)` en todas las ramas: el chequeo contra `ALLOWED_ORIGINS` es código muerto. Para restringir CORS hay que arreglar ese último `return`.
2. **`ValidationPipe.forbidNonWhitelisted` es `false`:** los campos fuera del DTO se descartan en silencio (commit `feb64e6`, por el `_t` de cache-busting). Relaja la validación de entrada en toda la API.
3. **Clave pública de Stripe hardcodeada en `docker-compose.yml`** (`pk_test_...`). Es la pública, pero conviene moverla a `.env`/secret si el repo se comparte.
4. **Webhook de Stripe sin guard** por diseño (firma). Quitar `rawBody: true` de `main.ts` rompe la verificación sin un error obvio; sacar la ruta de la exclusión de `TenantMiddleware` haría que Stripe reciba 401 y ningún pago se confirme (hay una doble barrera en `TENANTLESS_ROUTES`).
5. **Doble lockfile en `api/` y en `front/`** (`package-lock.json` + `bun.lock` en ambos). Hay que decidir el gestor oficial por proyecto.
6. **`app_movil/README.md` documenta credenciales y una BD Neon distintas** a las del seed. Verificar contra `api/prisma/seed.mjs`.
7. ~~No existe `app_movil/eas.json`.~~ Creado (§2.4); falta `eas init` cuando haya cuenta de Expo.
8. **`ProductDetail.tsx:106` conserva un comentario que dice que el probador "aún no existe".** Es obsoleto (§4.12).
9. **`DECART_API_KEY` ya se sacó de `docker-compose.yml`**, pero la key vieja (`dct_probador_...`) **sigue en el historial de git**: hay que rotarla en Decart si no se hizo. `api/.env` todavía tiene `DECART_API_KEY`, que solo lee el script `import-legacy-integrations`.
10. **La rama `oscar` es incompatible con la BD actual.** Es anterior a `edb3598` y usa un único `PrismaService` contra `public`; como el SQL `001_…` ya renombró `public` a `tenant_legacy`, cualquier query de negocio falla con `P2021 TableDoesNotExist`. Para trabajar con la BD actual usar `main`; para revivir `oscar` habría que rebasarla sobre `main` o darle su propia BD.
11. **`api/.env.example` sigue incompleto:** en `2291d1c` se le agregaron las variables del checkout (`PAYMENT_CURRENCY`, `CART_RESERVATION_TTL_MS`, `ORDER_TTL_*`, `ALLOW_SIMULATED_PAYMENTS`, etc.), pero todavía no tiene `DIRECT_URL`, `TENANT_SECRETS_KEYS`, `PLATFORM_ADMIN_KEY`, `INTERNAL_API_KEY`, `STRIPE_CONNECT_WEBHOOK_SECRET`, `LEGACY_TENANT_ID` ni `TENANT_BASE_DOMAIN`, y todavía documenta `VAPID_*` globales (ya son por tienda). Usar la tabla de §6.4.
12. **`LEGACY_TENANT_ID` no está en `api/.env`.** Es el fallback del webhook para PaymentIntents creados antes del multitenant (sin `tenantId` en la metadata): sin la variable, esos eventos no encuentran tienda. Debería valer `00000000-0000-4000-8000-000000000001`.
13. **Docker del front sin tienda por defecto:** ni `front/Dockerfile` ni `docker-compose.yml` pasan `NEXT_PUBLIC_TENANT_ID`/`NEXT_PUBLIC_LEGACY_TENANT_ID` como build args (son `NEXT_PUBLIC_*`, se hornean en el build), ni `INTERNAL_API_KEY`/`PLATFORM_HOSTS` en runtime. Una imagen construida así abre el selector de tienda y no resuelve dominios propios. Confirmar cómo está configurado el deploy real en Azure.
14. **Comentarios desalineados sobre idiomas del catálogo:** la migración `product_translations` y `schema.prisma` mencionan `pt`, pero `TRANSLATABLE_LANGUAGES` solo acepta `en`, `fr`, `zh` (un `pt` se rechaza).
15. **El mismo email puede ser usuario de varias tiendas** (son tablas distintas). Es intencional. El login siempre ocurre en la tienda elegida (§4.1); `POST /auth/login` por tienda sigue existiendo (lo usan la app móvil y los dominios propios).
16. **(Resuelto en `fix/login-multitenant`) El login unificado recorría todas las tiendas.** Ahora `tenant-login` exige `tenantId` y consulta solo esa tienda (§4.1). Quedan dos oráculos fuera de alcance: `POST /auth/register` responde `EMAIL_TAKEN` (inherente al registro) y `POST /platform/auth/login` (administradores) sigue respondiendo `TOO_MANY_ATTEMPTS`/`ACCOUNT_LOCKED` distinto de `INVALID_CREDENTIALS`.
17. ~~El bloqueo de app móvil por plan depende de un header que manda el propio cliente~~ → resuelto en `fix/plan-app-movil` con el canal móvil de §4.19 (tokens emitidos por la API tras plan vigente + Play Integrity / App Attest; `x-client-platform` queda solo como pista). Pendiente: credenciales y publicación reales (lista en §4.19); hasta tenerlas, en producción **nadie** puede abrir sesión en la app (fail closed). Los builds viejos de la app (que usan `/auth/login`) siguen obteniendo sesiones web en tiendas Pro; conviene forzar la actualización. La URL de la app ya no tiene IP LAN fija ni Azure hardcodeado (`fix/url-app-movil`): un build de producción **exige** `EXPO_PUBLIC_API_URL` (https, pública) y falla si falta (§2.4). La API no está desplegada hoy, así que no hay URL de producción definida.
18. ~~**Mensajes de plan sin i18n**~~ — resuelto en la rama `fix/idiomas-planes`: los errores de plan de la API son claves i18n en los 4 idiomas (§4.18) y la app móvil traduce sus avisos de plan del selector de tienda (`mobileAccess.*`, que en la integración reemplazó a `tenantSelector.*`). **Sigue pendiente** el texto propio del front sobre planes (avisos de upgrade en `ProductsClient`, `PaymentSettingsClient`, `ReportsClient`, etc.) y el resto de `TenantSelectorScreen`, que están en español fijo; y otros errores no relacionados con planes en `platform.controller.ts` ("Tienda no encontrada", "Dominio no registrado") y `branches.service.ts` (uno en inglés).
19. **Billetera con datos de ejemplo (corregido en `fix/configuracion-billetera`; quedan tiendas por revisar):** antes, `seedPaymentSettings` activaba en Growth/Pro la billetera con la cuenta ficticia `@<slug> / pagos@<slug>.com`, y además `PaymentSettingsService.read()` la **escribía al leer** (panel o checkout) en cualquier tienda con plan con billetera y sin cuenta, incluida la legacy (con slug `mitienda` si no resolvía la tienda); la app móvil, por su parte, mostraba siempre la pestaña de billetera con cuentas inventadas desde el slug. Ahora las tiendas nacen con la billetera desactivada y vacía, `read()` no escribe, el reintento (`update: {}`) no pisa lo guardado y la app usa los datos reales de `payment-options`. **Tiendas existentes:** no se tocaron (una coincidencia puede ser una cuenta real). Para revisarlas: `cd api && npm run build && npm run wallet:audit` (o `-- --json`, `-- --tenant <slug>`). La sesión abre PostgreSQL con `default_transaction_read_only=on`, así que no puede escribir. Riesgo **ALTA** = cuenta idéntica a la de ejemplo; **MEDIA** = contiene `@<slug>` o `pagos@<slug>.com`; **BAJA** = solo quedan el proveedor o las instrucciones sembrados (los textos están en `modules/payments/wallet-sample.ts`). El reporte trae `pedidos` (pedidos con `WALLET`) y `aprobados` (comprobantes aprobados). Si hay comprobantes aprobados, la cuenta probablemente recibe dinero de verdad. Antes de cambiar algo: (1) confirmar con el dueño de cada tienda si la cuenta es suya; (2) si no lo es, que la desactive o la corrija él mismo desde `/admin/settings/payments`, o hacerlo con su autorización escrita; (3) revisar los pedidos `WALLET` pendientes de esa tienda por si algún cliente transfirió a la cuenta de ejemplo. **Nunca** desactivar en lote.
20. **~~Los pedidos con billetera vencían como si fueran tarjeta~~ (corregido en la rama `fix/vencimiento-billetera`):** `orderPaymentTtlMs` solo daba `ORDER_TTL_MANUAL_MS` a `BANK_QR`/`USDT`; ahora `WALLET` está en `MANUAL_PAYMENT_METHODS` (prueba `api/test/acceptance/expiry-manual-payments.spec.ts`). **Datos históricos:** los pedidos `WALLET` creados antes del despliegue de la corrección guardaron `paymentExpiresAt = creación + ORDER_TTL_CARD_MS` y ese valor no se recalcula. Si no tenían comprobante `PENDIENTE`, el cron los canceló a la hora (repuso stock y avisó por push); si el cliente pagó después, ya no pudo subir la referencia (el pedido no estaba `PENDIENTE`). Los que tenían comprobante en revisión no se vieron afectados. No se tocaron datos: la revisión es manual y de solo lectura (consultas en el informe de la corrección: pedidos `WALLET` cancelados con `inventory_movements.reason = 'ORDER_EXPIRED'` antes de las 24 h, y pedidos `WALLET` aún pendientes con plazo menor a 23 h).
21. **~~Autoconfirmación de tarjeta de prueba sin opt-in~~ (corregido, sin commit, sobre `integracion/correcciones`):** `PaymentsService.confirmPayment` confirmaba con `pm_card_visa` si `simulatedPaymentsEnabled()` **o** la clave empezaba con `sk_test_` (entró en `a860fbe`; en `2291d1c` solo existía la primera condición). Con cualquier clave de prueba, un cliente obtenía un pedido pagado sin pagar. Ahora la única puerta es `simulatedPaymentsEnabled()` (`ALLOW_SIMULATED_PAYMENTS=true`, `NODE_ENV` no productivo y clave `sk_test_`). La app móvil sin SDK nativo necesita ese opt-in para la demo con tarjeta. P04/P11 fallaban por el código, no por la prueba (el Stripe falso devolvía 404 porque la API tomaba el camino de simulación); el Stripe falso ahora implementa `confirm` y **P11b** cubre la simulación explícita y su bloqueo en producción. 
22. **~~Cobro con tarjeta en la cuenta central sin Stripe Connect~~ (corregido, sin commit, sobre `integracion/correcciones`):** desde `a860fbe`, `StripeConnectService.isDirectPlatformFallbackAllowed` devolvía `true` con cualquier clave `sk_test_` (todas las tiendas) **y, con cualquier clave incluida `sk_live_`, para la tienda `LEGACY_TENANT_ID`**. En esos casos `isCardEnabled`/`getStatus` decían que había tarjeta y `createPaymentIntent` creaba el PaymentIntent **sin `transfer_data`** (cobro a la cuenta de la plataforma, sin comisión). Ahora el flujo de tarjeta exige siempre una cuenta conectada **y** habilitada de la propia tienda (`getPayoutAccount`, 400 si no la hay), `isCardEnabled` usa la misma condición, `obtainIntent` nunca crea un PI sin destino, un intento abierto con otro destino (o sin destino) se retira con `resolveProviderBeforeRelease` antes de abrir uno nuevo y `reconcileIntent` rechaza un PI con destino si su intento no lo tenía. Los PI ya creados sin destino que el cliente pagó siguen llegando a su tienda por el webhook y se liquidan, pero dejan la anomalía `PAYMENT_WITHOUT_DESTINATION` (ERROR) para transferirle el importe a mano. `GET /store/payment-options` agrega `simulatedCard` (`card && simulatedPaymentsEnabled()`) y `/payments/confirm` responde `simulated: true` cuando usa la tarjeta de prueba. La app móvil solo muestra la tarjeta (rotulada "simulación") con `card && simulatedCard` y no crea el PaymentIntent si no la hay. Pruebas: `stripe-connect-destination.spec.ts` (K01–K08). Las tiendas de la demo local no tienen Connect: la tarjeta ya no aparece allí.
22. **~~Las respuestas de login devolvían el hash de la contraseña~~ (corregido, sin commit, sobre `integracion/correcciones`):** `toUserResponse` copiaba con `...rest` todo lo seleccionado y `login`/`tenantLogin` seleccionan además `password`, `loginAttempts` y `lockedUntil`, que salían en `POST /auth/login`, `/auth/mobile/login` y `/platform/auth/tenant-login`. Ahora `toUserResponse` arma el usuario campo por campo (los 12 de `UserResponseDto`), así que nada seleccionado de más llega al cliente; registro, refresh web y móvil y `/users/me` usan el mismo mapper. Prueba: `auth-response-privacy.spec.ts` (recorre todo el JSON y busca los valores reales guardados en la base). Los navegadores o teléfonos que iniciaron sesión antes conservan el `user` viejo (con el hash) en su almacenamiento local hasta el próximo login.

### 5.2 Pendientes ya conocidos que siguen sin resolver
- **Reserva de stock en carrito:** si la API está caída, el cron no corre y la reserva queda tomada hasta el siguiente arranque.
- **Pagos manuales:** la verificación es 100 % humana; no hay consulta automática a la blockchain para USDT, al banco para el QR ni a Airtm/Takenos/Wallbit para la billetera. Los pedidos impagos sí vencen ahora por TTL (§4.10; datos históricos de billetera en §5.1.20).
- **Planes:** no hay *downgrade* controlado: si una tienda baja de plan, los datos que excedan el nuevo tope (sucursales, productos) quedan como están; solo se bloquea crear o reactivar más.
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
- Lint preexistente con varios `any` (`npx eslint` en `api/` no carga: falta `eslint-plugin-prettier`; en `front/`, `PaymentSettingsClient.tsx` ya tenía un error `react-hooks/set-state-in-effect`). Jest no corre (`TS5011` con `ts-jest`, varios `jest.config.*` y Nest 12 es ESM): la suite real es **`api/test/acceptance`** (`npm run test:acceptance`, PostgreSQL local desechable con `max_connections` ≥ ~300). Cubre inventario/checkout, pagos con Stripe falso, PWA en Chromium (se salta sin Playwright), Stripe real (se salta sin `STRIPE_TEST_SECRET_KEY`), intentos móviles, backfill, `expiry-manual-payments`, `wallet-settings`, `mobile-channel` + `mobile-attestation-client`, `tenant-login`, `plan-errors-i18n`, `auth-response-privacy` y `stripe-connect-destination`. `support/env.ts` fija también `ALLOW_SIMULATED_PAYMENTS`, `MOBILE_ATTESTATION_DEV_BYPASS`, `PLAY_INTEGRITY_*` y `APP_ATTEST_*`: un `api/.env` local que los active (como el de la demo) ya no altera los resultados (antes rompía M16). `stock-writers.spec.ts` deja su tienda en Growth mientras corre (POS y devoluciones exigen Growth): antes I03 fallaba con 403 e **I02 pasaba sin carrera real** (el POS respondía 403 por plan); I02 ahora exige 201/409 en ambos lados e I04 comprueba que una tienda Starter recibe 403. Al 2026-11-06, sobre `integracion/correcciones` con los cambios sin commit: **152/152** (2 suites omitidas: PWA en navegador y Stripe real). Instalación: `api` con `npm ci --legacy-peer-deps`; `front/package-lock.json` está desincronizado con `package.json` (`npm ci` falla por `@types/dom-mediacapture-record`), pero `bun install --frozen-lockfile` funciona; `app_movil` con `npm ci`.

### 5.3 Historial de commits recientes (más nuevo primero, `git log --oneline`)
```
a481006 Merge branch 'origin/main' (MauricioD98)        ← une a860fbe con 2291d1c
a860fbe feat: planes multi-tenant, panel admin NovaSoft, integracion de pagos y soporte dinamico movil
                                                        ← features por plan, billetera P2P, login unificado, marca NovaSoft, Expo 58
2291d1c PWA                                             ← checkout resiliente: reservas, idempotencia, outbox, suite de aceptación
c7be543 v0                                              ← administradores de plataforma con email/contraseña
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
Las seis correcciones del 2026-11-06 (`fix/vencimiento-billetera`, `fix/configuracion-billetera`, `fix/plan-app-movil`, `fix/url-app-movil`, `fix/login-multitenant`, `fix/idiomas-planes`, todas sin commit sobre `e809a64`) quedaron integradas en la rama **`integracion/correcciones`** (worktree `ecommerce-si2-worktrees/07-integracion`), sin merge a `main`. Decisiones de la integración: el middleware usa `mobilePlanForbidden()` de `fix/plan-app-movil` (código `MOBILE_APP_NOT_IN_PLAN`, traducido) en vez del `ForbiddenException(planFeatureMessage('mobileApp'))` de `fix/idiomas-planes`; el selector de tienda de la app usa las claves `mobileAccess.*` y se descartaron las `tenantSelector.*` equivalentes; `payment-proofs.service.ts` usa `MANUAL_PAYMENT_METHODS` (vencimiento) e `isWalletReady` (billetera); los diccionarios de errores de la API y de la app conservan la unión de las claves nuevas. Notas de interacción: la API guarda **un solo refresh token por usuario**, así que iniciar sesión en la app invalida el refresh de la sesión web del mismo usuario (y viceversa); comportamiento previo, ahora más visible con el canal móvil. `main` sigue en `e809a64`; existen también `oscar` y `origin/oscar` (en `fffafec`, ver §5.1.10). Correr `git status --short` y `git log --oneline -20` antes de asumir nada.

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
# en desarrollo usa la IP del host de Metro:3001 (emulador Android: 10.0.2.2:3001); ver .env.example
# builds de producción (expo export / eas build preview|production) EXIGEN EXPO_PUBLIC_API_URL https pública
# la tienda debe tener plan Pro/Legacy y la API debe verificar la prueba de integridad (§4.19).
# Desarrollo sin Google/Apple: API con NODE_ENV=development + MOBILE_ATTESTATION_DEV_BYPASS=true y
# app con EXPO_PUBLIC_MOBILE_ATTESTATION_DEV_BYPASS=true (solo en __DEV__). La prueba real exige un
# development build firmado (no Expo Go) y la app publicada en Play / con App Attest habilitado.
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
| `PAYMENT_CURRENCY` | Moneda de los cobros con tarjeta. **Por defecto `bob`** (los precios se muestran en Bs; antes era `usd`, que cobraba el mismo número en dólares). `GET /store/payment-options` la expone como `currency` y el checkout web no ofrece tarjeta si no es `bob` |
| `CART_RESERVATION_TTL_MS`, `ORDER_TTL_CARD_MS`, `ORDER_TTL_MANUAL_MS`, `PAYMENT_RECONCILIATION_HOLD_MS` | TTLs del checkout (1 h, 1 h, 24 h, 6 h por defecto; `checkout-policy.ts`) |
| `ALLOW_SIMULATED_PAYMENTS`, `DISABLE_BACKGROUND_JOBS` | QR simulado / autoconfirmación fuera de producción · apagar los crons (tests) |
| `PLAY_INTEGRITY_PACKAGE_NAME`, `PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON`, `PLAY_INTEGRITY_CERT_SHA256`, `PLAY_INTEGRITY_MIN_DEVICE_VERDICT`, `PLAY_INTEGRITY_REQUIRE_LICENSED` | Verificación Play Integrity del canal móvil (§4.19). `CERT_SHA256` obligatorio en producción |
| `APP_ATTEST_APP_ID`, `APP_ATTEST_ROOT_CA_PEM`, `APP_ATTEST_ALLOW_DEVELOPMENT` | Verificación App Attest (§4.19). El PEM de la raíz de Apple no está en el repo |
| `MOBILE_ATTESTATION_CHALLENGE_TTL_MS`, `MOBILE_REATTEST_AFTER_MS`, `MOBILE_ATTESTATION_DEV_BYPASS` | Desafío (5 min), re-verificación en el refresh (24 h) y atajo de desarrollo (solo `NODE_ENV` development/test) |
| `DECART_API_KEY`, `VAPID_*` | **Ya no los usa la API en runtime** (son por tienda). Solo los lee `import-legacy-integrations` |

**`front/.env.local`:** `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_TENANT_ID` (tienda por defecto; en local es la legacy `00000000-0000-4000-8000-000000000001`), `INTERNAL_API_KEY` (la misma que en la API). Opcionales: `NEXT_PUBLIC_LEGACY_TENANT_ID`, `API_INTERNAL_URL` (URL de la API vista desde el servidor del front), `PLATFORM_HOSTS` / `NEXT_PUBLIC_PLATFORM_HOSTS`. Ya **no** necesita `DECART_API_KEY`. El chatbot no usa variables.

**`app_movil`** (ver `app_movil/.env.example`): `EXPO_PUBLIC_API_URL` (opcional en desarrollo; **obligatoria en producción**: `https://<dominio-público>/api/v1`, §2.4), `EXPO_PUBLIC_TENANT_ID` (opcional), `APP_ENV` (la fija `eas.json`; no es pública), `EXPO_PUBLIC_PLAY_INTEGRITY_CLOUD_PROJECT_NUMBER` (Android, §4.19; no es secreto), `EXPO_PUBLIC_MOBILE_ATTESTATION_DEV_BYPASS` (solo desarrollo). Todo `EXPO_PUBLIC_*` queda embebido en la app: nunca secretos ahí. En EAS se configura con `eas env:create --environment production --name EXPO_PUBLIC_API_URL …`. Dependencia nueva: `@expo/app-integrity` 58.0.2.

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
- Si vas a agregar o mover una **funcionalidad entre planes**, edita `PLAN_FEATURES_MAP` (API) y la interfaz `PlanFeatures` de `front/providers/StoreInfoProvider.tsx`, bloquea en la API con `@RequirePlanFeature` o `assertPlanFeature` y revisa `adminNav.ts` (§4.18).
- Si vas a agregar **texto de UI o mensajes de error**, agrégalo en los 4 idiomas (§4.16).
- Si vas a tocar **pagos**, recuerda que la tarjeta pasa por Stripe Connect (nunca cobrar sin `destination`) y que QR/USDT se aprueban a mano (§4.4).
- Si vas a tocar **inventario/stock**, recuerda que es por **talla** y que hay `stock` (vendible) y `damagedStock` (mermas).
- Si vas a tocar **devoluciones**, lee §4.11.
- Si vas a tocar **CORS o validación de entrada**, lee §5.1.1 y §5.1.2.
- Si una tarea menciona **probador virtual**, revisa §4.12: el token lo firma la API con la key de la tienda.
- Si una tarea menciona **chatbot**, revisa §4.13.
- Si una tarea toca la **app móvil, el login/refresh o el plan `mobileApp`**, lee §4.19: el canal móvil lo decide la API (tokens `channel: "mobile"`), nunca un header del cliente.
- Antes de dar por buena cualquier afirmación de este archivo sobre un archivo, endpoint o campo específico, verifícalo en el código: el código es la fuente de verdad.

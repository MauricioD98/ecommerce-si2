# App Mobile E-Commerce (React Native + Expo)

Aplicación móvil desarrollada con **React Native**, **Expo SDK 52+**, **TypeScript** y **React Navigation**, conectada a la API de NestJS y base de datos Neon PostgreSQL.

---

## 🚀 Características y Módulos

1. **Autenticación (`Auth`)**:
   - Inicio de sesión con credenciales persistidas en Neon.
   - Acceso rápido con 1 click para usuarios de prueba existentes.
   - Registro de nuevas cuentas con validación segura de contraseñas.
   - Renovación automática de sesión vía `Refresh Token` en Axios.
   - Cierre de sesión seguro con limpieza de almacenamiento local.

2. **Tienda y Catálogo (`Products` & `Categories`)**:
   - Catálogo interactivo de productos en cuadrícula de 2 columnas.
   - Barra de búsqueda en tiempo real por nombre o SKU.
   - Chips de categorías desplazables horizontalmente para filtrado instantáneo.
   - Vista detallada de producto con galería de imágenes, talla, SKU, stock disponible y selector de cantidades.
   - Agregar al carrito con validación de stock disponible.

3. **Carrito de Compras (`Cart`)**:
   - Sincronización en tiempo real con el backend mediante `CartContext`.
   - Modificación de cantidades (+ / -), eliminación individual y vaciado total.
   - Contador dinámico tipo badge en la barra de navegación inferior.
   - Resumen financiero: Subtotal, envío estimado y total a pagar.

4. **Checkout y Pedidos (`Orders`)**:
   - Pantalla de Checkout con ingreso de dirección de entrega.
   - Generación de órdenes en la base de datos y reserva de stock.
   - Pestañas de filtrado de pedidos (*Todos*, *Pendientes*, *Procesando*, *Enviados*, *Entregados*).
   - Vista detallada del pedido con listado de artículos, dirección, estado de pago y opción de cancelar pedidos pendientes.

5. **Pasarela de Pagos (`Payments`)**:
   - Integración con el flujo de **Stripe** (`/payments/create-intent` y `/payments/confirm`).
   - Simulación visual de tarjeta de crédito con titular, número, vencimiento y CVC.
   - Confirmación de pago y actualización automática del pedido a estado `PROCESANDO`.
   - Comprobante y recibo con ID de transacción.

6. **Perfil de Usuario (`Users`)**:
   - Consulta de datos personales, avatar con iniciales y rol (`USUARIO` / `ADMIN`).
   - Actualización de nombre, apellido y correo electrónico.
   - Cambio seguro de contraseña.
   - Acceso directo a configuración de servidor.

---

## 📱 Credenciales de Prueba (Neon DB)

Puedes ingresar rápidamente con cualquiera de las cuentas ya existentes en tu base de datos Neon:

| Correo | Contraseña | Rol |
|---|---|---|
| `admin@gmail.com` | `Admin123*` | Administrador / Usuario |
| `john.doe@example.com` | `StrongP@ssw0rd!` | Usuario |

*(En la pantalla de Login encontrarás botones de acceso rápido para rellenar estos campos automáticamente)*.

---

## ⚙️ Configuración del Servidor API

La URL base sale de `EXPO_PUBLIC_API_URL` (ver `.env.example`). Siempre termina en `/api/v1`
(prefijo global de la API): si no lo pones la app lo agrega y nunca lo duplica. Los endpoints se
concatenan como `/auth/login`, `/products`, etc. Lógica en `src/config/env.ts` y `src/config/apiUrl.js`.

### Desarrollo (`npx expo start`)
`EXPO_PUBLIC_API_URL` es opcional. Sin ella la app elige sola:

| Dónde corre la app | URL usada | Notas |
|---|---|---|
| Dispositivo físico (Expo Go) | `http://<IP de la PC que muestra Metro>:3001/api/v1` | Misma Wi-Fi; permite el puerto 3001 en el firewall |
| Emulador Android | `http://10.0.2.2:3001/api/v1` | `10.0.2.2` es la PC anfitriona; `localhost` sería el emulador |
| Simulador iOS / web | `http://localhost:3001/api/v1` | |

Para forzar otra dirección, crea `.env.local` con `EXPO_PUBLIC_API_URL=http://192.168.1.50:3001/api/v1`
y reinicia con `npx expo start -c` (las variables se embeben al empaquetar).

> 💡 En desarrollo puedes cambiar o restaurar la URL desde **"Servidor: [URL]"** en el Login o desde
> **Perfil**. En un build de producción esa opción solo acepta URLs `https` públicas.

### Producción (`npx expo export`, EAS `preview` / `production`)
`EXPO_PUBLIC_API_URL` es **obligatoria**, con `https` y dominio público. `app.config.js` detiene el
build si falta, si el formato es inválido o si apunta a `localhost` / una IP privada. Si aun así un
build llegara sin URL, la app no cae en una IP de desarrollo: las peticiones fallan con un mensaje claro.

```bash
# local: .env.production (no se versiona)
EXPO_PUBLIC_API_URL=https://api.example.com/api/v1   # ← ejemplo, reemplázalo por tu API real

# EAS (no hace falta subir .env): crear la variable en el entorno del perfil
eas env:create --environment production --name EXPO_PUBLIC_API_URL --value https://<tu-api>/api/v1 --visibility plaintext
```

Perfiles en `eas.json`: `development` (dev client, API local; requiere instalar `expo-dev-client`
antes de usarlo), `preview` (APK interno, exige URL pública) y `production`. Cada uno fija
`APP_ENV`, que es lo que lee la validación.

> ⚠️ Todo `EXPO_PUBLIC_*` queda embebido en la app y es público: nunca guardes secretos ahí.

Pruebas del validador: `npm run test:config`.

---

## 🛠️ Comandos de Ejecución

Asegúrate de que la API NestJS esté corriendo en el puerto 3001:
```bash
# En la carpeta /api
npm run dev
```

Luego inicia la app móvil:
```bash
# En la carpeta /app_movil
npx expo start
```

Opciones:
- Presiona `a` para abrir en emulador **Android**.
- Presiona `i` para abrir en simulador **iOS** (en macOS).
- Presiona `w` para abrir en **Navegador Web**.
- Escanea el código QR con la app **Expo Go** en tu teléfono Android o iOS.

---

## 👗 Probador virtual en vivo (Decart lucy-2.5)

En el detalle de una prenda, **«Probar en vivo»** abre la cámara frontal y transmite el video a Decart
(`lucy-2.5`, WebRTC por LiveKit), que lo devuelve con la prenda del catálogo puesta. Solo tiendas con el
probador en su plan (Pro). El cliente no sube ninguna foto: la referencia es la imagen de la prenda.

- **No funciona en Expo Go** (LiveKit necesita módulos nativos): hace falta un *development build*. En
  Expo Go el resto de la app funciona y el probador explica que necesita la app instalada.
- La clave permanente de Decart vive solo en la API (`DECART_API_KEY` en `api/.env` o la clave propia de
  la tienda). La app recibe un token de cliente que solo abre `lucy-2.5`, dura poco y cuya sesión
  corta Decart a los `TRY_ON_LIVE_MAX_SECONDS` (60 s por defecto). Ver `api/.env.example`.
- Pruebas con componentes simulados: `npm run test:tryon` (app) y
  `node test/acceptance/run.js try-on-live` (API, con un Decart falso local).

### Development build en Android (local)

Requisitos: Android Studio (SDK 36, NDK), JDK 17+ y un teléfono con **depuración USB** (o un emulador).

```bash
# En la carpeta /docs/app_movil
npm install
npx expo prebuild --platform android   # genera ./android (ignorado por git)
npm run android:dev-build              # = npx expo run:android: compila e instala la app de desarrollo
```

Después, para trabajar: `npm run start:dev-client` y abre la app instalada (no Expo Go). Si el teléfono
está por USB, `adb reverse tcp:3001 tcp:3001` hace que la app llegue a la API local.

Con EAS (en la nube, sin Android Studio): `npx eas build --profile development --platform android` y se
instala el APK que entrega el enlace.

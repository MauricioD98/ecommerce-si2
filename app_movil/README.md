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

Por defecto, la app detecta automáticamente el entorno:
- **Android Emulator**: `http://10.0.2.2:3001/api/v1`
- **Web / iOS Simulator**: `http://localhost:3001/api/v1`
- **Dispositivo físico (Expo Go)**: `http://TU_IP_LOCAL:3001/api/v1` (ej. `http://192.168.1.50:3001/api/v1`)

> 💡 **Nota**: Puedes cambiar o restaurar la URL de la API en cualquier momento haciendo clic en **"Servidor: [URL]"** en la parte inferior del Login o desde la pestaña de **Perfil**.

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

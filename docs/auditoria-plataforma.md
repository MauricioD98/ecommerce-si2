# Administradores y auditoría de la plataforma

Panel: `/plataforma/administradores`. API: `GET /api/v1/platform/admins` y `GET /api/v1/platform/audit`. Ambas usan `PlatformAdminGuard`.

## Quién es administrador de la plataforma

- Los administradores del SaaS están en `public.platform_admins` y entran a `/plataforma` con email y contraseña. Se crean por consola: `npm run platform:admin -- <email> <contraseña>`.
- **No** son usuarios de ninguna tienda. El dueño, el Super Admin o cualquier usuario de una tienda tiene un JWT de tienda, y en `/platform/*` recibe 401.
- Los scripts pueden usar la llave `PLATFORM_ADMIN_KEY` (`x-platform-key`). Esas acciones quedan registradas como `PLATFORM_KEY`, sin identidad personal.
- El panel solo muestra los administradores y su estado. No permite crearlos, desactivarlos ni cambiar contraseñas.

### Estados

| Estado | Significado |
| --- | --- |
| Activo | `is_active = true` y sin bloqueo vigente. |
| Bloqueado temporalmente | `locked_until` es posterior a ahora, por intentos fallidos. Se levanta solo al vencer. |
| Desactivado | `is_active = false`: no puede entrar y sus tokens vigentes dejan de valer. |

## Qué se registra

Todo se guarda en la tabla `public.platform_audit_log`, creada por la migración de control `20261108230000_platform_audit_log`.

| Acción | Cuándo | Quién |
| --- | --- | --- |
| `PLATFORM_LOGIN` | Inicio de sesión exitoso o fallido en `/plataforma`. | Administrador, o `ANONYMOUS` con el email intentado. |
| `TENANT_CREATED` | Alta de una tienda desde la plataforma. | Administrador o llave. |
| `TENANT_SUSPENDED` / `TENANT_REACTIVATED` | Cambio manual de estado, con el estado anterior y el nuevo. | Administrador o llave. |
| `TENANT_SUSPENDED_BY_BILLING` / `TENANT_REACTIVATED_BY_BILLING` | Cambio automático por el estado de la suscripción en Stripe. | `SYSTEM` |
| `TENANT_PROVISION_RETRIED` | Reintento de creación de una tienda con error. | Administrador o llave. |
| `TENANT_DOMAIN_CHANGED` | Asignar o quitar un dominio propio. | Administrador o llave. |
| `TENANT_INTEGRATION_CHANGED` | Alta, importación, generación o baja de una integración. Se guarda solo el proveedor y la operación, nunca la clave. | Administrador o llave. |
| `SUBSCRIPTION_SYNCED` | «Leer de Stripe» desde el panel. | Administrador o llave. |
| `SIGNUP_RETRIED` | Reintento de un alta pagada. | Administrador o llave. |
| `BACKUP_CREATED`, `BACKUP_UPLOADED`, `BACKUP_DOWNLOADED`, `BACKUP_RESTORE_STARTED`, `BACKUP_DELETED` | Operaciones de respaldo de plataforma. | Administrador o llave. |

Cada registro guarda:
- la fecha;
- el tipo de actor y su email;
- la acción;
- la tienda afectada (id, identificador y nombre en ese momento);
- el recurso afectado;
- el resultado: `SUCCESS`, `FAILURE` o `REQUESTED`;
- un código de error corto (por ejemplo `HTTP 409: …`, o `INTERNAL_ERROR` sin detalles internos);
- algunos detalles permitidos.

Las operaciones de respaldo son asíncronas y quedan como `REQUESTED`. El panel muestra su resultado final leyendo `backup_jobs`.

## Qué no se registra

- Contraseñas, tokens, claves de Stripe, de cifrado o de integraciones, ni contenido de respaldos.
- En `details` solo se aceptan estas claves: `from`, `to`, `plan`, `slug`, `domain`, `provider`, `operation`, `scope`, `subscriptionStatus`, `signupId` y `reason`. Cualquier otra se descarta.
- Las acciones que el dueño o los empleados hacen en el panel de su tienda. Ese es otro ámbito.
- Las consultas, es decir las pantallas que solo leen datos.
- Las peticiones que la validación de datos rechaza antes de llegar a la acción, por ejemplo un 400 por formato inválido. En ese caso la acción no llega a ejecutarse.

## Desde cuándo hay información

- La migración inserta una fila `AUDIT_STARTED`, y el panel muestra esa fecha. **No existe historial anterior** y no se reconstruye ninguno.
- Antes de esa fecha, el único registro con autor es el de los respaldos: `backup_jobs.requested_by_*`, visible en la sección Respaldos.
- Si la API se actualiza antes de aplicar la migración, las acciones siguen funcionando, pero no quedan registradas. El log del servidor muestra una advertencia, y el panel indica que la auditoría no está disponible.

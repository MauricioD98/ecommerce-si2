# Copias de seguridad y restauración

Módulo `api/src/modules/backups` + pantallas `/admin/backups` (tienda) y sección **Respaldos de plataforma** en `/plataforma` (SaaS).
Prueba de aceptación: `api/test/acceptance/backups.spec.ts` (R01–R10).

## 1. Cómo funciona

| | Respaldo de tienda | Respaldo de plataforma |
|---|---|---|
| Quién | Super Admin (dueño) de **su** tienda · administrador de la plataforma para cualquier tienda | Solo administrador de la plataforma (sesión de `/plataforma` o `x-platform-key`) |
| Qué tienda | La del request (`x-tenant-id` + JWT atado a esa tienda). Nunca un id, schema o ruta del navegador | Todas las registradas en `public.tenants` |
| Contenido | Todas las tablas del schema `tenant_<id>` (ver §3) | Plano de control (`public`, salvo exclusiones) + el schema completo de cada tienda |
| Consistencia | Una transacción `REPEATABLE READ READ ONLY` | **Una sola** transacción `REPEATABLE READ READ ONLY` para el control y todas las tiendas (misma foto) |

**Aislamiento real del proyecto:** un schema de PostgreSQL por tienda en una sola base, más el plano de control en `public` (`contexto.md` §3). Por eso el respaldo de tienda exporta **un schema**, no filtra por `tenant_id`.

**Por qué no `pg_dump`/`pg_restore`** (evaluado; PostgreSQL 18.4 local, `pg_dump` 18.4):
- `pg_restore` no puede cargar un schema con otro nombre ni validar en un schema temporal; restaurar una tienda con `--clean` borra y recrea objetos (vistas `<schema>_reporting`, permisos del rol `reports_*`) en la base compartida.
- Restaurar exige ejecutar el SQL del archivo. Aquí nunca se ejecuta SQL de una copia: solo filas JSON cargadas con parámetros (`json_populate_recordset`), con tablas y columnas contrastadas contra el catálogo real.
- Los roles son objetos del clúster (no van en `pg_dump`), la imagen Docker de la API no trae los binarios y una restauración completa con `pg_restore` necesita acceso exclusivo a la base.
- Para recuperación ante desastres de toda la base sigue siendo recomendable, **además**, el PITR/branching del proveedor (Neon). Es complementario y no está automatizado aquí.

### Formato `.sfbk` (versión 1)
`"SFBK" | 0x01 | largo | encabezado JSON | contenido cifrado | tag GCM`
- AES-256-GCM, clave por archivo derivada con HKDF-SHA256 de `BACKUP_ENCRYPTION_KEYS` (sal aleatoria; contexto = alcance + tienda).
- El encabezado (tipo, tienda, fecha, versión de clave) va en claro **pero autenticado** (AAD): cambiar un byte invalida el archivo.
- Contenido: `gzip(JSON)` con manifiesto (tipo, fecha, tienda, versión de la app, migraciones, componentes incluidos/omitidos) + filas y, por tabla, cantidad y SHA-256.
- En la base (`public.backup_jobs`) queda además el SHA-256 del archivo completo; descargar o restaurar lo recalcula.
- Una copia solo se acepta si descifra con la clave del servidor (origen), si el hash coincide (integridad), si es de la tienda correcta y si sus migraciones son **exactamente** las de la base (compatibilidad).

## 2. Configuración (Windows PowerShell)

### 2.1 Migración de control
La tabla `public.backup_jobs` viene en `api/prisma/control/migrations/20261108120000_backup_jobs`. Se aplica con el comando existente (o al arrancar el contenedor con `migrate:all`):
```powershell
cd api
npm run migrate:control
```

### 2.2 Clave de cifrado (obligatoria)
Generarla:
```powershell
node -e "console.log('1:'+require('crypto').randomBytes(32).toString('base64'))"
```
En `api/.env` (no versionado):
```
BACKUP_ENCRYPTION_KEYS=1:<valor generado>
```
- **Guárdala fuera del servidor y fuera de las copias** (gestor de contraseñas o bóveda de secretos, con al menos dos personas con acceso). La copia nunca contiene la clave.
- **Si se pierde, las copias cifradas con ella quedan irrecuperables.** No hay puerta trasera.
- Usa una clave distinta de `TENANT_SECRETS_KEYS` y de `JWT_SECRET`.
- Rotación: agrega una versión nueva y conserva las anteriores para poder leer copias viejas: `BACKUP_ENCRYPTION_KEYS=1:<vieja>,2:<nueva>` (las nuevas usan la mayor, o `BACKUP_ACTIVE_KEY_VERSION`).
- Sin la variable, la API arranca igual, pero las pantallas muestran "no configurado" y no ofrecen acciones.

### 2.3 Almacenamiento
```
BACKUP_DIR=C:\StellaBackups      # opcional; por defecto %USERPROFILE%\.stella-femme\backups
BACKUP_MAX_BYTES=209715200        # opcional; 200 MB por defecto (también límite de subida)
```
La carpeta debe quedar **fuera del repositorio** (la API avisa en el log si no). Los archivos se escriben con nombre `<uuid>.sfbk`; `*.sfbk` está en `.gitignore`. Es almacenamiento temporal: descarga las copias y guárdalas en otro lugar. En Azure Container Apps el disco del contenedor es efímero: monta un volumen o descarga cada copia.

## 3. Qué incluye cada copia

**Tienda — incluido:** productos, categorías, colecciones (`_CollectionToProduct`), inventario por talla, sucursales, pedidos, ítems, pagos, comprobantes de pago **con su imagen** (bytea), devoluciones, carritos, reservas, movimientos de inventario, intentos de checkout y de pago, compensaciones, outbox, anomalías, usuarios (clientes y empleados, contraseñas bcrypt), roles, direcciones, diseños del dashboard, suscripciones push, configuración de pagos **con la imagen del QR**, apariencia (logo, favicon y fondo como data URL) y recibos de sincronización offline.

**Tienda — NO incluido** (se muestra en el resultado y en la vista previa):
- Refresh tokens, códigos OTP y bloqueos de login (se exportan vacíos).
- Registro de la tienda en la plataforma: plan, estado, dominio, Stripe Connect, suscripción.
- Claves de Decart/Web Push (`tenant_integrations`): son de la plataforma.
- Archivos de `imageUrl` de productos y categorías: son URLs externas; solo se guarda el enlace.
- Modelos y salidas de IA (`IA/AS/salidas`, `IA/ANS/salidas`): se regeneran entrenando.
- Vistas `<schema>_reporting` y rol `reports_*`: las crean las migraciones.
- Estado en Stripe, correos enviados y push entregados.

**Plataforma — incluido:** `tenants`, `tenant_signups` (sin hash de contraseña), `tenant_integrations` (siguen cifradas con `TENANT_SECRETS_KEYS`), `tenant_credentials`, `platform_admins` (sin bloqueos), `provider_event_inbox` y el contenido de tienda de **cada** tienda con schema.

**Plataforma — NO incluido:** `backup_jobs` (historial de respaldos), desafíos y claves App Attest de la app móvil (`mobile_app_attest_keys` tiene un contador que solo puede crecer), variables de entorno y claves (`TENANT_SECRETS_KEYS`, `BACKUP_ENCRYPTION_KEYS`, `JWT_SECRET`, Stripe…), roles de PostgreSQL, imágenes externas, modelos de IA y estado de servicios externos. Por eso **una copia de plataforma no basta sola** para recuperar el SaaS: hacen falta además las variables de entorno (§6).

## 4. Uso

### 4.1 Tienda (`/admin/backups`, menú "Copias de seguridad", solo Super Admin)
1. **Generar copia de la tienda** → estado *Preparando respaldo* → *Respaldo disponible* (la pantalla se actualiza sola).
2. **Descargar** → archivo `respaldo-<tienda>-<fecha>-<id>.sfbk`.
3. **Subir copia** → solo acepta copias de esta tienda generadas por este servidor y sin modificar.
4. **Restaurar** → vista previa: tienda afectada, fecha, versión, incluido/excluido, filas por tabla (copia vs. actual), compatibilidad y aviso de reemplazo. Hay que marcar la casilla y escribir el **slug** de la tienda. Estados: *Validando copia* → *Restauración en curso* → *Operación completada* o *Error* con explicación.

### 4.2 Plataforma (`/plataforma`, sección "Respaldos de plataforma")
- **Generar respaldo completo**, o elegir una tienda y **Respaldar tienda seleccionada**.
- La tabla muestra fecha, tipo, alcance, tienda, estado, tamaño y errores con detalle técnico (solo para la plataforma).
- **Restaurar** una copia completa exige escribir `RESTORE-PLATFORM`; una de tienda, el slug de esa tienda.
- Las mismas rutas aceptan `x-platform-key: <PLATFORM_ADMIN_KEY>` para scripts: `GET|POST /api/v1/platform/backups`, `POST /platform/backups/tenants/:tenantId`, `POST /platform/backups/upload` (multipart `file`), `GET /platform/backups/:id[/download|/preview]`, `POST /platform/backups/:id/restore` (`{ "confirmation": "...", "acknowledgeReplace": true }`), `DELETE /platform/backups/:id`.

Rutas de tienda (JWT + `x-tenant-id`): `GET /backups/config`, `GET|POST /backups`, `POST /backups/upload`, `GET /backups/:id[/download|/preview]`, `POST /backups/:id/restore`, `DELETE /backups/:id`.

## 5. Cómo se restaura (y por qué no queda a medias)

1. **Verificación:** SHA-256 del archivo registrado → descifrado autenticado → manifiesto = encabezado → hash y filas por tabla → misma tienda (`backup_jobs.tenant_id` = encabezado = tienda autorizada) → mismas migraciones y columnas.
2. **Validación aislada:** se clona la estructura del schema destino (columnas, defaults, CHECK, índices únicos y claves foráneas) en un schema temporal `bkstage_<aleatorio>` y se cargan ahí las filas, dentro de una transacción que **siempre se revierte**. Los datos actuales no se tocan.
3. **Aplicación:** una **única transacción**: `TRUNCATE` con la lista explícita de tablas de ese schema (sin `CASCADE` ni nada global), inserción en orden de dependencias, reglas de credenciales y de efectos externos, verificación de conteos y `COMMIT`. Cualquier error → `ROLLBACK` completo y estado *Error*. Si la API se cae a mitad, PostgreSQL revierte la transacción y al arrancar el trabajo queda `BACKUP_INTERRUPTED`.
4. Una restauración de tienda solo toca su schema: ni otras tiendas ni `public` (verificado en R04 con huellas de cada tabla).
5. Una sola operación activa por tienda; una de plataforma excluye todas las demás (bloqueo en la base + índice único parcial). La segunda recibe 409.

**Plataforma:** igual, pero en una sola transacción para el control y todas las tiendas de la copia. Las tiendas que **no** están en la copia no se tocan (la vista previa las lista). Si una tienda de la copia no tiene schema en la base (entorno nuevo), se crea vacío y se migra antes de validar; es lo único que ocurre fuera de la transacción, y no modifica datos existentes.

### Credenciales y sesiones
- Ningún refresh token, OTP ni bloqueo sale en una copia → **ninguna sesión vieja se reactiva**.
- Usuario de tienda que existe hoy (mismo id): conserva su **contraseña y sesión actuales**; no se sobrescriben.
- Usuario que solo está en la copia: vuelve con la contraseña (bcrypt) que tenía y sin sesión.
- Quien restaura una tienda conserva su usuario y su rol para terminar la recuperación. Si la copia tiene otro usuario con su correo, la restauración se rechaza (`BACKUP_ACTOR_EMAIL_CONFLICT`).
- Antes de restaurar se verifica **en la base** que el usuario sigue siendo Super Admin (el rol del JWT puede tener hasta 15 min).
- Administradores de plataforma: los actuales se conservan intactos; los que solo están en la copia vuelven **desactivados** (se reactivan con `npm run build && npm run platform:admin -- <email> <contraseña>`).
- Credenciales de tienda (`tenant_credentials`): las actuales se conservan; las que solo están en la copia vuelven **revocadas**.
- Los access tokens JWT emitidos antes de restaurar siguen valiendo hasta su vencimiento (no hay lista de revocación).

### Servicios externos (Stripe, correo, push)
Restaurar no revierte Stripe ni "desenvía" correos. Para no repetir nada:
- Eventos de outbox pendientes (correos/push) → `DEAD` con nota "Restaurado desde un respaldo": no se reenvían.
- Reembolsos pendientes (`payment_compensations`) → `MANUAL_REVIEW`: no se piden solos.
- Pedidos web `PENDIENTE` → `reconciliationStatus = RESTORED_FROM_BACKUP` y plazo extendido por `PAYMENT_RECONCILIATION_HOLD_MS` (6 h): el cron no los vence ni consulta Stripe mientras tanto.
- Webhooks del inbox restaurados que estaban pendientes → `DEAD`; los actuales se conservan (siguen deduplicando).
- Altas pendientes de la copia → `EXPIRED` / `FAILED`.
- Queda una anomalía `BACKUP_RESTORED` en `operational_issues` de cada tienda con el resumen.

**Conciliación después de restaurar:** (1) en Stripe, revisa los cobros y reembolsos posteriores a la fecha de la copia y compáralos con los pedidos (un pedido pagado después de la copia aparecerá pendiente); (2) revisa suscripciones del SaaS (`tenants.subscription_status`) contra el panel de Stripe; los webhooks `customer.subscription.*` las volverán a sincronizar en el siguiente evento; (3) revisa comprobantes manuales (QR/USDT/billetera) pendientes; (4) avisa a los clientes si corresponde: el sistema no envía nada solo.

## 6. Recuperar el SaaS completo: pasos externos
1. Base PostgreSQL nueva (o la existente) con `npm run migrate:control` aplicado.
2. Las **mismas** variables de entorno de antes: `TENANT_SECRETS_KEYS` (sin ella las integraciones Decart/Web Push no descifran), `BACKUP_ENCRYPTION_KEYS`, `JWT_SECRET`/`JWT_REFRESH_SECRET`, claves y webhooks de Stripe, SMTP, `PLATFORM_ADMIN_KEY`.
3. Arrancar la **misma versión** de la app que generó la copia (mismas migraciones).
4. Subir la copia en `/plataforma` (o con `x-platform-key`, porque en una base nueva todavía no hay administradores activos) y restaurarla.
5. Reactivar los administradores con `npm run platform:admin`.
6. Conciliar Stripe (§5) y volver a entrenar los modelos de IA si se usan. Las imágenes externas de productos no dependen de la base.

## 7. Problemas frecuentes
| Error | Qué hacer |
|---|---|
| `BACKUP_KEY_MISSING` / "no configurado" | Definir `BACKUP_ENCRYPTION_KEYS` y reiniciar la API |
| `BACKUP_KEY_UNKNOWN` | La copia usa una versión de clave que no está; agrega esa versión a `BACKUP_ENCRYPTION_KEYS` |
| `BACKUP_INTEGRITY_FAILED` | Archivo alterado, truncado o de otro servidor/clave: no se puede usar |
| `BACKUP_INCOMPATIBLE_VERSION` | La copia es de otra versión (migraciones distintas). Restaurarla en un entorno aislado con la versión de la app que la generó, actualizar ese entorno (`migrate:all`) y generar una copia nueva |
| `BACKUP_TENANT_SCHEMA_MISSING` | La tienda no tiene schema en esta base: restaurar desde la plataforma con una copia completa |
| `BACKUP_ALREADY_RUNNING` (409) | Esperar a que termine la operación en curso |
| `BACKUP_INTERRUPTED` | La API se detuvo durante la operación; nada se aplicó a medias. Repetir |
| `BACKUP_TOO_LARGE` | Subir `BACKUP_MAX_BYTES` (el respaldo se arma en memoria) |

## 8. Pruebas (base aislada, nunca la demo ni Neon)
La suite borra por completo la base indicada: debe ser local y su nombre debe contener `test`. Clúster temporal en PowerShell (sin tocar el servicio `postgresql-x64-18`):
```powershell
$pg = "C:\Program Files\PostgreSQL\18\bin"; $dir = "$env:TEMP\stella-pg-prueba"
& "$pg\initdb.exe" -D $dir -U postgres -A trust -E UTF8 --no-locale
& "$pg\pg_ctl.exe" -D $dir -w -t 120 -o "-p 55432 -c listen_addresses=127.0.0.1 -c max_connections=300" -l "$dir.log" start
& "$pg\psql.exe" -h 127.0.0.1 -p 55432 -U postgres -c "CREATE DATABASE stella_backup_test"

cd api
$env:ACCEPTANCE_DATABASE_URL = "postgresql://postgres:pw@127.0.0.1:55432/stella_backup_test"
npm run test:acceptance backups      # solo respaldos (R01–R10)
npm run test:acceptance              # suite completa

& "$pg\pg_ctl.exe" -D $dir -w stop; Remove-Item -Recurse -Force $dir, "$dir.log"
```
La contraseña `pw` de la URL es obligatoria para el CLI de Prisma, aunque el clúster use `trust`. Las pruebas usan una clave de respaldo fija de prueba y una carpeta temporal propia (`support/env.ts`).

## 9. Limitaciones pendientes
- Respaldo en memoria: pensado para el tamaño de la demo; tiendas muy grandes necesitarían exportación en streaming.
- Una sola instancia de API debe ejecutar respaldos (al arrancar, los trabajos activos se marcan interrumpidos).
- Solo se restaura en la misma versión de migraciones; no hay conversión entre versiones.
- Durante la restauración de una tienda sus tablas quedan bloqueadas (segundos); conviene hacerlo fuera de horario.
- No hay retención automática ni copia a almacenamiento externo.
- No se revocan los access tokens JWT vigentes (hasta 15 min).

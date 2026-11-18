# Plan: Inbox de notificaciones y push

> **Estado (2026-11-18):** Pendiente; nada implementado (verificado 2026-11-18).

**Estado:** propuesta local revisada el 2026-09-09; implementación pendiente. Diseño: [03-notifications-push-design.md](03-notifications-push-design.md).

**Goal:** Inbox durable, preferencias, digests, campañas y entrega Web/PWA, Android, iOS y Tauri, con extensión federada.
**Architecture:** Outbox de dominio existente → consumer idempotente → inbox/deliveries PostgreSQL → dispatcher Dramatiq; REST/SSE/readplane recuperan estado.
**Tech Stack:** FastAPI/Pydantic, SQLAlchemy/Alembic, PostgreSQL, Redis, Dramatiq, React/Vitest, Web Push, Capacitor, Tauri y Go.

**Modificar** identifica rutas existentes; **Crear** identifica propuestas. Cada tarea de implementación añade pruebas del contrato, implementa y verifica su paquete. Esta revisión no ejecuta instalaciones, campañas ni despliegues.

## N1 — Inbox local útil sin depender de proveedores

### N01. Baseline y contrato público

**Dependencias:** ninguna.
**Crear:** `app/ui/src/hooks/use-notifications.test.tsx`, `app/crate/api/schemas/notifications.py`, `app/crate/notifications/contracts.py`, `app/tests/test_notifications_contract.py`.
**Leer:** `app/ui/src/hooks/use-notifications.ts`, `app/crate/api/__init__.py`.

Caracterizar aviso Admin; categorías, rutas internas, límites, cursor/watermark, revisión, lectura e idempotencia. Establecer permisos de endpoint y payload genérico para pantalla bloqueada. Security usa catálogo cerrado independiente de campañas. Congelar ejemplos OpenAPI para los endpoints del diseño.

**DoD:** tests de permiso inexistente/denegado, evento SSE repetido, categoría desconocida, payload excesivo, destino externo y misma clave con distinto cuerpo. El test Admin es nuevo, no un archivo preexistente.

### N02. Persistencia y migración compatible

**Dependencias:** N01.
**Crear:** migración en `app/crate/db/migrations/versions/`, `app/crate/db/repositories/notifications.py`, `app/tests/test_notifications_migration.py`, `app/tests/test_notifications_repository.py`.
**Reutilizar:** `app/crate/db/domain_event_outbox.py`, `app/crate/db/tx.py`.

Main observado termina en `093_artist_hero_manifest_history.py`; asignar revisión/down_revision contra el head real al implementar, coordinada con otros workstreams. No reservar números ni usar prefijo ficticio `2027_03`. Alembic se ejecuta por despliegue, no por petición/worker.

Crear tablas del diseño, unique keys, keyset, lectura hasta watermark, expiración, cifrado/rotación de endpoints y secretos, leases y retención. Inbox+entregas se confirman antes de invalidar. Borrado de cuenta purga contenido/endpoint; dedupe no conserva payload personal.

**DoD:** upgrade desde head/base vacía, constraints PG, dos consumers, inserción durante read-all, expiración/replay, rotación de claves y rollback binario con tablas aditivas conservadas. No destruir datos para revertir operación.

### N03. API, servicio, productor y UI locales

**Dependencias:** N02.
**Crear:** `app/crate/notifications/service.py`, `app/crate/notifications/producers.py`, `app/crate/api/notifications.py`, `app/tests/test_notifications_api.py`, `app/tests/test_notifications_service.py`, `app/listen/src/pages/Notifications.tsx`, `app/listen/src/pages/Notifications.test.tsx`.
**Modificar:** `app/crate/db/repositories/social.py`, `app/crate/db/domain_events.py`, `app/crate/api/__init__.py`, `app/listen/src/pages/Settings.tsx`, `app/listen/src/pages/Settings.test.tsx`, `app/listen/src/App.tsx`, `app/listen/src/components/layout/Shell.tsx`.

Emitir follow en la transacción de la relación, sin duplicar emisión standalone. Integrar bell, inbox paginado, preferencias e i18n Listen. REST recupera al abrir/reconectar; contador optimista se reconcilia por revisión y se aísla por servidor/usuario. Conservar avisos operativos Admin y evitar doble aviso UI/OS al integrarlos.

**DoD:** auth, ownership, CSRF/origin según sesión, cursor ajeno, read-all concurrente, cuenta borrada, offline/reconnect, usuario A→B y servidor A→B sin datos residuales. N1 no depende de push/readplane/federación.

## N2 — Web/desktop, campañas y digests

### N04. Dispatcher y adapters

**Dependencias:** N02; altas autorizadas de N03.
**Crear:** `app/crate/worker_handlers/notifications.py`, `app/crate/notifications/providers/web_push.py`, `app/crate/notifications/providers/fcm.py`, `app/crate/notifications/providers/apns.py`, `app/tests/test_notifications_dispatch.py`, `app/tests/test_notifications_providers.py`.
**Modificar:** `app/crate/actors.py` y registro de handlers existente.

Contrato adapter: aceptado/retry/permanente/configuración, timeout, Retry-After, jitter, lease y expiración. Revalidar consentimiento, autorización, endpoint y campaña por intento. No dar de baja tokens ante un 401/403 de credenciales ni generalizar 404/410 entre protocolos. Política Web Push evita SSRF. Fakes verifican mecanismo; sandbox no demuestra distribución real.

**DoD:** crash antes/después de aceptación, doble claim, lease vencido, cancelación durante retry, 429/503, FCM sender mismatch/UNREGISTERED, APNs entorno/topic incorrecto y Web Push inválido. Sin proveedores reales ni secretos en tests/logs.

### N05. Service Worker y Tauri

**Dependencias:** N03–N04; coordinar SW con 01.
**Modificar:** `app/listen/public/sw.js`, `app/listen/src/main.tsx`, `app/listen-desktop/src-tauri/src/lib.rs`, `app/listen-desktop/src-tauri/Cargo.toml`, `app/listen-desktop/src-tauri/capabilities/default.json`.
**Crear:** `app/listen/src/lib/push-web.ts`, `app/listen/src/lib/push-web.test.ts`, `app/listen/src/lib/notification-navigation.ts`, `app/listen/src/lib/notification-navigation.test.ts`, `app/listen/src/lib/push-desktop.ts`, `app/listen/src/lib/push-desktop.test.ts`.

Alta con gesto, renovación, click autenticado y selección del servidor. Dedupe pestañas/ventanas y OS; no cancelar subscriptions ajenas. Conservar listeners/cache offline del SW. Tauri usa capability mínima, adapter local y SSE del inbox; reabrir recupera lo ocurrido con proceso cerrado.

**DoD:** sin soporte, permiso denegado/revocado, actualización SW durante push, dos ventanas, click tras logout/recurso revocado, PWA instalada iOS y desktop real. Prueba browser de `push`/`notificationclick`; Vitest del helper no cubre lifecycle del SW.

### N06. Campañas y digests

**Dependencias:** N03–N04; 02/04/08 aportan eventos cuando existan sin bloquear productor local.
**Crear:** `app/crate/api/admin_notifications.py`, `app/crate/notifications/digests.py`, `app/tests/test_notifications_campaigns.py`, `app/tests/test_notifications_digests.py`, `app/ui/src/pages/Notifications.tsx`, `app/ui/src/pages/Notifications.test.tsx`.
**Modificar:** `app/crate/scheduler.py`, `app/crate/api/__init__.py`, `app/ui/src/App.tsx`.

Preview/estimate sin envíos, programación versionada, audiencia cerrada, consentimiento reevaluado, cancelar/retractar con auditoría. Digest único por ventana/zona con lotes/checkpoint. No convertir eventos playback frecuentes en marketing ni campañas en security.

**DoD:** 100 imports → un digest, vacío, DST, cambio de preferencia, doble scheduler, preview no envía, cancelación concurrente, retract sin prometer retirar OS y permisos Admin.

## N3 — P1: push nativo en distribuciones soportadas

### N07. Identidad de distribución y bridges Android/iOS

**Dependencias:** N04; decisión de distribución del diseño antes de validar entrega real. Contrato/fakes avanzan mientras se concreta.
**Modificar:** `app/listen/package.json`, `app/listen/capacitor.config.ts`, `app/listen/android/app/build.gradle`, `app/listen/android/app/src/main/AndroidManifest.xml`, `app/listen/ios/App/App/AppDelegate.swift`, `app/listen/ios/App/App.xcodeproj/project.pbxproj`, `.github/workflows/build-android.yml`, `.github/workflows/build-ios.yml`.
**Crear:** `app/listen/src/lib/push-native.ts`, `app/listen/src/lib/push-native.test.ts`; entitlement iOS push en el target si no existe.

Añadir Capacitor Push y ciclo token/permiso/deep link. Registrar server/user/install/app_identity; limpiar sólo el registro autorizado. Separar permiso/canal playback Android del canal social. Acreditar sender FCM y team/topic/entorno APNs de cada binario con infraestructura de envío autorizada; nunca claves privadas en cliente/repositorio.

Si la distribución compartida requiere relay, concretar su implementación como paquete adicional N07 con protocolo autenticado, tenant binding, cuotas, purga y tests de abuso; no declararlo cubierto por federation ni ocultar coste. Builds con identidad propia siguen soportadas. No distribuir credenciales centrales a instancias arbitrarias.

**DoD:** Android/iOS físicos, foreground/background/cold start, rotación, reinstalación, permiso revocado, logout en uno de dos servidores, cambio de usuario, otro proyecto y sandbox/producción. Evidencia por distribución; plataformas pendientes impiden cerrar N3 aunque Web Push funcione.

## N4 — Readplane y extensión federada

### N08. Lectura rápida y stream privado

**Dependencias:** N03, sin esperar push nativo. Las rutas Go no bloquean N1.
**Modificar:** `app/crate/api/redis_sse.py`, `app/readplane/internal/routes/server.go`, `app/readplane/internal/postgres/postgres.go`.
**Crear:** `app/readplane/internal/routes/notifications.go`, `app/readplane/internal/routes/notifications_test.go`, `app/tests/test_notifications_sse.py`.

Inbox/count/stream con mismos filtros, autorización/keyset y cache key por principal/revisión de permisos. FastAPI fallback; Redis restart/replay vencido fuerza REST. Revocación invalida conexiones abiertas y un heartbeat de autorización cada 5 s como máximo cubre streams ociosos; sin verificación no se continúa entregando. No duplicar CRUD en Go ni crear backfill sin datos que migrar.

**DoD:** fixtures equivalentes Python/Go, cursor ajeno, revocación en stream abierto, backend caído con snapshot válido, caché obsoleta y expiración inmediata sin esperar scheduler.

### N09. Protocolo federado y cierre operativo

**Dependencias:** N03–N04/N08; actor/consentimiento de 04 para sus eventos.
**Crear:** `app/crate/federation/notification_protocol.py`, `app/tests/test_notifications_federation.py`.
**Modificar:** `app/crate/federation/contracts.py`, `app/crate/federation/events.py`, `app/crate/api/internal_federation.py` y registro de capabilities.

Versionar envelope/capability/grants y destino home, usando signing/authorization/grants existentes. Antigüedad, replay, bloqueos, cuotas y recibo idempotente. Evento desconocido no habilita mensaje arbitrario. Kill switches por canal detienen nuevos envíos/reintentos conservando inbox/dedupe; apagar federación conserva local. Jam no depende de esta integración.

**DoD:** dos nodos aislados + zero peers, doble entrega, peer/actor revocado, firma caducada, consentimiento cambiado, provider caído y replay expirado. Medir carga declarada y soak del diseño; distinguir accepted/read/delivered.

## Verificación reproducible

Comandos para la implementación, no ejecutados durante esta revisión. `app/tests/conftest.py` busca PG por entorno antes de Testcontainers: configurar PG efímero exclusivo y verificar host/puerto/fixture. Nunca usar una DB de aplicación ni considerar skips de integración como verde.

```bash
PYTHONPATH=app python -m pytest -q app/tests/test_notifications_contract.py app/tests/test_notifications_migration.py app/tests/test_notifications_repository.py app/tests/test_notifications_api.py app/tests/test_notifications_service.py
PYTHONPATH=app python -m pytest -q app/tests/test_notifications_dispatch.py app/tests/test_notifications_providers.py app/tests/test_notifications_campaigns.py app/tests/test_notifications_digests.py app/tests/test_notifications_sse.py app/tests/test_notifications_federation.py
npm run --workspace=app/listen test -- Notifications push-web push-native push-desktop notification-navigation Settings
npm run --workspace=app/ui test -- Notifications use-notifications
npm run --workspace=app/listen i18n:check
npm run --workspace=app/listen typecheck
npm run --workspace=app/ui typecheck
(cd app/readplane && go test ./internal/routes/... ./internal/postgres/...)
(cd app/listen-desktop/src-tauri && cargo test)
```

Los TS propuestos viven en `src/**/*.test.{ts,tsx}`, recogidos por Vitest. Ampliar workflows existentes `.github/workflows/test-frontend.yml`, `test-backend.yml` y `test-readplane.yml`. N05 crea `playwright.notifications.config.ts` y `tests/notifications/push.spec.ts`, script/browser y path filters CI; ejecutar `npx playwright test --config=playwright.notifications.config.ts`. Coordinar harness con 01; apariencia no prueba push. Registrar evidencia física/gates externos en este par de docs al implementar, sin cerrar plataformas por tener un build verde.

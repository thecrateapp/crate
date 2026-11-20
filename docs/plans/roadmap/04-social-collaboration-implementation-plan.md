# Plan: Social feed y playlists colaborativas

> **Estado (2026-11-18):** Pendiente y a revisar contra el modelo de colaboración actual de main (77ea09d36, migración 108) antes de ejecutarlo.

**Estado:** propuesta local revisada el 2026-09-09; implementación pendiente. Diseño: [04-social-collaboration-design.md](04-social-collaboration-design.md).

**Goal:** Extender social/playlists existentes con privacidad transversal, edición versionada, feed y colaboración entre nodos.
**Architecture:** PostgreSQL autoritativo por playlist, outbox de dominio existente, REST para comandos/recuperación y SSE inicial para revisiones; projector sólo para lecturas derivadas.
**Tech Stack:** FastAPI/Pydantic, SQLAlchemy/Alembic, PostgreSQL, Redis, React/Vitest y federation existente. Go sólo donde se añada aceleración/paridad de rutas.

**Modificar** son rutas comprobadas; **Crear** son propuestas. Cada tarea de implementación añade pruebas, implementa y ejecuta su suite. No se hace commit ni implementación durante esta revisión documental.

## S1 — Colaboración local fiable y compatible

### S01. Baseline, matriz de permisos y contratos

**Dependencias:** ninguna; 03/06 no bloquean este paquete.
**Modificar:** `app/tests/test_social_api.py`, `app/tests/test_social_queries.py`, `app/listen/src/pages/People.test.tsx`, `app/listen/src/pages/UserProfile.test.tsx`, `app/listen/src/pages/PlaylistPages.test.tsx`, `app/crate/api/schemas/social.py`, `app/crate/api/schemas/playlists.py`.
**Crear:** `app/tests/test_playlist_collaboration_contract.py`, `app/crate/social/contracts.py`.

Congelar contratos actuales de perfiles/stats, `collab`, members/invites, owners/admin y errores. Definir actor/home, roles/capacidades, `entry_uid`, operación/revisión, consentimientos, cursor y estados approval/freeze/transfer. Añadir ejemplos OpenAPI de todas las acciones del diseño, incluidos solicitud/aceptación de follow, transferencia aceptada y revocación de invite. No duplicar `/members` como `/collaborators`.

**DoD:** matriz de permisos legible por operación, snapshots legacy/v1 y tests que demuestren que nuevo contrato no concede stream/import por pertenecer a playlist. `app/tests/test_social.py` no es una ruta existente.

### S02. Migración aditiva y facade previo al opt-in

**Dependencias:** S01.
**Modificar:** `app/crate/db/orm/playlist.py`, `app/crate/api/playlists.py`, `app/crate/db/repositories/playlists_membership_reads.py`.
**Crear:** migración en `app/crate/db/migrations/versions/`, `app/tests/test_social_collaboration_migration.py`, `app/tests/test_playlist_legacy_compat.py`.

Partir del head real al implementar; el observado es `093_artist_hero_manifest_history.py`. Asignar revisión coordinada con demás workstreams, no un nombre ficticio `2027_04`. Alembic sólo por despliegue. Extender `playlists`/`playlist_tracks`/`playlist_members`; crear mapping de actor sólo si no hay identidad reutilizable, recibos/operaciones, snapshots compactados y preferencias/bloqueos necesarios.

Backfill de entry UID conserva orden, duplicados y referencias locales/globales/storage. No crear otra tabla de miembros. Preservar rol `collab` e invites previos; nuevos campos aditivos. Desplegar primero facade/reader que reconozca protocolo de playlist y rechace escritura legacy ambigua cuando se habilite modo versionado.

**DoD:** base vacía/upgrade con playlists reales de fixture, invite legacy 20 usos, no pérdida de entradas duplicadas, cliente viejo leyendo y `client_upgrade_required` explícito al escribir en playlist opt-in. Definir versión mínima de rollback; no prometer volver a un binario que ignora las nuevas ACL.

### S03. Comandos atómicos, membership y ownership

**Dependencias:** S02.
**Modificar:** `app/crate/db/repositories/playlists_tracks.py`, `playlists_mutate.py`, `playlists_invites.py`, `playlists_membership_reads.py` y rutas de `app/crate/api/playlists.py`.
**Crear:** `app/crate/db/repositories/playlist_collaboration.py`, `app/tests/test_playlist_collaboration.py`, `app/tests/test_playlist_collaboration_api.py`.

Transacción corta por playlist para revalidar ACL, revisión, idempotency digest, mutación y evento. Integrar productores actuales en el mismo commit sin doble evento. Entry UID para mover/borrar, no índices recibidos. Contributor sólo afecta sus entradas. Membership/ACL comparten serialización con cambios de tracks para resolver revoke durante edit.

Consumo invite + membership + recibo por usuario en una transacción; aprobar/revocar, TTL, hash de tokens nuevos, rol limitado por invite. Transferencia con aceptación impide cero/dos owners; leave/delete de cuenta aplica política explícita. Ningún write filesystem ni llamada de red desde estos comandos.

**DoD:** dos accept simultáneos no agotan doble uso, misma idempotency key/cuerpo estable, otro cuerpo 409, actor revocado no recibe respuesta cacheada privada, reorder+delete concurrente, owner eliminado, transferencias simultáneas y permisos Admin auditados.

### S04. Privacidad aplicada a todas las superficies

**Dependencias:** S01–S02; puede avanzar junto a S03.
**Modificar:** `app/crate/api/social.py`, `app/crate/db/repositories/social.py`, `app/crate/db/queries/social_profiles.py`, `social_relationships.py`, `social_affinity.py`, `app/crate/api/schemas/social.py`.
**Crear:** `app/crate/social/privacy.py`, `app/crate/db/repositories/social_privacy.py`, `app/tests/test_social_privacy.py`.

Preferencias, solicitud/aceptación de follow privado, bloqueo y silencio diferenciados. Aplicar checks a search/profile/card/page/stats/afinidad/followers, no sólo actividad nueva. Migrar visibilidad actual de forma explícita; feed/presencia nuevos opt-in, relaciones actuales aceptadas, sin reconstruir historial público. Borrado de cuenta/política invalida snapshots y proyecciones.

**DoD:** tabla de audiencias por recurso y pruebas usuario A/B/bloqueado/owner/admin; cambio público→privado con caché caliente y stream abierto; caché sin principal rechazada. Mostrar controles sin habilitar nuevos datos por defecto.

## S2 — Actividad, realtime y UX

### S05. Feed, reacciones y presencia

**Dependencias:** S03–S04.
**Crear:** `app/crate/social/feed.py`, `app/crate/db/queries/social_feed.py`, `app/tests/test_social_feed.py`.
**Modificar:** `app/crate/projector.py`, `app/crate/api/social.py`, `app/crate/api/playlists.py`.

Proyección desde eventos existentes tipados, unique actor/evento, agrupación/cursor, ACL en producción y lectura. Reacción como set/remove idempotente con taxonomía cerrada. Presencia TTL 60 s propuesta sin historial, cuotas y sin push; `listening_now` sólo tras consentimiento separado. Borrar/restringir un recurso elimina previews. Recap compartido referencia el contrato de 08, sin copiar derechos/audiencia de forma independiente.

**DoD:** doble evento/reacción, cursor y filtros, cuenta borrada, recurso privado, evento desconocido, bloqueos cruzados y TTL con reloj controlado. Ninguna query de feed lee historial crudo para construir respuesta.

### S06. REST de recuperación y stream

**Dependencias:** S03–S05.
**Modificar:** `app/crate/api/playlists.py`, `app/crate/api/redis_sse.py`, `app/crate/api/__init__.py`.
**Crear:** `app/tests/test_playlist_collaboration_sse.py`.

GET operaciones desde revisión y snapshot actual, SSE privado con replay/resync/heartbeat. Aceptación de comando viene de REST; Redis sólo notifica. Log compactado/revisión vencida obliga snapshot; operaciones fuera del horizonte de idempotencia se rechazan y no se reproducen como nuevas. Revalidar membresía durante conexiones largas y al renovar auth. Invalidación de ACL/revocación cierra entrega de inmediato al recibir el evento; un heartbeat de autorización con periodo máximo de 5 s limita conexiones ociosas cuando falta la invalidación. Si el heartbeat no puede verificar permiso, cerrar el stream, no seguir sirviendo hasta que llegue una mutación.

**DoD:** caída/reinicio Redis, red cortada, token revocado, ACL modificada, replay más viejo que retención y consulta de playlist ajena. Si se añade WebSocket por presencia, debe pasar el mismo contrato; no es requisito para entregar SSE funcional.

### S07. Listen y ruta de compatibilidad del readplane

**Dependencias:** S03–S06; UI puede desarrollarse con fixtures desde S01.
**Modificar:** `app/listen/src/pages/People.tsx`, `PeopleContent.tsx`, `UserProfile.tsx`, `Playlist.tsx`, `PlaylistInvite.tsx`, `app/listen/src/pages/use-playlist-page-controller.ts`, `app/listen/src/components/playlists/PlaylistCollaboratorsModal.tsx`, `app/listen/src/pages/Settings.tsx` y tests de páginas existentes.
**Crear:** `app/listen/src/components/playlists/PlaylistCollaboratorsModal.test.tsx`, `app/listen/src/components/social/ActivityFeed.tsx`, `app/listen/src/components/social/ActivityFeed.test.tsx`.

Editar optimista con estado pendiente/confirmado/rechazado, conflicto recuperable y explicación al habilitar protocolo que exige cliente actualizado. Feed paginado, controles de audiencia, bloqueos, solicitudes, ownership/reacciones/presencia. Textos i18n, teclado/foco, reduced motion y multi-servidor sin cache leakage. Ninguna pérdida de cambios se oculta como éxito.

Verificar que `app/readplane/internal/routes/server.go` y fallback enrutan los nuevos paths con auth. **Crear** `app/readplane/internal/routes/social_contract_test.go` para contrato/routing si esos paths pasan por readplane. Añadir handler/snapshot Go sólo si las mediciones justifican acelerar la lectura; en tal caso exigir paridad de ACL, expiración y cursor antes de activarlo. El core no requiere un segundo backend.

**DoD:** render de cada permiso/estado, cliente legacy visible, revocación mientras modal abierto, fuente caída, cambio de cuenta/servidor y fallback con identidad correcta. Tests Go table-driven si se modifica routing exportado.

## S3 — Federación e integración sin dependencias circulares

### S08. Actor home, grants y entrega federada

**Dependencias:** S03–S06; no necesita SDK 10.
**Crear:** `app/crate/federation/social_protocol.py`, `app/tests/test_social_federation.py`.
**Modificar:** `app/crate/federation/contracts.py`, `app/crate/federation/events.py`, `app/crate/api/internal_federation.py`; reutilizar signing/authorization/grants existentes.

Capability versionada y delegación actor/home explícita; grants de catálogo no sirven como permiso social. El home de playlist confirma operaciones; nodo remoto nunca confirma antes de esa respuesta. Recepción/replay acotados, dedupe, revocación peer/actor, cuotas y recibos. No exponer IDs numéricos locales ni historial. Protocolo desconocido falla por capability, no se interpreta como legacy permisivo.

**DoD:** dos nodos aislados y zero peers, home offline, timeout tras commit+retry, doble entrega, firma vieja, actor suplantado, grant incorrecto y revocación con stream abierto. No reclamar borrado garantizado en peers no cooperativos.

### S09. Notificaciones, carga y rollout

**Dependencias:** S07–S08; integración con 03 sólo cuando su consumer esté disponible.
**Crear:** `app/tests/test_social_notification_events.py`, `app/tests/test_playlist_collaboration_concurrency.py`.
**Modificar:** productores de S03/S05 y adapter de notificaciones cuando exista.

Publicar sólo eventos confirmados y autorizados. Cien ediciones → agrupación, no cien push. Activar primero compatibilidad/ACL, después opt-in de colaboración versionada, feed, integración de avisos y federación. Mantener Jam 06 y edición local independientes de outages/flags 03/04 federados.

**DoD:** dos/cinco/diez editores, reorder/delete/add con historial de revisiones esperado, sin operaciones confirmadas perdidas; medir p95 con tamaño de playlist/carga declarados. Kill switch detiene nuevas mutaciones sin alterar memberships/lectura ni hacer owner-only silencioso. Rollback a versión compatible; pruebas de snapshots y datos confirmados conservados.

## Verificación

Estos comandos son trabajo de implementación pendiente. Backend sólo con PG efímero exclusivo y fixtures revisadas de `app/tests/conftest.py`; ese archivo puede conectar por variables de entorno antes de Testcontainers. No usar DB de aplicación ni declarar cobertura de integración con tests skipped.

```bash
PYTHONPATH=app python -m pytest -q app/tests/test_social_api.py app/tests/test_social_queries.py app/tests/test_playlist_collaboration_contract.py app/tests/test_social_collaboration_migration.py app/tests/test_playlist_legacy_compat.py
PYTHONPATH=app python -m pytest -q app/tests/test_playlist_collaboration.py app/tests/test_playlist_collaboration_api.py app/tests/test_social_privacy.py app/tests/test_social_feed.py app/tests/test_playlist_collaboration_sse.py app/tests/test_social_federation.py app/tests/test_social_notification_events.py app/tests/test_playlist_collaboration_concurrency.py
npm run --workspace=app/listen test -- People UserProfile PlaylistPages PlaylistCollaboratorsModal ActivityFeed Settings
npm run --workspace=app/listen typecheck
npm run --workspace=app/listen i18n:check
(cd app/readplane && go test ./internal/routes/...)
```

Todos los nuevos tests TS van bajo `src/**/*.test.{ts,tsx}`, recogidos por `app/listen/vitest.config.ts`. Integrar suites en `.github/workflows/test-frontend.yml`, `test-backend.yml` y, si se modifica Go, `test-readplane.yml`. S09 crea `playwright.social.config.ts` y `tests/social/collaboration.spec.ts` como **rutas nuevas**, configura dos browser contexts/cuentas en backend aislado y filtros CI; `npx playwright test --config=playwright.social.config.ts` comprueba concurrencia visible, refresh y reconnect. No usar sleeps como prueba de consistencia ni producción para el benchmark.

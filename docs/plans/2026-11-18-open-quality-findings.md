# Hallazgos abiertos de calidad de código (auditorías de mayo de 2026)

> **Estado (2026-11-18):** hallazgos de calidad abiertos, verificados contra main (commit 5e7a9d6ec). Sustituye a `2026-05-08-code-quality-audit.md` y `2026-05-08-code-quality-audit-findings.md`. Los hallazgos de seguridad de la auditoría del 2026-05-07 se siguen fuera del repositorio hasta que estén corregidos.

Método: cada hallazgo de las dos auditorías de calidad se ha contrastado con el código actual (grep y lecturas acotadas de los ficheros citados, `docker-compose.yaml`, `docker-compose.project.yaml`, `.env.example`, middleware, auth, workers, readplane, Rust y Listen). Las rutas son relativas a la raíz del repo. Cuando algo no se ha podido verificar desde el repo, se dice explícitamente.

Origen de los ids (se conservan los originales):

- **CQ**: `2026-05-08-code-quality-audit-findings.md` (C1-C4, H1-H7, M1-M10, L1-L5).
- **CQG**: `2026-05-08-code-quality-audit.md`, puntos sin id propio que no aparecen en el documento de findings. Ids asignados aquí: CQG-1 a CQG-6.

La severidad indica la original y, si cambia, la actual tras verificar (`original -> actual`).

## Resumen de hallazgos abiertos

| ID | Origen | Área | Severidad | Descripción |
| --- | --- | --- | --- | --- |
| H1 | CQ | calidad | ALTA | `app/crate/api/auth.py` ha crecido a 3.706 líneas (god module); el split de mayo no está en main |
| H4 | CQ | calidad | ALTA | 723 `except Exception:` en `app/crate`, 106 seguidos de `pass` |
| H6 | CQ | calidad | ALTA -> MEDIA | `dict` sin tipar como objeto de dominio (radio, jam y muchos repositorios) |
| H3 | CQ | calidad | ALTA -> BAJA | `catalog/store.go` (Go) sigue con 1.448 líneas y 18 métodos; falta extraer user/search/genre |
| C3 | CQ | calidad | CRÍTICA -> BAJA | `currentTime` en las dependencias de un `useEffect` de `use-media-session.ts` |
| M1 | CQ | calidad | MEDIA -> BAJA | `api/jam.py` solo tiene docstring en 9 de 46 funciones (pendiente de decidir si se cierra) |
| M2 | CQ | calidad | MEDIA -> BAJA | Códigos de cierre WebSocket de Jam (4401/4403/4409) otra vez como literales |
| M4 | CQ | calidad | MEDIA -> BAJA | 1.332 imports diferidos de `crate.*` dentro de funciones |
| L1 | CQ | calidad | BAJA | Rust: `serde_json::to_string(..).unwrap_or_default()` y `Value::Null` ocultan errores |
| L3 | CQ | calidad | BAJA | Estado mutable a nivel de módulo en `app/shared/web/library-routes.ts` |
| L4 | CQ | calidad | BAJA | `createUseApi(reactHooks, apiFn)` recibe los hooks de React como parámetros |
| CQG-1 | CQG | calidad | MEDIA | Rust: los fallos de inferencia ML solo se escriben por `eprintln!` y el resultado no lo refleja |
| CQG-2 | CQG | calidad | MEDIA | `app/shared/web` no es un workspace ni tiene `tsconfig.json` propio |
| CQG-3 | CQG | calidad | BAJA | Readplane: routing manual con `routeParts` en lugar de patrones de `http.ServeMux` |
| CQG-4 | CQG | calidad | BAJA | Readplane: `cacheTTL` de snapshots fijo a 2 s, no configurable |
| CQG-5 | CQG | calidad | BAJA | Eventos WebSocket de Jam tipados como `type: string` en lugar de una unión de literales |
| CQG-6 | CQG | calidad | BAJA | Estado global mutable en Python: hub/locks de Jam, caché de grafo de radio y fallback de memoria en auth |

Total: 17 abiertos. Los resueltos o no aplicables están en el apéndice A. Los hallazgos nuevos que han aparecido durante la verificación están en el apéndice B y no cuentan en el total.

---

## Calidad

### H1 (CQ). God module `app/crate/api/auth.py` (ALTA)

**Evidencia**
- `wc -l`: 3.706 líneas (eran 1.877 en mayo), 175 definiciones de nivel superior y 43 rutas.
- Los módulos que el documento de findings daba por extraídos (`auth_rate_limit.py`, `auth_cookies.py`, `auth_middleware.py`, `admin/users.py`) no existen en main. En `app/crate/api` solo hay `auth_cache.py` y `auth_dependencies.py`.
- Conviven en el fichero:
  - el rate limiter (`:183-420`);
  - los helpers de cookies (`:619-705`);
  - el estado OAuth y las invitaciones (`:1235-1300`);
  - `AuthMiddleware` (`:1599`);
  - las rutas de login/register/me/sesiones (`:1915-2420`);
  - OAuth y el native link (`:2452-3195`);
  - la administración de usuarios e invitaciones (`:3289-3700`).

**Impacto.** Revisión y tests muy costosos, y riesgo alto de regresiones en la superficie más sensible (la auth).

**Fix propuesto.** Extracción mecánica, sin cambios de comportamiento, en este orden:
1. `api/auth_rate_limit.py`;
2. `api/auth_cookies.py`;
3. `api/auth_middleware.py`;
4. `api/admin_users.py` (con `admin_router`).

Hay que actualizar los `monkeypatch`/`patch("crate.api.auth....")` de los tests en el mismo cambio, sin dejar re-exports permanentes.

**Verificación.** `pytest tests/test_auth.py -q` en verde y `wc -l app/crate/api/auth.py` por debajo de unas 1.500 líneas.

### H4 (CQ). `except Exception` que tragan errores (ALTA)

**Evidencia**
- `grep -rn "except Exception:\s*$" app/crate` da 723 ocurrencias, 106 de ellas con `pass` en la línea siguiente.
- Concentración: `db/cache_store.py` (20), `audio_analysis.py` (11), `orchestrator.py` (6), `db/repositories/connect_ws_hub.py` (6), `db/cache_musicbrainz.py` (5).
- Corregido desde mayo: `api/jam.py` tiene 9 y todas registran log; `enrichment.py` ya no captura `KeyboardInterrupt`; los `BaseException` revisados re-lanzan (`actors.py:1156`, `radio_continuation.py:30`, `worker_handlers/crate_download.py:87`).

**Impacto.** Fallos invisibles en la caché, el análisis y los hubs de Connect.

**Fix propuesto.** Empezar por los 106 `except Exception: pass`, fichero a fichero, empezando por los cinco de arriba. Acotar a la excepción concreta (`redis.RedisError`, `OSError`, `ValueError`) o añadir `log.debug(..., exc_info=True)`. Activar `S110` (try-except-pass) de ruff para `app/crate` cuando el contador llegue a 0.

**Verificación.** `ruff check --select S110 app/crate --statistics` va bajando hasta 0.

### H6 (CQ). `dict` sin tipar como objeto de dominio (ALTA -> MEDIA)

**Evidencia**
- Aproximación por grep: 2.519 firmas `-> dict`, `-> dict | None` o `-> list[dict]` en `app/crate`.
- Hechos: `LibraryArtistRow`, `LibraryAlbumRow` y `LibraryTrackRow` (`app/crate/db/repositories/library_shared.py:28,74,110`), `UserRow` como modelo Pydantic (`app/crate/db/models/user.py:11`) y `RadioSession` como schema de API (`app/crate/api/schemas/radio.py:49`).
- Pendiente: la sesión interna de radio sigue siendo `dict` (`app/crate/radio_engine.py:178,190`), no existen `JamRoomRow`, `JamMemberRow` ni `JamEventRow`, y `api/auth.py` mantiene 8 parámetros `user: dict`.

**Impacto.** Sin autocompletado ni comprobación de claves en los dominios con más estado (radio y jam).

**Fix propuesto.** Solo los dos que citaba la auditoría y siguen pendientes: un `TypedDict` para la sesión de radio en `radio_engine.py` y los tres de Jam en sus repositorios. No migrar el resto de forma masiva.

**Verificación.** Pyright sin errores nuevos (`pyrightconfig.json` en la raíz) y los tests de radio y jam en verde.

### H3 (CQ). `Store` de readplane todavía mezcla dominios (ALTA -> BAJA)

**Evidencia**
- `app/readplane/internal/catalog/store.go` tiene 1.448 líneas y 18 métodos `(s *Store)` (eran 2.132 y 46).
- Ya extraídos: `album_store.go`, `artist_store.go`, `track_store.go`, `global_store.go`, `smart_mix_store.go` y `genre.go`.
- Siguen en `store.go`: la búsqueda (`:369-470`), la biblioteca del usuario (`:471-693`, `:1169-1375`) y el detalle de género (`:694-1168`). `user_store.go`, que el documento de findings daba por hecho, no existe.

**Fix propuesto.** Mover sin cambios (mismo paquete) a `user_store.go`, `search_store.go` y `genre.go`.

**Verificación.** `cd app/readplane && go test ./internal/catalog/...`.

### C3 (CQ). `currentTime` en dependencias de efecto (CRÍTICA -> BAJA)

**Evidencia.** `app/listen/src/contexts/use-media-session.ts:56-66` declara un `useEffect` con `[currentTime, duration, ...]` que solo copia valores a `actionsRef`. El estado `currentTime` se confirma a unos 4 Hz, no a 60 fps (`app/listen/src/contexts/use-player-runtime-state.ts:254-258`), así que el impacto real es bajo. Aun así incumple la regla de AGENTS.md sobre valores por frame en dependencias.

**Fix propuesto.** Que los handlers de seek de MediaSession lean `currentTimeRef.current` y `durationRef.current` (que ya existen en el runtime state) y quitar `currentTime` y `duration` del efecto. Otra opción: asignar `actionsRef.current` durante el render.

**Verificación.** Test con Vitest en el que cambiar `currentTime` no re-ejecute el efecto y los handlers `seekbackward`/`seekforward` usen la posición actual.

### M1 (CQ). Docstrings en `api/jam.py` (MEDIA -> BAJA)

**Evidencia**
- `app/crate/api/jam.py`: 9 de 46 funciones con docstring y sin docstring de módulo (recuento con `ast`).
- Ya corregido: `actors.py` tiene 21 de 29; casi todos los módulos Rust tienen `//!`, salvo `media-worker/src/observability.rs`, `crate-cli/src/loudness.rs` y `mix_profile.rs`.

**Nota.** Choca con la regla de estilo de Diego (no añadir comentarios sin necesidad). Propuesta: cerrarlo como "won't fix", o como mucho añadir un docstring de módulo en `jam.py`. Lo decide Diego.

**Verificación.** No aplica salvo que se decida actuar.

### M2 (CQ). Códigos de cierre de Jam como literales (MEDIA -> BAJA)

**Evidencia.** `app/listen/src/hooks/use-jam-websocket.ts:18-25,168` y `app/listen/src/pages/jam-reducer.ts:243` usan `4401`, `4403` y `4409` en línea. Es una regresión, porque el documento de findings lo marcaba como hecho.

**Fix propuesto.** Constantes `JAM_WS_CLOSE_*` en `use-jam-websocket.ts`, importadas también en `jam-reducer.ts`.

**Verificación.** `npm run --workspace=app/listen test -- use-jam-websocket`.

### M4 (CQ). Imports diferidos (MEDIA -> BAJA)

**Evidencia.** 1.332 líneas indentadas `from crate.` en `app/crate`, entre ellas `actors.py` (46), `api/auth.py` (15) y `enrichment.py` (9).

**Nota.** Muchas son deliberadas: retrasan la carga de dependencias pesadas y evitan ciclos en workers.

**Fix propuesto.** Aceptarlo como deuda consciente. Solo actuar donde haya ciclos reales, por ejemplo moviendo a nivel de módulo los imports de `actors.py` que no generen ciclo.

**Verificación.** `python -X importtime -c "import crate.actors"` antes y después, y los tests de actors.

### L1 (CQ). Rust: errores de serialización ocultos (BAJA)

**Evidencia**
- `tools/crate-cli/src/tags.rs:272,283`, `quality.rs:127` y `analyze.rs:1603,1633` usan `serde_json::to_string(..).unwrap_or_default()` (han bajado de 10+ a 5).
- `tools/crate-cli/src/diff.rs:62,66,72` usa `unwrap_or(Value::Null)`.
- `scan.rs:553`, `fingerprint.rs:93` y `bliss.rs:76,169` ya hacen `match`.

**Fix propuesto.** Mismo patrón que `scan.rs:553`: `match`, `eprintln!` y código de salida distinto de 0.

**Verificación.** `cargo test` en `tools/crate-cli`.

### L3 (CQ). Estado mutable de módulo en `shared/web/library-routes.ts` (BAJA)

**Evidencia.** `app/shared/web/library-routes.ts:73-77`: tres `Map` de versiones de assets y dos `let` globales. La copia que había en `app/listen/src/lib/library-routes.ts` ya no tiene estado.

**Fix propuesto.** Mínimo: exportar una función de reset para los tests, o encapsular el estado en un objeto creado por app. Solo merece la pena si da problemas con HMR o con el aislamiento de tests.

**Verificación.** Tests de `library-routes` aislados sin depender del orden de ejecución.

### L4 (CQ). `createUseApi` con hooks de React como parámetros (BAJA)

**Evidencia.** `app/shared/web/use-api.ts:47`: `createUseApi(reactHooks: ReactHookDeps, apiFn: ApiFn)`. Listen ya tiene su propio `useApi` (`app/listen/src/hooks/use-api.ts:86`).

**Fix propuesto.** Si Admin es el único consumidor, sustituirlo por un hook normal en `app/ui`. Si no, mantenerlo; es poco convencional pero funciona.

**Verificación.** `npm run --workspace=app/ui test`.

### CQG-1. Rust: fallos de ML silenciados en el resultado (MEDIA)

**Evidencia.** `tools/crate-cli/src/analyze.rs:1422-1429`: en `Err` de `compute_features` o del decode para ML solo se hace `eprintln!`, y el resultado sale sin los campos ML y sin ningún indicador de error.

**Impacto.** No se distingue "el modelo falló" de "no hay modelo", así que no se pueden reintentar selectivamente las pistas fallidas.

**Fix propuesto.** Añadir `ml_error: Option<String>` al resultado serializado y rellenarlo en los dos `Err`. Persistirlo en el worker de análisis si se quiere reintentar.

**Verificación.** `cargo test` con un test que fuerce el `Err`.

### CQG-2. `app/shared/web` no es un paquete (MEDIA)

**Evidencia**
- `app/listen/tsconfig.json:24` y `app/ui/tsconfig.json:25` lo incluyen con `"../shared/web/**/*.ts"`.
- `package.json:23-30` (workspaces) no lo lista.
- No tiene `tsconfig.json` ni `package.json` propios.

**Impacto.** Se compila con las opciones de cada app consumidora y no se puede verificar de forma aislada.

**Fix propuesto (mínimo).** Añadir `app/shared/web/tsconfig.json` (strict, sin emit) y un paso `tsc -p app/shared/web --noEmit` en `test-frontend.yml`. Convertirlo en workspace (`@crate/web`) solo si Diego lo prefiere.

**Verificación.** El nuevo paso de CI en verde.

### CQG-3. Readplane: routing manual (BAJA)

**Evidencia.** `app/readplane/internal/routes/catalog.go:595` (`routeParts` con `HasPrefix`/`Split`) se usa 7 veces en `catalog.go` y 1 en `artwork.go`. `go.mod` declara `go 1.23.0`, que ya soporta patrones `GET /api/x/{id}`.

**Fix propuesto.** Migrar ruta a ruta a `mux.HandleFunc("GET /api/.../{id}", ...)` con `r.PathValue`, empezando por las rutas nuevas. No es urgente.

**Verificación.** `go test ./internal/routes/...` (incluidos `catalog_test.go` y `server_handler_test.go`).

### CQG-4. Readplane: TTL de caché de snapshots fijo (BAJA)

**Evidencia.** `app/readplane/internal/snapshots/store.go:24,79`: `defaultCacheTTL = 2 * time.Second` sin override. `AuthCacheTTL` sí es configurable (`internal/config/config.go:79`).

**Fix propuesto.** `READPLANE_SNAPSHOT_CACHE_TTL_MS` en `config.go`, con el mismo patrón que `AuthCacheTTL`.

**Verificación.** Test de configuración en `internal/config`.

### CQG-5. Tipos de evento de Jam como `string` (BAJA)

**Evidencia.** `app/listen/src/hooks/jam-websocket-control-handler.ts:23-24` (`type: string`). En `jam-websocket-message-handler.ts:55-107` las comparaciones se hacen con literales.

**Fix propuesto.** `type JamWsEventType = "room_updated" | "queue_add" | "play" | "pause" | "seek" | ...` en el payload.

**Verificación.** `tsc` de Listen y los tests de `use-jam-websocket`.

### CQG-6. Estado global mutable en Python (BAJA)

**Evidencia**
- `app/crate/api/jam.py:170-174`: `_local_hub`, `_sync_clocks` y dos `asyncio.Lock()` de módulo.
- `app/crate/radio_engine.py:150,354,375`: `_graph_cache` sin lock (la asignación de la tupla es atómica, así que el riesgo es de recomputación duplicada).
- `app/crate/api/auth.py:186-187`: `_login_failure_memory` y `_oauth_invite_memory`. Solo se usan como fallback sin Redis y caducan por clave, sin barrido, así que crecen sin límite si Redis no está disponible.
- Ya corregido: los executors de enrichment tienen lock y `atexit` (`app/crate/enrichment.py:56-67`).

**Fix propuesto.** Solo lo de auth: purgar las entradas caducadas en cada escritura del fallback de memoria (unas pocas líneas). Los locks de Jam no fallan en Python 3.13 (ver C4 en el apéndice A); dejarlos salvo que aparezcan errores "bound to a different event loop" en los tests.

**Verificación.** Test del limitador sin `REDIS_URL`: tras la ventana, el dict no conserva claves caducadas.

---

## Apéndice A. Verificados como resueltos o no aplicables

No hace falta volver a auditarlos.

Calidad (CQ):

- **C1** resuelto: `import random` a nivel de módulo (`app/crate/radio_engine.py:11`).
- **C2** resuelto: 0 `as any` en `app/listen/src` fuera de tests.
- **C4** no aplica. La imagen usa Python 3.13 (`app/Dockerfile:16`) y desde 3.10 `asyncio.Lock()` no necesita un loop activo al crearse. Los locks siguen a nivel de módulo (`app/crate/api/jam.py:172,174`); el riesgo residual está en CQG-6.
- **H2** resuelto. `JamSession.tsx` tiene 32 líneas, hay `useReducer` en `app/listen/src/hooks/use-jam-session-state.ts:14` y los hooks `use-jam-websocket.ts`, `use-jam-room-actions.ts`, etc. están extraídos. Los códigos de cierre van en M2.
- **H5** resuelto: `TaskPoolConfig(NamedTuple)` (`app/crate/actors.py:77-84`).
- **H7** resuelto según su propio criterio: `get_redis()` es público (`app/crate/db/cache_runtime.py:94`) y nadie importa `_get_redis` desde fuera. Nota: siguen existiendo 178 imports de nombres privados entre módulos fuera de `db/` (por ejemplo, `app/crate/radio_engine.py:44`); no se reabre como hallazgo.
- **M3 / M9** resueltos (eran duplicados). `WriteJSON` serializa antes de `WriteHeader` y devuelve el error (`app/readplane/internal/httpx/json.go`).
- **M5** resuelto: `unique_name` devuelve `Result` (`app/media-worker/src/package.rs:698`).
- **M6** resuelto: walker iterativo (`tools/crate-cli/src/lib.rs:29-51`). Ver nota B4.
- **M7** resuelto: `add_source_entry(&mut SourceEntryConfig)` (`app/media-worker/src/package.rs:456`).
- **M8** resuelto: la búsqueda va en paralelo con `errgroup` (`app/readplane/internal/catalog/store.go:390`).
- **M10** resuelto: la taxonomía se carga de JSON con defaults (`app/readplane/internal/catalog/taxonomy.go:54-75`).
- **L2** resuelto: `hound` ya no está en `tools/crate-cli/Cargo.toml`.
- **L5** resuelto: `CustomMixCard` y `CoreTracksPlaylistCard` usan el `PlaylistCard` compartido con `renderArtwork` (`app/listen/src/components/home/HomeCustomMixes.tsx:75-107`, `CoreTracksPlaylistCard.tsx`).

Calidad general (CQG, sin id):

- Interfaces Go resuelto: `routeAuthenticator`, `localMediaCatalog`, etc. (`app/readplane/internal/routes/server.go:49-70`).
- Orden de shutdown en Go resuelto: primero se drena HTTP/SSE, después se cierran Redis y el pool (`app/readplane/cmd/crate-readplane/main.go:201-216`, `internal/routes/server.go:586-591`).
- `use-playback-persistence` no aplica: `isPlaying` no cambia por frame y usa `useEffectEvent` (`app/listen/src/contexts/use-playback-persistence.ts:58-71`).
- Duplicado en `Home.tsx` resuelto: el fichero tiene 28 líneas y no contiene `albumCoverApiUrl`/`toPlayerTrack`.

## Apéndice B. Observaciones nuevas durante la verificación (fuera de las auditorías)

No cuentan en el total.

- **B1.** `app/crate/orchestrator.py` (472 líneas, 6 `except Exception: pass`) solo se alcanza con `crate worker --legacy` (`app/crate/__main__.py:103,177-181`). Ningún compose, Makefile ni script usa `--legacy`; solo `app/tests/test_orchestrator.py`. Candidato a eliminarse junto con el flag y su test. Es un cambio rompedor para quien use `--legacy` fuera del repo.
- **B4.** `collect_audio_files` (`tools/crate-cli/src/lib.rs:38`) sigue directorios enlazados por symlink sin registrar los visitados. Un symlink cíclico dentro de la librería provocaría un bucle infinito.

---
title: Smart Mix - plan de continuación
summary: Tareas, dependencias, pruebas y gates para completar la feature unificada desde su estado WIP.
section: developer
audience: [developer, operator]
status: canonical
order: 45
verified: 2026-09-09
sources:
  [
    app/crate,
    app/tests,
    app/listen,
    app/readplane,
    tools/crate-cli,
    tools/vdj-plugin,
    Makefile,
    .github/workflows,
  ]
---

# Smart Mix, Android nativo y VirtualDJ: plan de continuación

> **Para agentes:** usar la guía `viterbit-ai-tools:executing-plans` para ejecutar y verificar las tareas. Este plan y el [diseño unificado](smart-mix-design.md) son las únicas guías de desarrollo vigentes de esta feature. No ejecutar los planes/spikes sustituidos ni crear planes paralelos.

**Objetivo:** entregar Smart Mix, crossfade Android nativo y el plugin VirtualDJ en releases R1–R4 que se cierran de forma independiente (§1.1). Lo que no pertenece a ninguna release queda en el backlog de §1.1 y no bloquea cierres.

**Arquitectura:** backend común de análisis, perfiles, ranking y planes; Android y VirtualDJ son executors con validación propia. PostgreSQL/Redis, workers existentes y media/auth compartidos mantienen sus responsabilidades. No se añade daemon local ni se replica el algoritmo en clientes.

**Stack:** Python/FastAPI/Pydantic/SQLAlchemy/Alembic, Rust `crate-cli`, Go readplane, React/TypeScript/Vitest, Java/Media3/Gradle y C++20/CMake/CTest/SDK privado VirtualDJ.

**Baseline:** 2026-10-08, `codex/feat-smart-mix-phase-1` después de commitear el WIP (PAT, catálogo VDJ, routing, `tools/vdj-plugin/`) y de integrar `origin/main`. Las migraciones de la rama se renumeraron a `104_smart_mix_profiles` y `105_user_access_tokens` porque main ya ocupa 090–103. La baseline anterior (2026-09-09, `140f9e34` más working tree) queda como histórico en §8. Este es un plan pendiente de ejecución; ninguna tarea futura está marcada completa por haber escrito el documento. Las rutas de código son relativas a la raíz del worktree. `Crear` identifica archivos propuestos, no existentes.

## 1. Cómo continuar sin perder el WIP

Todo el WIP está commiteado en la rama; un checkout limpio de la rama es suficiente. Antes de empezar un paquete, integrar `origin/main` si la rama lleva más de una semana sin hacerlo y comprobar `alembic heads`. No usar `git reset --hard`, `git clean` ni `git add .`.

Cada paquete se descompone en las regresiones/contratos enumerados: RED que falla por la causa esperada, cambio mínimo, GREEN, revisión del diff y commit convencional acotado cuando corresponda. Los pasos son checkpoints separados, no una instrucción de escribir todos los tests y toda la feature antes de verificar. No se repiten refactors ya terminados para satisfacer numeración histórica.

Una suite omitida, un build no ejecutado o un gate de host pendiente se registra como tal. Para marcar `hecho` se adjuntan commit(s), comandos/resultados, entorno y evidencia requerida. Un cambio de contrato actualiza ambos documentos y fixtures en el mismo cambio; no reabre diseño tácitamente desde un adapter.

### 1.1 Releases, orden y backlog

Cada release se cierra con su propio gate y se puede desplegar detrás de flags sin esperar a las siguientes. Un gate fallido mantiene abierta solo esa release.

| Release                                        | Paquetes                                                                                                                          | Gate de cierre                                                                                                                                                                                 |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1 — Smart Mix correcto en Android adaptive    | C00, P01 (versiones, contratos y migraciones), SM01–SM05, SM06 (claves de caché, elegibilidad antes del límite, R15–R17), A01–A05 | Suites automáticas verdes; R01–R06 y R15–R17 con regresión; reanálisis v2 en curso con status correcto; adaptive sin clipping ni underrun en un dispositivo de referencia (subconjunto de A06) |
| R2 — VirtualDJ A (fuente local) en macOS arm64 | VH01, P02 (incluida UI de tokens en Listen), P03 (routing prod/home/dev y flags), P04, P05, V01–V04                               | Conectar, buscar, navegar carpetas, cargar, seek y revocar en VirtualDJ Pro real macOS arm64; paquete instalable sin origen por defecto                                                        |
| R3 — VirtualDJ B, Crate Automix y plataformas  | V05, V06, SM07, V09 (filtros DJ y CI nativo), V10 (Windows x64 y macOS Intel)                                                     | Compatibles y metadata Crate visibles; Crate Automix alimenta la cola nativa sin enviar comandos de mezcla; paquetes de las tres plataformas; benchmarks de SM07 registrados                   |
| R4 — Android avanzado y release conjunta       | A06 (matriz completa), A07, A08, X01–X04                                                                                          | Gates de §7 del diseño para beatmatch y bass; soak y rollback                                                                                                                                  |

**Backlog fuera de R1–R4.** Entra en una release solo editando esta tabla con una decisión explícita: P06 y V07 (radio como fuente de Crate Automix y presencia; los cues privados se retiran para VDJ porque VDJ ya persiste cues por pista online; la corrección de scope de play events sigue en P02 y su cliente nativo en V06), V08 (caché de audio cifrada, offline y prefetch, solo si VH01 confirma rutas locales en `GetStreamUrl`), OAuth integrado del SDK, recorrido federado de SM06, wrapper de compatibilidad v1 sin consumidor distribuido demostrado, y paridad PAT en el readplane de Go.

Dependencias no implícitas: P01 precede a todas las modificaciones de contrato/migración. P02/P03 pueden avanzar junto con SM02–SM05. A01 puede corregir red usando fixtures tras P01; integración Android final requiere SM06. VH01 precede a V03, V04 y V06 y puede ejecutarse en cuanto exista el plugin de sondeo. V01 usa P01; V02 usa P02/P03; V03 usa P04 y VH01; V04 usa P05 y VH01; V05 usa SM06; V06 usa V05 y VH01; V09 integra resultados; V10 usa X03; X04 usa V10.

Los paquetes P02–P05 entregan primero contratos e implementación backend verificados con integración automatizada. El estado `backend-listo` desbloquea V02/V03/V04 aunque el gate host conjunto esté pendiente. El estado posterior `integrado-en-host` se registra en la tarea V correspondiente y X03.

**Propiedad de cambios compartidos:** P04 implementa SQL/API de carpetas y la sintaxis de filtros, V03/V09 sus consumidores. P05 implementa tickets/media, V04 la integración host. SM06 implementa planner/cache/summary. P01 asigna la cadena de migraciones; ningún agente reserva un número por adelantado. X02 une CI; V09 mantiene el job nativo y X02 no crea otro pipeline equivalente.

### 1.2 Trazabilidad de hallazgos

| ID  | Hallazgo reproducido o carencia comprobada                                                                         | Paquetes que lo cierran   |
| --- | ------------------------------------------------------------------------------------------------------------------ | ------------------------- |
| R01 | Cue176s + fade12s sobre track180s genera transición fuera de pista                                                 | SM03, A02                 |
| R02 | Downmix oculta peak estéreo; RMS publicado como LUFS                                                               | SM01–SM02, A03            |
| R03 | Idempotencia impide partial Python → full Rust                                                                     | SM04                      |
| R04 | Fuente se revisa después de analizar; done antiguo excluido de backfill nuevo                                      | SM04–SM05                 |
| R05 | Planning bloquea startup, también hace red en offline y no tiene deadline                                          | A01                       |
| R06 | Standby ready antes de seek, trigger global tardío, envelope por ticks de main                                     | A02–A03                   |
| R07 | Capabilities sin integrar y contrato desconocido no vacío aceptado                                                 | P01, V01–V02              |
| R08 | PAT catalog-only permite escribir play-events                                                                      | P02, P06                  |
| R09 | Proxy prod/home envía PAT opaco a verificador JWT Go                                                               | P03, X02                  |
| R10 | Caché devuelve éxito ante401/403/cancel; callbacks obsoletos sobreviven                                            | V01–V03                   |
| R11 | Parsers JSON manuales, Unicode/body sin cubrir; sanitizer no enlaza                                                | V01, V09                  |
| R12 | Catálogo plano/truncado, géneros normalizados excluidos, covers relativos                                          | P04, V03–V04              |
| R13 | C solo spike; el ejecutor propio no es viable con el SDK (sin eventos, sin timer, grid de VDJ distinto)            | V06 (Crate Automix)       |
| R14 | Sin matriz física/host, settings completos, packaging/soak                                                         | A04–A08, V07–V10, X01–X04 |
| R15 | `GET /api/admin/smart-mix/status` cuenta ~48K `library_tracks` en cada request                                     | SM05                      |
| R16 | Planes: get/set de caché por edge (hasta 64 round trips) y `DELETE LIKE` en request                                | SM06                      |
| R17 | Compatibles aplican `LIMIT 500` antes de filtrar elegibilidad                                                      | SM06                      |
| R18 | Catálogo VDJ recorre y ordena `library_tracks` por página con OFFSET sin límite                                    | P04                       |
| R19 | Respuesta de catálogo expone `path`; búsqueda PAT admite `scope=federated`; allowlist por sufijo sin método        | P02, P04                  |
| R20 | `policy.py` usa techo −0.1 dBFS; el diseño fija ≤−1 dBTP                                                           | SM03, A03                 |
| R21 | Spike: origen de producción por defecto, sin login, redacción de logs sin efecto, carrera al cancelar búsqueda     | V02–V03                   |
| R22 | Tests C++ con `assert` no comprueban nada en Release                                                               | V01                       |
| R23 | Online Source y AutoStart exigen licencia Pro de VirtualDJ; no estaba en los documentos                            | V02, V10                  |
| R24 | El SDK no tiene subcarpetas ni paginación; P04/V03 asumían jerarquía y cursores                                    | P04, V03                  |
| R25 | VDJ persiste la URL de cover y analiza las pistas con su propio grid/key                                           | V03, V05, V06             |
| R26 | Cambiar el nombre del plugin dejó huérfanas sus entradas en `database.xml`                                         | V02, V10                  |
| R27 | Android aplica la ganancia del plan como constante durante el fade y salta a unidad al terminar (escalón de ~3 dB) | A03                       |

## 2. Preparación y verificación comunes

### C00 — Congelar baseline operativo y preservar cambios

**Estado:** pendiente al iniciar implementación. **Archivos:** este plan, diseño, inventario Git local y herramientas de test existentes. Sin cambios funcionales.

1. Ejecutar desde el worktree `git status --short`, `git rev-parse HEAD`, `git branch --show-current`, `git worktree list` y `git log --oneline origin/main..HEAD`. Registrar working tree y verificar los módulos sin seguir; no volcar secretos ni contenidos de `.env`.
2. Registrar divergencia usando referencias locales y decidir incorporación de main antes de asignar migraciones. Actualizar referencias remotas solo si procede para la ejecución; no confundir el 7/25 de la revisión con un dato perpetuo. Resolver cualquier integración de forma aislada preservando el snapshot WIP; no hacer rebase automático del trabajo ajeno.
3. Confirmar toolchains y dependencias del repo: Python3.13/requirements, Cargo lock, Node/package-lock, JDK/AndroidSDK fijados por build, Media3 actual y CMake/privateSDK. El comando `java` no estaba configurado en la revisión; no registrar eso como fallo de Gradle ni actualizar dependencias para eludirlo.
4. Levantar PostgreSQL/Redis **efímeros, exclusivos**, sin volúmenes prod/dev y con puerto libre. Exportar únicamente las variables de test esperadas por `app/tests/conftest.py` y `postgres_test_database.py`; verificar nombre `crate_test` y protección de clones. No depender de DB_URL heredada. Documentar comandos exactos saneados y teardown de los recursos propios.
5. Repetir suites focalizadas core/PAT y CTest. Para las reproducciones manuales R01–R11, convertir cada una en test dentro de su paquete; no exigir toda la matriz física para abrir un PR de corrección backend.

**DoD:** inventario preservado, servicios aislados, toolchains identificados y baseline actual anotado en §8. Diferencias desde la revisión se incorporan antes de marcar tareas.

### Comandos base

Los comandos siguientes se ejecutan desde la raíz salvo indicación. No están autorizando un deploy ni una ejecución contra producción. Instalar dependencias del lockfile antes de test; comprobar que un test nuevo está registrado y realmente se ejecuta.

```sh
PYTHONPATH=app python -m pytest -q app/tests/test_smart_mix_models.py app/tests/test_smart_mix_planner.py app/tests/test_smart_mix_api.py
PYTHONPATH=app python -m pytest -q app/tests/test_access_token_auth.py app/tests/test_access_token_api.py app/tests/test_vdj_catalog.py app/tests/test_media_access_tickets.py
cargo test --manifest-path tools/crate-cli/Cargo.toml --no-default-features --features analysis
npm run --workspace=app/listen test -- src/lib/smart-mix.test.ts src/lib/android-native-engine.test.ts src/contexts/player-engine-adapter.test.ts
cmake -S tools/vdj-plugin -B build/vdj-headless -DCRATE_VDJ_BUILD_REAL_PLUGIN=OFF -DCRATE_VDJ_BUILD_TESTS=ON
cmake --build build/vdj-headless --parallel 4
ctest --test-dir build/vdj-headless --output-on-failure
node scripts/check-docs.mjs
```

Desde `app/listen/android`: `./gradlew :app:testDebugUnitTest` para unit tests y `./gradlew :app:connectedDebugAndroidTest` para instrumentación en dispositivo explícitamente seleccionado. Desde `app/readplane`: `go test ./internal/routes ./internal/catalog ./internal/snapshots` cuando se toque su contrato. Añadir Ruff/Pyright y checks de frontend existentes según archivos afectados; no sustituir los gates del repositorio por esta lista mínima.

Los targets existentes `make cap-android-smart-mix-artifacts` y su variante local de test permiten APK explícitamente apuntada a dev. La variante `prod-artifacts` requiere elección expresa del entorno y no forma parte de CI por defecto. `make vdj-test`, `vdj-build` y `vdj-package` son entregables de V09/V10: aún no se asume que existen.

## 3. Plataforma compartida — P01 a P06

Cada paquete comienza con un test focalizado de regresión/contrato que falle, implementa el cambio mínimo, ejecuta sus verificaciones y registra commit/evidencia en el plan canónico. El WIP existente se revisa y completa; los tests unitarios aislados verdes no completan por sí solos un gate manual/SDK.

**Responsabilidad entre paquetes:** P04 es dueño del backend de carpetas y filtros; P06 (backlog) del backend de radio/presencia. V09 implementa el cliente de filtros y la integración CI/bench. Los contratos y fixtures se comparten, pero estas responsabilidades no se duplican en dos tareas.

### P01 — Fijar contratos integrados, linaje de migraciones y manifiesto de evidencia

**Depende de:** C00 y diseño integrado canónico; puede empezar sin disponer del SDK nativo.

**Archivos:** modificar `app/crate/api/schemas/capabilities.py`, `app/crate/api/capabilities.py`, `app/crate/api/schemas/smart_mix.py`, `app/tests/test_vdj_contract_baseline.py`, `app/tests/test_smart_mix_openapi.py`, `app/tests/test_federation_migration_matrix.py`; revisar `app/crate/db/migrations/versions/090_smart_mix_profiles.py` y el WIP `091_user_access_tokens.py`. Actualizar únicamente el diseño/plan canónicos y el manifiesto de compatibilidad utilizado por la release del paquete nativo.

1. Registrar rama, HEAD real e inventario del working tree; utilizar `docs/technical/smart-mix-design.md` y el `smart-mix-implementation-plan.md` canónico como únicas fuentes activas de diseño/plan. Baseline revisado: `140f9e34`; main local tenía revisión 089, el worktree comiteado 090 y el WIP añade 091. Volver a ejecutar `alembic heads` al implementar: estos números son observaciones, no reservas de migraciones futuras.
2. Fijar en fixtures compartidas con los clientes nativos el contrato `2026-09` de rutas/scopes/identidad, adiciones de schema `1`, grid `delta-ms-v1`, analyzer/implementación `smart-mix-audio-v2` y planner de lote `smart-mix-v2`/plan y score entero `2`, conservando los tipos wire actuales, junto con compatibilidad de versiones, campos aditivos, errores y flags por defecto. Incluir payloads anteriores de Listen/Android y contratos mínimo/máximo soportados del plugin.
3. Antes de añadir schema de cues/búsqueda, volver a comprobar head de migraciones e historial de releases. Asignar entonces la siguiente revisión disponible; no fijar 092/093 de antemano. Renumerar sólo una cola conflictiva comprobada como no publicada/no aplicada, actualizando down-revision y tests conjuntamente. No crear branch heads de conveniencia ni reescribir historia desplegada.
4. Probar instalación limpia, cadena soportada de upgrades incluido 103→104→105, repetición donde se soporte y actualización desde la fixture del schema de producción. Verificar supervivencia de usuarios/biblioteca/sesiones. Definir rollback mediante binarios/flags compatibles; un downgrade destructivo será una operación explícita de recuperación, no comportamiento automático del despliegue.
5. Incluir un manifiesto de finalización dentro del plan canónico: requisito/tarea responsable, artefacto, versión de contrato, commit tracked, evidencia automática, evidencia nativa/manual y limitaciones pendientes. Todos los requisitos aceptados de Android, A, B, C y extensiones deben mapear a tareas. Marcar correctamente WIP untracked y capacidades sólo demostradas con mocks; los planes obsoletos son referencias históricas, no fuentes competidoras de finalización.

**Verificaciones (desde `app/`, PG aislada):** `alembic heads`; `python -m pytest -q tests/test_smart_mix_migration.py tests/test_federation_migration_matrix.py tests/test_vdj_contract_baseline.py tests/test_smart_mix_openapi.py tests/test_capabilities.py tests/test_vdj_capabilities.py`.

**Terminado cuando:** existe un único linaje de migraciones y mapa canónico de contratos/evidencia; ninguna tarea depende de una revisión futura inventada ni presupone que un mock demuestra soporte de plataforma.

### P02 — Completar PAT de privilegio mínimo y la UI de conexión

**Depende de:** P01.

**Archivos:** modificar WIP `app/crate/api/access_tokens.py`, `app/crate/api/schemas/access_tokens.py`, `app/crate/db/repositories/access_tokens.py`, `app/crate/api/auth.py`, `app/crate/api/permissions.py` cuando corresponda, `app/crate/api/me.py`, `app/crate/api/schemas/auth.py`, `app/crate/api/__init__.py`; ampliar `app/tests/test_access_token_repository.py`, `app/tests/test_access_token_api.py`, `app/tests/test_access_token_auth.py`, `app/tests/test_auth.py`, `app/tests/test_play_event_contracts.py`. Crear `app/listen/src/components/settings/AccessTokensSection.tsx` y su test de render; integrar en `app/listen/src/pages/Settings.tsx`; actualizar los catálogos existentes de `app/listen/src/i18n/catalogs/`. Coordinar identidad/login/credential-store del plugin con el paquete nativo.

1. Reemplazar autorización permisiva por sufijo de ruta mediante política de método/ruta/scope. Cubrir cada ruta permitida y las vecinas denegadas, scopes ausentes, usuarios suspendidos/eliminados, tokens expirados/revocados e intentos de usar el rol Admin del propietario. Preservar permisos de sesiones/JWT.
2. Añadir la respuesta PAT de `/api/auth/me` y probar identidad de conexión sin permitir mutaciones de token/perfil/sesión. Exigir `vdj.play_events.write` antes de cualquier escritura de eventos. Mantener denegadas las futuras rutas de cues/radio hasta que P06 implemente su autorización. Registrar `vdj.automation` como legacy sin equivalencia automática a `vdj.automation.execute`, mostrando cómo asignar explícitamente el permiso nuevo.
3. Eliminar `FOR UPDATE` de las lecturas de autenticación. Añadir actualización condicional limitada de last-use y tests de concurrencia que distingan throughput de autenticación de atomicidad de rotación. Verificar efecto de revocación en lecturas/peticiones de tickets posteriores; mantener rotación atómica y aislamiento por propietario.
4. Implementar UI create/list/rotate/revoke con nombre, explicación de scopes, expiración, prefijo y last-used. Mostrar secreto sólo en el resultado create/rotate; limpiarlo al cerrar/desmontar o cambiar cuenta/servidor. Copiarlo sólo mediante acción del usuario y mostrar errores útiles de rotación/revocación. Sin PAT en URL/localStorage/sessionStorage, escrituras automáticas al portapapeles ni logs.
5. Conectar la UI real de login/entrada de token y callbacks de información de cuenta del plugin a los mismos contratos y al credential store del SO. Probar token válido/inválido, scopes ausentes, contrato de servidor incompatible, cancelación, cambio de cuenta/servidor y reconexión tras rotación. El servidor/UI puede terminar antes de verificar el SDK, pero el flujo integrado de conexión no se completa hasta superar la comprobación nativa.

**Verificaciones:** desde `app/`, `python -m pytest -q tests/test_access_token_repository.py tests/test_access_token_api.py tests/test_access_token_auth.py tests/test_auth.py tests/test_play_event_contracts.py`; desde la raíz, `npm run --workspace=app/listen test -- src/components/settings/AccessTokensSection.test.tsx src/pages/Settings.test.tsx src/pages/Login.test.tsx` y `npm run --workspace=app/listen i18n:check`. Ejecutar los tests nativos de login/credenciales identificados en su paquete.

**Terminado cuando:** un usuario normal puede crear un token con scopes, conectar, identificar su cuenta, rotar y revocar mediante UI soportada; las operaciones prohibidas fallan antes de efectos secundarios; la autenticación deja de serializar todas las peticiones sobre la fila del token.

### P03 — Hacer consistente el routing y los kill switches efectivos

**Depende de:** P01, P02.

**Archivos:** modificar `app/crate/config.py`, `app/crate/api/auth.py`, `app/crate/api/capabilities.py`, rutas VDJ protegidas, `docker-compose.yaml`, `docker-compose.home.yaml`, `docker-compose.dev.yaml`, `data/caddy/Caddyfile.readplane.dev`, `app/tests/test_readplane_catalog_routing.py`, `app/tests/test_vdj_capabilities.py`; crear `app/tests/test_vdj_feature_gates.py` y `app/tests/test_vdj_proxy_contract.py`. Tocar auth/rutas Go sólo si la decisión medida del readplane exige paridad posteriormente.

1. Añadir bypass PAT y routing de aliases tickets/media antes del readplane en las tres formas de despliegue. Probar PAT opacos válidos/inválidos, JWT, cookies de sesión, artwork sin autenticación, tickets de ruta exacta, HEAD y Range. Cubrir search/profile/auth-me canónicos y la política configurada de disponibilidad de FastAPI/readplane.
2. Ejecutar peticiones reales al proxy contra fixtures aisladas de FastAPI/readplane. Mantener las aserciones de configuración como comprobaciones económicas, pero no tratarlas como prueba de routing/autorización. Distinguir credenciales inválidas de backend no disponible.
3. Aplicar flags VDJ/asistente en operaciones del servidor, conservando identidad normal de Listen/Android y reproducción ajena a VDJ. Aplicar el flag independiente a autorización de automatización; probar combinaciones de flags/scopes y clientes que conservan caché, además del resultado de `/capabilities`.
4. Exponer en `/api/capabilities` el estado efectivo del flag de automatización y del scope `vdj.automation.execute` para el token, con el mismo valor que aplica el servidor. No hay lease: Crate Automix consulta este estado antes de cada pista que encola (diseño §6.3). Probar flag apagado, scope ausente, revocación y token sin automatización con una respuesta sin caché.
5. Medir p50/p95/p99 de FastAPI para search, resumen de perfil, contexto compatible, batch de planes y autorización de stream con tamaño de catálogo y concurrencia representativos. Si cumple los SLO existentes, registrar FastAPI como ruta soportada VDJ. Si no, implementar paridad Go con las mismas fixtures antes de cambiar routing; no reescribir el readplane incondicionalmente. Compartir evidencia con V09, responsable de integración cliente/CI/bench.

**Verificaciones (desde `app/`, servicios aislados):** `python -m pytest -q tests/test_readplane_catalog_routing.py tests/test_vdj_proxy_contract.py tests/test_vdj_feature_gates.py tests/test_vdj_capabilities.py`; si cambia routing/auth Go, desde `app/readplane/`, `go test ./internal/auth ./internal/routes ./internal/catalog ./internal/contract`. Registrar escenarios reales de cambio de flag en la evidencia del executor nativo.

**Terminado cuando:** prod/home/dev aceptan las mismas clases válidas de credenciales y rechazan las mismas inválidas; deshabilitar VDJ o la automatización tiene efecto en el servidor y en el siguiente refresco de capabilities del plugin.

### P04 — Carpetas VDJ de un nivel y búsqueda DJ con sintaxis de filtros

**Depende de:** P01, P02. Puede ejecutarse en paralelo a P03. P04 es el único dueño backend de carpetas y filtros; V09 consume el contrato y cubre cliente/CI/bench.

**Archivos:** modificar WIP `app/crate/api/vdj_catalog.py`, `app/crate/api/schemas/vdj_catalog.py`, `app/crate/db/queries/vdj_catalog.py`, `app/crate/api/browse_media.py`, `app/crate/api/schemas/media.py`, `app/crate/db/queries/browse_media_search.py`, `app/tests/test_vdj_catalog.py`, `app/tests/test_browse_queries.py`, `app/tests/test_browse_schemas.py`; crear `app/tests/test_vdj_search_filters.py` y `app/tests/test_vdj_catalog_queries.py`. Añadir índices justificados por mediciones en `app/crate/db/migrations/versions/` sólo cuando P01 asigne revisión real. Coordinar `tools/vdj-plugin/src/client/catalog_client.cpp` y `search_client.cpp` con el paquete nativo.

1. Carpetas de un nivel según el diseño §6.5, porque el SDK no admite subcarpetas: una por playlist autorizada (orden preservado, partes numeradas de 500 si es más larga), Géneros, Moods, Escuchado recientemente y Compatibles. Respetar propiedad/membresía y disponibilidad local; respuestas acotadas para carpetas vacías/eliminadas y metadata ausente. Quitar `path` de la respuesta.
2. Unificar selección y filtrado de género para que las pistas clasificadas únicamente mediante `album_genres` sigan apareciendo. Probar SQL real con datos aislados para géneros raw, heredados, normalizados y ausentes; cubrir moods y referencias por entidad de recently-played.
3. Sustituir el OFFSET sin límite por consultas acotadas a 500 pistas por carpeta o parte, con orden determinista. Sin cursores: el SDK no puede pedir páginas siguientes.
4. Añadir a la búsqueda la sintaxis de filtros dentro del texto (`artist:`, `album:`, `bpm:120-128`, `key:8A`, `energy:`, `analyzed:no`) y la proyección `fields=dj`, con máximo 50 resultados. Exigir scope local a los PAT VDJ en servidor. Mantener respuesta/orden legacy cuando no hay sintaxis DJ y comprobar regresiones de Listen.
5. Ejecutar planes de query/latencia representativos con 48K pistas antes de añadir índices. No agregar todo el historial de escucha para carpetas ordinarias; cargar solo la carpeta solicitada.

**Verificaciones (desde `app/`, PG aislada):** `python -m pytest -q tests/test_vdj_catalog.py tests/test_vdj_catalog_queries.py tests/test_vdj_search_filters.py tests/test_browse_queries.py tests/test_browse_schemas.py tests/test_catalog_local_browse.py`.

**Terminado cuando:** el plugin recorre playlists, géneros, moods, recientes y compatibles, y encuentra artistas y álbumes mediante la búsqueda con sintaxis de filtros; metadata normalizada y visibilidad coinciden con search; el SQL está cubierto por tests con DB y acotado a 500 pistas por respuesta.

### P05 — Demostrar entrega media, ranges y revocación

**Depende de:** P01, P02, P03; la finalización de carga en deck real depende del paquete nativo de media/caché.

**Archivos:** modificar `app/crate/api/media_access.py`, `app/crate/media_access.py`, `app/crate/api/browse_media.py`, `app/crate/api/browse_album.py`, `app/crate/api/schemas/media.py`, `app/tests/test_media_access_tickets.py`, `app/tests/test_vdj_stream_scope.py`, `app/tests/test_artwork_route_delivery.py`; crear `app/tests/test_vdj_media_contract.py`. Coordinar los existentes `tools/vdj-plugin/src/client/media_access_client.cpp`, `stream_resolver.cpp` y la implementación nativa de caché/prefetch.

1. Probar emisión y uso real del ticket conjuntamente: ruta/audiencia exactas, propietario, expiración, revocación, suspensión, cambio de scope, fallo de almacenamiento, número acotado de targets y ausencia de credenciales en diagnósticos. Confirmar que los tickets de sesión Listen conservan su comportamiento.
2. Alinear payload de resolución, alias media y resolver del plugin en política de entrega, estado preparing, identidad local y origen permitido. Validar headers/status en lugar de aceptar cualquier body no vacío. La API conserva acceso de sólo lectura al filesystem musical; las escrituras de preparación siguen en tareas worker.
3. Servir y verificar GET/HEAD, rangos completos/parciales/sufijos, rangos inválidos, seeking, archivos grandes y transferencias interrumpidas a través del proxy real. Cubrir expiración/revocación antes de la primera petición y entre ranges. Especificar que una respuesta ya autorizada puede terminar; no prometer recuperación de bytes entregados.
4. Fijar el TTL del ticket VDJ para que cubra la descarga inicial completa (valor inicial 15 minutos, ajustado con la medición de VH01), manteniendo ruta exacta, identidad del token y revocación por request. Si VH01 muestra requests Range tras caducar el ticket, implementar el mecanismo que el gate valide antes de cerrar A.
5. Verificar simultáneamente continuidad de la pista cargada y denegación de cargas nuevas sin autorización. Coordinar cancelación de prefetch y ausencia de tickets en cachés/spools persistentes; redactar PAT, tickets y URLs firmadas en todas las rutas de éxito/error.

**Verificaciones (desde `app/`, servicios aislados):** `python -m pytest -q tests/test_media_access_tickets.py tests/test_vdj_stream_scope.py tests/test_vdj_media_contract.py tests/test_artwork_route_delivery.py`. Ejecutar tests nativos de streams/caché y registrar escenarios SDK reales de seek/expiración/revocación/carga offline en la matriz de release.

**Terminado cuando:** una pista autenticada carga y permite seeking con credenciales de vida acotada, las credenciales expiradas/revocadas no autorizan nuevas peticiones y la continuidad del audio ya cargado queda demostrada sin credenciales duraderas en URLs.

**Contrato adicional de P05:** los covers de álbum son públicos y VDJ persiste su URL: el plugin recibe URLs absolutas sin ticket y no se amplían los tickets PAT a artwork. `offlineEligibleUntil` queda en el backlog con V08.

### P06 — Completar backend de cues, radio, now-playing y telemetría idempotente

**Depende de:** P01, P02; el cierre de integración de cues requiere SM03/SM06 ya verificados con fixtures. Utiliza identidad/visibilidad local de P04 y procedencia de playback de P05; su integración con flags depende de P03. P06 es el único dueño de estos endpoints/servicios backend; V07 implementa sus clientes nativos.

**Archivos:** modificar `app/crate/api/smart_mix.py`, `app/crate/api/me.py`, `app/crate/api/schemas/me.py`, `app/crate/db/repositories/user_library_playback_writes.py`, `app/crate/api/radio.py`, `app/crate/radio_engine.py`, `app/crate/db/repositories/radio.py`, `app/crate/api/auth.py`, `app/crate/metrics.py`, `app/crate/api/__init__.py`; ampliar `app/crate/api/dj.py` y `app/crate/api/schemas/dj.py` de P03; crear `app/crate/db/orm/cue_points.py`, `app/crate/db/repositories/cue_points.py`, `app/crate/services/dj_presence.py` y la migración de cues con revisión asignada en P01. Ampliar `app/tests/test_play_event_contracts.py`, `app/tests/test_radio_contracts.py`, `app/tests/test_shaped_radio_engine.py`; crear `app/tests/test_dj_cue_points.py`, `app/tests/test_dj_now_playing.py`, `app/tests/test_dj_play_events.py`, `app/tests/test_vdj_security.py`, `app/tests/test_vdj_observability.py`.

1. Añadir read/upsert/delete de cues privados por usuario y entity UID local con revisión esperada, respuestas de conflicto y revisiones monotónicas. Mantener globales e intactos los cues automáticos del perfil; el merge determinista conserva privados los overrides. Integrar overrides aplicables con contrato compartido del planner e identidad de caché, transportando revisión de cues para rechazar un plan obsoleto tras editar cues. Probar ownership, writes/planes obsoletos, aislamiento entre usuarios de caché de planes, entidades eliminadas, lecturas offline de caché y ausencia de dependencia adicional durante carga del deck.
2. Reutilizar endpoints/motor de radio y añadir propietario explícito a llamadas de servicio next/feedback/end. Exponerlas a PAT sólo con `vdj.radio`; aplicar candidatos locales y semántica de expiración/concurrencia. Preservar comportamiento y efectos de feedback de Listen para propietarios válidos.
3. Implementar presencia efímera con aislamiento usuario/cliente/deck, campos/rate acotados, heartbeat de 30 segundos y TTL de 90 segundos. Ausencia de presencia o caída Redis no puede detener playback; evitar cardinalidad ilimitada de métricas.
4. Exigir `client_event_id` VDJ estable y telemetry scope antes de llamar al repositorio actual. Especificar umbral audible en el contrato compartido, probar repetición de eventos idénticos y reutilización de ID con payload conflictivo, y garantizar que cada evento aceptado produce cada efecto posterior una sola vez. Mantener un spool nativo de reintentos acotado y sin credenciales.
5. Completar cobertura de abuso/observabilidad sobre scopes, ownership de cues/radio, parsing de cursores, replay/expiración de tickets, redirects/TLS, metadata excesiva, caché corrupta y redacción de logs. Emitir métricas acotadas de peticiones/fallback con versiones de contrato/plugin/planner; sin tokens, texto de usuario ni entity UID como labels de cardinalidad ilimitada.

**Verificaciones (desde `app/`, PG/Redis aisladas):** `python -m pytest -q tests/test_smart_mix_api.py tests/test_dj_cue_points.py tests/test_dj_now_playing.py tests/test_dj_play_events.py tests/test_play_event_contracts.py tests/test_radio_contracts.py tests/test_shaped_radio_engine.py tests/test_vdj_security.py tests/test_vdj_observability.py tests/test_access_token_auth.py tests/test_federation_migration_matrix.py`.

**Terminado cuando:** todas las extensiones aceptadas funcionan mediante los contratos actuales de usuario/biblioteca, aislamiento e idempotencia resisten reintentos/concurrencia y un fallo de telemetría/cues no puede tomar un deck ni retrasar audio cargado.

## 4. Smart Mix core — SM01 a SM07

Las rutas siguientes son relativas a la raíz del worktree activo. Cada tarea empieza con una reproducción que falla por el comportamiento señalado, continúa con el cambio mínimo y termina ejecutando las suites afectadas. No es necesario rehacer los tests que ya existen. Los commits se agrupan por tarea y no incluyen atribución automática. `pytest` se ejecuta con el Python del entorno de trabajo; el cierre usa el stack de test aislado de Crate, jamás credenciales/DB de producción. Las tareas de contratos coordinan sus cambios con los bloques Android y VDJ del documento consolidado.

### SM01 — Implementar procedencia y persistencia bajo los contratos de P01

**Depende de:** P01, que cierra versiones/contratos globales y reserva la cadena de migraciones. **Desbloquea:** SM02–SM06 y adapters de clientes.

**Modificar:** `app/crate/smart_mix/models.py`, `app/crate/smart_mix/policy.py`, `app/crate/api/schemas/smart_mix.py`, `app/crate/api/schemas/capabilities.py`, `app/crate/api/capabilities.py`, `app/crate/db/orm/smart_mix.py`, `app/crate/db/repositories/smart_mix.py`, `app/crate/db/repositories/library_analysis_writes.py`, `tools/crate-cli/src/mix_profile.rs`.

**Crear:** nueva revisión en `app/crate/db/migrations/versions/` con el siguiente número libre, identificada en el propio commit como `smart_mix_measurement_provenance`.

**Pruebas:** `app/tests/test_smart_mix_models.py`, `test_smart_mix_repository.py`, `test_smart_mix_migration.py`, `test_smart_mix_openapi.py`, `test_capabilities.py`, `test_vdj_capabilities.py`, `test_federation_migration_matrix.py`, `tools/crate-cli/tests/smart_mix_analysis.rs`.

1. RED: roundtrip de duración del decoder distinta de `library_tracks.duration`; campos de medida/límites ausentes en legado; rechazo de NaN/infinito/BPM no positivo, cue fuera de duration y producer/version desconocidos donde requieran degradación. Characterizar el contrato v1 que hoy consume el WIP.
2. Ejecutar `PYTHONPATH=app python -m pytest -q app/tests/test_smart_mix_models.py app/tests/test_smart_mix_repository.py app/tests/test_smart_mix_migration.py app/tests/test_smart_mix_openapi.py` y confirmar el fallo concreto nuevo; no confundir un skip por PG ausente con RED útil.
3. Añadir campos opcionales y persistencia de duración exacta, reutilizar constantes de versiones de P01 y crear la migración aditiva en la posición que haya reservado. No modificar la 090 ni eliminar datos legacy. Mantener el golden del codec.
4. Implementar las versiones negociadas y compatibilidad de P01; actualizar los adapters backend de capabilities/OpenAPI y sus matrices coordinadamente con el propietario del contrato global. Mantener `profileVersion:1` aditivo y la correspondencia lote `smart-mix-v2`/plan entero `2`, separada del schema.
5. GREEN: repetir suite y `PYTHONPATH=app python -m pytest -q app/tests/test_capabilities.py app/tests/test_vdj_capabilities.py app/tests/test_federation_migration_matrix.py` con DB aislada. `cargo test --manifest-path tools/crate-cli/Cargo.toml --no-default-features --features analysis` valida el contrato Rust.

**DoD:** esquema, ORM, JSON y fixtures concuerdan; lectores distinguen legado de medidas acreditadas; migración ida/vuelta sobre clones test; capacidades no activan funcionalidades por el mero hecho de existir columnas.

### SM02 — Medir loudness/true peak multicanal y acotar el DSP

**Depende de:** SM01. **Desbloquea:** publicación de perfiles corregidos, gates de staging del planner.

**Modificar:** `app/crate/smart_mix/analyzer.py`, `app/crate/smart_mix/cue_detection.py`, `app/crate/audio_analysis.py`, `tools/crate-cli/src/analyze.rs`, `tools/crate-cli/src/mix_profile.rs`, `tools/crate-cli/Cargo.toml`, `app/requirements-worker-analysis.txt` y configuración de build de las imágenes que requiera la dependencia elegida.

**Crear:** `app/crate/smart_mix/loudness.py`, `app/tests/test_smart_mix_loudness.py`; adapter Rust dedicado si evita mezclar el medidor con detección de beats.

**Pruebas existentes:** `app/tests/test_smart_mix_audio_analysis.py`, `test_smart_mix_rust_parity.py`, `test_audio_analysis.py`, `tools/crate-cli/tests/smart_mix_analysis.rs`.

1. RED: estéreo en contrafase `L=0.9*sin`, `R=-0.8*sin` cuyo peak por canal no puede convertirse en el peak de la media; fixture con intersample peak, silencio, canal único, ventanas con diferente loudness, archivo corto y cola tras el minuto 120. Las expectativas provienen del oracle, no del mismo helper que se prueba.
2. Ejecutar `PYTHONPATH=app python -m pytest -q app/tests/test_smart_mix_loudness.py app/tests/test_smart_mix_audio_analysis.py` y registrar que falla la medición actual.
3. Incorporar medidor real, preservar canales para su análisis y mantener mono solo en características que lo requieren. Emitir `measurementVersion`, nullear datos no medidos y versionar analyzer. Definir ventanas con duración/posición reproducible; validar build/licencia de la dependencia elegida antes de actualizar lockfiles.
4. Implementar decoder/scan acotados: budgets por track, lectura en bloques o ventanas y estrategia de largas duraciones. Compartir/cachar características de un decode cuando sea posible; evitar repetir FFT/onset/key sobre el audio completo sin necesidad.
5. GREEN Python/Rust: `cargo build --manifest-path tools/crate-cli/Cargo.toml --no-default-features --features analysis`, después `PYTHONPATH=app python -m pytest -q app/tests/test_smart_mix_loudness.py app/tests/test_smart_mix_audio_analysis.py app/tests/test_smart_mix_rust_parity.py app/tests/test_audio_analysis.py` y `cargo test --manifest-path tools/crate-cli/Cargo.toml --no-default-features --features analysis`.
6. La prueba de paridad falla si falta el binario en CI del core; el skip local sigue permitido con motivo explícito. Fijar tolerancias en fixtures y contrato del medidor: propuesta inicial ±0.1 LU en fixtures controladas y ±0.1 dBTP respecto al oracle compatible, confirmadas por su precisión. No trasladar esas tolerancias a BPM/key sin su protocolo independiente.

**DoD:** ambos backends miden las mismas magnitudes, pasan contrafase/intersample/silencio, no publican RMS como LUFS, no cargan duración ilimitada y producen artefacto de paridad real. El baseline de coste se entrega a SM07.

### SM03 — Corregir límites de transición, fase y cues efectivos

**Depende de:** SM01 y fixtures de SM02. **Coordina con:** modelos/engine Android y resolución de cues privados del bloque VDJ C.

**Modificar:** `app/crate/smart_mix/planner.py`, `app/crate/smart_mix/policy.py`, `app/crate/smart_mix/models.py`, `app/crate/api/smart_mix.py`, `app/crate/api/schemas/smart_mix.py`.

**Pruebas:** `app/tests/test_smart_mix_planner.py`, `test_smart_mix_api.py`, `test_smart_mix_models.py`.

1. RED parametrizado: outgoing de 180s/cue176s con fade12s; incoming corto o cue cercano al final; ratios 0.94/1/1.06; leading/trailing silence; grids half/double; cues privados explícitos; faltan perfiles/duración; anchors de outgoing e incoming con fases distintas.
2. Ejecutar `PYTHONPATH=app python -m pytest -q app/tests/test_smart_mix_planner.py` y confirmar que las nuevas invariantes temporales fallan en el código actual.
3. Implementar resolución pura de límites/cues y duración. Comprobar `cue + consumo de audio del fade` dentro del intervalo útil de cada pista después del ajuste de tempo/fase. Mantener la intención de cues privados, cuerpo audible y defaults de álbum/manual; degradar cuando no hay un intervalo seguro.
4. Calcular offset usando ambos grids y su tiempo efectivo. Usar medidas acreditadas para gain staging; datos legacy ausentes no permiten boost optimista. Generar revisión de planner v2 y razones compatibles.
5. Añadir propiedades sobre muchas combinaciones acotadas: ningún cue negativo, ningún handoff posterior al outgoing ni consumo posterior al incoming, ratio acotado, mismo input produce misma salida, perfiles globales inmutables. No exigir que todos los casos produzcan beatmatch.
6. GREEN: `PYTHONPATH=app python -m pytest -q app/tests/test_smart_mix_planner.py app/tests/test_smart_mix_api.py app/tests/test_smart_mix_models.py`. Entregar fixtures JSON con resultados esperados a engines/clientes para evitar reinterpretaciones de milisegundos vs frames.

**DoD:** el caso180/176/12 ya no genera un plan inviable; ambos extremos y tempo/fase están cubiertos; unknown/legacy degrada con razón; la interfaz pura acepta valores de cues ya resueltos/autorizados y sus fixtures pasan. La integración con su persistencia privada se cierra en la tarea VDJ correspondiente, sin crear una dependencia circular con el core.

### SM04 — Publicar perfiles correctos para la fuente y permitir promociones

**Depende de:** SM01–SM02. **Desbloquea:** SM05 y rollout de reanálisis.

**Modificar:** `app/crate/db/jobs/analysis_storage.py`, `app/crate/db/repositories/smart_mix.py`, `app/crate/db/repositories/library_analysis_writes.py`, `app/crate/worker_handlers/analysis.py`, `app/crate/audio_analysis.py` y el wiring Rust de resultados en esos módulos.

**Crear:** `app/tests/test_smart_mix_publication.py` para carreras con dos sesiones/conexiones reales; extraer un helper específico de publicación si mantiene el módulo legible.

**Pruebas existentes:** `app/tests/test_smart_mix_analysis_storage.py`, `test_smart_mix_repository.py`, `test_smart_mix_backfill.py`.

1. RED: cambio de archivo entre captura y store, path reasignado al mismo track, job viejo después de un ganador, pérdida de claim, retry idéntico, `crate-python/partial → crate-rust/full`, mismo source con analyzerVersion nuevo, fallo transitorio después de full válido.
2. Ejecutar `PYTHONPATH=app python -m pytest -q app/tests/test_smart_mix_publication.py app/tests/test_smart_mix_analysis_storage.py` en DB aislada. Los mocks valen para reproducciones de función, pero no acreditan el CAS/concurrencia.
3. Transportar contexto capturado y definir mecanismo de captura estable para los writers existentes. Abrir transacción únicamente para validar identidad/claim/revisión esperada y publicar. Usar CAS o row lock más condición equivalente; no mantener una transacción PostgreSQL durante DSP/decoding.
4. Corregir idempotencia y política de promoción/reemplazo: misma fuente+implementación+config no cambia; partial→full permitido; legacy/full de fuente distinta no se considera current; fallo conserva historial útil sin falsificar estado.
5. Completar únicamente el claim propietario, emitir invalidación por la nueva revisión y no emitir un evento de ready por una publicación descartada. Encolar nueva generación cuando cambió la fuente sin consumir retries de decoder como si fuera un error de audio.
6. GREEN: repetir suite más `PYTHONPATH=app python -m pytest -q app/tests/test_smart_mix_repository.py app/tests/test_smart_mix_backfill.py`; crash windows y dos conexiones deben producir un único ganador y estado consistente.

**DoD:** no se guarda un draft viejo como nueva fuente, Rust full no se pierde por compartir el string de versión con Python, un loser no completa claims ajenos y no hay DSP dentro de una transacción.

### SM05 — Backfill por generación, control operativo e invalidación de fuente

**Depende de:** SM04. **Coordina con:** scheduler/resource governor existentes y status Admin.

**Modificar:** `app/crate/db/jobs/smart_mix_backfill.py`, `app/crate/worker_handlers/analysis.py`, `app/crate/db/queries/smart_mix_admin.py`, `app/crate/api/smart_mix_admin.py`, `app/crate/api/schemas/smart_mix_admin.py`; añadir metadata target/claim en una nueva migración solo si se necesita para el protocolo adoptado. Al identificar writers de sustitución de audio, modificar sus puntos concretos de invalidación dentro de `app/crate/worker_handlers/` y sync/repositorios existentes, no un proceso nuevo paralelo.

**Pruebas:** `app/tests/test_smart_mix_backfill.py`, `test_smart_mix_admin.py`, `test_smart_mix_analysis_storage.py`, `test_smart_mix_publication.py`, tests existentes de los writers tocados.

1. RED: perfil v1 y processing done debe reclamarse para target v2; source sustituida se reanaliza; retry agotado del target antiguo no bloquea el nuevo; dos workers no procesan el mismo target; claim expirado recupera owner; pause/resume/cancel con hijos ya encolados.
2. Ejecutar `PYTHONPATH=app python -m pytest -q app/tests/test_smart_mix_backfill.py app/tests/test_smart_mix_admin.py` con PostgreSQL test.
3. Incluir generación objetivo en elegibilidad, dedup y checkpoint. Mantener las prioridades y el límite100. Reiniciar presupuesto de attempts únicamente al cambiar target, no en cada click de resume. Documentar quién encola el siguiente lote y cuándo termina la campaña; el status no presenta como campaña running un único batch que ya terminó.
4. Conectar invalidación de fuente/cambios de implementación; no recalcular profiles en GET. Definir pausa de nuevos claims y comportamiento preciso del lote actual. Cancelar no destruye perfiles; reanudar no duplica trabajo activo.
5. Ajustar status/coverage a perfiles current frente a stale/legacy/failed/agotados. Registrar counters de claimed/completed/promoted/stale-discard/retry-exhausted y razones; ninguna ruta protegida ni token en logs.
6. GREEN: suites anteriores más publicación y tests de cada writer tocado. Ejecutar un canary local acotado, interrumpirlo y reanudarlo verificando checkpoint y convergencia; guardar cantidad y target, sin lanzar el catálogo completo para probar control.

**DoD:** la migración de versiones y fuentes converge, pause/resume/cancel son reales, retries no reviven indefinidamente y status refleja el objetivo correcto. La implantación puede empezar antes de cobertura100%; las pistas pendientes degradan.

### SM06 — Entregar planes y candidatos versionados con caché y readplane coherentes

**Depende de:** SM03–SM04. **Coordina con:** auth/scopes VDJ y contratos de cliente Android/VDJ. El puerto de resolución de cues se prueba aquí con fixtures de valores/revisiones autorizados; la implementación de persistencia y el test integrado real pertenecen a P06/V07, que depende del core y no a la inversa.

**Modificar:** `app/crate/api/smart_mix.py`, `app/crate/api/schemas/smart_mix.py`, `app/crate/db/cache_store.py`, `app/crate/db/queries/smart_mix_compatible.py`, `app/crate/smart_mix/compatible.py`, `app/readplane/internal/routes/smart_mix.go`, `app/readplane/internal/catalog/smart_mix_store.go`, `app/readplane/internal/snapshots/smart_mix.go` y adapters/contracts de summaries ya existentes.

**Pruebas:** `app/tests/test_smart_mix_api.py`, `test_smart_mix_openapi.py`, `test_smart_mix_compatible_tracks.py`, `test_smart_mix_compatible_service.py`, `test_smart_mix_compatible_query_plan.py`, `test_vdj_contract_baseline.py`, `test_readplane_catalog_routing.py`, `app/readplane/internal/{routes,catalog,snapshots}/smart_mix*_test.go`.

1. RED: mismo par con distinta revisión de profile/cue o usuario no comparte plan incorrecto; cached v1 no se entrega como v2; unknown version falla/degrada según contrato; response summary omite grid; scope token y sesión mantienen los permisos establecidos. No duplicar ni reemplazar el mecanismo de auth que desarrolla VDJ.
2. Ejecutar `PYTHONPATH=app python -m pytest -q app/tests/test_smart_mix_api.py app/tests/test_smart_mix_compatible_tracks.py app/tests/test_smart_mix_openapi.py`.
3. Incluir revisión de política, fuente/perfil, cues resueltos y contexto/owner en claves donde corresponda. Resolver cues privados antes del planner puro. Mantener batch máximo32, candidatos máximo500 y respuestas sin credenciales. Invalidar caché por identidad, sin purgar indiscriminadamente Redis.
4. Mover elegibilidad local/quarantine/disponibilidad antes del límite de candidatos y asegurar que las consultas no se convierten en N+1 ni leen grids. Characterizar los pesos actuales, dedup y tie-break; no aprovechar este trabajo para introducir otra fórmula de ranking.
5. Aplicar summary/version parity en FastAPI y readplane; unknown versions no se convierten en perfiles full. Completar los summaries de federación que exige el alcance original usando contratos existentes; los grids detallados no se replican a todas las filas globales y VDJ `scope=local` sigue siendo local.
6. GREEN: suites de API/ranking/routing y, desde `app/readplane`, `go test ./internal/routes ./internal/catalog ./internal/snapshots`. Mantener correctas las rutas Go session/JWT existentes. La aceleración PAT en Go puede permanecer sin implementar si FastAPI cumple SLO y el routing es consistente; eso no impide cerrar la feature.

**DoD:** clientes antiguos y nuevos reciben planes compatibles y autorizados; preferencias privadas no contaminan otras sesiones; datos cambiados no reutilizan planes viejos; ranking sigue acotado y semánticamente estable; FastAPI/readplane coinciden o la ruta nueva permanece en FastAPI hasta pasar parity.

**Recorrido federado obligatorio de SM06:** modificar `app/crate/db/queries/federation_manifest.py`, `app/crate/db/jobs/federation_catalog_changes.py`, `app/crate/db/repositories/federation_catalog.py` y la adaptación de perfil remoto. Crear `app/tests/test_smart_mix_federation.py`; ampliar `app/tests/test_federation_catalog_delta.py` y `app/tests/test_federation_catalog_change_producer.py`. RED: publicar nueva profileRevision sin cambiar metadata de track genera delta y luego nuevo plan remoto, nunca reutiliza la revisión vieja. GREEN: snapshot/delta contienen summary opcional versionado y la ingestión tolera peers legacy sin grid/cues privados/paths. Ejecutar los tres tests con PG aislado y repetir contrato de planning remoto. La paridad Go session/JWT ya existente es obligatoria; auth/routing PAT Go es optimización condicionada a SLO, no un pendiente obligatorio si FastAPI cumple. Añadir `app/crate/api/federation.py`, `app/crate/db/repositories/global_catalog_dirty_sources.py`, `app/crate/worker_handlers/federation.py` y `app/crate/db/jobs/global_catalog_reconciliation.py` a ese recorrido. Tras el CAS ganador, en la misma transacción encolar `enqueue_local_dirty_source` para emitir delta con nueva profileRevision; no emitir por no-op/CAS perdido. Snapshot pasa por `_sync_single_peer_catalog`/`upsert_catalog_item`; delta por `_sync_peer_catalog_delta`/`apply_federation_delta_page`. La ingestión valida el summary en raw_json y proyecta revisión remota. Ampliar también `app/tests/test_federation_catalog_sync_resume.py` con replay idempotente, tombstone y peer sin summary.

### SM07 — Benchmarks reproducibles, matriz de audio y gates del core

**Depende de:** SM01–SM06. **Integra con:** verifier final de Android y VDJ.

**Crear/reutilizar según el bloque de laboratorio consolidado:** `tools/smart-mix-lab/benchmark_server.py`, `tools/smart-mix-lab/benchmark_analysis.py`, `tools/smart-mix-lab/schemas/release-gates-v1.json`, `tools/smart-mix-lab/tests/test_benchmark_contract.py`.

**Modificar:** `.github/workflows/test-backend.yml`, `.github/workflows/test-native-tools.yml`, `.github/workflows/test-readplane.yml`, `Makefile`, tests de queries/paridad actuales. El script de verificación global debe ser único y compartido con los bloques Android/VDJ.

1. RED: el parser de resultados rechaza muestras sin hardware/versión/dataset/warm-up, un percentile superior al umbral, suite Rust omitida o fixture de audio declarada pero no ejecutada. Generar resultados fake pequeños para probar el verifier; esos resultados no cuentan como evidencia de rendimiento.
2. Implementar fixtures de 48K perfiles para el servidor y corpus de audio reproducible: sintetizados deterministas más muestras reales con derechos de uso identificados. Incluir fades muy cortos/largos, silencio, stems contrastantes/contrafase, variable tempo, key ambigua y largas duraciones.
3. Medir cached/uncached/ranking con límites50/150/250ms p95, warm-up y carga declarados; medir tiempo/RSS del analyzer para tracks normales y largos sobre el worker objetivo. Mantener comparativas con baseline del mismo host. Instrumentar errores de decoder, stale publication, fallback reason y cache hit/miss, sin URLs protegidas.
4. GREEN: `PYTHONPATH=app python -m pytest -q tools/smart-mix-lab/tests/test_benchmark_contract.py`. Crear los CLIs con opciones explícitas para los siguientes escenarios y ejecutar, con entorno apuntando al stack aislado: `PYTHONPATH=app python tools/smart-mix-lab/benchmark_server.py --fixture representative-48k --warmup 100 --iterations 1000 --concurrency 16 --output /tmp/smart-mix-server-benchmark.json` y `PYTHONPATH=app python tools/smart-mix-lab/benchmark_analysis.py --fixture generated-v1 --long-duration-seconds 7200 --output /tmp/smart-mix-analysis-benchmark.json`. El primero informa separadamente cached batch32, uncached batch32 y compatible500; el segundo genera las fuentes por bloques y añade el corpus real identificado en el manifiesto de laboratorio. La CLI debe exigir un DSN de test aislado o corpus local, rechazar objetivos de producción por defecto y no autoaprovisionar sobre la DB de la aplicación. Cada JSON registra el comando y escenario efectivos.
5. Cerrar suites: `make dev-test-backend`, `cargo test --manifest-path tools/crate-cli/Cargo.toml --no-default-features --features analysis`, `cargo clippy --manifest-path tools/crate-cli/Cargo.toml --no-default-features --features analysis -- -D warnings`, `cargo fmt --manifest-path tools/crate-cli/Cargo.toml -- --check`; readplane mediante su target existente o `go test ./...` desde `app/readplane`. Confirmar que no había otro agente utilizando el stack fijo `crate-test` antes del target que lo recrea, o usar un proyecto/puertos aislados equivalentes.
6. Guardar artefactos con commit SHA+diff WIP, comando, entorno, fecha y resultado. Repetir cuando cambien DSP/policy/publicación; no repetir indiscriminadamente cuando nada relevante cambia. El verifier de release consume estos artefactos junto a los físicos del engine.

**DoD:** CI ejecuta y valida la evidencia del core, sin tratar skips o mocks como aceptación real; los budgets originales quedan medidos. Puede continuar el rollout parcial con flags apagados, pero el informe final distingue de forma explícita código existente, pruebas ejecutadas y aceptación pendiente.

## 5. Android nativo — A01 a A08

En este bloque, `JAVA` abrevia `app/listen/android/app/src/main/java/app/cratemusic/crate/`, `UNIT` abrevia `app/listen/android/app/src/test/java/app/cratemusic/crate/` y `DEVICE` abrevia `app/listen/android/app/src/androidTest/java/app/cratemusic/crate/`. Son directorios existentes; las clases señaladas como Crear son propuestas.

### A01 — Sacar planning del arranque y hacer offline real

**Depende de:** P01; integrar planes corregidos tras SM06. **Modificar:** `app/listen/src/lib/smart-mix.ts`, `android-native-engine.ts`, `playback-engine.ts`, `app/listen/src/contexts/player-engine-adapter.ts` y sus tests existentes. **Crear:** `app/listen/src/lib/smart-mix-plan-cache.ts` y su test solo si separar caché simplifica el cliente actual.

1. RED con promesa de API que nunca resuelve: iniciar cola/reproducir no espera el plan. Offline no invoca request; deadline cancela; cambio de usuario/origen/cola/cue descarta resultado viejo; desactivar Smart Mix también cancela.
2. Ejecutar los tests del cliente y adapter del comando base y comprobar los fallos de startup/offline, no un timeout global del runner.
3. Separar carga de media y precarga de planes; cola/play no hace `await Promise.all(streams, plans)`. Limitar próximos 3 edges, dedup, deadline 1s y AbortSignal real; instalar resultados solo si generación y condiciones siguen vigentes y no empezó transición.
4. Reusar caché con clave de versiones/contexto/proveniencia; offline usa cache validada o fallback inmediato. Verificar que obtener un fallback no se reintenta en bucle y que reconnect habilita nuevas generaciones.
5. GREEN focalizado; ejecutar `npm run --workspace=app/listen typecheck`. Integración fake bridge acredita que la primera orden de playback precede al resultado de planificación.

**DoD:** ninguna dependencia de red musical bloquea play, offline no llama al servidor, requests/planes obsoletos no mutan el engine y no se guardan URLs/tickets.

### A02 — Preparar en el cue y ejecutar solo dentro de ambos tracks

**Depende de:** A01, SM03/SM06. **Modificar:** `JAVA/NativeMixController.java`, `ExoPlayerNativePlaybackDeck.java`, `NativePlaybackDeck.java`, `NativeTransitionPlan.java`, `NativeMixTiming.java`, `CrateNativePlaybackService.java`; tests `UNIT/NativeMixControllerTest.java`, `NativeMixTimingTest.java`, `FakeNativePlaybackDeck.java`, `DEVICE/ExoPlayerNativePlaybackDeckTest.java`.

1. RED: deck inicialmente ready que vuelve a buffering tras seek; incoming cue!=0; poco buffer; final corto; late plan; duración 180/cue176/fade12; ratio 1.06; plan de otra carga/cola; repeat-one. El fake debe modelar preparación asíncrona, no devolver siempre true.
2. Preparar media y seek al cue antes de emitir ready válido. Readiness incluye identidad/generación, posición tolerada y buffer posterior al seek; fijar margen inicial mínimo 1s cuando quede audio suficiente y medirlo en A06. Poco buffer degrada/reintenta hasta deadline del cue, nunca extiende outgoing.
3. Trigger por cue/posición actual y validador de límites del executor; acortar solo bajo reglas declaradas o fallback. Eliminar repeat-one artificial y la condición global de crossfade que lanza demasiado tarde. Los datos efectivos del decoder prevalecen sobre una duración legacy aproximada.
4. Ejecutar suite `./gradlew :app:testDebugUnitTest` y prueba instrumentada de seek/buffer real. Registrar que play no se emite antes de la nueva readiness.

**DoD:** la transición nunca comienza con un standby no preparado para su cue, no excede los límites temporales y la reproducción ordinaria sigue disponible si el plan falla.

### A03 — Envelope completo en PCM, ganancia y clipping

**Depende de:** A02 y SM02/SM03. **Modificar:** `JAVA/NativeMixAudioProcessor.java`, `NativeMixController.java`, `ExoPlayerNativePlaybackDeck.java`, `CrateNativePlaybackService.java`; `UNIT/NativeMixAudioProcessorTest.java`, `NativeMixSignalTest.java`, `NativeMixControllerTest.java`. **Crear:** `DEVICE/NativeMixEnvelopeTimingTest.java` y un helper de envelope si permite pruebas puras.

1. RED con PCM determinista, tamaños de buffer variables, cancelación a mitad de buffer, main thread detenido 250ms y dos señales correlacionadas. La curva debe continuar por frames y fallar con la dependencia actual de ticks 20ms.
2. Programar inicio/duración/curva/ganancias en dominio samples; snapshot de parámetros sin allocations/I/O/locks bloqueantes en audio. Cambios de volumen/duck/cancel tienen rampa corta controlada y no reinician toda la transición.
3. Aplicar staging con peaks acreditados, headroom para EQ y fallback conservador cuando faltan medidas; probar clipping del mix total, no solo rango de cada procesador. Dos AudioTracks no se presentan como un limiter común inexistente.
4. GREEN de señal/unit e instrumentación. Exportar WAV de fixtures al laboratorio A06 y medir true peak/continuidad con oracle independiente. Revisar CPU/allocation traces bajo carga.

**DoD:** el fade completo no depende de main, no hay clicks por cambios de parámetros y el corpus cumple staging; ningún test presume que equal-power equivale a ausencia de clipping.

### A04 — Cerrar lifecycle, sesión, cola y contabilidad audible

**Depende de:** A02–A03. **Modificar:** `JAVA/CrateMixPlayer.java`, `NativeMixController.java`, `NativeTransitionStateMachine.java`, `CrateNativePlaybackService.java`, `CrateNativePlaybackPlugin.java`, `PlaybackCheckpointStore.java`, `NativePlaybackTelemetry.java`; tests existentes de esas clases y `DEVICE/CrateMixMediaSessionTest.java`; hooks de callbacks/visualización en `app/listen/src/contexts/` y `src/lib/native-transition-visual.ts` si cambia el contrato.

1. RED por cada interrupción en cada fase: pause/resume, seek, next/previous, reemplazo de cola, repeat-one, error/fin de deck, focus loss/duck, llamada, cambio/desconexión de ruta y cierre del service. Callbacks viejos tras cancelación no avanzan ni publican progreso.
2. Consolidar executionId/generaciones y dueño único de handoff/advance. Diferenciar cruce de metadata y fin audible; reportar exactamente una transición/avance con play events por audio realmente audible. No contar precarga como escucha.
3. Conservar misma facade/MediaSession, comandos/capabilities OS, EQ y audio-session routing de ambos decks; preparar el siguiente no recrea notificación. Persistir un checkpoint estable y restaurar un deck sin revivir una automatización parcial.
4. GREEN unit + MediaSession instrumentada + Vitest de callbacks/visualización. Probar process death, auth renewal, playback descargado y cambio a streaming en dispositivo A06.

**DoD:** una sesión/notificación, ningún double advance/duplicate play-event, controles del SO continuos y recuperación determinista en todas las fases.

### A05 — Settings, negociación y opt-out persistente

**Depende de:** P01, A01–A04. **Modificar:** `app/listen/src/pages/Settings.tsx`, `Settings.test.tsx`, `src/lib/player-playback-prefs.ts`, `player-playback-prefs.test.ts`, `android-native-engine.ts` y test, `src/lib/smart-mix.ts`, catálogos `src/i18n/catalogs/`; wiring de capabilities y flags existentes. **Crear:** `src/components/settings/SmartMixSettings.tsx` y render test si la extracción es útil y se integra en Settings.

1. RED: Android nativo capaz muestra controles; navegador móvil no los activa; desktop mantiene preferencias; opt-out no se pierde al refresh; duration0 desactiva; álbum secuencial sigue gapless; servidor/engine desconocido oculta o explica el modo.
2. Implementar control Smart Mix, duración máxima, beatmatch y bass con capacidad efectiva. No exponer toggles activos para campos ignorados; los últimos se habilitan tras A07/A08. Distinguir flag local de pruebas y capacidad de release sin bypass accidental.
3. Migrar preferencias legacy una sola vez y conservar elección explícita. Cancelar planes/transiciones pendientes al desactivar con el contrato seguro A04; una nueva versión del perfil no cambia el consentimiento.
4. GREEN Settings/prefs/native tests; `npm run --workspace=app/listen i18n:check` y typecheck. Revisar accesibilidad de labels/estado, persistencia entre reinicios y cuenta/origen.

**DoD:** usuario puede controlar y entender el modo disponible; opt-out duradero y no regresión en otros engines. Se cierra UI adaptive ahora, toggles beat/bass con sus tareas.

### A06 — Laboratorio reproducible y gate adaptive físico

**Depende de:** A01–A05, SM07 para corpus. **Crear:** `tools/smart-mix-lab/generate_fixtures.py`, `capture_analysis.py`, `benchmark.py`, `tests/test_capture_analysis.py` y fixtures/manifests de datos pequeños con licencias; no otro README de decisiones. **Modificar:** `Makefile`, instrumentación Android y telemetría para exportar métricas acotadas.

1. Testear el analizador de capturas con retraso/drift/clipping conocidos: detecta fallos inyectados y no produce una métrica favorable para una captura vacía, silenciosa o mal alineada. Fixture/oracle del test no comparte la implementación que mide producción.
2. Generar clicks/pilotos deterministas 48kHz de BPM fijo/half-double/drift, silencio, transientes y estéreo; añadir corpus de música autorizado y pares correlacionados. Manifest guarda parámetros/hash, no audio protegido sin licencia.
3. Añadir comandos reproducibles `python tools/smart-mix-lab/generate_fixtures.py --output artifacts/smart-mix/fixtures` y `python tools/smart-mix-lab/capture_analysis.py --manifest artifacts/smart-mix/fixtures/manifest.json --capture <captura.wav> --output artifacts/smart-mix/results.json`. Implementar y probar esas interfaces, todavía propuestas.
4. Medir baseline single deck y dual en mismo dispositivo/ruta/volumen/EQ/build. Audio de aceptación viene de loopback externo cable/USB≥48kHz; logJava es correlación secundaria. Registrar compensación de latencia de ruta, no restar arbitrariamente error de fase.
5. Ejecutar matriz §7: Pixel de referencia y Xiaomi13/equivalente, rutas cable/USB y al menos Bluetooth/altavoz para continuidad; background/lockscreen/Doze/calls/auth/offline/route/process. Bloquear main y degradar red durante la transición.
6. GREEN: adaptive cumple clipping, underrun y memoria. Guardar capturas/métricas y resultados por dispositivo, incluidos fallos, en artefactos; enlazar evidencia en §8. No activar beatmatch con esta tarea.

**DoD:** laboratorio detecta regresiones reales, adaptive aprobado en hardware y baseline reproducible; los resultados no dependen de impresiones subjetivas ni de timestamps de callbacks.

### A07 — Tempo/phase con gate físico y contingencia acotada

**Depende de:** SM03/SM07, A06. **Modificar:** `JAVA/NativeTransitionPlan.java`, `NativeMixTiming.java`, `NativeMixController.java`, `ExoPlayerNativePlaybackDeck.java`, procesador/bridge/capabilities/tests respectivos. **Crear:** `DEVICE/NativeBeatmatchTest.java`; fixtures de ratio/drift y pruebas del laboratorio.

1. RED: plan beatmatch no se trata como adaptive ignorando tempo/phase; rechazar perfiles/ratios/phase desconocidos; restaurar tempo sin salto; media duration y cues siguen válidos tras cambio de rate.
2. Implementar rate/pitch preservation, alineación por ambos grids, coordinación de inicio y recuperación de tempo con límites≤4% por defecto/≤6% absoluto. No ajustar reloj con timers JS/main ni mover cues privados silenciosamente.
3. GREEN unit/instrumentado; ejecutar captura externa en cada ruta anunciada capaz. Gate p95≤20ms con corpus/drift y protocolo§7. Publicar capacidad por executor/ruta efectivamente certificada; Bluetooth no hereda certificación de USB.
4. **Si falla con dos outputs:** dejar beatmatch inactivo y tarea pendiente. Hacer spike de factibilidad acotado al mismo executor: dos decoders→bus PCM común→un output, preservando facade/session/cola. Medir sincronía, CPU, RSS, route/focus/EQ y licencias/dependencias. No implementar una plataforma DSP nueva por adelantado.
5. Si el spike pasa, actualizar la sección5 del diseño con evidencia y el desglose de esta misma A07 antes de integrar el reemplazo; repetir A02–A06 y fase. Si falla o cambia sustancialmente coste/alcance, registrar bloqueo/alternativa para revisión; no cerrar beatmatch renombrándolo como fase futura.

**DoD:** tempo/phase realmente ejecutados y medidos, restauración y manual cancellation correctas, toggle opt-in A05 habilitado solo para capacidades probadas. Adaptive puede entregarse antes; esta tarea no figura hecha hasta pasar su gate o acordar un cambio explícito de alcance.

### A08 — Bass handoff y aceptación de preferencias finales

**Depende de:** A03, A07 y plan/capabilities SM06. **Modificar:** `JAVA/NativeMixAudioProcessor.java`, controller/plan/engine, tests de señal; Settings y catálogos de A05. **Crear:** tests de filtros/handoff si requieren módulo separado.

1. RED: plan balanced en engine sin soporte degrada; activar/desactivar no produce click; bajos correlacionados y EQ positivo no saturan; sample rates44.1/48/96k mantienen estabilidad.
2. Implementar filtro/envelope de bass handoff en audio, acotado al periodo de transición y separado del EQ global; persistir opt-in y deshacer estado al cancelar/terminar. Sin asignaciones/I/O en callbacks.
3. GREEN señal/unit e instrumentación; medir true peak/espectro/continuidad y realizar escucha de corpus con bass desactivado/activado a volumen controlado. Repetir gates de A06/A07 afectados.
4. Completar UI/capabilities y verificar álbum, usuario opt-out, cambio de ruta y legacy. Conservar adaptive si el modo bass no está disponible.

**DoD:** bass es una opción entregada y probada, sin clipping ni regresión de fase/EQ; no basta parsear el campo o dejarlo permanentemente oculto.

## 6. VirtualDJ — VH01 y V01 a V10

El diseño §6.1 recoge lo que permiten el SDK (versión oficial de 2021-10-03) y el host VirtualDJ 8.5, con su evidencia. Las tareas siguientes se ajustan a esa superficie. P01 fija contratos; P02/P03 auth y flags; P04 carpetas y filtros; P05 media; SM06 ranking y perfiles. Cada paso es un checkpoint RED/GREEN/refactor; los resultados se registran en §8.

Comandos comunes de verificación nativa:

```sh
cmake -S tools/vdj-plugin -B build/vdj-headless -DCRATE_VDJ_BUILD_REAL_PLUGIN=OFF -DCRATE_VDJ_BUILD_TESTS=ON
cmake --build build/vdj-headless --parallel 4
ctest --test-dir build/vdj-headless --output-on-failure
```

Baseline: 14 tests verdes en headless y 16 con el SDK local. Los nuevos targets deben registrarse en CTest. Los tests en Release usan checks que no desaparecen con `NDEBUG`. Los builds SDK usan `VIRTUALDJ_SDK_ROOT` privado; headers/samples SDK, credenciales y bundles generados no se incorporan a Git.

### VH01 — Gate de host: comprobar en VirtualDJ lo que el SDK no documenta

**Dependencias:** ninguna; bloquea V03, V04 y V06. **Requiere:** VirtualDJ Pro en macOS arm64 abierto por una persona durante unos 15 minutos.

**Crear:** `tools/vdj-plugin/probe/host_probe.cpp` (target de desarrollo, excluido de los paquetes) y `tools/vdj-plugin/probe/README.md` con el guion. El probe es una Online Source que registra en un log local, sin tokens ni URLs firmadas, cada callback con hilo, duración y resultado.

Comprobaciones, cada una con resultado registrado en §8:

1. Hilo de `OnSearch`, `GetFolder` y `GetStreamUrl`, y si `GetFolder` admite `S_FALSE` + `finish()`.
2. Si VDJ vuelve a llamar a `GetStreamUrl` al hacer seek, recargar o perder la red, y qué requests HTTP hace (GET completo, Range, HEAD) contra un servidor local de prueba, incluido un ticket que caduca a mitad de descarga.
3. Si `GetStreamUrl` acepta una ruta local o `file://`.
4. Si `IVdjSubfoldersList::add` con un identificador o nombre jerárquico genera subcarpetas.
5. Cómo se ve el login con `IsLogged`/`OnLogin`, y si desde `OnLogin` se puede abrir una ventana nativa.
6. Si `SendCommand`/`GetInfo` funcionan desde un hilo propio del plugin.
7. Si `automix_add_next` y `playlist_add` aceptan `netsearch://plugin-<nombre>/<uid>` y la pista se carga y se mezcla en automix.
8. Si la Online Source sigue cargada con el navegador en otra carpeta durante una sesión larga.
9. Si `Release` termina limpio con una búsqueda y un hilo en curso, y tras reiniciar VDJ.
10. Formato de `get_filepath` en un deck con pista Crate (confirmar `netsearch://plugin-Crate/<uid>`).

**DoD:** las diez comprobaciones tienen resultado y versión de VDJ registrados. Si una contradice el diseño §6, se actualizan el diseño y las tareas afectadas antes de implementarlas.

### V01 — Core como frontera fiable de producción

**Dependencias:** P01. **Estado:** core existente; correcciones pendientes.

**Modificar:** `tools/vdj-plugin/CMakeLists.txt`, `include/crate_vdj/{http_client,models,contract_negotiator,credential_store}.hpp`, `src/core/{models,search_results,catalog_results,contract_negotiator,credential_store}.cpp`, `src/client/curl_http_client.cpp`, `src/mapping/{mix_profile,compatible_tracks}.cpp` y tests client/auth existentes.
**Crear:** `tools/vdj-plugin/src/core/json_mapping.cpp`, `tools/vdj-plugin/include/crate_vdj/json_mapping.hpp`, `tools/vdj-plugin/tests/client/json_mapping_test.cpp`, `tools/vdj-plugin/tests/security/redaction_test.cpp`.

1. RED: contrato desconocido no vacío, escapes Unicode/pares sustitutos, null opcional, límites numéricos, nesting malformado y body excesivo.
2. GREEN: un parser JSON mantenido fijado en CMake; límite de body en libcurl antes de añadir bytes; `CURLOPT_NOSIGNAL`, `curl_global_init` explícito y reutilización de handles; rechazo de origen/redirect/status inesperados.
3. GREEN: negociación por rangos de contrato, disponibilidad y flags independientes; versión runtime/paquete desde un único valor; redacción central de secretos con tests.
4. RED/GREEN: propagar los flags de sanitizer a los ejecutables de test y sustituir `assert` por checks que funcionen en Release.
5. Commit `fix(vdj): harden native contracts and test tooling`.

**DoD:** repros conocidos cubiertos y verdes; builds normal, Release y sanitizer correctos; inventario de dependencias y licencias actualizado.

### V02 — Conexión del usuario en un solo binario

**Dependencias:** V01, P02 y P03. **Estado:** stores de credenciales en WIP; sin login.

**Modificar:** `tools/vdj-plugin/src/auth/credential_store_macos.mm`, `tools/vdj-plugin/src/auth/credential_store_windows.cpp`, `tools/vdj-plugin/include/crate_vdj/core.hpp`, `tools/vdj-plugin/CMakeLists.txt`.
**Crear:** `tools/vdj-plugin/src/client/capability_client.cpp`, `tools/vdj-plugin/src/core/connection_settings.cpp`, `tools/vdj-plugin/include/crate_vdj/connection_settings.hpp`, `tools/vdj-plugin/src/platform/connection_dialog_macos.mm`, `tools/vdj-plugin/src/platform/connection_dialog_windows.cpp`, `tools/vdj-plugin/tests/auth/connection_session_test.cpp`, `tools/vdj-plugin/tests/client/capability_client_test.cpp`.

1. RED: sin configurar no hay red; origen inválido; token inválido, revocado o sin scopes; contrato incompatible; rotación; cambio de servidor; errores de escritura del almacén de credenciales.
2. GREEN: `IsLogged`/`OnLogin`/`OnLogout`; `OnLogin` abre el diálogo nativo con origen y token según el resultado de VH01. Guardar el token solo en Keychain o Credential Manager, con cuenta por origen normalizado; propagar errores de escritura; leer la credencial una vez por sesión, no en cada request.
3. GREEN: handshake con `/api/auth/me` y `/api/capabilities`, refresco periódico acotado y flags independientes de A, B y Crate Automix.
4. Fijar el nombre del plugin en `Crate` y documentarlo como contrato permanente; mostrar en el diálogo que el plugin requiere VirtualDJ Pro.
5. Tests nativos auth/capability y, desde `app`, `pytest -q tests/test_access_token_repository.py tests/test_access_token_api.py tests/test_access_token_auth.py tests/test_vdj_capabilities.py`. Probar conectar, sustituir y desconectar en macOS.
6. Commit `feat(vdj): connect and negotiate scoped sessions`.

**DoD:** sin origen por defecto; configuración sobrevive reinicios; errores de auth piden reconexión; desactivar B o Crate Automix mantiene A.

### V03 — Sustituir el spike y completar la navegación

**Dependencias:** V01, V02, P04 y VH01. **Estado:** callbacks de búsqueda, carpetas y compatibles en el spike.

**Modificar:** `tools/vdj-plugin/CMakeLists.txt`, `tools/vdj-plugin/src/client/{search_client,catalog_client}.cpp`, `tools/vdj-plugin/src/cache/sqlite_metadata_cache.cpp`, `tools/vdj-plugin/include/crate_vdj/metadata_cache.hpp`.
**Crear:** `tools/vdj-plugin/src/sdk/online_source_plugin.cpp`, `tools/vdj-plugin/src/online_source/online_source.cpp`, `tools/vdj-plugin/include/crate_vdj/online_source.hpp`, `tools/vdj-plugin/src/core/request_coordinator.cpp`, `tools/vdj-plugin/include/crate_vdj/request_coordinator.hpp`, `tools/vdj-plugin/tests/sdk/online_source_lifecycle_test.cpp`.

1. RED: búsquedas solapadas, cancelación entre fin de red y publicación, `finish` único, callback tras unload, carpeta lenta. Ejercitar el adaptador de producción con el SDK falso.
2. GREEN: adaptador de producción con coordinador de generaciones; búsqueda asíncrona; carpetas asíncronas o servidas desde caché según VH01. Corregir la carrera de `OnSearchCancel`.
3. RED/GREEN: carpetas de un nivel de P04; sintaxis de filtros de búsqueda; menú contextual "Más de este artista" y "Este álbum" que lanzan esa búsqueda; covers como URL absoluta pública en todas las rutas (búsqueda, carpetas, compatibles).
4. RED/GREEN: caché de metadata con stale solo ante transporte o 5xx; 401/403/cancel/version siguen siendo errores; migración de SQLite dentro de transacción; separación por origen y cuenta.
5. `ctest --test-dir build/vdj-headless -R 'online_source|catalog|search|cache' --output-on-failure` y, desde `app`, `pytest -q tests/test_vdj_catalog.py tests/test_browse_queries.py tests/test_browse_schemas.py`. En host: búsquedas rápidas, cancelación, unload/reload con dos decks sonando.
6. Commits por partes, finalizando con `feat(vdj): ship cancellable local catalog source`.

**DoD:** A recorre playlists, géneros, moods, recientes y compatibles, y encuentra artistas y álbumes por búsqueda; la cancelación no publica resultados viejos; el host descarga el plugin limpiamente.

### V04 — Media probada en decks reales

**Dependencias:** V02, V03, P05 y VH01. **Estado:** el resolver genera la URL; ticket de 60 s sin refresh.

**Modificar:** `tools/vdj-plugin/src/client/{stream_resolver,media_access_client}.cpp`, `tools/vdj-plugin/src/sdk/online_source_plugin.cpp`, `tools/vdj-plugin/tests/client/stream_resolver_test.cpp`.
**Crear:** `tools/vdj-plugin/tests/sdk/media_delivery_contract_test.cpp`.

1. RED: payload de playback completo (UID, localidad, formato, estado preparing), autorización fallida, redirect a otro origen, media borrada, revocación.
2. GREEN: validar el payload antes de emitir el ticket; URL con ticket de TTL según P05; deadline en `GetStreamUrl`; sin persistir la URL.
3. RED/GREEN según VH01: si hay requests Range tras caducar el ticket, implementar el mecanismo validado por el gate.
4. Gate host: cargar dos pistas Crate distintas (incluida FLAC), reproducir, seek, cortar red, revocar el token y probar una carga nueva. Registrar versión, arquitectura y resultados.
5. Commit `feat(vdj): validate authorized deck media delivery`.

**DoD:** A funciona en host real con reproducción, seek y revocación correctos; reinicio y unload no dejan workers activos.

### V05 — Asistente con el ranking de Crate

**Dependencias:** V03 y SM06. **Estado:** carpeta Compatibles conectada; mapper de perfiles sin usar.

**Modificar:** `tools/vdj-plugin/src/client/smart_mix_client.cpp`, `tools/vdj-plugin/src/mapping/{mix_profile,compatible_tracks}.cpp`, `tools/vdj-plugin/src/online_source/compatible_tracks.cpp`.
**Crear:** `tools/vdj-plugin/tests/online_source/smart_mix_presentation_test.cpp`.

1. RED: BPM y key de Crate en los campos del SDK; Camelot, energía y confianza en `comment` con formato fijo y localizado; perfil ausente no rompe la pista; versión de perfil incompatible desactiva la presentación; orden igual al del servidor; semilla del menú contextual frente a pista cargada.
2. GREEN: conectar el cliente de perfiles a la presentación; "Abrir en Crate" desde el menú contextual. El plugin no consume `TransitionPlan`.
3. `ctest --test-dir build/vdj-headless -R 'smart_mix|compatible' --output-on-failure`. En host: compatibles desde la pista cargada con dos y cuatro decks.
4. Commit `feat(vdj): present Crate compatibility in VirtualDJ`.

**DoD:** B es visible en el plugin real y no contradice el análisis propio de VDJ.

### V06 — Crate Automix y play events

**Dependencias:** V05, P03 y VH01 (comprobaciones 6, 7 y 8). **Estado:** solo los comandos fijos del spike para el deck 1.

**Crear:** `tools/vdj-plugin/src/automix/{deck_poller,automix_feeder,play_event_reporter}.cpp`, `tools/vdj-plugin/include/crate_vdj/automix.hpp`, `tools/vdj-plugin/tests/automix/{deck_poller,automix_feeder,play_event_reporter}_test.cpp`.

1. RED: polling acotado de `get_filepath`, `is_audible` y `get_time` por deck con valores desconocidos o parciales; identificación de pistas Crate por `netsearch://plugin-Crate/<uid>`; dos y cuatro decks.
2. GREEN: un único worker serializa las llamadas VDJScript, por el mecanismo que valide VH01.
3. RED/GREEN: el feeder mantiene 2 pistas de antelación en la cola de automix con los verbos validados, las sustituye si cambia la pista que suena, comprueba capabilities, flag y scope antes de cada adición y deja de añadir al desactivarse. Nunca envía comandos de crossfader, tempo, EQ ni play.
4. RED/GREEN: play events al endpoint existente con `client_event_id` estable, umbral audible y spool acotado sin credenciales.
5. Host: automix con pistas Crate durante una sesión de al menos una hora, intervención manual, flag apagado a mitad y pérdida de red.
6. Commits por partes hasta `feat(vdj): feed VirtualDJ automix from Crate`.

**DoD:** Crate Automix alimenta la cola nativa sin comandos de mezcla, se detiene limpiamente y registra play events una sola vez.

### V07 — Radio y presencia (backlog)

Entra con P06 cuando se decida en §1.1: radio de Crate como fuente del feeder de V06 y presencia now-playing. Los cues privados quedan retirados para VDJ. Referencia: diseño §6.8.

### V08 — Caché de audio cifrada y prefetch (backlog)

Solo si VH01 confirma que `GetStreamUrl` acepta rutas locales. Referencia: diseño §2.4 y §6.8.

### V09 — Filtros DJ, medición y verificación continua

**Dependencias:** P04 y V01–V06; la CI puede empezar tras V01.

**Modificar:** `.github/workflows/test-backend.yml`, `Makefile`, `tools/vdj-plugin/CMakeLists.txt`, cliente de búsqueda.
**Crear:** `tools/vdj-plugin/src/client/search_syntax.cpp`, `tools/vdj-plugin/tests/client/search_syntax_test.cpp`, `.github/workflows/vdj-plugin.yml` y harness de medición bajo `tools/vdj-plugin/tests/performance/`.

1. RED/GREEN: el plugin pasa la sintaxis de filtros de P04 sin reinterpretarla y muestra errores de sintaxis como resultado vacío con mensaje.
2. Jobs de PR: headless Linux/macOS, sanitizer, Release, dependencias/licencias/secretos sin SDK privado; `make vdj-test` y `make vdj-build`; build Windows del core sin firma.
3. Medir p50/p95/p99 de search, carpetas, compatibles y autorización de stream contra FastAPI con dataset de 48K pistas. Readplane solo si falla el SLO registrado.

**DoD:** CI reproducible cubre el código nativo real; filtros sin regresión de Listen; rendimiento medido.

### V10 — Paquetes y cierre de gates host

**Dependencias:** V01–V06 y X03.

**Crear:** `tools/vdj-plugin/packaging/manifest.json`, scripts bajo `tools/vdj-plugin/packaging/`, `.github/workflows/vdj-plugin-release.yml`.
**Modificar:** `tools/vdj-plugin/CMakeLists.txt`, `tools/vdj-plugin/README.md`, `Makefile`.

1. Manifest con SemVer del plugin, contratos Crate mínimo y máximo probados, versiones de VDJ probadas y requisito de licencia Pro.
2. Bundle macOS arm64 y x86_64 (o universal) instalado en `PluginsMacArm/OnlineSources` o `Plugins64/OnlineSources` según arquitectura, y DLL Windows x64 en `Plugins64/OnlineSources`. Excluir spike, probe, headers SDK y credenciales. Checksums, SBOM e inventario de licencias.
3. Firma: macOS necesita Developer ID y notarización para distribuirse fuera de la máquina de desarrollo; hoy no hay secretos de firma de Apple. Hasta tenerlos, el paquete macOS es solo para pruebas internas y se documenta así. Windows: firma Authenticode si hay certificado; si no, se documenta.
4. `make vdj-package`; verificar exports, metadata, carpeta de instalación y carga en host de cada paquete.
5. Consumir la evidencia de X03 y repetir sobre los paquetes: instalación, actualización, credenciales, media y Crate Automix.

**DoD:** paquetes instalables por plataforma con requisitos documentados (Pro, arquitectura, firma); A, B y Crate Automix verificados en host real.

## 7. Integración, aceptación y operación — X01 a X04

### X01 — Contratos integrados, privacidad y QoE

**Depende de:** SM06/SM07, P01–P06; integración por adapter cuando A/V correspondientes estén listos. **Modificar:** fixtures y tests de schemas/planner, `app/crate/metrics.py`, telemetría Android/VDJ y contratos de federation existentes. **Ampliar:** golden corpus cross-language bajo `app/tests/fixtures/smart_mix/`, reutilizado por Rust/Java/C++ sin copiar valores divergentes.

1. RED/GREEN de recorrido: análisis fuenteA→profile revision→plan autorizado→Android/VDJ validators→ejecución; cambiar fuente/cue/queue/usuario revoca la validez del mismo artefacto. Incluir consumidor v1 y desconocido.
2. Testear summaries opcionales federados y su ausencia en nodos antiguos; no grids/cues privados/paths/tickets. Perfil remoto parcial sirve para adaptive seguro en Listen donde ya se permite media remota; VDJ sigue local. No crear nuevos endpoints desde nombres de roadmaps antiguos.
3. Instrumentar tiempos de analysis/planning/cache/preload/readiness, fallback reasons, phase, underrun, cancellation y play events. Labels limitados a modo/resultado/versión acotada; IDs solo en trazas saneadas bajo política de retención, no en series métricas.
4. Verificar fallos de Redis/telemetría no bloquean playback y datos obsoletos no falsean cobertura. Agregar métricas a superficies Admin existentes; no construir otro dashboard antes de demostrar necesidad.

**Checks:** suites SM/P relevantes, Go summary, Rust golden, Vitest/Gradle/CTest validators y `node scripts/check-docs.mjs`. **DoD:** significado idéntico entre consumidores, eventos auditables y observabilidad útil sin fuga/cardinalidad ilimitada.

### X02 — CI de comportamiento y topologías reales

**Depende de:** P03–P05, V01/V09, X01; ampliar conforme se entregan A/V. **Modificar:** `.github/workflows/test-backend.yml`, workflow VDJ de V09, workflows Android/frontend existentes y scripts de smoke/integration; `Makefile` cuando falten targets reproducibles.

1. Asegurar jobs obligatorios de PostgreSQL, Rust parity real, Go, Vitest, Java unit y CMake/CTest normal/Release/ASan-UBSan. SDK y firma solo en jobs privados; headless público no exige headers propietarios.
2. Levantar topologías dev/home/prod mediante fixtures/config saneadas. Hacer requests PAT reales por proxy a search/profile/catalog/tickets/stream: no basta comprobar que una etiqueta YAML contiene un substring. JWT/session conserva ruta y scopes existentes.
3. Añadir races de publicación/claim, token rotate/revoke concurrente, media HEAD/Range trasTTL, cancellation real libcurl/SDKfake y contrato de body limits. Test nuevo descubierto y ejecutado en CI; un archivo sin target no cuenta.
4. Ejecutar tests de documentación/portal y link integrity. Path filters incluyen nuevos C++/contratos/proxy/manifest; las pruebas relevantes no se omiten por cambiar solo compose o fixture compartida.

**DoD:** fallos conocidos tienen regresión ejecutada automáticamente y el flujo PAT por proxy está probado; las suites físicas/manuales siguen separadas y explícitas.

### X03 — Matriz física/host y ensayo de rollback

**Depende de:** A01–A08, V01–V09, P/SM completos, X01–X02. **Archivos:** este plan y manifests/resultados bajo `artifacts/smart-mix/` o almacenamiento de CI; no nueva guía de aceptación.

1. Ejecutar la matriz siguiente en builds equivalentes a release. Identificar modelo, OS/build, arquitectura, Media3/VirtualDJ, Crate/plugin/analyzer/planner, dataset, perfiles current, red/ruta, knobs y flag values.
2. Android: al menos 20 transiciones por caso funcional y ≥1000 transiciones para la tasa agregada por configuración que se pretenda certificar. Informar `fallos/N` y límite superior Wilson95%; exigir límite superior <0.5%, aumentando muestra si es necesario. No deducir una tasa de20 casos. Memoria compara p95RSS estable y máximo tras warmup contra single deck; ambas≤1.5× bajo mismo escenario y sin crecimiento sostenido.
3. Fase: ≥200 transiciones beatmatch por configuración certificada, múltiples pares/tempos/drift; reportar p50/p95/max e intervalo de incertidumbre. p95≤20ms sobre audio válido, true peak≤−1dBTP y cero clipped samples. Una captura inválida repite el escenario, no se cuenta como éxito.
4. VirtualDJ: Windowsx64, macIntel y macarm64; versión mínima/máxima soportadas que se fijan en manifest antes de probar;2/4 decks, búsqueda/folders/media/seek trasTTL, reconexión, authrotate/revoke, user/origin switch, caché, cues/radio, takeover en cada fase y unload/restart. Soak4h por plataforma soportada; medir cola de workers y memoria estable.
5. Para Crate Automix, registrar que el plugin no envía comandos de mezcla, que la cola mantiene la antelación configurada con 2 y 4 decks, y cuánto tarda en dejar de añadir pistas tras apagar el flag o revocar el token.
6. Ensayar disable independiente C/VDJ/beatmatch/adaptive y rollback a binarios compatibles. Nuevo trabajo se cancela/deniega; audio audible y controles manuales se mantienen. Probar recuperación/rearme consciente y no degradar DB automáticamente.

**DoD:** toda celda anunciada soportada tiene evidencia real con resultado; fallo en una plataforma/modo no se oculta agregando éxitos de otra. Los gates inviables se registran pendientes y elevan una decisión concreta en los mismos documentos.

### Matriz mínima de escenarios

| Superficie   | Casos obligatorios                                                                                                                                                             |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Audio        | Mono/estéreo contrafase/correlacionado, silencio/intro corto/outro corto, variable tempo,44.1/48/96k, MP3/AAC/FLAC soportados, tracks largos                                   |
| Android      | Referencia Pixel y Xiaomi13/equivalente; altavoz, auriculares cable/USB, Bluetooth y coche/AndroidAuto; focus/duck/calls; foreground/background/lockscreen/Doze/process death  |
| Red/media    | Local descargado, stream autenticado, lento/offline, timeout de plan, ticket expirado en seek/range, token/session renovado/revocado, source file reemplazada                  |
| Cola/usuario | Álbum gapless, shuffle/radio/playlist, repeat-one, next/seek/pause en cada fase, cambio de cola/cues/origen/cuenta, opt-out persistente                                        |
| VDJ          | Licencia Pro; 2 y 4 decks; deck con pista no Crate; búsqueda cancelada y sustituida; unload/restart; Crate Automix con intervención manual y flag apagado; revocación de token |

### X04 — Rollout progresivo y cierre único

**Depende de:** X03 y V10; no bloquea la creación previa de paquetes piloto. **Modificar:** este plan, flags/capabilities/config existentes y releases independientes. No desplegar producción como efecto lateral de ejecutar un test.

1. Desplegar migraciones aditivas/capabilities con flags apagados. Canary de análisis pequeño, pause/resume verificados; crecer bajo resource governor. Cobertura completa no bloquea reproducción: legacy/partial sigue fallback. No lanzar reanálisis 48K de golpe para probar el pipeline.
2. Activar cuentas internas; Android adaptive y VDJ A/B opt-in primero. Beatmatch/bass/C solo en configuraciones aprobadas con toggles separados. Plugin tiene tag/manifests propios compatibles con stack; no exige publicar la misma versión numérica.
3. Ampliar 5%→25%→100% con al menos 7 días y 1000 transiciones observables sin gates incumplidos en cada etapa relevante. Si la base instalada no permite ese volumen, mantener beta o acordar explícitamente otro criterio documentado; el paso del tiempo no sustituye datos ausentes.
4. Ante regresión, apagar modo afectado y conservar manual/gapless. Desactivar VDJ completo solo si A también falla. Revertir binarios compatibles; no borrar perfiles ni hacer downgrade automático de090/091/colas. Registrar causa y nueva aceptación antes de rearme.
5. Auditar §8 y matriz de alcance: todas SM/P/A/V/X completadas con evidencia, extensiones incluidas, SDK no empaquetado, permisos/firmas/rollback correctos, docs/manifest/portal coherentes y guías antiguas sustituidas. Solo entonces declarar completa la feature.

**DoD:** entrega conjunta comprobada, versiones compatibles, rollout observado y ningún pendiente disfrazado de opción deshabilitada.

## 8. Registro de ejecución y decisiones

Actualizar estas tablas en cada checkpoint; no crear otro plan de seguimiento. Los resultados iniciales pertenecen a la revisión del 2026-09-09 y no sustituyen la ejecución de tareas futuras.

| Evidencia inicial                                 | Resultado                            | Límite                               |
| ------------------------------------------------- | ------------------------------------ | ------------------------------------ |
| Python core focalizado                            | 113 pass /16 skipped,11.02s          | PG omitido en esa ejecución          |
| Plataforma PAT/media/capabilities/migraciones     | 60 pass,12.98s, PG efímero exclusivo | No host ni proxy end-to-end completo |
| C++ headless macarm64                             | 14/14 CTests                         | No SDKhost ni Windows/Intel          |
| Sanitizers C++                                    | Fallo de link confirmado             | R11 pendiente                        |
| Rust/Vitest completos/Gradle/dispositivos/VDJsoak | No ejecutados en revisión            | Evidencia pendiente                  |

Evidencia 2026-10-08, rama antes de integrar main (el resultado posterior al merge se registra en el commit de merge):

| Evidencia                                          | Resultado                                    | Límite                                     |
| -------------------------------------------------- | -------------------------------------------- | ------------------------------------------ |
| Python Smart Mix, capabilities, routing, migración | 156 pass / 1 skip (paridad Rust sin binario) | PostgreSQL vía Testcontainers              |
| Python PAT/media/catálogo VDJ                      | 45 pass                                      | Sin proxy end-to-end                       |
| Rust `--features analysis`                         | 43 pass                                      |                                            |
| Go readplane                                       | `go test ./...` OK                           |                                            |
| Vitest Listen/Admin Smart Mix                      | 61/61 y 2/2                                  |                                            |
| C++ headless / con SDK local                       | 14/14 y 16/16 CTests                         | Sanitizers no enlazan; Release sin asserts |

| Paquete     | Estado inicial | Commit / comandos / artefactos / siguiente bloqueo                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C00/P01–P06 | En curso       | P01 (`572f06b9`). P02: allowlist por método, scope de play events, búsqueda PAT local, sin `path` en catálogo ni en búsqueda con token, auth sin `FOR UPDATE` (`770ced11`, `0ecf37f9`, `55296480`, `7d5fa812`); identidad mínima en `/api/auth/me` con token (`20c9289a`); UI de tokens en Listen con Crate Automix opt-in (`13a86be4`, `53b1e858`). P03: router Traefik para `Bearer crv_` hacia FastAPI en prod/home con prioridad 150, gate `CRATE_VDJ_ENABLED` y estado de automatización por token en capabilities (`20c9289a`, `f3204e51`). P04: carpetas de un nivel con partes de 500, sintaxis de filtros DJ, migración 108 de índices de mood, sin seq scan en `library_tracks` (`1f774d15`). P05: tickets de token de 15 min, HEAD en stream VDJ, `entity_uid` en playback (`162c1c9f`). Pendiente: validación del payload de playback en el plugin (V04), P06 en backlog                                                                                |
| SM01–SM07   | En curso       | SM03 (`f47ee91e`) y planner v2 (`7841daed`). SM01: migración 106 con duración del decoder y procedencia de medición (`580f4ad8`). SM02: BS.1770 con `ebur128` en Rust en streaming, Python publica `null`, analyzer `smart-mix-audio-v2` (`63b43a6b`), memoria acotada en pistas largas (`00bd7749`). SM04: captura previa, CAS y tokens de claim (`787a619a`). SM05: generación objetivo (migración 107), campaña con pausa/cancelación y cobertura precalculada sin COUNT en request (`0a45449a`); backfill con analizador Rust y protección ante despliegues escalonados (`51faf79e`). SM06 (parte R1): elegibilidad antes del límite con ventana de perfiles ×2 sin escanear `library_tracks` (`d440c95b`), caché de planes en un MGET y un pipeline por batch sin PostgreSQL ni `DELETE LIKE`, sin decodificar grids (`f7387031`). Pendiente: invalidación desde writers de audio, canary interrumpido/reanudado, resto de SM06 (federación en backlog) y SM07 |
| A01–A08     | En curso       | A01 (`53d28608`, `beebff6a`), A02 (`c0cf2bb2`), A03 con R27 (`e08714d4`). A04: `executionId` y dueño único del handoff y avance, matriz de interrupciones antes y después del handoff, errores de deck resueltos una vez sin doble recuperación en JS, un play event por pista audible, checkpoint a mitad de fade sin revivir la transición (`04cdc2e9`, `1dd0986b`). A05: Settings de Smart Mix en Android nativo con opt-out persistente y beatmatch/bass ocultos (`000d5b90`); recargas nativas conservan la duración (`787af8db`). Gradle 98/98, Vitest de contextos 377/377. Android no aplica ganancia positiva (staging ≤0 dB). Pendiente: validación física A06 y A07–A08                                                                                                                                                                                                                                                                                  |
| V01–V10     | Pendiente      | Core/spike WIP;14CTests no acreditan host                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| X01–X04     | Pendiente      | Sin aceptación/release conjunta                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

Al iniciar una tarea se expande su fila individual: `pendiente → en curso → verificado` o `bloqueado` con causa concreta y próximo paso. Anotar qué gates faltan, no porcentajes subjetivos de progreso.

| Fecha      | Decisión vigente                                                                                  | Consecuencia                                                         |
| ---------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 2026-09-09 | Un solo diseño y un solo plan para Smart Mix+Android+VDJ                                          | Sustituyen planes/spikes anteriores; sin tercera guía por plataforma |
| 2026-09-09 | Mantener WIP y contratos compartidos;API 2026-09/analyzer v2/planner lote string v2/plan entero 2 | P01 congela fixtures, SM01 migra aditivamente                        |
| 2026-09-09 | Dos decks Android primero; busPCM solo por gate físico fallido                                    | A06/A07 deciden con captura, no por preferencia arquitectónica       |
| 2026-09-09 | VDJ A+B y C en dos binarios sin daemon/IPC                                                        | Negociación y estado independientes; SDKhost es gate                 |
| 2026-09-09 | Todos los entregables anteriores conservados; hitos incrementales                                 | Apagar una opción no cierra trabajo faltante                         |
| 2026-10-08 | Releases R1–R4 cerrables por separado y backlog explícito                                         | Ningún entregable bloquea a otra release                             |
| 2026-10-08 | VDJ se ajusta al SDK de 2021: un nivel de carpetas, sin cursores, ticket en URL, covers públicos  | P04, P05, V03 y V04 reescritos; VH01 cierra lo no documentado        |
| 2026-10-08 | C pasa a Crate Automix sobre el automix nativo de VDJ; sin lease ni ejecutor propio               | P03 sin lease; V06 reescrito; cues privados retirados para VDJ       |
| 2026-10-08 | Un solo binario Online Source con nombre permanente `Crate`; requisito de licencia Pro            | V02 y V10; segundo binario solo si VH01 lo exige                     |

Una revisión que cambie una decisión debe indicar motivo, evidencia, impacto en contratos/capabilities/migración y tareas afectadas. Toda guía antigua permanece histórica incluso si sus checkboxes dicen completa.

### Validación documental de esta revisión

El 2026-09-09 se verificaron los dos documentos y su publicación en el portal: `node scripts/check-docs.mjs` pasó con 37 documentos canónicos; desde `app/docs`, `npm test -- src/smoke.test.tsx` pasó 7/7 incluyendo ambos deep links y sus enlaces recíprocos, y `npm run build` completó TypeScript/Vite. Se usaron temporalmente las dependencias ya instaladas del checkout principal, sin cambiar lockfiles. Esta evidencia valida la documentación y sus loaders; no acredita ejecución de los paquetes funcionales del plan.

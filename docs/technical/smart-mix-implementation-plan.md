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

**Objetivo:** terminar Smart Mix, crossfade Android nativo y el plugin VirtualDJ A+B+C, incluidas sus extensiones y distribución, conservando el WIP útil.

**Arquitectura:** backend común de análisis, perfiles, ranking y planes; Android y VirtualDJ son executors con validación propia. PostgreSQL/Redis, workers existentes y media/auth compartidos mantienen sus responsabilidades. No se añade daemon local ni se replica el algoritmo en clientes.

**Stack:** Python/FastAPI/Pydantic/SQLAlchemy/Alembic, Rust `crate-cli`, Go readplane, React/TypeScript/Vitest, Java/Media3/Gradle y C++20/CMake/CTest/SDK privado VirtualDJ.

**Baseline:** 2026-09-09, `codex/feat-smart-mix-phase-1`, HEAD `140f9e347976eec0d27cb71919afd6f71bee4e86` **más working tree**. Este es un plan pendiente de ejecución; ninguna tarea futura está marcada completa por haber escrito el documento. Las rutas de código son relativas a la raíz del worktree. `Crear` identifica archivos propuestos, no existentes.

## 1. Cómo continuar sin perder el WIP

Trabajar en `worktrees/smart-mix-phase-1` o en una copia explícita que incluya sus cambios sin commit. No basta hacer checkout de HEAD: PAT, catálogo, migración 091 y todo `tools/vdj-plugin/` estaban sin seguir. No usar `git reset --hard`, `git clean`, checkout de archivos ni `git add .` para preparar la tarea.

Cada paquete se descompone en las regresiones/contratos enumerados: RED que falla por la causa esperada, cambio mínimo, GREEN, revisión del diff y commit convencional acotado cuando corresponda. Los pasos son checkpoints separados, no una instrucción de escribir todos los tests y toda la feature antes de verificar. No se repiten refactors ya terminados para satisfacer numeración histórica.

Una suite omitida, un build no ejecutado o un gate de host pendiente se registra como tal. Para marcar `hecho` se adjuntan commit(s), comandos/resultados, entorno y evidencia requerida. Un cambio de contrato actualiza ambos documentos y fixtures en el mismo cambio; no reabre diseño tácitamente desde un adapter.

### 1.1 Orden y dependencias

| Hito                      | Paquetes                                                     | Resultado verificable                                                      |
| ------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------- |
| M0 — Baseline y contrato  | C00 → P01                                                    | WIP preservado, versiones/scopes/gates congelados, reproducciones trazadas |
| M1 — Fundamentos seguros  | SM01–SM06, P02–P05; V01–V04 y A01–A05 en paralelo según deps | Perfiles/planes seguros; Android adaptive integrado; fuente A real         |
| M2 — Calidad y asistencia | SM07, A06–A07, V05, P06                                      | Evidencia musical/física; B completo; extensiones servidor                 |
| M3 — Ejecución completa   | A08, V06–V09, X01–X02                                        | Beat-aware/bass certificados, C y extensiones completas, CI y regresión    |
| M4 — Release conjunta     | X03, V10, X04                                                | Matrices reales, paquetes firmados, rollout y cierre auditado              |

Dependencias no implícitas: P01 precede a todas las modificaciones de contrato/migración. P02/P03 pueden avanzar junto con SM02–SM05. A01 puede corregir red usando fixtures tras P01; integración Android final requiere SM06. V01 usa P01; V02 usa P02/P03; V03 usa P04; V04 usa P05; V05 usa SM05/SM06; V06 usa V05/P03; V07 usa P06; V08 usa V04/V05; V09 integra resultados; V10 usa X03; X04 usa V10. P06 resuelve cues persistidos usando interfaces/fixtures que SM03/SM06 entregaron antes: no hay dependencia circular.

Los paquetes P02–P05 entregan primero contratos e implementación backend verificados con integración automatizada. El estado `backend-listo` desbloquea V02/V03/V04/V06 aunque el gate host conjunto esté pendiente. El estado posterior `integrado-en-host` se registra en la tarea V correspondiente y X03: no se exige cerrarla para empezar el consumidor. V04 resuelve la entrega por carga, incluida una materialización privada acotada si el SDK no renueva tickets; V08 añade retención/offline/prefetch. Ninguna carga básica depende de completar C.

**Propiedad de cambios compartidos:** P04 implementa SQL/API de catálogo y filtros, V03/V09 sus consumidores. P05 implementa tickets/media, V04/V08 la integración host. P06 implementa cues/radio/presencia/events, V07 el cliente. SM06 implementa planner/cache/summary y P06 conecta cues privados reales. P01 asigna la cadena de migraciones; ningún agente reserva un número por adelantado. X02 une CI; V09 mantiene el job nativo y X02 no crea otro pipeline equivalente.

### 1.2 Trazabilidad de hallazgos

| ID  | Hallazgo reproducido o carencia comprobada                                     | Paquetes que lo cierran   |
| --- | ------------------------------------------------------------------------------ | ------------------------- |
| R01 | Cue176s + fade12s sobre track180s genera transición fuera de pista             | SM03, A02                 |
| R02 | Downmix oculta peak estéreo; RMS publicado como LUFS                           | SM01–SM02, A03            |
| R03 | Idempotencia impide partial Python → full Rust                                 | SM04                      |
| R04 | Fuente se revisa después de analizar; done antiguo excluido de backfill nuevo  | SM04–SM05                 |
| R05 | Planning bloquea startup, también hace red en offline y no tiene deadline      | A01                       |
| R06 | Standby ready antes de seek, trigger global tardío, envelope por ticks de main | A02–A03                   |
| R07 | Capabilities sin integrar y contrato desconocido no vacío aceptado             | P01, V01–V02              |
| R08 | PAT catalog-only permite escribir play-events                                  | P02, P06                  |
| R09 | Proxy prod/home envía PAT opaco a verificador JWT Go                           | P03, X02                  |
| R10 | Caché devuelve éxito ante401/403/cancel; callbacks obsoletos sobreviven        | V01–V03                   |
| R11 | Parsers JSON manuales, Unicode/body sin cubrir; sanitizer no enlaza            | V01, V09                  |
| R12 | Catálogo plano/truncado, géneros normalizados excluidos, covers relativos      | P04, V03–V04              |
| R13 | C solo spike; faltan estados/takeover/lease, B no presenta todo                | P03, V05–V06              |
| R14 | Sin matriz física/host, settings completos, packaging/soak                     | A04–A08, V07–V10, X01–X04 |

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

**Responsabilidad entre paquetes:** P04 es dueño del backend de filtros y cursores; P06 es dueño del backend de cues/radio/eventos/presencia. V07 implementa sus clientes nativos; V09 implementa el cliente de filtros y la integración CI/bench correspondiente. Los contratos y fixtures se comparten, pero estas responsabilidades no se duplican en dos tareas.

### P01 — Fijar contratos integrados, linaje de migraciones y manifiesto de evidencia

**Depende de:** C00 y diseño integrado canónico; puede empezar sin disponer del SDK nativo.

**Archivos:** modificar `app/crate/api/schemas/capabilities.py`, `app/crate/api/capabilities.py`, `app/crate/api/schemas/smart_mix.py`, `app/tests/test_vdj_contract_baseline.py`, `app/tests/test_smart_mix_openapi.py`, `app/tests/test_federation_migration_matrix.py`; revisar `app/crate/db/migrations/versions/090_smart_mix_profiles.py` y el WIP `091_user_access_tokens.py`. Actualizar únicamente el diseño/plan canónicos y el manifiesto de compatibilidad utilizado por la release del paquete nativo.

1. Registrar rama, HEAD real e inventario del working tree; utilizar `docs/technical/smart-mix-design.md` y el `smart-mix-implementation-plan.md` canónico como únicas fuentes activas de diseño/plan. Baseline revisado: `140f9e34`; main local tenía revisión 089, el worktree comiteado 090 y el WIP añade 091. Volver a ejecutar `alembic heads` al implementar: estos números son observaciones, no reservas de migraciones futuras.
2. Fijar en fixtures compartidas con los clientes nativos el contrato `2026-09` de rutas/scopes/identidad, adiciones de schema `1`, grid `delta-ms-v1`, analyzer/implementación `smart-mix-audio-v2` y planner de lote `smart-mix-v2`/plan y score entero `2`, conservando los tipos wire actuales, junto con compatibilidad de versiones, campos aditivos, errores y flags por defecto. Incluir payloads anteriores de Listen/Android y contratos mínimo/máximo soportados del plugin.
3. Antes de añadir schema de cues/búsqueda, volver a comprobar head de migraciones e historial de releases. Asignar entonces la siguiente revisión disponible; no fijar 092/093 de antemano. Renumerar sólo una cola conflictiva comprobada como no publicada/no aplicada, actualizando down-revision y tests conjuntamente. No crear branch heads de conveniencia ni reescribir historia desplegada.
4. Probar instalación limpia, cadena soportada de upgrades incluido 090→091, repetición donde se soporte y actualización desde la fixture del schema de producción. Verificar supervivencia de usuarios/biblioteca/sesiones. Definir rollback mediante binarios/flags compatibles; un downgrade destructivo será una operación explícita de recuperación, no comportamiento automático del despliegue.
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

**Depende de:** P01, P02; la finalización de automatización también depende del executor nativo.

**Archivos:** modificar `app/crate/config.py`, `app/crate/api/auth.py`, `app/crate/api/capabilities.py`, rutas VDJ protegidas, `docker-compose.yaml`, `docker-compose.home.yaml`, `docker-compose.dev.yaml`, `data/caddy/Caddyfile.readplane.dev`, `app/tests/test_readplane_catalog_routing.py`, `app/tests/test_vdj_capabilities.py`; crear `app/crate/api/dj.py` y `app/crate/api/schemas/dj.py` para la lease, `app/tests/test_vdj_feature_gates.py` y `app/tests/test_vdj_proxy_contract.py`. Tocar auth/rutas Go sólo si la decisión medida del readplane exige paridad posteriormente.

1. Añadir bypass PAT y routing de aliases tickets/media antes del readplane en las tres formas de despliegue. Probar PAT opacos válidos/inválidos, JWT, cookies de sesión, artwork sin autenticación, tickets de ruta exacta, HEAD y Range. Cubrir search/profile/auth-me canónicos y la política configurada de disponibilidad de FastAPI/readplane.
2. Ejecutar peticiones reales al proxy contra fixtures aisladas de FastAPI/readplane. Mantener las aserciones de configuración como comprobaciones económicas, pero no tratarlas como prueba de routing/autorización. Distinguir credenciales inválidas de backend no disponible.
3. Aplicar flags VDJ/asistente en operaciones del servidor, conservando identidad normal de Listen/Android y reproducción ajena a VDJ. Aplicar el flag independiente a autorización de automatización; probar combinaciones de flags/scopes y clientes que conservan caché, además del resultado de `/capabilities`.
4. Implementar `GET /api/vdj/automation-lease`, scope `vdj.automation.execute`, TTL de 15 segundos y refresco de cliente cada 5 segundos, compartido con el executor nativo. Responder `Cache-Control: no-store`, sin persistencia/stale fallback; una lease ID reutilizada conserva deadline original y no renueva autorización. Verificar replay, expiración, armado y comprobación previa a cada comando con reloj simulado; medir el límite real de observación/cancelación en la matriz manual. Nunca hacer red en callback de audio. Probar apagado del flag, revocación, fallo de refresco y expiración en cada fase activa; permitir diagnóstico/revocación de tokens para recuperación, prohibir nuevos comandos automáticos y ceder a manual sin stop/reset brusco.
5. Medir p50/p95/p99 de FastAPI para search, resumen de perfil, contexto compatible, batch de planes y autorización de stream con tamaño de catálogo y concurrencia representativos. Si cumple los SLO existentes, registrar FastAPI como ruta soportada VDJ. Si no, implementar paridad Go con las mismas fixtures antes de cambiar routing; no reescribir el readplane incondicionalmente. Compartir evidencia con V09, responsable de integración cliente/CI/bench.

**Verificaciones (desde `app/`, servicios aislados):** `python -m pytest -q tests/test_readplane_catalog_routing.py tests/test_vdj_proxy_contract.py tests/test_vdj_feature_gates.py tests/test_vdj_capabilities.py`; si cambia routing/auth Go, desde `app/readplane/`, `go test ./internal/auth ./internal/routes ./internal/catalog ./internal/contract`. Registrar escenarios reales de cambio de flag en la evidencia del executor nativo.

**Terminado cuando:** prod/home/dev aceptan las mismas clases válidas de credenciales y rechazan las mismas inválidas; deshabilitar VDJ/automatización tiene comportamiento aplicable en servidor y cliente conectado, con límite de latencia y limitación offline documentados.

### P04 — Completar jerarquía local de catálogo y backend de búsqueda DJ

**Depende de:** P01, P02. Puede ejecutarse en paralelo a P03. P04 es el único dueño backend de filtros/cursores; V09 consume el contrato y cubre cliente/CI/bench.

**Archivos:** modificar WIP `app/crate/api/vdj_catalog.py`, `app/crate/api/schemas/vdj_catalog.py`, `app/crate/db/queries/vdj_catalog.py`, `app/crate/api/browse_media.py`, `app/crate/api/schemas/media.py`, `app/crate/db/queries/browse_media_search.py`, `app/tests/test_vdj_catalog.py`, `app/tests/test_browse_queries.py`, `app/tests/test_browse_schemas.py`; crear `app/tests/test_vdj_search_filters.py`, `app/tests/test_vdj_search_pagination.py`, `app/tests/test_vdj_catalog_queries.py`. Añadir índices justificados por mediciones en `app/crate/db/migrations/versions/` sólo cuando P01 asigne revisión real. Coordinar `tools/vdj-plugin/src/client/catalog_client.cpp` y `search_client.cpp` con el paquete nativo.

1. Sustituir listas planas de pistas por carpetas jerárquicas, preservando orden de playlists, identidad de entidades, propiedad/membresía y disponibilidad local. Definir respuestas acotadas para carpetas vacías/eliminadas y metadata/artwork ausentes.
2. Unificar selección y filtrado de género para que las pistas clasificadas únicamente mediante `album_genres` sigan apareciendo. Probar SQL real con datos aislados para géneros raw, heredados, normalizados y ausentes; cubrir moods y referencias por entidad de recently-played.
3. Implementar cursores ligados a carpeta/query/filtros/orden/contexto de visibilidad, desempates deterministas y política documentada para cambios de catálogo. Probar múltiples páginas, cambios concurrentes, cursores de playlists no autorizadas, reutilización entre carpetas, manipulación, longitud/offset excesivos y versiones desconocidas. Reemplazar el OFFSET base64 ilimitado actual, no cambiar únicamente su codificación.
4. Añadir los filtros DJ aceptados y proyección `fields=dj` al contrato existente de búsqueda con páginas acotadas. Exigir scope local a los PAT VDJ en servidor. Mantener respuesta/orden legacy cuando no se indiquen opciones DJ y comprobar regresiones de Listen.
5. Ejecutar planes de query/latencia representativos antes de añadir índices. Evitar agregar todo el historial de escucha para carpetas ordinarias; cargar sólo la jerarquía/página solicitada.

**Verificaciones (desde `app/`, PG aislada):** `python -m pytest -q tests/test_vdj_catalog.py tests/test_vdj_catalog_queries.py tests/test_vdj_search_filters.py tests/test_vdj_search_pagination.py tests/test_browse_queries.py tests/test_browse_schemas.py tests/test_catalog_local_browse.py`.

**Terminado cuando:** el plugin permite elegir artista/álbum/playlist/género/mood y recorrer sus pistas locales reales entre páginas; metadata normalizada y visibilidad coinciden con search; el SQL está cubierto por tests con DB y permanece acotado al tamaño realista del catálogo.

### P05 — Demostrar entrega media, refresco, ranges y revocación

**Depende de:** P01, P02, P03; la finalización de carga en deck real depende del paquete nativo de media/caché.

**Archivos:** modificar `app/crate/api/media_access.py`, `app/crate/media_access.py`, `app/crate/api/browse_media.py`, `app/crate/api/browse_album.py`, `app/crate/api/schemas/media.py`, `app/tests/test_media_access_tickets.py`, `app/tests/test_vdj_stream_scope.py`, `app/tests/test_artwork_route_delivery.py`; crear `app/tests/test_vdj_media_contract.py`. Coordinar los existentes `tools/vdj-plugin/src/client/media_access_client.cpp`, `stream_resolver.cpp` y la implementación nativa de caché/prefetch.

1. Probar emisión y uso real del ticket conjuntamente: ruta/audiencia exactas, propietario, expiración, revocación, suspensión, cambio de scope, fallo de almacenamiento, número acotado de targets y ausencia de credenciales en diagnósticos. Confirmar que los tickets de sesión Listen conservan su comportamiento.
2. Alinear payload de resolución, alias media y resolver del plugin en política de entrega, estado preparing, identidad local y origen permitido. Validar headers/status en lugar de aceptar cualquier body no vacío. La API conserva acceso de sólo lectura al filesystem musical; las escrituras de preparación siguen en tareas worker.
3. Servir y verificar GET/HEAD, rangos completos/parciales/sufijos, rangos inválidos, seeking, archivos grandes y transferencias interrumpidas a través del proxy real. Cubrir expiración/revocación antes de la primera petición y entre ranges. Especificar que una respuesta ya autorizada puede terminar; no prometer recuperación de bytes entregados.
4. Implementar un único refresco acotado de ticket justo antes de usarlo mediante el transporte nativo verificado. Probar pause/seek tras TTL, carga lenta y error temporal de red en VirtualDJ real. Si el SDK no permite refrescar, terminar la vía aceptada de carga/caché cifrada acotada con pinning de deck activo y aislamiento cuenta/nodo antes de declarar listo Online Source.
5. Verificar simultáneamente continuidad de la pista cargada y denegación de cargas nuevas sin autorización. Coordinar cancelación de prefetch y ausencia de tickets en cachés/spools persistentes; redactar PAT, tickets y URLs firmadas en todas las rutas de éxito/error.

**Verificaciones (desde `app/`, servicios aislados):** `python -m pytest -q tests/test_media_access_tickets.py tests/test_vdj_stream_scope.py tests/test_vdj_media_contract.py tests/test_artwork_route_delivery.py`. Ejecutar tests nativos de streams/caché y registrar escenarios SDK reales de seek/expiración/revocación/carga offline en la matriz de release.

**Terminado cuando:** una pista autenticada carga y permite seeking con credenciales de vida acotada, las credenciales expiradas/revocadas no autorizan nuevas peticiones y la continuidad del audio ya cargado queda demostrada sin credenciales duraderas en URLs.

**Contrato adicional de P05:** artwork público sin cambio; artwork protegido requiere ampliar audiencia/tipos de ticket PAT actualmente limitados a stream y verificar scope/ruta en emisión y entrega. Añadir tests de audiencia equivocada, path diferente, token revocado y scope ausente. Además, resolver `offlineEligibleUntil` según §2.4 del diseño; probar límites 24h/expiración PAT, revisión de fuente/owner, ausencia de permiso al desactivar caché y falta de media scope. El SDK gate de V04 determina refresh o materialización por carga. V08 reutiliza este contrato para offline y retención, sin emitir otra autorización de larga duración.

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

## 6. VirtualDJ — V01 a V10

Las tareas backend/auth/profile/planner del plan canónico son los únicos propietarios de sus contratos; no se implementa un backend paralelo en estas tareas nativas. P01 fija contratos; P02/P03 cubren auth/lease; P04 catálogo/filtros; P05 media; P06 radio/cues/eventos. SM05/SM06 son la dependencia del contrato funcional de perfiles/planner. Las rutas son relativas al worktree Smart Mix inspeccionado; las nuevas se marcan Crear. Cada paso es un checkpoint RED/GREEN/refactor; los resultados se registran en la tabla de evidencia del plan canónico. No se crean nuevos documentos de diseño/plan por fase.

Comandos comunes de verificación nativa, al fijar baseline y tras cambios relevantes:

```sh
cmake -S tools/vdj-plugin -B build/vdj-headless -DCRATE_VDJ_BUILD_REAL_PLUGIN=OFF -DCRATE_VDJ_BUILD_TESTS=ON
cmake --build build/vdj-headless --parallel 4
ctest --test-dir build/vdj-headless --output-on-failure
```

Baseline esperado: 14 tests verdes; las tareas aumentarán ese número. Los nuevos targets deben registrarse en CTest. Los tests en Release conservan assertions o usan un framework cuyos checks no desaparezcan con `NDEBUG`. Los builds SDK usan `VIRTUALDJ_SDK_ROOT` privado; headers/samples SDK, credenciales y bundles generados no se incorporan a Git.

### V01 — Core como frontera fiable de producción

**Dependencias:** P01. **Estado:** core existente; correcciones pendientes.

**Modificar:** `tools/vdj-plugin/CMakeLists.txt`, `include/crate_vdj/{http_client,models,contract_negotiator,credential_store}.hpp`, `src/core/{models,search_results,catalog_results,contract_negotiator,credential_store}.cpp`, `src/client/curl_http_client.cpp`, `src/mapping/{mix_profile,compatible_tracks}.cpp` y tests client/auth existentes. Las rutas abreviadas de esta lista están dentro de `tools/vdj-plugin/`.
**Crear:** `tools/vdj-plugin/src/core/json_mapping.cpp`, `tools/vdj-plugin/include/crate_vdj/json_mapping.hpp`, `tools/vdj-plugin/tests/client/json_mapping_test.cpp`, `tools/vdj-plugin/tests/security/redaction_test.cpp`.

1. RED: regresiones de contrato desconocido no vacío, Assistant incompatible con Source válido, escapes Unicode/pares sustitutos, null opcional, límites numéricos, nesting malformado y body excesivo. Reproducir con `ctest --test-dir build/vdj-headless -R 'contract_negotiator|json_mapping|redaction' --output-on-failure` tras configurar/compilar.
2. GREEN: elegir un parser JSON mantenido, fijar versión en CMake/lock de dependencias y sustituir readers duplicados por parsing acotado y validadores tipados. Los fixtures compartidos fijan intencionalmente camelCase/snake_case del wire. Limitar body libcurl antes de append, rechazar origen/redirect/status inesperados y comprobar cancelación antes de petición y antes de entregar resultado.
3. GREEN: declarar y comparar rangos compatibles en requirements, modelar disponibilidad y flags independientes. Generar versión runtime/package desde un valor. Corregir categorías de error y redacción central sin emitir responses crudos ni URLs firmadas.
4. RED/GREEN: reproducir el enlace fallido de sanitizers en build separado y propagar flags de link a ejecutables/modules consumidores; instrumentar adaptadores/tests. Ejecutar `cmake -S tools/vdj-plugin -B build/vdj-sanitizers -DCRATE_VDJ_BUILD_TESTS=ON -DCRATE_VDJ_ENABLE_SANITIZERS=ON`, compilar y ejecutar su CTest. Esperado: enlace correcto y sin hallazgos ASan/UBSan. Añadir comprobación Release que demuestre que un test fallido sigue observándose.
5. Refactorizar interfaces duplicadas sin consumidores solo tras tests verdes; commit `fix(vdj): harden native contracts and test tooling`.

**DoD:** repros conocidos cubiertos y verdes; límites de parser/transporte fijados en código; builds normal/sanitizer correctos; inventario de dependencias/licencias actualizado.

### V02 — Conexión segura de usuarios y ambos binarios

**Dependencias:** V01, P02 y P03. **Estado:** API y stores de plataforma en WIP; handshake/configuración UI pendientes.

**Modificar:** `tools/vdj-plugin/src/auth/credential_store_macos.mm`, `tools/vdj-plugin/src/auth/credential_store_windows.cpp`, `tools/vdj-plugin/include/crate_vdj/core.hpp`, `tools/vdj-plugin/CMakeLists.txt`. P02/P03 son dueños de cambios en `app/crate/api/{access_tokens,capabilities}.py` y schemas; V02 consume sus contratos.
**Crear:** `tools/vdj-plugin/src/client/capability_client.cpp`, `tools/vdj-plugin/src/core/connection_settings.cpp`, `tools/vdj-plugin/include/crate_vdj/connection_settings.hpp`, `tools/vdj-plugin/src/platform/connection_dialog_macos.mm`, `tools/vdj-plugin/src/platform/connection_dialog_windows.cpp`, `tools/vdj-plugin/tests/auth/connection_session_test.cpp`, `tools/vdj-plugin/tests/client/capability_client_test.cpp`.

1. RED: origen, fallo de conexión/verificación, sustitución/rotación, dos usuarios/nodos, lectores concurrentes, handshake caducado sin red, desactivación opcional y ausencia de fallback en texto plano. La suite backend de P02/P03 prueba que un PAT no gestiona tokens ni accede a rutas ajenas.
2. GREEN: diálogo nativo accesible con origen/token/estado; persistir solo settings sin secretos. Normalizar origen, verificar nodo/usuario, guardar token en almacén OS y después habilitar operaciones privadas. Eliminar origen de producción implícito: una instalación no configurada queda desconectada. La CA de desarrollo es explícita y limitada a su origen; TLS sigue verificado.
3. GREEN: implementar sesión/handshake independiente por binario y recarga segura de credenciales. Refresco de capabilities acotado y flags independientes. General consume `/api/vdj/automation-lease` (scope `vdj.automation.execute`, propuesta TTL15s/refresco5s); si caduca, no permite nuevas operaciones, también sin red. P03 implementa endpoint/tests; no crear un mecanismo de permiso paralelo.
4. Ejecutar tests nativos auth/capability y, desde `app`, `pytest -q tests/test_access_token_repository.py tests/test_access_token_api.py tests/test_access_token_auth.py tests/test_vdj_capabilities.py`. Probar conectar/sustituir/desconectar en macOS y Windows; inspeccionar logs/caché con tokens sintéticos.
5. Commit `feat(vdj): connect and negotiate scoped sessions`.

**DoD:** ningún binario depende de globals del otro; configuración sobrevive reinicios; errores auth piden reconexión útil; desactivar B/C mantiene A compatible; no se hacen peticiones de producción sin configurar.

### V03 — Sustituir el spike y completar navegación

**Dependencias:** V01, V02 y P04. **Estado:** callbacks search/catalog/compatible en spike; lifecycle y cobertura completa pendientes.

**Modificar:** `tools/vdj-plugin/CMakeLists.txt`, `tools/vdj-plugin/spike/control_spike.cpp`, `tools/vdj-plugin/src/client/{search_client,catalog_client}.cpp`, `tools/vdj-plugin/src/cache/sqlite_metadata_cache.cpp`, `tools/vdj-plugin/include/crate_vdj/metadata_cache.hpp`. P04 modifica `app/crate/api/vdj_catalog.py`, schemas, queries y tests backend; V03 verifica su consumo.
**Crear:** `tools/vdj-plugin/src/sdk/online_source_plugin.cpp`, `tools/vdj-plugin/src/online_source/online_source.cpp`, `tools/vdj-plugin/include/crate_vdj/online_source.hpp`, `tools/vdj-plugin/src/core/request_coordinator.cpp`, `tools/vdj-plugin/include/crate_vdj/request_coordinator.hpp`, `tools/vdj-plugin/tests/sdk/online_source_lifecycle_test.cpp`, `tools/vdj-plugin/tests/online_source/catalog_pagination_test.cpp`.

1. RED: búsqueda A/B solapada, cancelación entre fin de red y publicación, carpetas lentas, callback tras unload, `finish` único, saturación de cola e instancias independientes. Inyectar HTTP/clock/cache y ejercitar el adaptador real, no otra implementación simplificada.
2. GREEN: extraer factory/adaptador de producción. Implementar pool/coordinador acotados, ownership por generación, publicación y cierre conforme a semánticas SDK probadas. Probe opt-in fuera de packaging; logs/cache fuera de callbacks SDK.
3. RED/GREEN: conectar navegación artistas/álbumes y resultados de búsqueda de estos tipos; mantener playlists/géneros/moods/recently played. Añadir nodos/páginas de continuación para alcanzar >500 pistas sin fetch ilimitado. Consumir rechazo de cursor manipulado o de otro scope, y conservar orden con la política snapshot/cursor de P04.
4. RED/GREEN: stale solo ante fallos transitorios admitidos; 401/403/cancel/version siguen siendo errores. Fake clock que pruebe stale real, no un hit fresh inmediato. Cubrir límites bytes/entradas, corrupción, mismo SQLite abierto por ambos binarios, migración y separación de usuarios/nodos. Llevar el estado stale a presentación.
5. Ejecutar `ctest --test-dir build/vdj-headless -R 'online_source|catalog|search|cache' --output-on-failure` y, desde `app`, `pytest -q tests/test_vdj_catalog.py tests/test_browse_queries.py tests/test_browse_schemas.py`. En host, cambiar rápido consultas/carpetas, cancelar y unload/reload mientras suenan dos decks; medir callbacks.
6. Commits por partes verificadas, finalizando con `feat(vdj): ship cancellable local catalog source`.

**DoD:** A permite recorrer todo el catálogo local con trabajo acotado; tests del lifecycle usan producción; cancelación no publica resultados viejos; host responde y descarga el plugin limpiamente.

### V04 — Artwork y media probados en decks reales

**Dependencias:** V02, V03 y P05. **Estado:** resolver genera URL; falta evidencia completa de reproducción/seek en host.

**Modificar:** `tools/vdj-plugin/src/client/{stream_resolver,media_access_client}.cpp`, `tools/vdj-plugin/src/sdk/online_source_plugin.cpp`, `tools/vdj-plugin/tests/client/stream_resolver_test.cpp`. P05 es dueño de `app/crate/api/{browse_album,browse_media,media_access}.py`, `app/crate/media_access.py` y sus tests de entrega/tickets.
**Crear:** `tools/vdj-plugin/src/client/artwork_resolver.cpp`, `tools/vdj-plugin/include/crate_vdj/artwork_resolver.hpp`, `tools/vdj-plugin/tests/client/artwork_resolver_test.cpp`, `tools/vdj-plugin/tests/sdk/media_delivery_contract_test.cpp`.

1. RED: validar payload de playback completo/UID/localidad, autorización fallida, destino/redirect de otro origen, URLs de artwork absolutas en cada camino, artwork ausente, URL firmada no persistida, revocación y media borrada.
2. GREEN: consumir los servicios compartidos mediante rutas piloto; pedir autorización de ruta específica para artwork/streams y devolver URLs absolutas validadas. Caché solo de identidad/metadatos neutros. No resolver limitaciones de headers haciendo público el artwork privado.
3. RED/GREEN: probar Range/seek reales, HEAD si el host lo necesita, ticket caducado en ranges posteriores, reautorización acotada y 416. Audio ya cargado continúa manualmente mientras nuevas autorizaciones se deniegan tras revocación. Cubrir cambio de credenciales durante carga.
4. Fake server prueba transporte libcurl real sin producción. Ejecutar tests nativos media y, desde `app`, `pytest -q tests/test_media_access_tickets.py tests/test_vdj_stream_scope.py tests/test_artwork_route_delivery.py`. El test live queda OFF por defecto y rechaza producción salvo elección explícita del usuario.
5. Gate host: desde Online Music/búsqueda/carpeta/contexto, arrastrar dos pistas Crate diferentes, mostrar artwork, reproducir, hacer seek tras caducar ticket, cortar red, revocar token y probar una carga nueva. Registrar host/OS/arch/API, resultados y latencia. Devolver una URL no supera este gate.
6. Commit `feat(vdj): validate authorized deck media delivery`.

**DoD:** A funciona en host real con imágenes, reproducción, seek y reauth correctos; tests prueban fronteras de acceso; reinicio/unload no deja workers media activos.

**Gate de entrega en V04:** si el host no renueva tickets, probar primero referencia local/file y construir spool por carga cifrado/materialización privada limitada a decks activos, usando los límites del diseño. Esta base se implementa aquí antes de cerrar A; V08 añade persistencia/offline/prefetch posteriormente. Si el host no admite ninguna vía, V04 sigue bloqueada y se revisa el diseño; no se declara resuelto invocando una V08 dependiente de C.

### V05 — Completar Assistant y planes inmutables

**Dependencias:** V01–V04, SM05 y SM06. **Estado:** carpeta compatible conectada; mapper de perfiles existente; cliente/validador de planes ausentes.

**Modificar:** `tools/vdj-plugin/src/client/smart_mix_client.cpp`, `tools/vdj-plugin/src/mapping/{mix_profile,compatible_tracks}.cpp`, `tools/vdj-plugin/src/online_source/compatible_tracks.cpp`, adaptador Online Source de producción y tests existentes Smart Mix/compatible.
**Crear:** `tools/vdj-plugin/src/client/transition_plan_client.cpp`, `tools/vdj-plugin/include/crate_vdj/transition_plan.hpp`, `tools/vdj-plugin/src/automation/transition_plan_validator.cpp`, `tools/vdj-plugin/tests/automation/transition_plan_validator_test.cpp`, `tools/vdj-plugin/tests/online_source/smart_mix_presentation_test.cpp`.

1. RED: presentación de perfil/cues/confianza desde fixtures wire summary; perfil ausente conserva playback normal; versión incompatible desactiva ayuda; orden/breakdown igual al servidor; semilla de contexto consumida una vez y semilla manual no sustituida por otro deck.
2. GREEN: conectar SmartMixClient a presentación real y Open in Crate funcional; localizar labels/errores. Mostrar resumen de transición mediante contexto/superficie SDK validada, sin recuperar la UI SideView aplazada.
3. RED: fixtures de plan rechazan UIDs/revisiones/modos/planner/schema incorrectos, capacidad no soportada, valores no finitos, cues/duración/gain/tempo/phase fuera de límites y generaciones de carga/contexto obsoletas. Distinguir fallback musical válido de contrato inválido.
4. GREEN: cliente de planes y validador puro con elegibilidad/fallback tipado; plan inmutable, conservando procedencia necesaria para C. Un análisis opcional ausente no crea bucles de reintento ni impide playback normal.
5. Ejecutar `ctest --test-dir build/vdj-headless -R 'smart_mix|compatible|transition_plan' --output-on-failure` y, desde `app`, `pytest -q tests/test_smart_mix_api.py tests/test_smart_mix_models.py tests/test_smart_mix_planner.py`. Host: verificar perfil/cues visibles, navegación de contexto y semilla desde pista cargada con dos/cuatro decks.
6. Commit `feat(vdj): complete Smart Mix assistant and plan validation`.

**DoD:** B es visible en el plugin real; los fixtures demuestran significado de perfil/plan compartido con Android; C dispone de intenciones inmutables validadas.

### V06 — Implementar y demostrar Automation protegida

**Dependencias:** V05 y P03; frontera de hilos/comandos SDK medida. **Estado:** únicamente comandos fijos del probe para deck 1.

**Crear:** `tools/vdj-plugin/include/crate_vdj/{vdj_state,vdj_commands,automation_state_machine}.hpp`, `tools/vdj-plugin/src/automation/{vdj_state_reader,vdj_command_port,automation_state_machine,general_automation_plugin,transition_metrics}.cpp`, `tools/vdj-plugin/src/sdk/general_plugin.cpp`, `tools/vdj-plugin/tests/automation/{vdj_state_reader,vdj_command_port,automation_state_machine,transition_metrics}_test.cpp`, `tools/vdj-plugin/tests/sdk/general_automation_lifecycle_test.cpp`.
**Modificar:** `tools/vdj-plugin/CMakeLists.txt`, `tools/vdj-plugin/include/crate_vdj/core.hpp`. P03 sigue siendo dueño de config/capabilities y lease; V06 consume su contrato.

1. RED/GREEN: mapear IDs reales de decks, filepath/entity, revisión de carga, readiness, reproducción/audibilidad, BPM/phase/crossfader y señales manuales mediante consultas host. Cubrir valores desconocidos/obsoletos/parciales y dos/cuatro decks. La allowlist VDJScript genera comandos localmente desde intenciones tipadas.
2. RED: trazas de máquina de estados para todos los modos/fases, deck ocupado, cambio de plan/perfil antes de comando, carga lenta/deadline de readiness, comando rechazado, lease caducado/kill switch, intervención durante precarga/sync/crossfade, acknowledgment tardío y unload/restart. Inyectar clock monotónico y generación de ejecución.
3. GREEN: General resuelve por separado identidad de decks y solicita planes; sin globals entre bundles. Adquirir ownership solo de operaciones iniciadas por el plugin. Ejecutar un paso acotado, observar estado esperado y revalidar identidad/perfil/lease antes de continuar. No recuperar un deck tocado manualmente.
4. Gate obligatorio antes de habilitar C: demostrar cómo se cancelan comandos host `auto_*` en curso y cómo vuelve el control sin sobrescribir tempo/fader manual. Medir por separado detección manual y cancelación host. Si un verbo no cumple el límite de seguridad, sustituir su mapping o declarar temporalmente no soportado ese modo hasta resolverlo; no basta detener un worker C++.
5. Conectar assisted/automatic opt-in a settings de General, mostrar estado/fallback. Desactivar C con lease obsoleto/deshabilitado preservando audio manual. Diagnósticos/métricas fuera de callbacks, cardinalidad acotada y sin rutas/secretos.
6. Ejecutar tests `automation|general_automation` en builds normal/sanitizer; realizar precarga/sync/crossfade reales con intervención, kill switch y pérdida de red. Fijar y registrar SLOs medidos de callbacks/cancelación/transición; no prometer precisión de sample sin evidencia.
7. Commits por partes verificadas hasta `feat(vdj): execute guarded Smart Mix transitions`.

**DoD:** C ejecuta transiciones completas derivadas del backend y supera intervención manual en todas las fases de hosts soportados; desactivación del servidor con efecto acotado documentado; trabajo rechazado/tardío preserva playback manual.

### V07 — Integrar radio, cues privados y telemetría

**Dependencias:** P06, V05 y V06 para integración basada en decks. **Estado:** extensiones conservadas, clientes nativos pendientes.

**Crear:** `tools/vdj-plugin/src/client/{radio_client,cue_client,now_playing_client,play_event_client}.cpp`, `tools/vdj-plugin/src/online_source/radio_source.cpp`, `tools/vdj-plugin/src/automation/cue_sync.cpp`, `tools/vdj-plugin/tests/client/{radio_client,cue_sync,telemetry_client}_test.cpp`.
**Modificar:** adaptador nativo, settings de plataforma y contratos/fixtures nativos compartidos.
**Propietario backend:** P06 crea/actualiza rutas, scopes, modelos, repositorios, migraciones y tests radio/cues/presencia/eventos. V07 no crea `app/crate/api/dj.py`, servicios ni migraciones paralelos: integra el contrato que entrega P06 y reporta incompatibilidades a esa tarea.

1. RED/GREEN: cliente de `/api/radio/start`, `/api/radio/next`, `/api/radio/feedback` y `/api/radio/session/{session_id}` con scope y ownership explícitos del contrato P06. Validar candidatos locales, caducidad, cancelación, idempotencia de feedback cuando corresponda y reinicio explícito de sesión caducada. No copiar ranking ni lógica de sesiones.
2. RED/GREEN: consumir GET/PUT/DELETE de `/api/dj/tracks/by-entity/{uid}/cues` propuesto en P06 con revisión esperada, revisión del perfil fuente y ámbito privado. Probar conflicto, política de recarga/merge, delete, usuarios separados y lectura cacheada sin retrasar carga de deck. Aplicar cues en VDJ con comandos host validados sin sobrescribir cambios manuales silenciosamente. Los cues automáticos globales permanecen independientes.
3. RED/GREEN: cliente de `/api/dj/now-playing` de P06 por usuario/deck, cada 30s y TTL servidor90s. Consumir `/api/me/play-events` con umbral audible e idempotency key. La idempotencia persistida es responsabilidad del backend P06: un spool correcto por sí solo no la acredita. Distinguir pista precargada/silenciosa de pista audible y reproducción solapada en decks.
4. Acotar reintentos/spool por cantidad/edad, limpiar al cambiar identidad y excluir URLs firmadas/tickets. Fallos de red no afectan timing de decks. Cubrir reinicio durante flush, duplicación de acknowledgment y orden de feedback/cues al reconectar.
5. Ejecutar tests nativos client y la suite entregada por P06 desde `app`: `pytest -q tests/test_radio_contracts.py tests/test_smart_mix_api.py tests/test_dj_cue_points.py tests/test_dj_now_playing.py tests/test_dj_play_events.py tests/test_play_event_contracts.py`. Probar edición de cues, reconexión y caducidad de radio en host real.
6. Commit de cada cliente/extensión con mensajes `feat(vdj): ...`. Registrar las tres como requeridas; una capacidad deshabilitada pendiente de gate no cuenta como extensión terminada.

**DoD:** integración sobre el único backend P06, sin radio/planner duplicados; cues privados revision-safe, presencia best effort acotada y efectos persistidos únicos de play events comprobados ante reintentos.

### V08 — Caché cifrada acotada y prefetch

**Dependencias:** V04 y V05; reutilizar identidad y transporte ya probados. P06/V07 aportan eventos cuando se conecten. La carga/caché básica no depende de C/V06. **Estado:** caché de metadatos existente; audio cache/prefetch ausentes.

**Crear:** `tools/vdj-plugin/src/cache/{audio_cache,prefetch_queue,audio_materialization}.cpp`, `tools/vdj-plugin/include/crate_vdj/audio_cache.hpp`, `tools/vdj-plugin/tests/cache/{audio_cache,offline_playback,prefetch_queue}_test.cpp`.
**Modificar:** resolver de stream, credenciales de plataforma, settings nativos, manifiesto de dependencias CMake y packaging. Campos de permisos offline/cache vienen de P05, sin contrato media paralelo. Implementar límites§2.4 del diseño: presupuesto físico total 5GiB incluye temporales/parciales/ciphertext, reservas previas; conceder carga manual offline solo dentro de offlineEligibleUntil vinculado a token/owner/nodo/fuente, sin ampliar lease C. Validar restauración, reloj y revocación observada.

1. Gate y RED: verificar en los hosts soportados que GetStreamUrl entrega la referencia privada local/file elegida y permite seek. Registrar cifrado en reposo y comportamiento temporal en claro antes de implementarlo; no introducir daemon/IPC oculto.
2. RED/GREEN: elegir cifrado autenticado auditado, fijar dependencia y guardar claves por nodo/cuenta solo en almacén OS. Autenticar metadatos/contenido/revisión; limitar bytes/edad; escritura/finalización atómica, rechazo de corrupción, LRU y limpieza tras crash. Las nuevas cargas requieren autorización/política adecuada a modo online/offline; revocación observada online deniega cargas nuevas y limpia material sin pin.
3. RED/GREEN: prefetch máximo de las tres siguientes con concurrencia pequeña, cancelación al cambiar cola/perfil/usuario/origen y sin expulsar decks activos. Ticket/URL solo en memoria; descarga parcial no se publica como cache reproducible. Progreso por bytes reales fuera de callbacks con I/O.
4. RED/GREEN: material temporal descifrado, si el host lo requiere, limitado a cargas con pin, permisos privados OS, ausente en metadatos/logs y limpio tras unload/crash. No afirmar retirada de bytes ya cargados ni borrado seguro garantizado en SSD.
5. Ejecutar `ctest --test-dir build/vdj-headless -R 'audio_cache|offline_playback|prefetch' --output-on-failure`; verificar límite de bytes, disco lleno, ciphertext corrupto, restos tras reinicio, cambio de usuario, cancelación y seek offline en dos decks reales. Mantener opt-in y OFF por defecto hasta superar gates; estar deshabilitado no acredita entregable completo.
6. Commit `feat(vdj): add bounded encrypted cache and prefetch`.

**DoD:** offline/prefetch opcional funciona mediante entrega host probada, semántica explícita de seguridad/disponibilidad, almacenamiento acotado y sin expulsión de decks activos.

### V09 — Integrar filtros DJ, medición y verificación continua

**Dependencias:** P04 y V01–V08; la infraestructura CI puede empezar tras V01. **Estado:** filtros nativos, CI de release y decisión readplane medida pendientes.

**Modificar:** `.github/workflows/test-backend.yml`, `Makefile`, `tools/vdj-plugin/CMakeLists.txt`, cliente de búsqueda y UI nativa de filtros.
**Crear:** `tools/vdj-plugin/src/client/search_filters.cpp`, `tools/vdj-plugin/tests/client/search_filters_test.cpp`, `.github/workflows/vdj-plugin.yml` y harness/scripts de medición nativos bajo `tools/vdj-plugin/tests/performance/`.
**Propietario backend:** P04 implementa filtros, cursores, `fields=dj`, índices necesarios y suites `test_vdj_search_filters.py`, `test_vdj_search_pagination.py` y medición de queries. Las tareas P02–P06 mantienen tests auth/media/observabilidad/routing. V09 conecta cliente/UI/CI y mide el sistema entregado; no vuelve a implementar filtros, queries, endpoints ni migraciones. Si la medición requiere readplane, la tarea backend correspondiente entrega la paridad antes de activarlo.

1. RED/GREEN: consumir filtros BPM/Camelot/energía/analysis-required y cursor/`fields=dj` aditivos de P04. Mapear estado UI a request y resultados; respetar máximo50 de búsqueda. Cubrir análisis ausente, error de cursor/scope, orden estable, cambio de filtros con cancelación y fallback de versión no soportada. Verificar junto a P04 que Listen sin filtros permanece igual.
2. Añadir jobs PR de contratos backend, Linux headless/CTest, macOS headless, sanitizer y checks de dependencias/licencias/secretos sin SDK privado. Targets `make vdj-test` y `make vdj-build`; probar Release también. Build Windows core sin credenciales de firma. Los mocks de stores no sustituyen gates separados de integración OS.
3. Incorporar a CTest por defecto fake-server transport (TLS/origin/redirect/body-size/cancel/expiry/range) y lifecycle del adaptador real. Tests live opt-in y limitados al entorno. Usar métricas con labels acotados de resultado/modo/clase de versión, sin track/user IDs.
4. Medir FastAPI-only search/profile/compatible/plan/authorization p50/p95/p99 mediante harness cliente, fixtures del backend a escala de producción y concurrencia realista. Registrar hardware/dataset/cache, SLOs y decisión en el plan canónico. Una biblioteca de desarrollo pequeña no demuestra capacidad para el catálogo completo.
5. Readplane solo si falla el SLO registrado: exigir a su tarea backend fixtures iguales de allowlist/revocación/tickets/cursor/orden/errores. V09 integra esos fixtures y matrices en CI, sin implementar otra capa Go de auth. Hasta la paridad, VDJ debe dirigirse determinísticamente a FastAPI en cada topología de despliegue, no solo en el overlay Caddy local.
6. Ejecutar suites backend/nativas pertinentes y contratos de routing. Commit separado de integración de filtros, CI y decisión medida de routing.

**DoD:** CI reproducible cubre el código nativo real; filtros funcionan sin regresión de Listen; afirmaciones de rendimiento/routing cuentan con mediciones y paridad de autorización acreditada por las tareas backend responsables.

### V10 — Releases independientes y cierre de gates host

**Dependencias:** V01–V09 y X03 para cerrar; los builds de empaquetado pueden prepararse en paralelo a X03. V10 no depende de X04, que realiza el rollout final. Los pilotos A/B pueden publicarse antes con C deshabilitado, sin cerrar el plan global.

**Crear:** `tools/vdj-plugin/packaging/manifest.json`, scripts bajo `tools/vdj-plugin/packaging/`, `.github/workflows/vdj-plugin-release.yml`.
**Modificar:** `tools/vdj-plugin/CMakeLists.txt`, `tools/vdj-plugin/README.md`, `Makefile` y workflow existente del stack para fixtures de compatibilidad. Evidencias técnicas y rollout permanecen en `docs/technical/smart-mix-design.md` y `docs/technical/smart-mix-implementation-plan.md`; registrar exactamente estas dos fuentes canónicas en el manifiesto documental. Release notes/artefactos generados son outputs, no nuevos documentos de diseño/plan.

1. RED/GREEN: manifiesto valida SemVer plugin, contrato Crate mínimo/máximo probado, schemas/analyzer/planner, builds/arquitecturas VirtualDJ y gates de capacidades. Versión de binario y manifiesto desde un origen único. `vdj-v*` publica plugin independiente; Crate `v*` ejecuta compatibilidad sin incrementar su versión.
2. Generar DLLs Windows x64 firmadas y bundles macOS Intel/arm64 firmados/notarizados, con SDK/firma privados solo en jobs de release. Empaquetar A+B y C por separado en una distribución versionada; upgrade/rollback/uninstall conservan configuración compatible. Excluir `ControlSpike`, headers/samples SDK y credenciales locales. Generar checksums/SBOM/inventario de licencias.
3. Añadir `make vdj-package`; ejecutar matrices CMake/CTest normal/sanitizer/Release antes de firmar. Verificar exports, metadata/iconos de bundle, directorios de instalación y carga independiente de ambos binarios. Probar stores OS sin depender exclusivamente de dobles.
4. Consumir evidencia de la matriz host y soak de X03; repetir sobre paquetes firmados instalación/upgrade, carga de ambos binarios, credenciales, media y takeover. Repetir otras pruebas únicamente si packaging cambia comportamiento o aparece una regresión; distinguir core, SDK falso, harness API y host efectivo.
5. Preparar artefactos y verificar configuración para el rollout de X04: gates independientes de A/B/C, rollback de binarios y rutas FastAPI soportadas. X04 ejecuta beta/ampliación; V10 no repite ese despliegue como prerrequisito de sí misma.
6. Revisar todas las extensiones retenidas y resolver gates fallidos; una casilla pendiente no es una exclusión aprobada. Commit de configuración release y evidencia final en el plan canónico.

**DoD:** artefactos firmados instalables multi-plataforma, compatibilidad de versiones independientes, A+B+C completo en host real, gates de extensiones cerrados, soak y rollout reversible; la feature Smart Mix unificada solo se cierra con los gates Android y servidor también verdes.

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
5. Para C, registrar reconocimiento de takeover, cancelación efectiva del comando programado por host y efecto de lease. Objetivo inicial reconocer/cancelar scheduling propio≤100ms en contextos de control soportados; cualquier comando sobre un deck ya cedido es fallo. No anunciar sample-accuracy. Si el SDK no permite cumplirlo, corregir mapping/modo y repetir antes de certificar C.
6. Ensayar disable independiente C/VDJ/beatmatch/adaptive y rollback a binarios compatibles. Nuevo trabajo se cancela/deniega; audio audible y controles manuales se mantienen. Probar recuperación/rearme consciente y no degradar DB automáticamente.

**DoD:** toda celda anunciada soportada tiene evidencia real con resultado; fallo en una plataforma/modo no se oculta agregando éxitos de otra. Los gates inviables se registran pendientes y elevan una decisión concreta en los mismos documentos.

### Matriz mínima de escenarios

| Superficie   | Casos obligatorios                                                                                                                                                                |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Audio        | Mono/estéreo contrafase/correlacionado, silencio/intro corto/outro corto, variable tempo,44.1/48/96k, MP3/AAC/FLAC soportados, tracks largos                                      |
| Android      | Referencia Pixel y Xiaomi13/equivalente; altavoz, auriculares cable/USB, Bluetooth y coche/AndroidAuto; focus/duck/calls; foreground/background/lockscreen/Doze/process death     |
| Red/media    | Local descargado, stream autenticado, lento/offline, timeout de plan, ticket expirado en seek/range, token/session renovado/revocado, source file reemplazada                     |
| Cola/usuario | Álbum gapless, shuffle/radio/playlist, repeat-one, next/seek/pause en cada fase, cambio de cola/cues/origen/cuenta, opt-out persistente                                           |
| VDJ          | A+B sin C instalado y C independiente;2/4 decks; deck no-Crate/ocupado; manual takeover; gates/lease; request cancel/replacement; unload/restart; caché/audio opt-in y permisosSO |

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

| Paquete     | Estado inicial | Commit / comandos / artefactos / siguiente bloqueo           |
| ----------- | -------------- | ------------------------------------------------------------ |
| C00/P01–P06 | Pendiente      | Baseline anterior preservado; registrar evidencia nueva aquí |
| SM01–SM07   | Pendiente      | Hay implementación parcial anterior, descrita en el diseño   |
| A01–A08     | Pendiente      | Adaptive WIP; campos tempo/phase/bass sin ejecutar           |
| V01–V10     | Pendiente      | Core/spike WIP;14CTests no acreditan host                    |
| X01–X04     | Pendiente      | Sin aceptación/release conjunta                              |

Al iniciar una tarea se expande su fila individual: `pendiente → en curso → verificado` o `bloqueado` con causa concreta y próximo paso. Anotar qué gates faltan, no porcentajes subjetivos de progreso.

| Fecha      | Decisión vigente                                                                                  | Consecuencia                                                         |
| ---------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 2026-09-09 | Un solo diseño y un solo plan para Smart Mix+Android+VDJ                                          | Sustituyen planes/spikes anteriores; sin tercera guía por plataforma |
| 2026-09-09 | Mantener WIP y contratos compartidos;API 2026-09/analyzer v2/planner lote string v2/plan entero 2 | P01 congela fixtures, SM01 migra aditivamente                        |
| 2026-09-09 | Dos decks Android primero; busPCM solo por gate físico fallido                                    | A06/A07 deciden con captura, no por preferencia arquitectónica       |
| 2026-09-09 | VDJ A+B y C en dos binarios sin daemon/IPC                                                        | Negociación y estado independientes; SDKhost es gate                 |
| 2026-09-09 | Todos los entregables anteriores conservados; hitos incrementales                                 | Apagar una opción no cierra trabajo faltante                         |

Una revisión que cambie una decisión debe indicar motivo, evidencia, impacto en contratos/capabilities/migración y tareas afectadas. Toda guía antigua permanece histórica incluso si sus checkboxes dicen completa.

### Validación documental de esta revisión

El 2026-09-09 se verificaron los dos documentos y su publicación en el portal: `node scripts/check-docs.mjs` pasó con 37 documentos canónicos; desde `app/docs`, `npm test -- src/smoke.test.tsx` pasó 7/7 incluyendo ambos deep links y sus enlaces recíprocos, y `npm run build` completó TypeScript/Vite. Se usaron temporalmente las dependencias ya instaladas del checkout principal, sin cambiar lockfiles. Esta evidencia valida la documentación y sus loaders; no acredita ejecución de los paquetes funcionales del plan.

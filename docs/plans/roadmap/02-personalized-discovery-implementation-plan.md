# Plan: discovery recurrente y Release Radar

> **Estado (2026-11-18):** Pendiente; nada implementado (verificado 2026-11-18).

**Estado:** propuesta revisada el 2026-09-09; tareas pendientes.

**Diseño:** [02-personalized-discovery-design.md](02-personalized-discovery-design.md).

**Base comprobada:** checkout principal `992704b9`; las ramas históricas de Discovery, Stats/Upcoming y Radio/Playlist ya están integradas.

Implementar sobre builders, feedback, snapshots y HomePlaylist existentes. No recrear Daily Discovery, Replay o el motor de playlists. Archivos marcados como nuevos son propuestas. Seguir TDD y convenciones Python/React/Go de Crate; no introducir convenciones PHP de Viterbit.

## Dependencias y entregas

- **Secuencia:** PD01 → PD02 → PD03 → PD04 → PD06 → PD07 → PD08 → PD09. PD05 depende de PD02 y PD03; sus perfiles correspondientes deben terminar antes de PD06.
- **Incremento A:** ediciones estables de `daily-discovery` y `genre-*`, feedback y disponibilidad coherentes; PD01–PD04, configuración común de PD05 y PD06–PD09 para esos productos.
- **Incremento B:** Weekly Discovery y Release Radar completos; políticas restantes de PD05 y misma cadena de publicación/UI/validación. A no cierra el alcance completo.
- **Dependencias duras:** auth, identidades local/global, eventos, follows/likes, acceso a catálogo y tareas/snapshots ya integrados. No depende de terminar recap, Social, Notifications o Lyrics.
- **Integración adicional:** señales de Smart Mix cuando estén integradas, según [sus fuentes canónicas](00-index.md#fuentes-de-smart-mix). No espera Android crossfade/VirtualDJ. Go conserva paridad en rutas que ya sirve; nuevas rutas pueden permanecer en FastAPI.

## PD01 — Contratos y baseline

**Existentes:** `app/crate/db/home_personalized_collections.py`, `home_builder_mix_generation.py`, `home_discovery_surface.py`; `app/tests/test_home_mix_generation.py`, `test_home_taste_guardrails.py`, `test_home_discovery_algorithms.py`, `test_home_surfaces.py`; `app/listen/src/pages/HomePlaylist.test.ts`, `Home.test.tsx`.

1. Capturar IDs, campos de detalle, fuentes local/global y límites de Home. Reproducir una card construida con límite pequeño y detalle con candidatos/límite distintos.
2. **RED:** test exige igualdad de selección por edición y falla con la reconstrucción dinámica. Conservar separadas las assertions legacy que ya pasan.
3. Medir usuarios activos, latencia cold/warm, queries, tiempo/RSS de builders y payload; incluir biblioteca de tres artistas y pool global con muchas entradas no elegibles.
4. Fijar presupuestos absolutos y comparación warm con tolerancia inicial máxima del 10%, hardware/carga/muestra documentados. No inventar capacidad para 10k usuarios.

**Comando:** `PYTHONPATH=app python -m pytest -q app/tests/test_home_mix_generation.py app/tests/test_home_taste_guardrails.py app/tests/test_home_discovery_algorithms.py app/tests/test_home_surfaces.py`.

**DoD:** baseline reproducible, contratos y RED concreto; existencia de tests no significa que haya generaciones implementadas.

## PD02 — Contrato de edición e integración de feedback

**Depende de:** PD01.

**Modificar:** `app/crate/api/schemas/me.py`, `app/crate/db/home_personalized_collections.py`, `app/crate/db/repositories/recommendations.py`, `app/crate/api/me.py`; tipos compartidos en la ubicación que ya consume HomePlaylist.

**Crear:** `app/tests/test_discovery_generation_contracts.py`.

1. Campos aditivos del diseño, límite de 100 entradas, propiedad de edición y error `expired`; distinguir `schema_version` y `algorithm_version`.
2. **RED:** cliente sin `generation_id`, lectura de edición ajena/inexistente/expirada, URLs firmadas/paths privados y contexto de feedback ajeno o excesivo.
3. **GREEN:** adaptadores compatibles y referencia canónica; mantener rutas `/api/me/home/mixes`, sin API duplicada.
4. Fijar acciones actuales, bloqueo persistente y deshacer. Validar nuevas acciones sin convertir todo el contrato legacy en un enum incompatible. Reutilizar tablas de feedback/exposición.

**Comando:** `PYTHONPATH=app python -m pytest -q app/tests/test_discovery_generation_contracts.py app/tests/test_recommendation_feedback.py`.

**DoD:** contrato y acciones probados, sin cambiar significado de `not_interested` ni Radio.

## PD03 — Reutilizar selección y cerrar guardrails

**Depende de:** PD02.

**Modificar:** `app/crate/db/home_builder_mix_generation.py`, `home_taste_guardrails.py`, `home_builder_track_selection.py`, `home_builder_global_recommendations.py`, `app/crate/db/queries/home_track_discovery.py`.

**Extender:** `app/tests/test_home_taste_guardrails.py`, `test_home_mix_generation.py`, `test_home_recommended_tracks.py`.

1. **RED:** variantes local/remoto, peer revocado, bloqueo en backfill, artista dominante, biblioteca escasa, metadata sin Bliss y exposición repetida.
2. **GREEN:** reutilizar dedupe/caps, filtrar tras merges, retrieval acotado y política pura con reloj/seed inyectables. No trasladar SQL al router ni duplicar ranking Smart Mix.
3. Preservar semántica de Daily Discovery, razones veraces y shortfall. Likes/repetición tienen significado por producto.
4. Integración PostgreSQL para joins de identidad/permisos/límites y pool grande con muchos descartes. Mocks no prueban SQL: medir queries y `EXPLAIN (ANALYZE, BUFFERS)` en fixture aislada.

**Comando:** `PYTHONPATH=app python -m pytest -q app/tests/test_home_taste_guardrails.py app/tests/test_home_mix_generation.py app/tests/test_home_recommended_tracks.py`.

**DoD:** restricciones no relajadas por fallback, selección estable y lectura acotada; sin afirmar mejora de skips offline.

## PD04 — Persistencia y publicación atómica

**Depende de:** PD03.

**Crear:** revisión en `app/crate/db/migrations/versions/` sobre el head real; `app/crate/db/repositories/discovery_generations.py`; `app/tests/test_discovery_generations.py`, `test_discovery_generations_migration.py`.

1. Tablas `discovery_generations`/`discovery_generation_state`, FKs del propietario, unicidad de trabajo, índices usuario/producto/periodo y payload limitado. No tabla por pista sin consulta que lo justifique.
2. **RED PostgreSQL:** dos workers, retry, crash antes/después de commit, revisión nueva durante cálculo, job de periodo anterior, cuenta borrada y lectura ajena.
3. **GREEN:** insertar edición/promover puntero con CAS; job superseded no publica. Invalidar tras commit, conservar edición anterior al fallar.
4. Upgrade desde head real y bootstrap limpio; convivencia con binario anterior y rollback por flag. No reservar `2027_02` ni otra revisión: conciliar ramas antes de elegir `down_revision`. Downgrade destructivo elimina ediciones y debe documentarlo.
5. Retención del diseño, respuesta `expired` y guardado explícito mediante playlists existentes.

**Comando:** `PYTHONPATH=app python -m pytest -q app/tests/test_discovery_generations.py app/tests/test_discovery_generations_migration.py`.

**DoD:** concurrencia/migración verdes en PostgreSQL aislado; un skip no demuestra integridad. DB es autoridad, Redis no.

## PD05 — Perfiles y calendario de los cuatro productos

**Depende de:** PD02–PD03.

**Modificar:** `app/crate/db/home_builder_mix_generation.py`, `home_release_weeks.py`, `home_builder_release_recommendations.py`, `app/crate/db/releases.py`.

**Extender:** `app/tests/test_home_release_weeks.py`, `test_home_mix_generation.py`; **crear** `app/tests/test_release_radar.py`.

1. Registrar cadencias/perfiles; mantener `daily-discovery`, `my-new-arrivals` y `genre-*`. Completar política común para A antes de habilitar productos nuevos.
2. **RED Weekly:** sin Bliss, historial escaso, cuota de exploración, repetición semanal, cambio de versión sin reescribir historia.
3. **RED Radar:** límite del viernes, unfollow, detección tardía, backcatalog importado, fecha desconocida, futuro release/preview, peer sin permiso y lista vacía válida.
4. **GREEN:** publicación por semana y lookback de cuatro semanas, separado de fecha de detección. No `release_date > input_watermark` ni relleno ajeno al criterio de Radar.

**Comando:** `PYTHONPATH=app python -m pytest -q app/tests/test_home_release_weeks.py app/tests/test_home_mix_generation.py app/tests/test_release_radar.py`.

**DoD:** cuatro políticas diferenciadas/probadas; A solo activa perfiles completos.

## PD06 — Jobs, cadencias y revisiones

**Depende de:** PD04 y perfiles correspondientes de PD05.

**Modificar:** `app/crate/actors.py`, `scheduler.py`, `projector.py`, `app/crate/worker_handlers/analysis.py`, `app/crate/db/home_discovery_surface.py`; si se extrae `worker_handlers/discovery.py`, registrar el handler en infraestructura existente.

**Crear:** `app/tests/test_discovery_generation_jobs.py`.

1. Reutilizar `create_task_dedup`, claims DB, colas y control de recursos. Identidad por usuario/producto/periodo/revisión; usuarios activos 30 días precalentados, resto bajo demanda.
2. Conectar follows/likes/feedback, catálogo/permiso y cadencia; coalescer eventos y persistir revisión pendiente. Bloqueo/retirada de permiso afectan elegibilidad inmediatamente aunque la generación tarde.
3. **RED:** duplicados/fuera de orden, worker reiniciado, Redis vacío, retry agotado, dos cambios durante cálculo, expiración de feedback sin play y cuenta borrada durante job.
4. **GREEN:** retry limitado, recuperación de jobs abandonados y lotes cancelables. Estado/tiempo/candidatos/error en tareas actuales; rebuild dirigido, sin regenerar todos los usuarios por un play.

**Comando:** `PYTHONPATH=app python -m pytest -q app/tests/test_discovery_generation_jobs.py app/tests/test_home_surfaces.py`.

**DoD:** frescura/retención funcionan tras reinicios; recovery probado y presión sobre playback controlada.

## PD07 — API, snapshots y paridad

**Depende de:** PD06.

**Modificar:** `app/crate/api/me.py`, `app/crate/db/home_personalized_collections.py`, `home_personalized_discovery.py`, `home_discovery_surface.py`; `app/readplane/internal/routes/home_slices.go`, `home_discovery_response.go` y sus tests.

**Extender:** `test_discovery_generation_contracts.py`, `test_home_surfaces.py`, `test_recommendation_feedback.py`.

1. Servir puntero y detalle fijado a edición; cold request encola y responde warming/fallback sin generar dentro del endpoint.
2. **RED:** publicación entre card/detalle, stale vencido, edición expirada, bloqueo posterior, peer revocado, otro usuario, cookie/bearer y cache tras cambio de permiso.
3. **GREEN:** referencias estables, elegibilidad revalidada y claves privadas correctas. Go conserva rutas/contratos actuales y fallback; no habilitar un handler nuevo sin misma matriz de auth/revisión.
4. Probar invalidación tras commit y Redis reiniciado; una referencia antigua no devuelve contenido nuevo bajo el mismo ID.

**Comandos:** suites Python indicadas y `(cd app/readplane && go test ./internal/routes/...)`.

**DoD:** misma edición/estado y permisos en ambas implementaciones; comparación cold/warm con PD01.

## PD08 — UI sobre HomePlaylist

**Depende de:** PD07.

**Modificar:** `app/listen/src/pages/HomePlaylist.tsx`, `HomePlaylist.test.ts`, `HomeSection.tsx`, `Home.test.tsx`; `app/listen/src/components/home/HomeCustomMixes.tsx`, `HomeSections.tsx` y tipos/controladores actuales.

1. Transportar `generation_id` card → detalle → Play, manteniendo rutas/IDs; no crear página `DiscoveryMix.tsx` equivalente.
2. Razones, actualización, warming/stale/expired, shortfall y acciones ocultar/bloquear/deshacer.
3. **RED/GREEN Vitest + Testing Library:** publicación entre render/click, respuesta fuera de orden, expiración, feedback fallido, exposición sin duplicación, cola iniciada estable y entrada no reproducible.
4. Elegir ubicación visible de productos explícitamente; no restaurar por accidente el rail Custom mixes oculto. Mantener contrato de Home actual hasta esa decisión.
5. Verificar móvil/escritorio, teclado y red; reutilizar design system vigente.

**Comandos:** `npm run --workspace=app/listen test -- HomePlaylist Home.test` y `npm run --workspace=app/listen typecheck`.

**DoD:** abrir o dar Play no reconstruye selección; navegación y reproducción existentes conservadas.

## PD09 — Evaluación, operación y cierre

**Depende de:** PD08; requiere PD05 completo para cerrar la propuesta entera.

**Crear:** fixtures sintéticas `app/tests/fixtures/discovery/` y evaluador junto a tests; registrar resultados/comandos aquí cuando se ejecuten.

1. Gates de identidad, bloqueo, permisos, diversidad condicionada, razones, estabilidad, CAS y presupuestos PD01; incluir cold start y catálogo dominado por descartes.
2. Medir p50/p95, queries, RSS, cola y freshness con hardware/dataset/muestra. Engagement necesita plays atribuibles a edición y denominadores; fixtures no demuestran menos skips.
3. Activar por producto en usuarios de prueba, comparar legacy y ampliar según población real. Rollback desactiva nueva generación/entrada sin borrar ediciones válidas ni playlists guardadas.
4. Ensayar rebuild, pausa/reanudación, worker caído, retención, cuenta borrada y Redis perdido. Registrar A/B por separado, sin dar por terminados perfiles apagados.

**DoD global:** cuatro productos entregados, publicación/guardrails correctos, UI estable, métricas reproducibles, rollback ensayado y suites afectadas verdes.

## Pruebas y evidencia actual

Esta revisión solo modifica documentación; no ejecuta suites del producto ni aporta nuevos benchmarks. Los comandos son verificaciones requeridas al implementar, no resultados obtenidos.

Antes de tests SQL, comprobar `app/tests/conftest.py`: `crate_test` y clones desechables del template migrado, en instancia local de pruebas. No usar host/credenciales de producción. Los skips por falta de PostgreSQL dejan verificaciones de SQL/concurrencia/migración pendientes. Obtener head Alembic real y probar bootstrap + upgrade, sin reservar números cronológicos.

Ejecutar tests focalizados por tarea y contratos afectados al cierre, además de typecheck. El módulo Go se prueba dentro de `app/readplane`, no con `go test ./app/readplane/...` desde raíz.

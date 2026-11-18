# Plan: Stats, Replay y recap anual

> **Estado (2026-11-18):** Parcial: entrega A hecha; pendientes las entregas B y C.

**Estado:** propuesta revisada el 2026-09-09; tareas pendientes.

**Diseño:** [08-listening-recap-design.md](08-listening-recap-design.md).

**Base:** checkout principal `992704b9`; Stats/Upcoming ya integrado.

Extender eventos, agregados, dashboard y Replay actuales. Los módulos/archivos marcados como nuevos se crearán durante implementación. No añadir `app/crate/analytics/`: ya existe `app/crate/analytics.py`; usar módulos concretos DB, dominio de recap y handlers de Crate. Seguir TDD y convenciones Python/React/Go, sin instrucciones de ejecución PHP/Viterbit.

## Dependencias y entregas

- **Secuencia principal:** RC01 → RC02 → RC03 → RC04 → RC05 → RC06. RC07 depende de RC05 y RC02; RC08 depende de RC06–RC07; RC09 depende de RC03–RC05; RC10 cierra RC08–RC09 y todas las anteriores.
- **A: Stats:** RC01–RC04 y verificaciones operativas pertinentes de RC09–RC10.
- **B: recap privado:** RC05–RC06, con borrado/revisiones ya cubiertos, más gates de RC09–RC10. No espera sharing para salir.
- **C: compartir:** RC07–RC08 y cierre completo RC10. B no equivale a feature terminada.
- **Dependencias duras:** eventos/identidad, auth, DB, tareas y snapshots existentes. No exige completar Discovery, Social nuevo, Notifications, Lyrics, Smart Mix o Jam. El dashboard Go actual sí exige paridad; recap/shares pueden comenzar en FastAPI con fallback.

## RC01 — Semántica y rendimiento de la base

**Leer/modificar tests existentes:** `app/crate/db/repositories/user_library_playback_writes.py`, `user_library_aggregate_runner.py`, `user_library_daily_aggregates.py`, `user_library_entity_aggregates.py`; `app/crate/db/user_stats_dashboard_surface.py`; `app/tests/test_play_event_contracts.py`, `test_user_stats_aggregates.py`, `test_user_stats_dashboard_surface.py`, `test_stats_api_contracts.py`; `app/listen/src/pages/Stats.test.tsx`.

1. Caracterizar `play_count`, minutos, completions/skips, identidad local/global, ventanas/meses UTC e idempotencia por `(user_id, client_event_id)`. Dos escuchas distintas no son duplicados.
2. **RED dirigido:** retry concurrente, mix de identidades de la misma entidad, expiración de ventana sin nuevo play y snapshot cuya fuente cambió. Distinguir regresiones reales de semántica legacy que aún pasa.
3. Medir registro → debounce → rebuild → snapshot, queries y tiempo/RSS por etapa. El controller ya hace una petición a dashboard; no medirlo como si aún pidiera múltiples tops por separado.
4. Fixtures sintéticas de 0, pocos y 100k eventos; 1 M como estrés, sin afirmar que es uso actual. Declarar hardware/carga, establecer budgets absolutos y tolerancia warm inicial del 10%. Comparar resultados, no solo latencia.

**Comando:** `PYTHONPATH=app python -m pytest -q app/tests/test_play_event_contracts.py app/tests/test_user_stats_aggregates.py app/tests/test_user_stats_dashboard_surface.py app/tests/test_stats_api_contracts.py`.

**DoD:** baseline reproducible y reglas documentadas; ningún resultado histórico se presenta como test/benchmark nuevo.

## RC02 — Contrato temporal, identidad y privacidad

**Depende de:** RC01.

**Modificar:** `app/crate/api/schemas/me.py`, `app/crate/api/me.py`, `app/crate/db/queries/user_library_shared.py`, `user_library_stats_month.py`, `app/listen/src/pages/stats-page-model.ts`; **crear** `app/tests/test_listening_periods.py` y tipos puros de periodo en un módulo concreto bajo `app/crate/`.

1. Mantener `window=7d|30d|90d|365d|all_time`, `month=YYYY-MM` y default 30d. Añadir `period=today|year`, `year`, `timezone` con exclusiones/validación explícitas, sin reemplazar `window` por `range`.
2. **RED/GREEN:** intervalo `[inicio, fin)`, DST, bisiesto, evento que cruza medianoche, zona desconocida, fechas/duraciones inválidas y parámetros contradictorios. Preservar semántica UTC legacy.
3. Fijar `metrics_version: "listening-v1"` y reglas de cards; no aplicar umbral nuevo silenciosamente a todos los plays. Resolver local/global canónico; desconocidos y cobertura parcial explícitos.
4. Auditar `app/crate/db/repositories/auth_user_admin.py`, auth/settings y flujos de borrado/exportación actuales. Especificar qué se conserva al desactivar registro y qué se elimina al borrar historial/derivados/cuenta; añadir solo las operaciones que falten para estos datos.
5. Contrato anual aditivo: esquema 1, algoritmo `recap-v1`, año/zona/corte/revisiones, estados provisional/ready/partial/empty, cards tipadas y selección de edición. Ser público en Social no autoriza a compartir recap.

**Comandos:** `PYTHONPATH=app python -m pytest -q app/tests/test_listening_periods.py app/tests/test_play_event_contracts.py app/tests/test_stats_api_contracts.py` y `npm run --workspace=app/listen test -- Stats`.

**DoD:** semántica temporal/privacidad aceptada por tests; requisitos de borrar derivados son de esta feature, no una dependencia de otro roadmap.

## RC03 — Refresh acotado y revisiones duraderas

**Depende de:** RC02.

**Modificar:** `app/crate/db/repositories/user_library_playback_writes.py`, `user_library_aggregate_runner.py`, `user_library_daily_aggregates.py`, `user_library_entity_aggregates.py`, `app/crate/worker_handlers/analysis.py`, `scheduler.py`.

**Crear:** repository de estado `app/crate/db/repositories/user_listening_projection_state.py`, revisión Alembic sobre head real; `app/tests/test_listening_projection_state.py`, `test_listening_projection_migration.py`.

1. Estado por usuario (`user_listening_projection_state`) con revisiones de datos/privacidad/proyección y días pendientes (`user_listening_dirty_days`). Marcar en la misma transacción que inserta/corrige/borra; retry ya existente no crea una contribución nueva.
2. **RED PostgreSQL:** eventos concurrentes confirmados fuera de orden, mensaje repetido, crash entre aggregate/publish, late event de mes anterior, borrado durante refresh y retry de `(user, client_event_id)` contra constraint real.
3. **GREEN:** recomputar/reemplazar buckets afectados, confirmar solo revisiones procesadas y dejar pendiente lo concurrente. Actualizar ventanas por entidad coherentemente y expirar por reloj, aunque no haya plays nuevos. Conservar rebuild completo como oracle/repair.
4. Usar medición RC01 para decidir índices y, si son necesarios, buckets diarios por entidad. No sumar distintos diarios para totales mensuales/anuales; preservar precisión de ventanas parciales con eventos de borde. Documentar aquí la decisión y coste medido.
5. Borrado invalida estados/snapshots/jobs; publicación verifica cuenta/revisión. Reutilizar task `refresh_user_listening_stats`; no añadir otro consumidor que incremente agregados en paralelo.
6. Upgrade/clean bootstrap/concurrencia sobre PostgreSQL aislado; resolver `down_revision` al implementar, sin reservar `2027_08` ni números de otra rama. Rollback por flag conserva rebuild previo; downgrade destructivo requiere explicar pérdida de proyecciones.

**Comando:** `PYTHONPATH=app python -m pytest -q app/tests/test_listening_projection_state.py app/tests/test_listening_projection_migration.py app/tests/test_user_stats_aggregates.py`.

**DoD:** igualdad con rebuild de referencia, trabajo acotado al cambio y revision CAS correcto; SQL/migraciones sin skips pendientes.

## RC04 — Dashboard coherente, estados y paridad Go

**Depende de:** RC03.

**Modificar:** `app/crate/db/user_stats_dashboard_surface.py`, `app/crate/db/queries/user_library_stats_month.py`, `user_library_stats_story.py`, `app/crate/api/me.py`, `projector.py`; `app/readplane/internal/routes/stats_dashboard.go`, `stats_dashboard_test.go`; `app/listen/src/pages/use-stats-page-controller.ts`, `stats-page-model.ts`, `Stats.tsx`, `Stats.test.tsx`.

1. Reutilizar `ui_snapshots` y refresh existente; publicar datos y metadata de la misma revisión/corte. Añadir periodos/zonas a clave de snapshot y parseo idéntico en Go/Python.
2. **RED:** snapshot fresh/stale/ausente/vencido, cero eventos real, cobertura parcial, fuente revisada durante build, usuario borrado, Redis reiniciado, fallo de worker, cookie/bearer y cache de otro usuario.
3. **GREEN:** stale útil durante refresh, sin servir proyección incompatible con privacidad. Scheduler/projector coalescean cambios; no reconstruir historial en GET ni recalcular todo por cada evento.
4. UI conserva su única petición y secciones existentes; añade hoy/año, zona visible y estado actualizado. Las métricas de dispositivos/rachas desconocidas aparecen como insuficientes, no como cero inventado.
5. Extender contracts `test_stats_api_contracts.py`, superficie `test_user_stats_dashboard_surface.py` y handler Go, incluyendo nuevos parámetros y mismos errores/status. Mantener separados dashboard global/social y propietario.

**Comandos:** `PYTHONPATH=app python -m pytest -q app/tests/test_user_stats_dashboard_surface.py app/tests/test_stats_api_contracts.py app/tests/test_listening_periods.py`; `(cd app/readplane && go test ./internal/routes/...)`; `npm run --workspace=app/listen test -- Stats`.

**DoD:** incremento A operable tras gates; dashboard actual sigue compatible, rápido y sin estados de privacidad obsoletos.

## RC05 — Generador de edición anual

**Depende de:** RC04.

**Reutilizar:** `app/crate/db/queries/user_library_stats_tops.py`, `user_library_stats_month.py`, `user_library_stats_story.py`, `app/crate/db/user_stats_dashboard_surface.py`.

**Crear:** `app/crate/listening_recap.py` para política pura, `app/crate/db/repositories/listening_recap.py`, revisión Alembic `user_replay_generations`; `app/tests/test_listening_recap.py`, `test_listening_recap_repository.py` y fixtures.

1. Cards tipadas de rankings, géneros, descubrimientos registrados, ritmo, rachas/dispositivos con cobertura y comparación interanual; reutilizar queries/señales actuales. No LLM ni otro motor de Replay.
2. **RED:** ties deterministas, año vacío/parcial, identidad remota, metadata desaparecida, primera escucha fuera del historial retenido, distinto anual no aditivo y año previo insuficiente.
3. **GREEN:** fijar año/zona/corte y versiones; guardar selección/valores/razones inmutables. Una nueva regla/zona/entrada tardía produce nueva edición, no modifica contenido bajo el mismo ID.
4. Persistencia limitada, owner FK, unicidad de job, publicación CAS a snapshot/puntero anual y retención del diseño. **RED DB:** duplicados, crash, dos generaciones y borrado durante publicación.
5. Registrar handler con `create_task_dedup` en infraestructura de workers existente; API fría no calcula el año. Probar migración desde head real y compatibilidad del binario anterior.

**Comando:** `PYTHONPATH=app python -m pytest -q app/tests/test_listening_recap.py app/tests/test_listening_recap_repository.py app/tests/test_user_stats_aggregates.py`.

**DoD:** edición reproducible y privada, métricas conciliadas, migración/retención/borrado probados; año actual claramente provisional.

## RC06 — API privada y experiencia anual

**Depende de:** RC05.

**Modificar:** `app/crate/api/me.py`, `app/crate/api/schemas/me.py`, `app/listen/src/pages/Stats.tsx`, `use-stats-page-controller.ts` y registro de rutas actual.

**Crear:** `app/listen/src/pages/ListeningRecap.tsx`, sus pruebas y componentes de cards reutilizables; `app/tests/test_listening_recap_api.py`.

1. `GET /api/me/replay/{year}` con zona/edición explícitas y latest privado; mantener `/stats/replay` y Replay mensual de Home intactos.
2. **RED API:** usuario ajeno, edición inexistente/expirada, año futuro inválido, cold/warming/stale, borrado de datos, response sin paths/tokens y tamaño limitado.
3. **GREEN UI:** navegación desde Stats, edición/corte visibles, años disponibles reales, narrativa determinista y playlist Replay reproducible mediante acciones actuales; no prometer play de tracks ya no disponibles.
4. **Vitest + Testing Library:** sin datos, parcial, publicación nueva, error de red, responsive/teclado/reduced motion y enlaces Android. Web/Android consumen mismas cards; no introducir otro esquema nativo.
5. Recap puede quedar en FastAPI; si se añade handler Go privado, duplicar matriz de auth/revisión antes de habilitarlo. Un fallback no recalcula historia síncronamente.

**Comandos:** `PYTHONPATH=app python -m pytest -q app/tests/test_listening_recap_api.py`; `npm run --workspace=app/listen test -- Stats ListeningRecap`; `npm run --workspace=app/listen typecheck`.

**DoD:** incremento B privado completo tras RC09 y gates; sharing no aparece habilitado todavía, y su ausencia no se oculta en el estado global.

## RC07 — Grant de compartir y proyección pública

**Depende de:** RC02, RC05.

**Crear:** repository `app/crate/db/repositories/replay_shares.py`, router específico `app/crate/api/replay_shares.py`, schemas y tests `app/tests/test_replay_shares.py`; revisión Alembic para `replay_share_tokens`. Registrar router en `app/crate/api/__init__.py` sin conflictos con catch-alls.

1. POST del propietario fija edición/cards; token criptográfico devuelto una sola vez y hash persistido, TTL/revocación. DELETE por share y revocación de todos; rutas del diseño bajo `/api/me/replay` y `/api/replay/shares/{token}`.
2. **RED:** token inválido/expirado/revocado, owner incorrecto, share de edición warming, selección de cards inválida, IDOR, logout y ráfaga de tokens. No ruta pública por username que contradiga el grant.
3. **GREEN:** proyección allowlist sin eventos, IDs internos, paths, devices individuales o streaming. Nombre/avatar opt-in. No inferir autorización de perfil social público.
4. Verificar revisión de privacidad en cada lectura de grant/payload; `Cache-Control: no-store`, token sin logs/analytics/referrer a terceros y rate limit. Si existe nueva capa Go/CDN, ejecutar la misma matriz antes de habilitarla.
5. Pruebas SQL/migración de FKs, unicidad/hash y revocación concurrente. Un link antiguo permanece fijado a su edición salvo invalidación por privacidad.

**Comando:** `PYTHONPATH=app python -m pytest -q app/tests/test_replay_shares.py app/tests/test_listening_recap_api.py`.

**DoD:** backend de compartir no filtrante y revocable, aún sujeto a cierre RC08 antes de exposición pública.

## RC08 — UI de compartir, assets y borrado integral

**Depende de:** RC06–RC07.

**Modificar:** nueva página/cards de recap, controller de cuenta/settings existente, `app/crate/db/repositories/auth_user_admin.py` y flujos de borrado/exportación identificados en RC02.

**Crear:** vista pública limitada de recap y sus tests; tests de integración de privacidad en `app/tests/test_replay_shares.py` o módulo dedicado.

1. Preview de cards que se van a compartir, creación/copia del enlace, expiración y revocación individual/todas. La UI explica que capturas/descargas ya recibidas no pueden retirarse.
2. **RED/GREEN:** link abierto web/Android, deep link desde sesión cerrada, expirado/revocado, owner que borra historia/cuenta, evento tardío y job que intenta publicar después. Revocación comprobada con caché previamente caliente.
3. Reutilizar artwork autorizado sin convertir URL privada en pública. Si se generan assets, worker con path permitido, permiso del mismo grant, TTL/purga y sin escrituras de filesystem desde API.
4. Borrar datos derivados por propietario: eventos aplicables, agregados, snapshots, ediciones, tokens y assets. Exportación incluye datos/ediciones propios, sin secretos. No «anonimizar» conservando estadísticas vinculables.
5. Verificar metadatos de preview social/HTML y caches: sin publicar contenido privado ni recuperar snapshot stale tras revocación. No depender del nuevo roadmap Social/Notifications para estas operaciones mínimas.

**Comandos:** `PYTHONPATH=app python -m pytest -q app/tests/test_replay_shares.py app/tests/test_listening_recap_repository.py`; `npm run --workspace=app/listen test -- ListeningRecap`; smoke web/Android documentado.

**DoD:** incremento C compartible completo, permisos consistentes para JSON/HTML/assets y borrado resistente a jobs tardíos.

## RC09 — Backfill, reconciliación y budgets

**Depende de:** RC03–RC05; verificar shares/retención de RC07–RC08 cuando estén habilitados.

**Modificar:** handlers/repositories ya creados y scheduler/control de recursos existente; **crear** pruebas de backfill `app/tests/test_listening_recap_backfill.py`.

1. Backfill limitado por usuario/periodo, dry-run de cobertura, checkpoint DB, pausa/reanudación/cancelación y retry; priorizar últimos 24 meses y luego años/usuarios solicitados.
2. **RED:** fallo a mitad de lote, repetición, nuevos eventos/late arrivals, datos borrados e identidad actualizada durante backfill. **GREEN:** convergencia con rebuild de referencia, sin sumar dos veces ni restaurar datos eliminados.
3. Benchmark cold/warm y refresh normal/backfill con datos RC01; queries, p50/p95, RSS, lag, tamaño de snapshots y contención de playback. No convertir 1 M sintético en promesa de capacidad ni un microbenchmark en SLO de producción.
4. Gate por budgets fijados en RC01, sin consultas de historial en GET y sin regresión warm >10% en entorno comparable; repetir solo ante cambios/fallos relevantes.

**Comando:** `PYTHONPATH=app python -m pytest -q app/tests/test_listening_recap_backfill.py app/tests/test_user_stats_aggregates.py app/tests/test_listening_projection_state.py`.

**DoD:** operación acotada/reanudable, resultados reconciliados y evidencia de rendimiento con límites explícitos.

## RC10 — Rollout, rollback y cierre del alcance

**Depende de:** RC01–RC09 para cierre completo; aplicar gates pertinentes también a entregas A/B.

1. Flags separados de refresh nuevo, recap privado y shares; usuarios de prueba primero, ampliación según población real. Comparar totales/cobertura, no exigir cohortes 5/25/100% ficticias.
2. Rollback vuelve al rebuild/dashboard anterior compatible y apaga nueva UI/job; shares siguen revocables. No eliminar eventos ni ediciones privadas válidas al apagar un flag.
3. Ensayar restore de DB, Redis vacío, worker caído, expiración temporal, borrado/revocación y rollback del binario. Documentar upgrade y efectos de downgrade; no reservar números Alembic antes de conciliar ramas.
4. Registrar suites, pases/skips, dataset/hardware y mediciones. Cerrar A/B/C individualmente; gate de privacidad o performance pendiente deja la parte correspondiente abierta.

**DoD global:** Stats coherentes, recap privado y sharing entregados; contratos legacy conservados, paridad donde Go sirve, pruebas SQL/concurrencia/privacidad/UI verdes y operación/rollback ensayados.

## Ejecución de pruebas y evidencia actual

Esta revisión modifica documentación; no ejecuta tests de producto ni aporta benchmarks actuales. Los comandos anteriores son verificaciones de implementación. Las rutas nuevas aún no existen; los tests existentes no prueban el recap anual propuesto.

Antes de ejecutar suites SQL, comprobar `app/tests/conftest.py`: usa `crate_test` y clones desechables del template migrado. Usar solo PostgreSQL local de pruebas; nunca credenciales/host de producción. Si PostgreSQL no está disponible, los skips dejan migración, concurrencia y reconciliación pendientes.

Ejecutar suites focalizadas de cada tarea, typecheck y contratos afectados al cerrar. Go se ejecuta desde su módulo con `(cd app/readplane && go test ./internal/routes/...)`. No sustituir integración real por mocks para SQL, CAS, constraints o borrado.

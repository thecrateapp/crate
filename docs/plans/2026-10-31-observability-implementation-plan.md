# Observabilidad de Crate: Implementation Plan

**Goal:** Hacer fiables las señales existentes y adoptar observabilidad autohospedada que explique fallos de
operación y reproducción sin perjudicar el servicio.

**Architecture:** La base del producto (métricas Redis/PG corregidas, QoE y resumen Admin/MCP) es
permanente y funciona sin overlay. Prometheus/Grafana/exporters forman un overlay opcional para historia
larga, infraestructura y paneles. Crate Operator conserva el ciclo de incidentes y, con overlay, evalúa
Prometheus directamente. Alloy/Loki/Tempo, adopción home y retirada forman un programa v2 separado.

**Tech Stack:** Python/FastAPI/Dramatiq/SQLAlchemy/Alembic, Redis/PostgreSQL, React/Vitest,
Java/Swift/Rust/Go, Prometheus, Grafana y, en v2, Alloy/Loki/Tempo.

---

**Fecha/base:** 2026-10-31, `main@7460a43eb`.
**Estado:** revisión 2 aprobada en dirección (Prometheus opcional, base permanente, infraestructura
adelantada en shadow, supervisor directo a Prometheus, programa v1/v2). Pendiente de autorización de
ejecución por cortes.
**Diseño:** [Observabilidad de Crate](2026-10-31-observability-design.md).

## 0. Instrucciones de ejecución

- Leer `AGENTS.md` y el scoped correspondiente antes de tocar cada área. SQL/transacciones exclusivamente en
  `app/crate/db/`.
- Al autorizar implementación, actualizar el worktree principal con fast-forward y crear un worktree desde
  `origin/main`, por ejemplo `../crate-observability`. No reutilizar ramas ajenas ni editar en `main`.
- Los paths de **Create** son propuestas; los de **Modify/Test existente** se verifican contra el HEAD de
  ejecución. Una migración recibe el siguiente revision ID real.
- Cada corte: RED del fallo/contrato → cambio mínimo → GREEN → revisión → commit convencional sin
  atribución. Tests acotados durante el desarrollo; validación completa una vez al cierre de cada fase.
- Cada checkpoint entrega diff, resultados, evidencia, riesgos y rollback. Commit/push/despliegue requieren
  la autorización vigente. Activar algo en producción es siempre un paso explícito.
- Cambios visuales de Admin pasan por el showcase existente; no crear otra identidad visual.
- Estos documentos son de diseño: escribirlos no requiere ejecutar tests, crear contenedores ni tocar
  producción.

## 1. Mapa de v1 y checkpoints

| Fase | Cortes | Depende de | Checkpoint (revisión de Diego) |
| --- | --- | --- | --- |
| 0. Infraestructura en shadow y baseline | PR0 overlay infra; inventario | Diseño revisado | **C0**: baseline medido, presupuesto, diccionario, host del probe |
| 1. Base del producto | PR1A integridad; PR1B QoE | C0 | **C1**: integridad y QoE demostrados |
| 2. Dominio | PR2A radio/paths/refill + skip temprano; PR2B nativo | C1 | (se revisa en C3) |
| 3. Productores de la app y paneles | PR3A endpoints; PR3B paneles y reglas | C1 y catálogo de PR2A | **C3**: dominio, multiproceso, paneles, overhead y shadow |
| 4. Incidentes | PR4 supervisor directo, resumen Admin/MCP, probes | C3 | **C4**: fallo/recuperación/entrega y ruido por regla |
| 5. Documentación v1 | PR5 docs GitHub + website | C4 | **C5**: preview y publicación verificada |

Son cortes de revisión, no un número fijo de PRs: un cambio nativo o de empaquetado no revisable se
subdivide conservando dependencias. No ejecutar todos los cortes en paralelo.

**Observabilidad v2** (sección 8) es un programa separado que requiere su propia aprobación tras C5.

## 2. Fase 0: infraestructura en shadow y baseline

### PR0 — Overlay de infraestructura (sin código de Crate)

**Files:**
- Create: `deploy/observability/compose.observability.yaml`, `prometheus.yml`, `grafana/provisioning/`,
  `grafana/dashboards/infra-*.json`, `deploy/observability/README.md`.
- Create: `app/tests/test_observability_compose.py`; job de CI con `promtool check config`.
- Modify: `Makefile` (targets opt-in), sin tocar `docker-compose.yaml` salvo lo imprescindible.

**Secuencia:**
1. Pin de versiones/digests comprobadas al ejecutar, sin `latest`; amd64/arm64.
2. Prometheus, Grafana, node-exporter, postgres-exporter (rol mínimo), redis-exporter para cache y durable
   por separado, cAdvisor con `housekeeping_interval` 30 s, `docker_only` y métricas reducidas.
3. Sin puertos públicos; Grafana solo loopback con credencial generada fuera de Git. Datos en `/var`.
   Retención 90 días con tope de 10 GiB; límites agregados 1 GiB RAM / 1 vCPU.
4. Paneles de infraestructura: host, contenedores, PostgreSQL (`pg_stat_statements`, locks, pool), ambos
   Redis. Cada panel muestra fuente y frescura.
5. Validar compose base+overlay en project/home con profile encendido/apagado y con operador, sin arrancar
   servicios en los tests de parseo. Desactivar el overlay no afecta a Crate.

**Checks:** `promtool check config` con la imagen fijada; `docker compose ... config --quiet` con valores
dummy sin imprimir configuración resuelta; pytest del compose.

### Inventario y baseline

**Files:** Create `docs/technical/evidence/observability/baseline.md` y `coverage-matrix.md`.

**Tareas:**
1. Tras autorización, activar PR0 en producción en **shadow** (sin alertas). Registrar CPU/RSS/disco/IO,
   procesos, volumen de peticiones/eventos, colas y margen del host a partir del overlay, no de consultas
   HTTP sobre la biblioteca.
2. Inventariar por instalación: servicio/release, métricas, DSN presente/ausente sin valor, última
   ingesta, regla y entrega. Distinguir desconocido de desactivado. No imprimir `.env`, tokens ni URLs con
   credenciales.
3. Verificar supervisor/watchdog y un evento diagnóstico Sentry por runtime, con identificador de prueba.
4. Escenario reproducible de 20–30 minutos: navegación, playback continuo, cambio de tema, refill, un
   fallo de red controlado y tareas de background.
5. Fijar el diccionario de intentos/fallos/cancelaciones/stall/starvation/skip temprano y dimensiones.
6. Completar la matriz (proveedores, federación, IA, Connect/SSE/offline, backups) con productor,
   labels, consumidores y prioridad; lo pospuesto queda explícito.

**C0:** Diego revisa baseline medido, coste real del overlay, diccionario y objetivos propuestos. El host
del probe externo queda pendiente por decisión explícita de Diego (2026-10-31); no bloquea shadow ni se
presenta el probe como desplegado. Ningún SLO se presenta como cumplido; iOS/Cast pendientes quedan registrados con
responsable.

## 3. Fase 1: base del producto

### PR1A — Integridad, dimensiones y salud de la recogida

**Files:**
- Modify: `app/crate/metrics.py`, `app/crate/alerting.py`, `app/crate/worker.py`,
  `app/crate/api/admin_metrics.py`.
- Modify: `app/crate/db/repositories/management.py`, `app/crate/db/queries/management.py`.
- Create: `app/crate/observability/metric_catalog.py`,
  `app/crate/db/migrations/versions/<next>_metric_minute_snapshots.py` y ORM/schema asociados.
- Test existente: `app/tests/test_metrics.py`, `test_metrics_middleware.py`,
  `test_runtime_saturation_metrics.py`, `test_operator_alert_rules.py`.
- Create tests: `app/tests/test_metric_minute_integrity.py`, `test_metric_dimensions.py`.

**Secuencia:**
1. RED: un minuto con diez observaciones, dos flushes y un retry siguen dando diez; dos flushers
   concurrentes tampoco duplican.
2. RED: dos runtimes/colas en el mismo minuto permanecen separados; distinto orden de tags es la misma
   serie; un label libre se rechaza/normaliza.
3. Catálogo y namespace v2. Consumidores antiguos agregan por nombre; no se suman namespace viejo y nuevo.
4. Snapshots absolutos por minuto con clave única serie/minuto: el mismo minuto se reemplaza y un snapshot
   anterior a la revisión aplicada se rechaza. **Sin rollup horario mantenido:** las ventanas de 15 min,
   1 h, 24 h y 7 días se agregan en la lectura sobre minutos indexados. Medir el coste de lectura en
   Admin; solo si no cumple su presupuesto, añadir un agregado horario recalculado desde minutos, nunca
   acumulativo.
5. Retención de minutos de ocho días con limpieza incremental por lotes. `metric_rollups` antiguo queda
   como legacy no verificado con fecha de corte; no se borra.
6. Renombrar el máximo y migrar `alert_threshold_api_p95_latency_ms` con alias deprecado; no etiquetar
   como p95 ningún máximo.
7. Contadores locales acotados de buffer lleno/error Redis/muestras descartadas y última escritura,
   consultables aunque Redis falle y sin recursión.
8. El contrato de resumen expone fuente/frescura/disponibilidad/muestra y el corte histórico.
9. Guardar cobertura durable por generación, incluyendo backlog anterior al checkpoint y minutos
   desaparecidos sin fila. Aislar familias/labels futuros y payloads corruptos sin bloquear el lote;
   recuperar cuarentena con recorridos acotados que roten. Reclamación solo con ACK positivo por revisión.
10. Buffer Redis de dos horas como máximo: 24.000 buckets genéricos, 2.000 de rutas y 1.000 samples
    por bucket de ruta. Recuperar historial ya persistido y rotar rutas antiguas; declarar recortes,
    rechazos y backlog. Medir con `volatile-lru` y RDB sin extrapolar a capacidad PostgreSQL o SLO HTTP.
11. Comprobar frescura persistida, cero de slow requests desde población clasificada, endpoint histórico
    con procedencia y ventana diaria compatible, guardas de catálogo y aislamiento del reloj de Nivo.

**Checks:** desde `app/`, `../.venv/bin/python -m pytest tests/test_metric_minute_integrity.py
tests/test_metric_dimensions.py tests/test_metrics.py tests/test_metrics_middleware.py
tests/test_runtime_saturation_metrics.py tests/test_operator_alert_rules.py -q`, con `pg_db`/Redis
aislados para concurrencia y reinicio.

### PR1B — QoE continuo y visible

**Files:**
- Modify: `app/listen/src/lib/playback-qoe.ts`, `app/crate/api/playback_telemetry.py`,
  `app/crate/api/schemas/playback_telemetry.py`, `app/crate/api/admin_metrics.py`,
  `app/ui/src/pages/SystemHealth.tsx`, `app/ui/src/components/system-health/metric-stream-model.ts`.
- Create: `app/listen/src/lib/playback-qoe-store.ts`, `app/ui/src/components/system-health/PlaybackHealth.tsx`
  y sus tests si el panel necesita extracción.
- Tests existentes: `playback-qoe.test.ts`, `test_playback_telemetry.py`, `test_playback_observability.py`,
  `SystemHealth.test.tsx`. Mockup en el showcase existente.

**Secuencia:**
1. RED: más de 24 eventos en varias ventanas siguen observándose; un flood queda acotado y cuenta
   descartes.
2. Batch, token bucket temporal y buffer con TTL fuera del hilo de audio; sin credenciales ni IDs
   musicales.
3. **Rate limit del servidor por dispositivo/sesión de cliente**, con techo por usuario más alto. RED:
   dos dispositivos del mismo usuario dentro de su límite no se rechazan.
4. RED: fallo de red→retry deduplicado; batch expirado; límite de almacenamiento; logout/cambio de
   servidor; cliente anterior; rechazo 401/429. Sin flush infinito ni persistencia entre cuentas.
5. Intents/resultados y duración activa/stall como denominadores. Payload v1 como cobertura parcial.
6. Deduplicación temporal en servidor con ventana/cobertura declarada.
7. Resumen QoE en SystemHealth y mockup con estados `unavailable`, `stale`, `partial` y muestra
   insuficiente.

**Checks:** `npm run --workspace=app/listen test -- src/lib/playback-qoe.test.ts
src/lib/playback-qoe-store.test.ts`; `npm run --workspace=app/ui test -- src/pages/SystemHealth.test.tsx
src/components/system-health/PlaybackHealth.test.tsx`; desde `app/`, pytest de
`test_playback_telemetry.py` y `test_playback_observability.py`.

**C1:** replay/concurrencia, segregación de labels, pérdida visible, legacy distinguido, sesión larga real
o simulación determinista, varios dispositivos por usuario y mockup revisado. Rollback: dejar de producir
v2/payload extendido sin borrar datos; el servidor sigue admitiendo clientes anteriores.

## 4. Fase 2: dominio

### PR2A — Infinite, radio, Music Paths y skip temprano

**Files:**
- Modify: `app/listen/src/lib/radio-continuation.ts`, `app/listen/src/lib/playback-continuation.ts` y
  callbacks consumidores tras trazar propietarios.
- Modify: `app/crate/radio_engine.py`, `app/crate/radio_continuation.py`, `app/crate/music_paths.py`,
  `app/crate/db/paths_service_planning.py`, `app/crate/db/paths_compute.py` según el flujo real.
- Modify: `app/crate/observability/metric_catalog.py`.
- Create: `app/crate/observability/recommendations.py` si evita duplicación; job de skip temprano en el
  worker con su query en `app/crate/db/queries/`.
- Tests: `radio-continuation.test.ts`, `playback-continuation.test.ts`, `test_radio_continuation_contract.py`,
  `test_radio_session_rotation.py`, `test_radio_retrieval_performance.py`, `test_music_paths_runtime.py`,
  `test_paths_performance.py`; Create `app/tests/test_recommendation_observability.py`.

**Secuencia:**
1. RED con máquina de estados: refill oportuno; fallo/retry; agotamiento real; cola vacía involuntaria;
   pause/repeat/skip/final voluntario. Un mismo intento no se cuenta desde UI y motor dos veces.
2. Observaciones de resultados y tiempos en los puntos propietarios sin alterar decisiones, ranking o
   backoff.
3. Etapas de radio/paths con el contexto ya cargado; ninguna query por resultado.
4. Completitud, motivos de relajación y distribuciones de afinidad; features ausentes como cobertura
   ausente, no cero.
5. **Skip temprano:** job en segundo plano sobre `user_play_events` que agrega, por superficie
   (radio/path) y `rules_revision`, los temas entregados que se saltan en los primeros 20–30 s. Ventanas
   acotadas e índices existentes; nunca en una petición HTTP ni sobre `library_tracks` completo.
   Publicado en la base y, con overlay, como counter.
6. Fixtures Citizen/Concubine y punk→electrónica: mismos resultados antes/después.

**Checks:** archivos anteriores con `-q`/Vitest filtrado; medición de consultas y latencia con mismo
catálogo/entorno registrando commit, tamaño, concurrencia y percentiles.

### PR2B — Cobertura nativa y por motor

**Files:**
- Modify: `app/listen/android/app/src/main/java/app/cratemusic/crate/NativePlaybackTelemetry.java`,
  `CrateNativePlaybackService.java` y clases de continuación identificadas por los tests.
- Modify: `app/listen/src/contexts/use-player-playback-observability.ts`, `use-player-playback-runtime.ts`,
  `use-player-engine-callbacks.ts` según propietario.
- Read/modify según contrato: `app/listen/ios/App/`, `app/listen-desktop/src-tauri/src/`,
  `app/cast-receiver/src/receiver-session-runtime.ts`.
- Update: `docs/technical/evidence/observability/coverage-matrix.md`.

**Secuencia:**
1. Propietario por runtime: JS foreground, Android service/background, iOS, Tauri y Cast. No exigir JS
   activo para observar Android en segundo plano.
2. Adaptadores al contrato QoE; el hilo de audio solo encola un evento pequeño.
3. Probar foreground/background/resume, cierre de WebView, cambio de dispositivo, falta de red y
   duplicación al adoptar estado nativo en JS.
4. Cobertura verificada, inferida, no disponible y pendiente de dispositivo por separado.

## 5. Fase 3: productores de la app y paneles

### PR3A — Instrumentos y endpoints internos

**Files:**
- Create: `app/crate/observability/prometheus.py`, `app/crate/observability/metrics_server.py` y tests
  `test_prometheus_metrics.py`, `test_metrics_multiprocess.py`, `test_metrics_endpoint_isolation.py`.
- Modify: `app/crate/metrics.py`, `app/crate/__main__.py`, `app/crate/worker.py`, `app/crate/broker.py`,
  `app/crate/projector_daemon.py`; dependencias Python.
- Modify: `app/readplane/internal/observability/media.go`, `app/readplane/internal/routes/server.go`;
  Create `metrics.go`/`metrics_test.go`.
- Modify: `app/media-worker/src/observability.rs`, `main.rs`, `Cargo.toml` y lockfile.

**Secuencia:**
1. RED: family/type/unit correctos, labels acotados, un counter no depende de ventanas Redis y gauges no
   suman observaciones temporales.
2. `PROMETHEUS_MULTIPROC_DIR` antes del import, tmpfs por contenedor, limpieza única por arranque del
   supervisor y `mark_process_dead` para hijos.
3. Dos hijos reales Uvicorn/Dramatiq o harness equivalente: N+M observaciones en un scrape; reiniciar un
   hijo no duplica ni borra; reiniciar el contenedor produce un reset válido.
4. Registry de exposición aislado; build-info y gauges del supervisor en registry separado.
5. Endpoint interno 9200; Go convierte buckets exclusivos; Rust responde durante un empaquetado largo.
6. Gauges globales con propietario único y timestamps de origen. Deshabilitado no abre sockets ni
   threads al importar en tests/CLI.
7. Migrar al catálogo las familias priorizadas en C0 con tests de semántica.

**Checks:** pytest de los tres archivos nuevos y consumidores; `go test ./internal/observability
./internal/routes` en `app/readplane`; `cargo test observability` en `app/media-worker`.

### PR3B — Paneles de la app y recording rules

**Files:**
- Create: `deploy/observability/recording-rules.yml`, `grafana/dashboards/` de la app,
  `scripts/observability-check.sh`, `app/tests/test_observability_packaging.py`.
- Modify: `deploy/observability/prometheus.yml` y compose para los targets de la app.
- CI: `promtool check rules` y `promtool test rules` con series sintéticas de reset/no-data/low-volume.

**Secuencia:**
1. Los seis paneles del diseño y recording rules: p95 de histogramas agregados, tasas de counters y
   gauges recientes, con fuente/muestra/frescura; IDs nunca como labels.
2. Simular series ausentes, resets, tráfico bajo, errores con 200 de negocio y caídas de collectors. No
   representar missing como cero saludable.
3. Shadow de 7–14 días en producción: CPU/RSS/IO/disco/cardinalidad del overlay completo y comparación
   con el flujo reproducible de C0.

**C3:** dominio (un refill y un path parcial explicados por eventos, falsas alarmas voluntarias
descartadas, queries estables, matriz por runtime), multiproceso y reinicio, aislamiento del endpoint,
caída de Redis, scrape durante trabajo pesado, paneles revisados y overhead dentro del presupuesto. Shadow
no envía alertas.

## 6. Fase 4: incidentes y probes

**Files:**
- Modify: `deploy/operator/supervisor.py` y su configuración (`config.operator.example.json`): consultas
  Prometheus fijas evaluadas por el supervisor; tests `app/tests/test_operator_supervisor.py`,
  `test_operator_alert_rules.py`.
- Create: `app/crate/observability/summary.py` (job de resumen para Admin/MCP),
  `app/tests/test_observability_summary.py`; Modify `app/crate/agent_observability.py`,
  `app/crate/db/ops_runtime.py`, `test_mcp_observability.py`.
- Create: `deploy/observability/probes/` con runner externo y tests;
  `docs/technical/evidence/observability/alert-acceptance.md`.
- Read: `deploy/operator/watchdog.py`, `docs/technical/hermes-operator-release.md`.

**Secuencia:**
1. **Supervisor directo:** allowlist fija de consultas Prometheus con timeout, tamaño y frecuencia
   limitados; reglas de frescura/histeresis/recuperación existentes. No depende de la API, workers ni
   PostgreSQL de Crate. Sin overlay, sigue usando probes y el resumen de la base.
2. RED: Prometheus caído, respuesta antigua, resultado vacío, query inválida, ratio sin denominador y
   sample duplicado no declaran recuperación. Frescura basada en la muestra de origen.
3. **Resumen Admin/MCP:** job opt-in que lee las mismas consultas (o la base) y persiste en `ops_runtime`;
   solo presentación, no alimenta alertas.
4. Reglas por grupos: observabilidad; colas/projector; disponibilidad; playback/refill; degradación
   radio/paths (incluido skip temprano por `rules_revision`). Mantener incidentes/ack/silence/cooldown.
5. Probe externo en el host decidido en C0, credencial mínima y recurso sintético excluido del historial:
   DNS/TLS/auth, primeros bytes/decodificación y reproducción periódica completa.
6. Demostrar que probe y watchdog detectan fallo funcional y caída de la monitorización con la API y
   Prometheus del host caídos.
7. Activar por regla tras shadow y revisión; no todas a la vez.

**Checks:** pytest del supervisor, resumen y MCP; tests de reglas; integración aislada con canal de prueba
autorizado, sin mensajes a usuarios reales.

**C4:** un fallo y una recuperación de cada clase, sin duplicados; entrega real en el canal de prueba;
ruido observado y umbrales aprobados. Rollback: desactivar reglas nuevas conservando incidentes y probes.

## 7. Fase 5: documentación v1

**Files:**
- Modify: `README.md`, `docs/README.md`, `docs/manifest.json`.
- Create/Update: `docs/technical/observability.md` (base del producto, overlay opcional, alertas,
  retención, desactivación y rollback), `operations.md`, `crate-operator.md`, `storage-retention.md`,
  `deploy/observability/README.md`.
- Test/Read: `app/docs/AGENTS.md`, `app/docs/src/content.ts`, `content.test.ts`, `smoke.test.tsx`,
  `scripts/check-docs.mjs`, job `crate-docs` de `build-images.yml`.

**Secuencia:**
1. Contrastar documentación con flags, comandos, defaults, dashboards, retención, permisos y cobertura
   efectiva. Separar disponible, opt-in, limitaciones y lo pospuesto a v2.
2. GitHub: README e índice actualizados; documentación pública versionada, sin depender de `docs/plans/`.
3. Website: `docs/technical/observability.md` registrado en `docs/manifest.json`, sección `operations`,
   ruta `/operations/observability`, con frontmatter completo.
4. `npm run check:docs --prefix app/docs`; `npm test --prefix app/docs -- src/content.test.ts
   src/smoke.test.tsx`; `npm run build --prefix app/docs`; preview revisado.
5. Publicación por el flujo normal y verificación en GitHub y `https://docs.cratemusic.app`.

**C5:** Diego revisa la documentación y el preview; se registra la publicación verificada. Documentación
preparada no equivale a publicada.

**v1 termina en C5** con base corregida, overlay en producción, paneles, alertas probadas y documentación
publicada. Lo no entregado se enumera en la propia documentación.

## 8. Observabilidad v2 (programa separado)

Requiere aprobación propia tras C5. Conserva las reglas del diseño:

- **Logs:** contrato JSON y redacción en origen (tickets Cast, Subsonic, cookies, tokens, paths
  personales, parámetros SQL); `wlog` se conserva. Alloy/Loki solo tras checkpoint de presupuesto y valor,
  con proxy de Docker de lectura y allowlist. Si no aporta valor, se conserva JSON y se pospone Loki.
- **Trazas:** propagación browser→API→tarea→worker, allowlist de destinos/CORS, sanitización de
  transacciones, scrub selectivo en Tauri y symbolication verificada. Tempo opcional, justificado frente a
  Sentry.
- **Adopción home/installer:** integración opt-in en `deploy/install/integrations.yaml` e installer, sin
  rotar secretos ni activar servicios inesperados; pruebas amd64/arm64 con y sin operador y sin overlay.
- **Retirada:** solo con overlay activo y por familia, tras 14 días consecutivos de paridad; en
  instalaciones sin overlay la base no se retira. Histórico legacy etiquetado y rollback de al menos una
  release. No borrar `user_play_events`, uso de IA, `wlog` ni domain events.
- **Documentación v2:** mismo cierre que la fase 5 para el alcance de v2.

## 9. Registro de checkpoints

| Checkpoint | Estado inicial | Evidencia requerida | Revisión |
| --- | --- | --- | --- |
| Diseño/plan rev. 2 | Pendiente de autorización de ejecución | Estos dos documentos | Diego |
| C0 | Pendiente | Overlay infra en shadow, baseline medido, presupuesto, host del probe | Diego |
| C1 | Pendiente | Integridad, dimensiones, QoE multi-dispositivo y mockup | Diego |
| C3 | Pendiente | Dominio + skip temprano, matriz por runtime, multiproceso, paneles, shadow | Diego |
| C4 | Pendiente | Supervisor directo, fallo/recuperación/entrega, ruido por regla | Diego |
| C5 | Pendiente | Documentación v1, preview y publicación verificada | Diego |
| v2 | No iniciado | Aprobación separada tras C5 | Diego |

Para cada corte registrar: SHA, flags, entorno, cambios, tests acotados, medición de coste, limitaciones,
decisión de revisión y siguiente paso. No incluir secretos, biblioteca de producción ni payloads musicales
personales en evidencias.

## 10. Registro de ejecución — PR0

- 2026-10-31: Diego autoriza crear rama/worktree desde main y comenzar PR0.
- Worktree `/Users/diego/Code/crate-observability`, rama `codex/observability-infra`, base `7460a43eb`.
- PR0 implementado y publicado en borrador: https://github.com/thecrateapp/crate/pull/309.
- Head: `b7716b8b2dab554347093a6c08c973cc1d3d6288`. SPEC y QUALITY revisados.
- Validación local: 42 checks offline y smoke opt-in con 4 pruebas; config Prometheus, 24 expresiones de paneles, HAProxy, Ruff y Prettier correctos.
- CI Linux: 39 checks de configuración y 4 pruebas de runtime correctos, incluidos host/cgroups, PostgreSQL y ambos Redis. Run: https://github.com/thecrateapp/crate/actions/runs/41189880227.
- Correcciones verificadas: Grafana necesita bridge de acceso adicional para el puerto loopback; CI usa el driver overlay2 admitido, sin ampliar sockets/privilegios. Backend containerd permanece fuera de la integración actual.
- Estado anterior a preflight: PR0 pendiente de merge/activación; PR1A no iniciado.
- Diego autoriza continuar con integración y shadow. El preflight identifica Docker 29.4.3, driver `overlayfs`, cgroup v2 y containerd `/run/containerd/containerd.sock` en producción. No se cambia el daemon ni el image store.
- Diego elige **adaptar y validar overlayfs antes de activar**; queda descartada la activación parcial con cobertura de contenedores pendiente. El host del probe externo se deja pendiente expresamente.
- Adaptación en `ad2e100c75c69a73b51607a28bf1f59bb0890282`: override opt-in `OBS_CONTAINERD=1`, mismo proxy/presupuesto, único RPC `Containers/Get` en namespace `moby`, sin acceso directo de cAdvisor al socket host. CI valida `overlay2` y `overlayfs`, RPC positivo y rechazos HTTP/2. Configuración: 61 checks correctos; CI real de la adaptación en curso.
- **C0 pendiente:** compatibilidad real Linux de la adaptación, merge, activación shadow e inventario/baseline medido. Ningún cambio de producción realizado durante el preflight. PR1A no iniciado.

### C0 — estado tras integración y shadow

- PR0 mergeado en `248636d511d7356b732b908bc07ba0b50fdb9b97`, PR #309. Head revisado `44b1ef4b0b85e112dd948b8aa56b2410b1faf5f3`; SPEC/QUALITY PASS. La revisión cerró el bypass de rutas de socket fuera de `/run` y la divergencia de variable entre Make y `.env`.
- CI final: run `41192009582`, Linux overlay2/overlayfs correctos (65 contratos por runner; 16 pruebas runtime en overlayfs / 4 en overlay2). Run `41192050270`, cierre backend completo correcto; no repetir suites completas durante el siguiente desarrollo.
- Shadow activado desde el SHA mergeado, sin actualizar checkout/configuración de la aplicación ni cambiar Docker. Se conservan IDs y horas de arranque de los 26 contenedores existentes. Seis targets y dependencia PG/Redis correctos; sin alertas del overlay.
- Evidencias iniciales: `docs/technical/evidence/observability/`. Seis muestras entre 10:32:24 y 10:37:24 UTC, 2026-10-31; memoria 239–343 MiB, cero reinicios/OOM. CPU/throttling parcialmente disponibles en tres muestras; IO de 3/8 servicios. No tratar ausencias como cero ni extrapolar capacidad/retención desde cinco minutos.
- Cobertura: 30/34 servicios; el relabel `crate-.+` excluye nginx/slskd/tidarr/traefik. Registrar y resolver esta allowlist finita antes de afirmar cobertura completa. No ampliar permisos de sockets ni labels arbitrarios.
- Supervisor leído por API: heartbeat reciente, estado `ok`, 13 fuentes válidas y 9 gaps declarados; sin entregas pendientes/fallidas. DSN backend presente y heurística de bundles frontend positiva; ingesta/symbolication por runtime pendiente. `SENTRY_RELEASE` backend desactualizado frente al release real, registrado sin redesplegar.
- **C0 no aprobado todavía.** Recorrido autenticado de 20–30 minutos y verificación de ingesta/entrega pendientes; sesión del navegador disponible cerrada. Se preguntó a Diego cómo realizar el recorrido. Host del probe externo pendiente por decisión explícita. PR1A no iniciado.

### C0 — recorrido autenticado realizado por el agente

- Diego delega finalmente el recorrido y facilita sesión autenticada en Listen. Ventana de cliente2026-10-31,12:10:29–12:36:42 CET, pausa confirmada después. Red de la pestaña restaurada; sin cambios de preferencias ni código/configuración de producción.
-26 muestras de infraestructura en25 minutos:6 targets/dependencias correctos,0 reinicios/OOM,349.6–384.2 MiB de working set. CPU de la consulta existente5m:8/8 servicios en todos los pasos,0.0354–0.0433 cores; las sumas exploratorias2m siguen parciales. Grafana252.4/256 MiB(98.6%) exige revisión individual de presupuesto.
- Álbum publicado: HTTP200 de radio,30 temas añadidos y salto natural a recomendación. Álbum en preventa parcial: InfiniteON termina vacío, porque `albumRadioSeed=null` elimina metadata radio y la guardia supported devuelvefalse. Registrar limitación/follow-up de producto; no se modifica el player/ranking dentro de observabilidad.
- Corte de red de cliente16.061s: progreso continuó, API/Sentry volvieron a devolver respuestas correctas. No se acredita stall/recuperación audible. Tres lotesQoE204 observados; no prueba de almacenamiento/ingesta/symbolication completa.
- Captura de red parcial:2 desbordamientos de buffer y un404 de recurso normalizadoother duranteRadar sinURL/cuerpo retenido; causa/impacto por revisar. Sin fabricar denominadores completos ni considerar ausencia igual a cero.
- Evidencias: `docs/technical/evidence/observability/functional-review.md` yJSON/JSONL enlazados. C0 sigue sin aprobación; quedan presupuestoGrafana,4 contenedores acompañantes excluidos,404 y cobertura por runtime/ingesta. Probe externo continúa pendiente. PR1A no iniciado.

### C0 — remediación y estado final del runtime

- Diego autorizó ampliar el margen de Grafana, completar la cobertura de contenedores, clasificar el 404 y verificar Sentry. Confirmó que no usa Tidarr y autorizó retirarlo conservando sus datos.
- PR #310 integrado y desplegado como `6681be8017b60865c00af61c3edc6f17696175b7`, con 25 comprobaciones de PR aprobadas. El esquema permanece en la revisión 140; API, readplane y rutas públicas verificadas. No se han publicado tags de Desktop.
- Tidarr retirado a las 12:58:49 UTC. Su estado final contiene 46 archivos verificados, con todos los binds conservados y sin eliminar volúmenes. Backup privado: `/home/crate/crate/data/retired/tidarr/20261031T125751Z-recovered`. El error PAX del primer tar fue de normalización de nombres: los contenidos se conservaron y el snapshot corregido se verificó antes de retirar el contenedor.
- Overlay actualizado y listo a las 13:23:38 UTC, con una pausa controlada de 629 segundos. Se reutilizaron datos, secretos y cuenta PostgreSQL de observación. Grafana 384 MiB y Prometheus 256 MiB dentro del presupuesto total de 944 MiB / 1 CPU. Los seis targets y PostgreSQL/Redis pasan; cobertura de memoria de 33/33 IDs actuales.
- Seis muestras entre 13:24 y 13:29 UTC sin OOM ni reinicios. Máximos observados: 384.19 MiB agregados y 0.0324 cores; Grafana 245.82 MiB y Prometheus 77.82 MiB. Se verificó que el histórico de Prometheus de las 13:10 UTC seguía disponible. No se extrapola capacidad a largo plazo.
- Cuatro receipts Sentry verificados: API, worker Python, Go y Rust. Nueve roles backend coinciden con el source_sha de su imagen. Go reutiliza `82ea847…`; Python/Rust usan `6681be8…`. El fallback manual no cambió. Son diagnósticos de procesos secundarios, sin reiniciar servidores; no prueban todos los caminos de instrumentación ni el cliente Desktop instalado.
- El 404 de Radar es una portada externa inexistente de Cover Art Archive. El fallback ya está cubierto; no se ha enmascarado el HTTP. La continuación de Infinite en álbum publicado pasó, pero el álbum parcial de pre-release sin radio seed sigue como seguimiento funcional separado.

### Incidencia de retención y cierre operativo

- La limpieza de despliegues ordenaba nombres y eliminó `c0-20261031-validation` frente a cinco nombres antiguos. No se recuperó una copia autoritativa del entorno completo previo. No confundir una reconstrucción con un backup exacto. Base de datos, biblioteca, backups de Tidarr y configuración en ejecución no se eliminaron.
- Existe un checkpoint POSTDEPLOY verificado de la configuración actual, fuera de limpieza y de montajes de datos de las aplicaciones: `/home/crate/.deployment-config-backups/20261031T133257Z-post-c0`, con permisos 0700/0600 y diez archivos verificados. No es recuperación del estado anterior, backup de base de datos ni restore drill.
- PR #312 integrado como `75b442401bfbca8646efe5f684fca36dd9aab31d`, tras 12 comprobaciones de CI aprobadas. Protege el snapshot actual y conserva otros cuatro por mtime; si el actual falta o es symlink, no borra snapshots. Cuatro casos reales RED→GREEN, 112 pruebas acotadas y 25 skips de macOS; revisión independiente aprobada.
- Helper instalado atómicamente a las 13:53:47 UTC, SHA256 `52b609963fef2e17067b16efc65a298d23bb115cf491296759cd27f3924a731a`. Se conserva el helper anterior. No se ejecutó otra limpieza ni se reinició ningún contenedor. La aplicación sigue en `6681be8…`; la procedencia del helper se registra por separado.
- Comprobación final de las 13:58 UTC: 33 servicios saludables/en ejecución, seis targets accesibles, cobertura de memoria 33/33, cuatro receipts y histórico anterior a la pausa conservado.
- Evidencias finales publicadas para revisión en PR #313, rama `codex/observability-c0-evidence`, commit `97c0e3b4f681303c55c5a4ffb53e06b27691417c`. Incluye índice actualizado, rollout y recibos finales. No cambia runtime.

**Checkpoint:** remediación operativa terminada; C0 espera revisión de Diego. PR1A no ha empezado. El host del probe externo sigue diferido por decisión explícita.

### Seguimientos para las fases de adopción y documentación

- PR5: retirar la frase obsoleta de Tidarr en `app/web/src/content/architecture/en.ts`, además del comentario histórico en `app/crate/library_watcher.py` y la expectativa del mockup archivado `tools/design-system-preview/admin-operations-checkpoint.spec.ts`. No representan dependencias activas.
- Al adoptar el host infra bridge, comprobar su helper y server_path: `.deploy/deploy-remote.sh` está actualizado, pero `scripts/deploy-remote.sh` del checkout histórico del servidor es antiguo. No se encontró bridge provisionado/activo, así que no se sincronizó ese helper a ciegas.
- Rendimiento operativo pendiente: `scripts/hermes_context.py` empaqueta 4,141 archivos con dos procesos Git por archivo; preflight y deploy repiten el cálculo. Evaluar lectura batch manteniendo whitelist, blobs regulares, tamaños y hashes. No se cambió este mecanismo de confianza en C0.


### C0 aprobado; inicio de PR1A

- 2026-10-31: Diego aprueba C0 y autoriza PR1A, delegando los objetivos iniciales. PR #313 integrado como 6b1803c4506312b6550fb548cce8ffb333443e20.
- Worktree: /Users/diego/Code/crate-observability-integrity; rama codex/observability-integrity desde main. Producción permanece sin cambios.
- Baseline acotado de test_metrics.py y test_metrics_middleware.py:15 passed. RED real Redis/PG:6 fallos/1 passed; replay cuenta30 en lugar10 y concurrencia20 en lugar10; dimensiones colapsan y se guardan tags libres.
- Checkpoints PR1A: identidad/snapshots absolutos; integración de consumidores y salud de recogida; retención/performance y cierre. Ver el registro versionado c0-acceptance.md.

### PR1A — checkpoint de identidad y minutos absolutos

- Implementados catálogo cerrado (819 nombres activos), namespace Redis v2, identidad por dimensiones, escritura Lua atómica, snapshots absolutos por minuto y migración/ORM 141. Los históricos legacy no se combinan con v2.
- Corregidos además pérdida de sufijos de rutas, target OpenSubsonic, propagación de source_gap dentro de un lote, límite del índice antes de descargarlo y carreras de reinicio/escritura durante el ACK.
- Validación acotada: 79 casos verdes con Redis/PostgreSQL aislados y consumidores próximos; Ruff y revisión independiente sin hallazgos pendientes en este corte. No suite completa ni cambios en producción.
- Registro versionado: docs/technical/evidence/observability/pr1a-checkpoint-1.md. PR1A sigue abierto en desarrollo: quedan salud y disponibilidad en consumidores, renombrar el máximo, corte histórico, conectar retención y medir ventanas antes de publicar.


### PR1A — checkpoint de recogida y consumidores

- Completados estados de disponibilidad/frescura/muestra, contadores locales y buffer acotado con TTL, corte durable v2, cache de Admin sin diagnóstico de otros procesos, máximo real y alias deprecado. SQL/MCP/Operator conservan fechas y rechazan salud incierta.
- Admin valida cuatro poblaciones y pérdida local, expira muestras sin polling y conserva la cola a partir de su resumen fresco. Mockup compartido con Storybook en /review-observability-integrity.html; seis estados, desktop y móvil sin llamadas API.
- Evidencia: docs/technical/evidence/observability/pr1a-checkpoint-2.md. Tests acotados:133 backend,24 UI,2 navegador; revisiones SPEC y quality aprobadas. Chequeos Admin y escena acotada verdes; dos errores previos del typecheck global de Storybook quedan documentados, sin migrar otras escenas.
- Sin publicación/despliegue. Siguiente: retención incremental de ocho días, coste de ventanas indexadas/Admin y cierre de PR1A. QoE continuo corresponde a PR1B.

### PR1A — checkpoint de retención y lectura acotada

- Retención de ocho días: lote de 1.000 filas cada minuto, independiente del flush de cinco minutos, un solo hilo en vuelo, timeouts 500/50 ms y savepoint que conserva la transacción del llamador. Los fallos se reintentan sin bloquear scheduler/Auto DJ; legacy y fecha de corte permanecen.
- Lecturas UTC por lotes: máximo 32 familias/12.000 puntos, índice covering en 141, una consulta PostgreSQL para todos los gráficos Admin, fuentes y watermarks visibles. Resumen/score/cola siguen en Redis. Rutas mantienen 60 minutos con preflight y límites explícitos; hiredis 3.5.0 reduce coste del parser. No se añade rollup horario mantenido.
- Benchmark controlado de 100 series/1.152.000 filas, 100 operaciones con concurrencia diez: p95 Admin cold 1h 456,7 ms y 24h 487,2 ms; PostgreSQL 7d 65 ms. Objetivos locales 500/250 ms cumplidos, sin errores ni familias vacías. No son latencias HTTP/SLO de producción. Capacidad a 500 series pendiente: preparación detenida al llegar a tres minutos, antes de medir. Smoke de retención 1.000 filas 35,1 ms con rollback, sin extrapolación de throughput.
- Revisiones SPEC y quality aprobadas. SPEC corrigió pérdidas locales antes de primera escritura o tras escritura obsoleta: prevalece partial y no se certifica salud con datos globales de otros procesos. Cierre acotado conjunto: 640 casos backend, 31 Admin y dos navegador verdes; Pyright/Ruff, build/budget Admin y React Doctor sin hallazgos nuevos. No suite global durante desarrollo.
- Evidencia versionada: docs/technical/evidence/observability/pr1a-checkpoint-3.md y .ecc/benchmarks/observability-pr1a/. Producción intacta; PR1A listo para revisión del corte, todavía sin commit/push/PR. Siguiente bloque: PR1B QoE continuo; C1 y validación global de fase siguen pendientes.

### PR1A — correcciones de revisión, 2026-11-01

- Resueltos reinicio/reset antes del primer flush, backlog perdido, aislamiento y recuperación de cuarentena, ACK positivo, límites y reclamación Redis, rotación de rutas, lecturas incompletas, frescura persistida y cero clasificado de Slow Requests.
- Endpoint histórico con procedencia y compatibilidad diaria; guardas del catálogo; metadata SQL emitida una vez; backlog de flush/retención visible; downgrade limpia solo settings v2; Nivo no se reconstruye por el reloj de página.
- 239 casos afectados de métricas/migración/API y seis guardas DB pasan juntos: 245/245. Frontend acotado verde, Pyright/Ruff y revisiones independientes SPEC y QUALITY aprobadas. Sin suite global de plataforma ni cambios de producción.
- Harness Redis portable, hashes y límites documentados en .ecc/benchmarks/observability-pr1a/review-buffer-bounds/. Todos los writes saludables aceptados con ACK simulado; no prueba capacidad de escritura PostgreSQL.
- Checkpoint local: docs/technical/evidence/observability/pr1a-review-corrections.md. Se mantienen separados los worktrees D1 y Stack Map. Sin commit/push; PR1B, D2, C1 y actualización final de documentación GitHub/website conservan sus checkpoints.

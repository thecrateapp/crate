# Plan: métricas completas (PR1B–Fase 4) y KPIs de producto

Fecha: 2026-11-01. Estado: propuesta para revisión de Diego. Amplía el programa de
`2026-10-31-observability-implementation-plan.md` (PR1B, PR2A, PR2B, PR3A, PR3B, Fase 4 y
Fase 5) y añade KPIs de producto, que no estaban en ningún plan.

## 1. Alcance

| Bloque | Qué entrega | Dónde se ve |
| --- | --- | --- |
| PR1B QoE continuo | Telemetría de reproducción fiable (batch, rate limit por dispositivo, dedup), intents/resultados, stalls, recuperación | Admin, System Health: panel "Playback health" |
| KPI | Tabla diaria de KPIs de producto, job diario, backfill y página Admin "Product" | Admin, Product; Grafana opcional (decisión D3) |
| PR2A | Infinite/radio refill y starvation, Music Paths (latencia, completitud, relajación), skip temprano por superficie y `rules_revision` | System Health y, tras PR3, Grafana |
| PR2B | Cobertura nativa: Android en segundo plano, iOS, Desktop (Tauri), Cast | Matriz de cobertura y QoE por runtime |
| PR3A | Exportadores Prometheus: Python multiproceso (API/workers/projector), readplane (Go), media worker (Rust) | Prometheus |
| PR3B | Seis dashboards de la app y recording rules, shadow de 7–14 días | Grafana: Overview, Playback/Infinite, Radio/Paths, Workers/Projector, PG/Redis/host, Telemetry Health |
| Fase 4 | Reglas del supervisor de Operator sobre Prometheus, resumen Admin/MCP, probes externos, aceptación de alertas | Telegram (Operator), Admin, MCP |
| Fase 5 | Documentación v1 en GitHub y web de docs | docs.cratemusic.app |

Se mantienen las reglas del diseño: catálogo cerrado de labels (nunca usuario, pista, artista, ID ni URL),
missing distinto de cero, nada de COUNT sobre `library_tracks` en una petición, el éxito de una operación
no depende de registrar su métrica.

## 2. KPIs de producto (diseño nuevo)

### Almacenamiento

`metric_minute_snapshots` retiene 8 días y no admite desgloses por entidad, así que los KPIs van a una
tabla propia con migración Alembic:

`product_kpi_daily(day DATE, kpi TEXT, dims JSONB, value DOUBLE PRECISION, sample INTEGER, computed_at TIMESTAMPTZ)`,
PK `(day, kpi, dims)`. `dims` usa claves y valores de un catálogo cerrado (plataforma, fuente, origen,
proveedor), nunca identidades. `sample` permite ocultar desgloses con menos de 3 usuarios (mismo umbral
que PD43 en Crate Pulse). Escritura idempotente: DELETE + INSERT por día bajo advisory lock.

### Job

Tarea periódica `compute_product_kpis` registrada en `DEFAULT_SCHEDULES` (cada hora, recalcula hoy y
ayer; los días cerrados no cambian), pool `maintenance`, gobernada por el resource governor. Lee
rollups existentes (`user_daily_listening`, `instance_track_daily`, `user_listening_sessions`) y tablas
pequeñas. Un backfill acotado reconstruye el histórico que las fuentes conservan.

Fuentes que borran filas (tareas terminadas a los 7 días, sesiones a los 3 días) y métricas con 8 días
de retención (streams, transcoding) se consolidan a diario en la tabla antes de perderse; su histórico
empieza el día del despliegue.

### Catálogo inicial

| Grupo | KPIs | Fuente |
| --- | --- | --- |
| Usuarios | Totales, altas/día, invitaciones aceptadas, DAU/WAU/MAU, stickiness (DAU/MAU), retención por cohorte semanal (W1, W4) | `users`, `auth_invites`, `user_daily_listening`, `user_devices` |
| Escucha | Reproducciones, horas escuchadas, oyentes únicos, ratio completadas/saltadas, sesiones y duración media; por plataforma, fuente y origen local/remoto | `user_daily_listening`, `user_listening_sessions`, `instance_track_daily` |
| Biblioteca | Artistas, álbumes, pistas y tamaño (snapshot diario), crecimiento, % del catálogo escuchado en 30 días | snapshot diario de totales, `library_artists.first_seen_at`, `instance_track_daily` |
| Adquisición | Peticiones, completadas, fallidas, bytes y tiempo hasta completar por fuente (Soulseek, Tidal, Bandcamp, uploads, importaciones federadas) | `tasks` (snapshot diario), `tidal_downloads`, `bandcamp_imports`, `import_queue_items`, `federation_import_requests` |
| Engagement | Likes, seguimientos, álbumes guardados, playlists y crates creadas, scrobbles enviados y fallidos | tablas de actividad con `created_at` |
| Plataformas | Dispositivos activos por plataforma y versión de app | `user_devices` |
| Federación | Peers activos, streams remotos, bytes importados | `federation_nodes`, `federation_stream_tickets`, `federation_import_requests` |
| Streams | Streams, transcodificaciones completadas y fallidas, bytes (consolidado diario de las métricas) | `metric_minute_snapshots` antes de la poda |

### Superficie

Página Admin "Product" en la sección Insights, con API `/api/admin/kpis` que solo lee la tabla (cache y
`response_model` como `_build_metrics_dashboard`). Ventanas 7/30/90/365 días, comparación con el periodo
anterior, desglose por dimensión con umbral de muestra, estados unavailable/partial/stale. Solo
agregados, sin nombres.

### Rendimiento

`user_play_events` no tiene índice por tiempo; el job no lo escanea entero. Si algún KPI necesita
eventos crudos, migración con un índice BRIN sobre `created_at` (barato y adecuado para inserción
cronológica) en vez de un B-tree. Ninguna lectura de KPIs construye snapshots en la petición.

## 3. Orden de ejecución

0. Merge de las tres ramas actuales (integrity, deployments, stack-live) tras PR y revisión. Las nuevas
   ramas salen de `main` para no apilar cinco ramas sin integrar.
1. PR1B y KPI en paralelo (independientes): ~3–4 días cada uno.
2. PR2A: ~4–5 días.
3. PR2B: ~4–6 días más tiempo de dispositivo físico (Android, iOS) por parte de Diego.
4. PR3A: ~5–7 días.
5. PR3B: ~3–4 días más shadow de 7–14 días en producción.
6. Fase 4: ~5–7 días; reglas activadas una a una tras shadow.
7. Fase 5: ~2 días, publicación verificada.

Total aproximado: 6–8 semanas de trabajo más los periodos de shadow. Cada bloque: tests acotados
durante el desarrollo, validación completa una vez al cierre, checkpoint con evidencia, commit local;
PR, merge y despliegue solo con OK explícito.

## 4. Decisiones para Diego

- **D1. Ramas:** merge de las tres ramas actuales antes de empezar (recomendado) o seguir apilando.
- **D2. Retención de KPIs:** indefinida (recomendado; una fila por KPI y día es poco) o 2 años.
- **D3. KPIs en Grafana:** solo Admin (recomendado para empezar) o datasource PostgreSQL de solo lectura
  en Grafana con un rol limitado a `product_kpi_daily`. Lo segundo es una exposición nueva de la base.
- **D4. Probes externos (Fase 4):** host donde corren (fuera del servidor de producción para detectar su
  caída) y credencial sintética de mínimo privilegio.
- **D5. Canal de alertas:** Telegram vía Operator con un canal de prueba durante la aceptación.
- **D6. Definición de "usuario activo":** la existente (`CRATE_USER_INACTIVE_AFTER_DAYS`, 30 días por
  login, presencia o escucha) para MAU, y "escuchó al menos una pista" para DAU (recomendado).

## 5. Decisiones tomadas (Diego, 2026-11-01)

- D1: merge de las tres ramas actuales antes de empezar; las ramas nuevas salen de `main`.
- D2: retención indefinida de KPIs.
- D3: KPIs solo en Admin (página Product); sin datasource PostgreSQL en Grafana.
- D4: probes externos pospuestos; en la Fase 4 el supervisor usa solo consultas a Prometheus y el
  resumen de la base. Queda registrado como hueco en la documentación.
- D5: alertas por Telegram vía Operator con canal de prueba.
- D6: DAU = escuchó al menos una pista; MAU = definición existente (`CRATE_USER_INACTIVE_AFTER_DAYS`).

## 6. Bloque 3D del Stack map (aprobado por Diego, 2026-11-01)

Vista 3D opcional con cúpulas en three.js, a partir del piloto en la rama `codex/stack-map-3d-pilot`
(`3902d51fc`, worktree `/Users/diego/Code/crate-stack-3d`). Diego aprueba `three` como dependencia,
incluidos `three/examples/jsm` (Line2, post-proceso, BufferGeometryUtils), y la excepción a la regla de
instrumentos hechos a mano (`app/ui/AGENTS.md:40`, DS §3.5) para la vista 3D de topología. La enmienda se
documenta en ambos sitios.

Se hace tras el merge de las tres ramas actuales, en rama propia desde `main`:

1. Mover modelo, cámara, shell y renderer a `app/ui/src/components/admin/`, renderer como chunk lazy.
2. Toggle 2D | 3D en el toolbar del mapa, selección compartida, preferencia persistida (2D por defecto).
3. Sin 3D por debajo de ~880px; vuelta real al 2D si no hay WebGL2 o se pierde el contexto.
4. Tokens para intensidades, tiempos de cámara y anchos de línea; `color(srgb …)` en la capa compartida.
5. Vitest (modelo, cámara, colisión de etiquetas, pulses) y spec Playwright con cámara determinista.
6. Pulido: etiqueta FAILING junto al halo, haz de Edge, tooltip tras fly-to, nodos traseros no clicables.

Estimación: 4–6 días. Puede ir en paralelo con PR1B y KPI.

## 7. Registro de ejecución

- 2026-11-02: PRs #324 (PR1A), #323 (deployments) y #325 (Stack map) abiertos, CI en verde, a la
  espera del OK de merge. Los bloques siguientes avanzan en local, apilados y sin push, para
  rebasarlos sobre `main` tras el merge.
- KPI (rama `codex/product-kpis`, worktree `/Users/diego/Code/crate-product-kpis`, sobre
  integrity): migración 142 (`product_kpi_daily` + BRIN en `user_play_events.created_at`), job
  horario con backfill de un año, API `/api/admin/kpis` con supresión de segmentos menores de 3,
  página Admin "Product" y documentación. Commits `8f93fc0f3`…`c21a4666c`.
- 3D (rama `codex/stack-map-3d`, worktree `/Users/diego/Code/crate-stack-map-3d`, sobre stack-live
  `ac07962c3`): integración completa en `app/ui`, toggle 2D|3D, fallback, tokens, tests y docs.
  Commits `41f7d0529`…`392452c2b`. Pendiente rebase tras `621ca93bf` en stack-live.
- Siguiente: PR1B (QoE continuo).

## 8. Sección de observabilidad en el website (Diego, 2026-11-02)

Tras la documentación (Fase 5), una sección de observabilidad en cratemusic.app (`app/web`), siguiendo
el mismo patrón, estructura de secciones, copy y lenguaje visual que el resto del site (tokens,
tipografía, motion y componentes existentes; sin estilos nuevos). Contenido: qué ve un operador en
Admin (System Health, mapa en vivo del Stack, KPIs de producto), la monitorización opcional con
Prometheus/Grafana desplegada aparte, privacidad (solo agregados, missing no es cero) y enlace a
docs.cratemusic.app/operations/monitoring. Revisión visual con Diego antes del merge, tests y build
de `app/web` (vitest, astro check, Playwright de páginas y a11y) en verde, y release con el bump
3.1.x correspondiente.

Orden actualizado: PR1B → PR2A → PR3A/PR3B (shadow) → Fase 4 → PR2B (en paralelo) → Fase 5
(documentación) → sección del website.

## 9. Releases

- 2026-11-02: Crate 3.1.0 (tag `v3.1.0` sobre `7dc1b7ff5`) con C0, PR1A, deployments, mapa en vivo y
  VirtualDJ en servidor. Los siguientes merges de observabilidad suben parche 3.1.x.

## 10. Observabilidad en MCP, Crate Agent y Crate Operator (Diego, 2026-11-02)

Amplía la Fase 4 (que ya incluía el resumen Admin/MCP en `ops_runtime` y las reglas del supervisor):

- **MCP (`crate-mcp`):** herramientas de solo lectura con contrato cerrado y tests, que leen los
  snapshots existentes y nunca agregan en la petición: resumen de System Health (procedencia y
  disponibilidad incluidas), QoE de reproducción (`playback_qoe`), KPIs de producto por ventana
  (con supresión de segmentos <3), inventario del Stack (servicios, salud, recursos) y estado de
  la monitorización (release activa, deriva, último deploy, adopción). Missing nunca como cero.
  Capacidad y scopes revisados; documentación en `docs/technical/crate-mcp.md`.
- **Crate Agent (Telegram, solo lectura):** usar esas herramientas para responder sobre salud,
  reproducción, KPIs y monitorización, con el contexto técnico actualizado (`deploy/hermes`) y
  aceptación con fixtures como el resto de capacidades del agente.
- **Crate Operator:** (1) reglas del supervisor sobre Prometheus y los nuevos resúmenes (QoE,
  monitorización caída o desviada) con histéresis, recuperación y canal de prueba; (2) extender
  su contrato revisado con acciones de observabilidad aprobadas por humano —`observability-deploy`
  de un SHA de main, `observability-rollback` y `status`— usando el mismo lease de host, con
  política, tests de contrato y reprovisionado documentado. Las acciones no soportadas siguen
  rechazándose.

Encaje: tras PR3A/PR3B (para tener las series en Prometheus) y junto a la Fase 4; release 3.1.x
propia.

## 11. Estado a 2026-11-02

- Releases: 3.1.0 y 3.1.1 publicadas y desplegadas. La 3.1.1 está en el merge `17a30a9`, con
  esquema 142, e incluye KPIs (#327), 3D (#328), el host real (#332), overlays persistentes (#334)
  y notas (#335).
- Pila 1: #336 (PR1B, QoE v2 y Playback health) y #339 (PR2A, radio, paths y skip temprano; base
  #336).
- Pila 2: #337 (PR3A, exportadores Prometheus), #338 (PR3B, recording rules y dashboards; base
  #337) y #340 (Fase 4, alertas, resumen y MCP; base #338).
- Decisión nueva: el supervisor de Operator también entra en la red `prometheus-query` (aprobado
  por Diego).
- Pendiente: PR2B (cobertura nativa), las acciones de Operator para desplegar monitoring (PR
  propio), Fase 5 (documentación y website) y activar las reglas tras el shadow de 7 a 14 días.
  Los probes siguen pospuestos.

# Tasks

## 0. Especificación

- [ ] 0.1 Escribir las delta specs de comportamiento de esta línea (capacidades del proposal) antes de aplicar tareas nuevas

## 1. Fase 0 — Preparación

- [x] 1.1 0.0 — Licencia de la fuente de marca ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-00-settle-the-brand-font-licence-before-anything-is-pushed-pd4--d3)) · Publicado con 1A (handover, fila 0.0–0.2)
- [x] 1.2 0.1 — Docs trackeados e integración de ramas ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-01-track-docs-and-integrate-the-branches)) · Integrado en main en 82ea84746
- [x] 1.3 0.2 — Clon interno de trabajo ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-02-internal-working-clone)) · b59c6c8b9
- [x] 1.4 0.3 — Decisiones reconciliadas y protocolo ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-03-reconciled-decisions-and-delivery-protocol)) · 5b2530e98
- [x] 1.5 0.4 — Alinear nombres y contratos de los docs ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-04-align-names-contracts-facts-and-order-across-the-v3-docs)) · 44872a21c
- [x] 1.6 0.5 — Enmienda de la regla de gráficos ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-05-amend-the-chart-rule-pd1--d1)) · 71b2f280d
- [x] 1.7 0.6 — Token surface-object y techos de drift ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-06-surface-object-token-and-drift-ceilings)) · 084eb796f
- [x] 1.8 0.7 — EqBands con morph por muelle ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-07-eqbands-spring-morph-without-inline-styles-fixes-the-ce506e86-regression)) · 273fa80bf, b0fa2d75d
- [x] 1.9 0.8 — Residuo del panel EQ y editor Admin ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-08-listen-eq-panel-residue-and-admin-editor-flattening)) · 4692be4c2
- [x] 1.10 0.9 — Muescas del ticket y entrada del setlist ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-09-real-ticket-notches-and-setlist-row-entrance)) · f8c9b409f
- [x] 1.11 0.10 — Pares de contraste y tono ámbar ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-010-contrast-pairings-and-the-amber-hue)) · 77197c245
- [x] 1.12 0.11 — Fixtures visuales y baselines ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-011-visual-fixtures-admin-captures-and-re-recorded-baselines)) · cf4779868 (1E)
- [x] 1.13 0.12 — Presupuestos de bundle en CI ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-012-bundle-budgets-in-ci-for-both-apps-pd48)) · 8520c0c5b
- [x] 1.14 0.13 — Target de despliegue iOS 16.4 ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-013-ios-deployment-target-pd42--d11)) · 22b5c7b47
- [ ] 1.15 0.14 — Medir el grafo de géneros de producción `F4` ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-014-measure-the-production-genre-graph-read-only)) — **en curso** · La auditoría de taxonomía A3d lo cubre en parte; las cifras no están registradas en main
- [ ] 1.16 0.15 — Runtime WebKitGTK 2.40 fijado para desktop `F4` ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-015-a-pinned-webkitgtk-240-runtime-for-the-desktop-gate)) · No existe tests/desktop-webkitgtk/

## 2. Fase 1 — Primitivas

- [x] 2.1 1.0 — Tarjetas Admin visibles en el nuevo lienzo ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-10-keep-admin-cards-visible-on-the-new-canvas-pd6--d6)) · 1F: 6e793ebd
- [x] 2.2 1.1 — Foco global y selección ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-11-global-focus-and-selection-rules)) · 1D: d881a728
- [x] 2.3 1.2 — MonoLabel: ARIA y tamaño eyebrow ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-12-monolabel-aria-pass-through-and-eyebrow-size)) · 1A: efe6cf2e
- [x] 2.4 1.3 — StatusDot: pulso y forced colors ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-13-statusdot-pulse-and-forced-colors)) · 1A: efe6cf2e
- [x] 2.5 1.4 — Niveles de StatNumber ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-14-statnumber-tiers-pd8--d8)) · 1A: efe6cf2e
- [x] 2.6 1.5 — API v3 de HairlineList/Row ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-15-hairlinelist--hairlinerow-v3-api)) · 1B: c28a97e0
- [x] 2.7 1.6 — Variantes de CratePill ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-16-cratepill-variants-and-the-listen-radius-exemption-pd3--d2)) · 1B: c28a97e0
- [x] 2.8 1.6a — GenrePill con porcentajes ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-16a-preserve-genrepill-percentages-and-align-its-chip-treatment)) · 1C: e60e6f50
- [x] 2.9 1.7 — InstrumentPanel con primeros consumidores ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-17-instrumentpanel-with-first-adopters-in-both-apps)) · 473604f70
- [x] 2.10 1.8 — Meter con primeros consumidores ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-18-meter-with-first-adopters)) · 1H: 6a5b3366
- [x] 2.11 1.9 — Readout con primeros consumidores ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-19-readout-with-first-adopters)) · 1I: a80f396b
- [x] 2.12 1.10 — ProgressHairline con primeros consumidores ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-110-progresshairline-with-first-adopters)) · 0660fbd22
- [x] 2.13 1.11 — Config compartida del toaster ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-111-shared-toaster-config-pd12--d10)) · 1K: 7b46021d
- [x] 2.14 1.12 — Eliminar componentes compartidos muertos ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-112-remove-dead-shared-components)) · 1L: 2c90a6f2
- [x] 2.15 1.13 — Retirar el runtime de temas ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-113-retire-the-theme-runtime-and-migrate-visual-preferences-pd53)) · 1M: 21873d24

## 3. Fase 1b — Componentes base

- [x] 3.1 1b.1 — Diálogos, sheets, popovers y menús ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-1b1-dialogs-sheets-popovers-menus-and-tooltips)) · 1N (corte publicado 1N–1P)
- [x] 3.2 1b.2 — Controles de formulario ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-1b2-form-controls)) · 1O–1P
- [x] 3.3 1b.3 — Tabs de texto con estado en URL ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-1b3-text-tabs-with-the-state-in-the-url)) · 1Q: e863c227
- [x] 3.4 1b.4 — Estados de carga, vacío y error ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-1b4-loading-empty-and-error-states)) · 1R: 093dcb1f
- [x] 3.5 1b.5 — Filas de pista y rejillas ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-1b5-track-rows-and-media-grids)) · 1S: 124b36a8
- [x] 3.6 1b.6 — Color de estado en Admin ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-1b6-admin-status-colour)) · 1T: 5308c391
- [x] 3.7 1b.7 — Skip link en ambos shells ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-1b7-skip-link-in-both-shells)) · 1U: afed5a3c
- [ ] 3.8 1b.8 — Retirar casi todos los iconos Admin `F4` ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-1b8-remove-almost-all-admin-icons-diego-2026-10-16)) — **en curso** · Grupos 1V–1AX publicados; 43 archivos Admin no-test siguen importando lucide-react (sitios UX registrados)

## 4. Fase 2 — Contratos backend

- [x] 4.1 2.1 — Aprobar federación por pairing id ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-21-federation-approve-uses-the-pairing-id-b14-main)) · 8b9c0964c
- [ ] 4.2 2.2 — Control de dueño en radio y streams de tareas `F0` ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-22-owner-checks-on-radio-sessions-and-task-streams-b15-b16-main-behaviour)) — **en curso** · B15 hecho (radio.py); falta B16, sin task_access.py
- [ ] 4.3 2.3 — Sacar payloads de play del ops snapshot `F0` ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-23-keep-play-event-payloads-out-of-the-ops-snapshot-b19-main)) · recent_events conserva payload_json
- [ ] 4.4 2.4 — Eventos de stream remoto no reconstruyen ops `F0` ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-24-remote-stream-events-stop-rebuilding-ops-b11-main)) · federation.stream.\* sigue en \_OPS_EVENT_TYPES
- [x] 4.5 2.5 — Conservar snapshot.pending en stats ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-25-stats-schemas-keep-snapshotpending-b12-main)) · c42043c2b
- [ ] 4.6 2.6 — Una constante de límites del dashboard `F1` ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-26-one-stats-dashboard-limits-constant-main)) — **en curso** · a9a31a5c6 alinea los valores; falta el módulo de constantes y el fixture de drift
- [x] 4.7 2.7 — Un check fallido conserva sus incidencias ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-27-a-failing-health-check-keeps-its-issues-b13-main)) · 7af26ed54
- [ ] 4.8 2.8 — Curation limpia la clave explore v2 `F0` ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-28-curation-clears-the-current-explore-cache-key-main)) · curation.py sigue borrando la clave v1
- [ ] 4.9 2.9 — Snapshot de adquisición exige permisos `F0` ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-29-acquisition-snapshot-and-stream-require-acquisition-rights-pd46-main-behaviour)) · acquisition.py sigue con \_require_auth
- [x] 4.10 2.9b — Un único mapeo Camelot ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-29b-one-camelot-mapping-for-v3-and-smart-mix-main-behaviour)) · 24a1ad098 (bliss.py usa crate.smart_mix.camelot)
- [ ] 4.11 2.10 — Projector consume eventos y agrupa rebuilds de ops `F1` ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-210-the-projector-consumes-new-domain-events-b1-and-coalesces-ops-rebuilds-v5-behaviour)) — **en curso** · Lectura de PEL + '>' hecha; faltan el backlog guard, el flag de side effects y el coalescing de 60 s
- [ ] 4.12 2.11a — Flags notify/quiet en tipos de tarea `F1` ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-211a-notify-and-quiet-flags-on-task-types)) · task_registry.py no los tiene
- [ ] 4.13 2.11b — Servir ops stale y agrupar refrescos `F1` ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-211b-serve-stale-ops-surfaces-and-coalesce-their-refreshes-behaviour)) · No existen coalesce.py ni ui_snapshot_serving.py
- [ ] 4.14 2.11c — Writer de la surface de tareas y viewer keys `F1` ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-211c-tasks-surface-writer-and-viewer-keys)) · No existe admin_surface_writer.py
- [ ] 4.15 2.12 — SSE fuera del event loop; pubsub multicanal `F1` ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-212-sse-reads-off-the-event-loop-pubsub-on-several-channels-b4)) · \_ops_stream sigue siendo síncrono; open_pubsub admite un solo canal
- [ ] 4.16 2.13 — Play events por hora de fin y presencia `F1` ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-213-play-events-by-end-time-v8-and-one-presence-count)) · Falta idx_user_play_events_ended_at
- [ ] 4.17 2.14 — Un único live stream de Admin `F1` ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-214-one-admin-live-stream)) · No existe admin_live.py
- [ ] 4.18 2.15a — Diferimientos estructurados y heartbeats `F1` ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-215a-structured-deferrals-v12-and-worker-heartbeats)) · Faltan deferral_progress y crate:workers
- [ ] 4.19 2.15b — Query y payload de queue lanes `F1` ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-215b-queue-lanes-query-payload-and-writer)) · En la práctica sustituida: QueueLanes lee tasks-stream (7f3fe7e8)
- [ ] 4.20 2.15c — Endpoint de colas y flags del catálogo `F1` ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-215c-queue-endpoint-and-task-catalog-flags)) · No existe /api/admin/queues
- [x] 4.21 2.16 — Sampler y surface del governor ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-216-governor-sampler-and-surface-fixes-b3)) · 7f3fe7e89 (/api/admin/governor)
- [ ] 4.22 2.17a — Labels de health al repair catalog `F1` ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-217a-health-labels-move-into-the-repair-catalog)) · CHECK_LABELS sigue en Health.tsx
- [ ] 4.23 2.17b — Resultados por check y eventos de escaneo `F1` ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-217b-per-check-results-and-scan-events)) · Sin la migración health_check_results
- [ ] 4.24 2.17c — Surface y endpoints de health checks `F1` ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-217c-health-checks-surface-and-endpoints-behaviour)) · No existe /api/admin/health-checks
- [ ] 4.25 2.17d — Fases del pipeline y set desatendido `F1` ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-217d-pipeline-phases-and-the-unattended-set-pd24-main-behaviour)) · No se filtra por requires_confirmation
- [ ] 4.26 2.17e — Índice de papelera `F1` ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-217e-trash-index)) · management.py sigue haciendo rglob
- [ ] 4.27 2.18a — Ruta de herencia EQ en los resolvers `F1` ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-218a-the-eq-inheritance-path-from-every-resolver)) · Falta EQ_TEMPLATES
- [ ] 4.28 2.18b — Builder del snapshot del genre wheel `F1` ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-218b-genre-wheel-snapshot-builder-and-triggers)) · El wheel lee /api/genres/taxonomy/tree (A3d)
- [ ] 4.29 2.18c — Endpoint wheel; quitar agregados de géneros `F1` ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-218c-wheel-endpoint-remove-request-time-genre-aggregates-b7-behaviour)) · browse_shared.py sigue agregando genre_counts en la request
- [ ] 4.30 2.18c-go — Tabla genre_counts y read plane Go `F1` ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-218c-go-genre_counts-table-and-the-go-read-plane-b7-behaviour)) · No existe la tabla genre_counts
- [ ] 4.31 2.18d — Overrides de curador persistentes `F1` ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-218d-curator-overrides-that-survive-restarts-and-rollbacks-g1-g2-behaviour)) · No existe local_eq_gains
- [ ] 4.32 2.18e — Procedencia MB, guardia de ciclos y borradores IA `F1` ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-218e-musicbrainz-provenance-cycle-guard-and-ai-drafts-g3-g7-d35-behaviour)) — **en curso** · Los borradores IA ya existían; faltan source=musicbrainz y la guardia de ciclos
- [ ] 4.33 2.19 — Cadena EQ efectiva en una query `F1` ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-219-effective-eq-chain-in-one-query-b8)) · No existe equalizer_resolution.py
- [x] 4.34 2.20 — Horas nocturnas y privacidad de Pulse ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-220-night-hours-instance-heatmap-fields-and-crate-pulse-privacy-pd43-behaviour)) · c5cf68648, 81bf2abc4

## 5. Fase 3 — Admin

- [ ] 5.1 3.1 — Bloques base de Admin `F2` ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-31-admin-building-blocks)) — **en curso** · use-snapshot-stream y hero en A1a–A1c; faltan StatStrip, AdminLiveProvider y nivo-theme
- [ ] 5.2 3.2 — Chrome del shell Admin `F2` ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-32-admin-shell-chrome)) — **en curso** · A1a y 1W hechos; faltan el breadcrumb y retirar Profile.tsx
- [x] 5.3 3.3 — Tiles del Dashboard ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-33-dashboard-tiles-and-the-health-tile-p0--m)) · Sustituida por el Dashboard 1AB (2d047fec)
- [x] 5.4 3.4 — Tasks con QueueLanes ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-34-tasks-page-with-queuelanes-p0--l-fixes-b10)) · 7f3fe7e8 (A2e)
- [ ] 5.5 3.5 — GovernorGauges en Tasks y System `F2` ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-35-governorgauges-on-tasks-and-system-p1--m-ships-after-the-p0-groups)) — **en curso** · Hecho en Tasks; System sigue con ResourceCard
- [ ] 5.6 3.5b — Residuo de System `F2` ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-35b-system-residue-p1--m-coverage-a16)) — **en curso** · Restyle hecho; faltan small multiples y ?period=
- [ ] 5.7 3.6 — Health con HealthScan `F2` ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-36-health-page-with-healthscan-p0--l)) · Health se rediseñó como cola de incidencias (1AD/A2d); no hay HealthScan
- [x] 5.8 3.7 — Genre wheel de solo lectura ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-37-genres-wheel-read-only-p0--l)) · cb812597c (A3d)
- [ ] 5.9 3.8 — Edición de géneros desde el wheel `F2` ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-38-genre-editing-from-the-wheel-frontend-for-g1-g3-g7)) — **en curso** · Hay panel de gestión; faltan link mode y overrides
- [ ] 5.10 3.9a — Backend del readout de análisis `F2` ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-39a-analysis-readout-backend-behaviour)) · No existe track_analysis_readout.py
- [ ] 5.11 3.9b — TrackReadout compartido `F2` ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-39b-shared-trackreadout-in-admin-analysis-admin-album-and-listen-info-tab)) · No existe TrackReadout
- [ ] 5.12 3.10a — Backend del sidecar de álbum `F2` ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-310a-album-sidecar-backend-p1--m)) · Sin migración
- [ ] 5.13 3.10b — Panel sidecar de álbum `F2` ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-310b-album-sidecar-panel)) · No existe AlbumSidecar
- [ ] 5.14 3.11a — Backend del ciclo de vida de lanzamientos `F2` ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-311a-release-lifecycle-backend-p1--l)) · Sin columnas de lifecycle
- [ ] 5.15 3.11b — ReleaseRail en New Releases `F2` ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-311b-releaserail-on-new-releases)) · No existe ReleaseRail
- [ ] 5.16 3.11c — Timelines para adquisiciones no Tidal `F2` ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-311c-release-timelines-for-non-tidal-acquisitions-pd27--d33-p1--m)) · Depende de 3.11a
- [ ] 5.17 3.12a — Backend de fuentes de enriquecimiento `F2` ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-312a-enrichment-sources-backend-p2--l-behaviour)) · No existe artist_enrichment_sources
- [ ] 5.18 3.12b — Pestaña EnrichmentOrbit `F2` ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-312b-enrichmentorbit-tab)) · No existe EnrichmentOrbit en Admin
- [ ] 5.19 3.12c — Respetar toggles de fuentes `F2` ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-312c-honour-the-enrichment-source-toggles-pd29--d38-main-behaviour)) · enrichment.py no lee enrichment_sources

## 6. Fase 4 — Listen

- [x] 6.1 4.1 — Chrome del shell y loops de cliente ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-41-shell-chrome-and-client-loops-p0--m-b24)) · 1AY/1AZ, 18a880c2
- [x] 6.2 4.2 — Barra, fullscreen, extended y cola ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-42-player-bar-fullscreen-extended-player-and-queue-p0--m)) · 1AZ, 18a880c2
- [ ] 6.3 4.3 — Store EQ en vivo y glifo EQ `F2` ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-43-eq-live-store-and-eq-glyph-p0--m)) · No existe equalizer-live-store.ts
- [ ] 6.4 4.4 — Mantener la última curva Smart EQ `F2` ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-44-hold-the-last-smart-eq-curve-while-resolving-pd32--d29-main-behaviour)) · use-equalizer-runtime.ts no conserva las gains mientras carga
- [ ] 6.5 4.5 — Panel EQ v3 y genre walk `F2` ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-45-eq-panel-v3-smart-eq-chain-and-the-shared-genre-walk-p0--m)) — **en curso** · Panel v3 hecho; falta GenreEqWalk
- [ ] 6.6 4.6 — Heatmap de stats y tile Home `F2` ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-46-stats-heatmap-band-counters-and-the-home-tile-p0--m)) — **en curso** · e2e1a5755 hecho; falta el tile de Home
- [ ] 6.7 4.7a — Backend de matching de setlist `F2` ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-47a-setlist-library-match-backend-p1--m-pd5-b22-behaviour)) · No existe setlist_matching.py
- [ ] 6.8 4.7b — SetlistTicket compartido `F2` ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-47b-shared-setlistticket-in-listen-and-admin-p1--m)) — **en curso** · 9dc2f44fc (SetlistFrequency compartido); no existe SetlistTicket en @crate/ui
- [ ] 6.9 4.8a — Backend del mood map `F2` ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-48a-mood-map-backend-p1--m-b6-behaviour)) · No existe moods.py
- [ ] 6.10 4.8b — MoodMap en Explore `F2` ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-48b-moodmap-on-explore-p1--m)) · No hay MoodMap en Explore
- [ ] 6.11 4.9a — Planificación de Paths en tarea `F2` ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-49a-paths-planning-in-a-task-and-plan-metadata-p1--l-b18-behaviour)) · paths.py sigue planificando de forma síncrona
- [ ] 6.12 4.9b — Route map en Paths (fase A) `F2` ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-49b-route-map-on-paths-phase-a-p1--l)) · No existe RouteMap
- [ ] 6.13 4.10a — Backend de explain y bliss map `F2` ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-410a-radio-explain-and-bliss-map-backend-p1--l)) · No existe bliss_map.py
- [ ] 6.14 4.10b — Sound map en Radio `F2` ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-410b-sound-map-on-radio-p1--l)) · No existe SoundMap
- [x] 6.15 4.11 — Paleta del visualizador con tokens v3 ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-411-visualizer-palette-from-crate-v3-tokens-pd40--d16-p2--s)) · visualizer-colors.ts, 2f3059046
- [ ] 6.16 4.12 — Estado estático analizado en móvil `F2` ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-412-static-analysed-state-for-audio-reactive-visuals-on-mobile-pd41-p2--s)) · Solo hay frame estático con reduced motion

## 7. Fase 5 — Instrumentos P1/P2

- [ ] 7.1 5.1 — Terminal de logs `F2` ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-51-logs-terminal-p1--m)) — **en curso** · Restyle 1Z/A2c; faltan auto-follow y filtros en URL
- [ ] 7.2 5.2 — Snapshot y página de Insights `F2` ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-52-insights-snapshot-b5-and-page-p1--m)) — **en curso** · 219d56ac2; B5 sigue abierto
- [ ] 7.3 5.3 — Banda del event pipeline `F2` ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-53-event-pipeline-band-p2--m-requires-210)) · No existe event_pipeline.py
- [ ] 7.4 5.4 — Redis pair `F2` ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-54-redis-pair-p2--m-main-pd45-only)) · No existe redis_runtime.py
- [x] 7.5 5.5 — Stack map ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-55-stack-map-p1--l-main-pd44-only-behaviour)) · PR #325, #328, #450–#452
- [ ] 7.6 5.6 — Lanes de adquisición en /download `F2` ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-56-acquisition-lanes-on-download-p1--l-b9-b20)) · No existe AcquisitionLanes
- [ ] 7.7 5.7a — Backend de la surface de imports `F2` ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-57a-imports-surface-backend-pd16-p1--m)) · No existe /api/imports/queue
- [ ] 7.8 5.7b — Página /imports `F2` ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-57b-imports-page)) — **en curso** · Restyle A4f; falta el contrato de cola
- [ ] 7.9 5.8 — Topología de federación `F2` ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-58-federation-topology-p2--l-requires-21-and-24)) · No existe federation_topology
- [ ] 7.10 5.9 — Devices en Ajustes de Listen `F2` ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-59-devices-in-listen-settings-p2--m-pd38)) · Sustituida por Crate Connect v2 (origin/feature/crate_connect_v2, sin mergear)
- [ ] 7.11 5.10 — Genre wheel en Listen (fase 2) `F2` ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-510-listen-genre-wheel-phase-2-pd20)) · No hay GenreWheel en Listen
- [ ] 7.12 5.11 — Paths fase B `F2` ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-511-paths-phase-b-p1--l)) · Depende de 4.9
- [ ] 7.13 5.12 — Heatmap de horas tranquilas en Admin `F2` ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-512-admin-quiet-hours-heatmap-heatmap-phase-2)) · No existe heatmap_utc
- [ ] 7.14 5.13 — Mix strip (fase A) `F2` ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-513-mix-strip-phase-a-web-and-desktop-p2--l)) · No existe mix-model.ts
- [ ] 7.15 5.14 — Seguimientos dependientes de Smart Mix `F2` ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-514-smart-mix-dependent-follow-ons)) — **en curso** · SmartMixCoverage/Settings hechos; falta la política de access tokens

## 8. Fase 6 — Cobertura

- [x] 8.1 6.1-6.3 — Cobertura Admin: Browse, Artist, Album ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#phase-6--coverage-screens-surfaces-with-no-site-visual)) · A3a/A3b (20ad97b0)
- [ ] 8.2 6.4 — Cobertura Admin: Trash y Contributions `F4` ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#phase-6--coverage-screens-surfaces-with-no-site-visual)) — **en curso** · UI hecha; falta el StatStrip sobre el índice de 2.17e
- [ ] 8.3 6.5 — Cobertura Admin: Upcoming, Bandcamp, Discover `F4` ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#phase-6--coverage-screens-surfaces-with-no-site-visual)) — **en curso** · A4d/A4e/A3c hechos; Discover depende de B5
- [ ] 8.4 6.6 — Cobertura Admin: Users y Roles `F4` ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#phase-6--coverage-screens-surfaces-with-no-site-visual)) — **en curso** · UI hecha; B17 (presencia sin MGET) sigue abierto
- [x] 8.5 6.7-6.11 — Cobertura Admin: Catalog, Playlists, Settings, Federation, Genres ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#phase-6--coverage-screens-surfaces-with-no-site-visual)) · A4e, A5a, A5c, A5d, A3a (20ad97b0)
- [ ] 8.6 6.12-6.16 — Cobertura Listen (Home, Search, Library, Settings, Stats) `F4` ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#phase-6--coverage-screens-surfaces-with-no-site-visual)) — **en curso** · 1AY–1BD y 6a92b11ee; faltan StatStrip/StepRail y los gates nativos
- [ ] 8.7 6.17 — Limpieza de dependencias (PD47, PD50) `F4` ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#phase-6--coverage-screens-surfaces-with-no-site-visual)) — **en curso** · Siguen leaflet, @nivo/bump/chord/geo/network y gl-matrix

## 9. Fase 7 — Cierre

- [x] 9.1 7.1 — CI completa en cada release ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-71-full-ci-on-each-release)) · v3.0.0 a v3.4.0
- [ ] 9.2 7.2 — Pasada de accesibilidad `F4` ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-72-accessibility-pass)) · No hay registro con VoiceOver/TalkBack
- [ ] 9.3 7.3 — Matriz de runtimes y reduced motion `F4` ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-73-runtime-matrix-and-reduced-motion)) · Bloqueada por 0.15
- [ ] 9.4 7.4 — Verificación de rendimiento en producción `F4` ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-74-performance-verification-on-production-data)) · Sin evidencia registrada
- [x] 9.5 7.5 — Baselines visuales finales ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-75-final-visual-baselines)) · 5e6a85bcc
- [ ] 9.6 7.6 — Acoplamiento de drift del site `F4` ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-76-site-drift-coupling)) · viz.test.ts sigue leyendo CHECK_LABELS
- [x] 9.7 7.7 — Release ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-77-release)) · Tag v3.0.0 sobre 82ea84746
- [ ] 9.8 7.8 — Docs técnicos `F4` ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-78-technical-docs)) · No se documentan AdminLiveProvider ni las viewer keys
- [ ] 9.9 7.9 — Revisión del bundle y checks visuales `F4` ([plan](../../../docs/plans/2026-10-14-crate-v3-implementation-plan.md#task-79-review-of-the-bundle-and-visual-checks)) · Sin revisión posterior a los instrumentos

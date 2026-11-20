# Tasks

## 0. Especificación

- [ ] 0.1 Escribir las delta specs de comportamiento de esta línea (capacidades del proposal) antes de aplicar tareas nuevas

## 1. Plan de implementación

- [x] 1.1 PR0 — Overlay de infraestructura en shadow y baseline (C0) ([plan](../../../docs/plans/2026-10-31-observability-implementation-plan.md#pr0--overlay-de-infraestructura-sin-código-de-crate)) · #310, #313 (6b1803c45); deploy/observability/
- [x] 1.2 PR1A — Integridad, dimensiones y salud de la recogida ([plan](../../../docs/plans/2026-10-31-observability-implementation-plan.md#pr1a--integridad-dimensiones-y-salud-de-la-recogida)) · #324 codex/observability-integrity

## 2. Plan de completitud

- [x] 2.1 PR1B — QoE continuo y Playback health ([plan](../../../docs/plans/2026-11-01-observability-metrics-completion-plan.md#1-alcance)) · #339 (pila #336): bedaf3dca, 4a0eddd1d, ccff1596f
- [x] 2.2 KPI — Tabla, job y página Admin de KPIs ([plan](../../../docs/plans/2026-11-01-observability-metrics-completion-plan.md#2-kpis-de-producto-diseño-nuevo)) · PR #327 (migración 142 product_kpi_daily, /api/admin/kpis)
- [x] 2.3 PR2A — Radio, Music Paths y skip temprano ([plan](../../../docs/plans/2026-11-01-observability-metrics-completion-plan.md#1-alcance)) · PR #339 (codex/recommendation-observability)
- [ ] 2.4 PR2B — Cobertura nativa Android/iOS/Tauri/Cast ([plan](../../../docs/plans/2026-11-01-observability-metrics-completion-plan.md#1-alcance)) · Sin commits; el QoE nativo de Android solo se registra en log (CrateNativePlaybackService.java) y Cast no entra en el enum de runtime
- [x] 2.5 PR3A — Exportadores Prometheus ([plan](../../../docs/plans/2026-11-01-observability-metrics-completion-plan.md#1-alcance)) · PR #337 (codex/prometheus-instruments)
- [x] 2.6 PR3B — Dashboards y recording rules ([plan](../../../docs/plans/2026-11-01-observability-metrics-completion-plan.md#1-alcance)) · PR #338 (codex/prometheus-panels)
- [x] 2.7 F4 — Reglas del supervisor, resumen y MCP ([plan](../../../docs/plans/2026-11-01-observability-metrics-completion-plan.md#1-alcance)) · PR #340; 17 reglas con enabled:false en config.operator.example.json
- [ ] 2.8 F4-ACT — Activar reglas tras el shadow de 7–14 días ([plan](../../../docs/plans/2026-11-01-observability-metrics-completion-plan.md#11-estado-a-2026-11-02)) · alert-acceptance.md: 'Nothing here has been enabled in production'
- [x] 2.9 MCP — Herramientas MCP de observabilidad ([plan](../../../docs/plans/2026-11-01-observability-metrics-completion-plan.md#10-observabilidad-en-mcp-crate-agent-y-crate-operator-diego-2026-11-02)) · app/crate/mcp/tools.py: get_observability_summary, get_playback_quality, get_product_kpis, get_stack_status
- [x] 2.10 AGENT — Crate Agent usa las tools de observabilidad ([plan](../../../docs/plans/2026-11-01-observability-metrics-completion-plan.md#10-observabilidad-en-mcp-crate-agent-y-crate-operator-diego-2026-11-02)) · deploy/hermes/config\*.json, CONTEXT.md y operator-catalog.json las referencian
- [ ] 2.11 OPS-ACT — Acciones de Operator observability-deploy/rollback/status ([plan](../../../docs/plans/2026-11-01-observability-metrics-completion-plan.md#10-observabilidad-en-mcp-crate-agent-y-crate-operator-diego-2026-11-02)) · Solo existen el target make observability-deploy y scripts/observability-deploy.sh; deploy/operator no tiene contrato ni política para estas acciones (pendiente en alert-acceptance.md)
- [x] 2.12 3D — Vista 3D del Stack map ([plan](../../../docs/plans/2026-11-01-observability-metrics-completion-plan.md#6-bloque-3d-del-stack-map-aprobado-por-diego-2026-11-01)) · PR #328 (codex/stack-map-3d)
- [x] 2.13 F5 — Documentación v1 de observabilidad ([plan](../../../docs/plans/2026-11-01-observability-metrics-completion-plan.md#1-alcance)) · PR #345 (docs/observability); docs/technical/monitoring.md
- [x] 2.14 WEB — Sección de observabilidad en cratemusic.app ([plan](../../../docs/plans/2026-11-01-observability-metrics-completion-plan.md#8-sección-de-observabilidad-en-el-website-diego-2026-11-02)) · 2a1749abf, 75ecf63b1 (app/web/src/components/admin/Observability.astro)

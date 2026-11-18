# Proposal

> Fase del roadmap: **EC** · ver [docs/plans/roadmap/README.md](../../../docs/plans/roadmap/README.md)

## Why

La federación pasa de catálogo replicado a un modelo híbrido: búsqueda remota bajo demanda y un índice de fuentes consolidado en segundo plano. FED0 y FED1 ya están en main; un agente trabaja en las siguientes fases.

## What Changes

Completar FED2–FED7 según el plan: resúmenes por peer, bootstrap por snapshot e índice de fuentes, deltas con leases y revocación, identidad de fuente en navegación y reproducción, consolidación en background e integridad por digests de bloque.

## Capabilities

- `federation/peer-summaries`, `federation/source-index`, `federation/catalog-deltas`, `federation/source-identity`: nombres provisionales, se fijan al escribir las delta specs (tarea 0.1).

## Impact

app/crate/federation, readplane Go, Listen (búsqueda y reproducción por fuente), migraciones nuevas.

## Fuentes

- [2026-11-10-federation-hybrid-implementation-plan.md](../../../docs/plans/2026-11-10-federation-hybrid-implementation-plan.md)
- [2026-11-10-federation-hybrid-design.md](../../../docs/plans/2026-11-10-federation-hybrid-design.md)

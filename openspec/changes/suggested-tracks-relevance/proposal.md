# Proposal

> Fase del roadmap: **F0** · ver [docs/plans/roadmap/README.md](../../../docs/plans/roadmap/README.md)

## Why

`get_similar_from_db` ordena por score y corta top-N sin dedupe ni diversidad, y `/api/similar-tracks` no pasa `user_id` al scorer: la pestaña Suggested repite artista y versiones.

## What Changes

Fases 0–5 del plan: tests de contrato, hotfix de precisión, afinidad de taxonomía, nuevo gating y scoring, fallback sin bliss más estricto y ajuste con ejemplos reales.

## Capabilities

- `recommendations/suggested-tracks`: provisional (tarea 0.1).

## Impact

app/crate/bliss.py, app/crate/api/browse_media.py, use-suggested-tracks.ts.

## Fuentes

- [2026-04-17-suggested-tracks-relevance-plan.md](../../../docs/plans/2026-04-17-suggested-tracks-relevance-plan.md)

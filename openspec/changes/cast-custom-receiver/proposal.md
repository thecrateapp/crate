# Proposal

> Fase del roadmap: **F0** · ver [docs/plans/roadmap/README.md](../../../docs/plans/roadmap/README.md)

## Why

El receiver propio está construido (cuts 0–10), pero sigue desactivado (`CAST_CUSTOM_RECEIVER_ENABLED=false`) porque faltan el gate automático, la aceptación en Chromecast/Google TV y el registro de app IDs.

## What Changes

Tareas 11.1–11.3 del plan: gate de release, matriz de hardware y registro/activación progresiva.

## Capabilities

- `playback/cast-receiver`: provisional (tarea 0.1).

## Impact

Receiver, flags de despliegue, docs/testing/cast-release-checklist.md, docs/operators/cast-receiver.md.

## Fuentes

- [2026-09-14-crate-cast-receiver-implementation-plan.md](../../../docs/plans/2026-09-14-crate-cast-receiver-implementation-plan.md)
- [2026-09-14-crate-cast-receiver-design.md](../../../docs/plans/2026-09-14-crate-cast-receiver-design.md)

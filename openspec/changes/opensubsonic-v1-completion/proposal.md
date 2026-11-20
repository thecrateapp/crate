# Proposal

> Fase del roadmap: **F0** · ver [docs/plans/roadmap/README.md](../../../docs/plans/roadmap/README.md)

## Why

v1 es el motor por defecto desde 2026-09-17, pero siguen el routing legacy (`app/crate/api/subsonic/legacy.py`) y la columna `users.subsonic_token`.

## What Changes

Pasos 9–10 del Cut S: retirar el routing legacy y la columna, con su migración y verificación de clientes.

## Capabilities

- `subsonic/compatibility`: provisional; requisitos REMOVED del motor legacy (tarea 0.1).

## Impact

Routing Subsonic, migración de users, docs/technical/opensubsonic.md.

## Fuentes

- [2026-09-15-opensubsonic-v1-implementation-plan.md](../../../docs/plans/2026-09-15-opensubsonic-v1-implementation-plan.md)
- [2026-09-15-opensubsonic-v1-design.md](../../../docs/plans/2026-09-15-opensubsonic-v1-design.md)

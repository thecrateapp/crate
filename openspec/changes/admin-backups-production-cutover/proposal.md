# Proposal

> Fase del roadmap: **F0** · ver [docs/plans/roadmap/README.md](../../../docs/plans/roadmap/README.md)

## Why

BK0–BK6 están en main, pero producción sigue con `crate-backup-offsite` y `crate-postgres-backup`. Falta el ciclo en paralelo de una semana y retirar los sidecars (gate BG2).

## What Changes

Ejecutar BK6.2. Es operación y retirada de configuración: no cambia comportamiento especificable (`skip_specs`).

## Capabilities

Ninguna (operación).

## Impact

docker-compose.yaml, despliegue en producción.

## Fuentes

- [2026-11-10-admin-backups-plan.md](../../../docs/plans/2026-11-10-admin-backups-plan.md)

# Proposal

> Fase del roadmap: **F0** · ver [docs/plans/roadmap/README.md](../../../docs/plans/roadmap/README.md)

## Why

Connect v2 está en producción, pero v1 sigue expuesto: rutas `/commands`, `/events` (SSE), `/transfer` y `/ack`, la tabla `connect_command_outbox` y hooks antiguos en Listen. Mantener dos transportes duplica superficie y riesgo.

## What Changes

Fases 4 y 5 del plan de Connect v2: quitar rutas y hooks v1, migración que elimina `connect_command_outbox` y pulido final.

## Capabilities

- `playback/connect`: provisional; requisitos REMOVED de v1 al escribir las delta specs (tarea 0.1).

## Impact

app/crate/api/connect.py, app/listen/src/contexts/use-crate-connect-commands.ts, use-remote-playback-state.ts, nueva migración.

## Fuentes

- [2026-05-31-crate-connect-v2-rewrite.md](../../../docs/plans/2026-05-31-crate-connect-v2-rewrite.md)

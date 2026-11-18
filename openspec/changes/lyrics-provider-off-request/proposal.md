# Proposal

> Fase del roadmap: **F0** · ver [docs/plans/roadmap/README.md](../../../docs/plans/roadmap/README.md)

## Why

`/api/lyrics` todavía llama a LRCLIB dentro del request (hasta 10 s), lo que rompe la regla de rendimiento del proyecto: la API de lectura no hace I/O externo lento.

## What Changes

Fase F0 del plan consolidado de letras: lectura solo desde PostgreSQL, revalidación y misses en una tarea deduplicada, y Listen refresca al llegar la letra. El cuerpo JSON no cambia.

## Capabilities

- `lyrics/lookup`: provisional; se fija al escribir las delta specs (tarea 0.1).

## Impact

app/crate/api/lyrics.py, app/crate/lyrics.py, actors y task_registry, worker de enriquecimiento, hook y componente de letras de Listen.

## Fuentes

- [2026-11-18-lyrics-karaoke-and-credits-plan.md](../../../docs/plans/2026-11-18-lyrics-karaoke-and-credits-plan.md)

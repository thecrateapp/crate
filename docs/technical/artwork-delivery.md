---
title: Artwork delivery
summary: Operate worker-owned persistent artwork variants and their non-blocking read path.
section: operations
audience: [operator, developer]
status: canonical
order: 140
verified: 2026-07-21
sources:
  [
    app/crate/artwork_variants.py,
    app/crate/artwork_materializer.py,
    app/crate/api/artwork_delivery.py,
  ]
---

# Artwork delivery

Crate materializes artwork as immutable WebP revisions under
`/data/artwork-variants/v1`. HTTP processes are read-only: they serve a current
variant, a local original, or the existing placeholder and enqueue deduplicated
worker work on a miss. Provider calls, embedded-cover extraction, Pillow and all
filesystem writes run in workers.

## Backfill and lifecycle

API startup automatically queues the versioned `backfill_artwork_variants` task
until its durable completion marker is present. Each invocation processes bounded,
stable pages (100 by default) and schedules its continuation only after the page
has been enumerated. It covers album covers, artist photos/backgrounds and genre
covers. Release and external-artist assets materialize on demand.

The task is restart-safe and deduplicates on `artwork:<kind>:<entity-key>`.
`cleanup_artwork_variants` retains current plus one previous revision and removes
only temporary directories older than 24 hours. `repair_artwork_variants` samples
or scans manifests and requeues corrupt assets; it never edits them in an API
process.

## Operations

- Normal health samples at most 100 assets.
- Admin system metrics expose checked, valid, corrupt, revisions and bytes.
- Request and worker metrics use the `artwork.*` namespace.
- A high `missing` ratio means the backfill is incomplete or source files are
  absent. A high `failed` queue ratio indicates task broker failure.
- Rollback is safe: disable native local media and FastAPI continues serving
  variants/originals/placeholders. Materialized files are additive.

Never delete `current.json` or a current revision manually. Use the cleanup and
repair tasks so publication remains atomic.

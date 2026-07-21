---
title: Local media delivery SLOs
summary: Gate native readplane delivery of local audio and artwork with measurable safety and rollback criteria.
section: operations
audience: [operator, developer]
status: canonical
order: 150
verified: 2026-07-21
sources:
  [app/readplane/internal/media, app/readplane/internal/routes, app/tests/load]
---

# Local media delivery SLOs

The Go readplane may serve local audio and materialized artwork directly from
read-only `/music` and `/data` mounts. `READPLANE_LOCAL_MEDIA_ENABLED=false` is
the default and immediate rollback control. FastAPI remains the bounded fallback
for disabled delivery, database errors, unsafe/missing files, stale or missing
adaptive variants, JIT preparation, and remote federation playback.

## Contract gates

- Zero 5xx responses in the delivery profile.
- Full responses use 200; valid single ranges use 206; unsatisfiable ranges use
  416; HEAD returns identical headers without a body.
- ETag, Last-Modified, Content-Length, Content-Range and playback policy headers
  match the selected bytes.
- Root confinement is validated after symlink resolution.
- Native stream throughput must not regress against FastAPI.
- Before activation, native p95 first-byte latency must be at least 20% better
  than the same FastAPI fixture.
- Warm materialized artwork p95 is below 50 ms at concurrency 50 on loopback.

Run `make dev-artwork-delivery-benchmark` and
`make dev-local-stream-benchmark` with the URLs and bearer token described by
the targets. Reports are written to `.artifacts/benchmarks/` as stable JSON.

Disable native delivery when 5xx exceeds 0.5%, p95 TTFB regresses by more than
20% for two five-minute windows, byte/header contracts diverge, valid paths are
rejected beyond migration tail, or playback stalls materially increase.

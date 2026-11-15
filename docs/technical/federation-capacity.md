---
title: Federation capacity and catalog resilience
summary: Capacity assumptions, serving modes and reconciliation safety for the global catalog.
section: federation
audience: [developer, operator]
status: canonical
order: 280
verified: 2026-07-21
sources:
  [
    app/tests/load/federation_catalog_profile.py,
    app/readplane/internal/catalog,
    app/crate/federation,
  ]
---

# Federation capacity and catalog resilience

Capacity gates must use a representative node shape: current library cardinality,
peer count, catalog page size, search mix, readplane concurrency, stream load
and failure injection. A small fixture can prove protocol mechanics but not a
production fallback or memory budget.

## Catalog serving modes

The catalog contract distinguishes local fallback, global-ready, global-refreshing
and global-degraded. Reconciliation must preserve a usable last complete or
local view; clients must not receive an undocumented `catalog_warming` outage.
Record serving mode in diagnostics and test it under first sync, refresh,
failure, deletion and recovery.

## Synchronization constraints

- Use bounded/keyset or durable cursor pagination; do not rely on unbounded
  offset scans for a growing catalog.
- Persist a page before moving its checkpoint and make replays/tombstones
  idempotent.
- Version a manifest over every payload component that affects the published
  catalog, not merely library row counts.
- Bound source fan-out, failure budgets, retries and cache freshness so one
  unhealthy peer cannot degrade local reads.

Run `make dev-federation-capacity-test` for the repository's isolated profile
when changing catalog/readplane paths. Attach the generated fixture/result to
the release evidence and update the SLO thresholds rather than embedding stale
numbers in this page.

### Catalog state feed and publication

Library writes stage catalog intents in the same PostgreSQL transaction as the
source change. The existing outbox relay publishes bounded committed batches in
a separate transaction; only that publisher assigns public sequence numbers.
A late-committing intent therefore receives a sequence after the last published
checkpoint, even when its internal outbox ID is smaller. Publication, intent
removal and the published watermark commit together. No publication runs inline
in a catalog HTTP request.

The delta feed synchronizes current state; it is not an audit history. A repeated
entity/payload/operation moves that state row to its new sequence. For example,
`A → B → A` can compact to `B, A`, and every earlier cursor still converges to
`A`. Consumers must tolerate repeated state and sequence gaps, apply operations
idempotently and checkpoint only a successfully committed page.

Retention removes only a bounded expired prefix and records its actual last
removed sequence. Compaction and rolled-back sequence allocations do not imply
a retention gap. The published watermark remains valid even when every retained
row has been pruned. Reads check the retention boundary and their page in one
database snapshot, so concurrent pruning cannot silently skip missing changes.

The initial migration conservatively reconstructs the old retention boundary
from legacy rows because the old schema did not distinguish pruning from gaps.
That can require one initial full repair for an old cursor; subsequent boundaries
are explicit. Bootstrap reads live keyset rows against a fixed initial published
watermark, then catches up deltas. This provides convergence rather than a
long-lived immutable database snapshot. Migration `159` waits for in-flight
legacy feed inserts, then installs a bridge that stages later legacy inserts in
the same outbox. Mixed-version writers therefore share the committed publisher
during a rolling upgrade. At least one updated publisher must remain active;
rolling every publisher back requires the explicit recovery procedure below.

## Local search fallback capacity

The first global reconciliation must not make local search unavailable. The
isolated `crate_test` profile seeds 1K artists, 10K albums and 100K tracks,
then exercises common prefixes, multi-token queries, Unicode and substring
fallback cases through `GET /api/catalog/search`.

```bash
make dev-catalog-search-capacity-test
```

The gate writes `.artifacts/catalog-search-fallback-capacity.json` and fails
when p95 exceeds 300 ms, p99 reaches 800 ms, or a response violates the
artists/albums/tracks contract. Fix query shape or indexes; do not satisfy the
gate by increasing a readplane timeout.

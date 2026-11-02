# PR1A checkpoint 1: identity and absolute minutes

2026-10-31. Branch `codex/observability-integrity`, based on main
`6b1803c4506312b6550fb548cce8ffb333443e20`. Worktree:
`/Users/diego/Code/crate-observability-integrity`.

This is the first development checkpoint, not completed PR1A or C1. Production
is unchanged. See [C0 acceptance and initial objectives](c0-acceptance.md).

## Changes

- Redis namespace `crate:metrics:v2`. Public producer functions are preserved;
  readers aggregate by name unless dimensions are requested. Redis v1 and
  PostgreSQL `metric_rollups` are never combined with v2 or deleted by this cut.
- Explicit catalogue of 819 active producer names, including finite MCP tools.
  Duration, byte and ratio units are explicit. Storage uses canonical units;
  compatibility queries return the previous input units. Eighteen registered
  federation names without verified producers/units remain unconfigured.
- Identity is name plus sorted, allowed dimensions. Unknown labels are dropped;
  unknown finite values become `other`. A family admits at most 1,024 active
  series. No track/user/peer UUID/file path becomes a dimension.
- Closed registry of 867 route values from audited API decorators. The middleware
  uses the ASGI template, retaining suffixes such as artist `/radio`, and fixed
  unmatched fallbacks. The registry requires no API startup import. New registered
  routes must extend it; observations cannot extend it.
- One Lua operation updates observations and indexes atomically. Dirty buckets
  bound each flush to ten batches of 500. Reads count indexed buckets before
  downloading them and fetch hashes in batches of 500. Index growth during that
  read is rejected instead of silently truncating results.
- Migration 141, bootstrap and ORM add `metric_minute_snapshots`, uniquely keyed
  by series/minute, with read and retention indexes. Bulk writes replace absolute
  snapshots only with a newer revision of the same source. Reads aggregate before
  LIMIT, with weighted mean computed as sum/count.
- Source changes preserve known data and set a sticky `source_gap`, never adding
  incompatible counters. Redis generation is verified around batch reads. ACK
  checks generation, source and revision atomically, leaving concurrent writes
  pending. DB failure or a lost ACK can be retried safely.
- The bounded retention repository operation is tested; its eight-day schedule
  is not connected yet.

## Validation

Tests use disposable Redis/PostgreSQL, never production. The initial RED cases
reproduced ten observations becoming thirty after three flushes, twenty from two
flushers, merged runtimes/queues, and stored free-form labels.

Regressions cover 100 concurrent writes; current-minute/late observations; DB
failure before/after commit; writes during ACK; stale revisions; sticky gaps within
and across batches; source regeneration and Redis generation changing during
flush; filtering; weighted aggregation before LIMIT; v1/v2 isolation; real TTLs;
bounded index reads; sampled route p95/p99; private route data; and schema/ORM.
Stream start/end dimensions match on both normal closure and exception.
No percentile is inferred from a stored maximum.

Core scoped command, from `app/`:

```bash
../.venv/bin/python -m pytest tests/test_metrics.py tests/test_metric_minute_integrity.py tests/test_metric_catalog.py tests/test_metrics_middleware.py tests/test_metric_dimensions.py -q
```

Additional scoped checks cover migration head/DDL/downgrade, active ORM mappings,
unique series/minute identity, runtime saturation consumers and the existing
operator rule consuming the real summary. Final results: **79 scoped cases pass**
(65 core, 12 migration/ORM/consumer cases, and the last two stream regressions).
Ruff and diff whitespace checks pass. The existing Testcontainers deprecation
warning remains. Independent specification and code reviews found issues in
route preservation, batch gap propagation, bounded reads and restart handling;
the fixes have regression coverage and the last review has no outstanding
findings within this checkpoint. No complete development suite is run.

## Remaining checkpoints

1. **Consumer integration:** collection health, truthful availability/freshness,
   historical cutover, and renaming the maximum called p95 with a deprecated
   configuration alias. Existing public zero/empty fallback remains until this
   integration; it cannot certify collection health or approve PR1A.
2. **Retention and cost:** connect incremental eight-day cleanup, measure indexed
   15-minute/1-hour/24-hour/7-day windows against the Admin budget, and run closing
   validation once stable. No maintained hourly rollup without measured need.

This cut does not claim continuous QoE coverage, alert activation, an external
probe or completion of PR1B. It has not been deployed.

# PR1A checkpoint 3: retention and bounded reads

2026-10-31. Branch `codex/observability-integrity`, based on main
`6b1803c4506312b6550fb548cce8ffb333443e20`. Builds on
[checkpoint 1](pr1a-checkpoint-1.md) and [checkpoint 2](pr1a-checkpoint-2.md).
This checkpoint is validated locally. No publication or deployment.

## Retention

The worker attempts one 1,000-row deletion batch every 60 seconds, independently
of the five-minute flush. At most one retention thread runs per service loop;
a blocked deletion never blocks scheduler/Auto DJ. Failed deletion or thread
startup is logged and retried on the next cadence. The cutoff retains the whole
boundary minute eight days ago. Legacy rollups and the durable cutover setting
remain untouched.

Deletion uses the retention index, ordered `FOR UPDATE SKIP LOCKED`, a 500 ms
statement timeout and 50 ms lock timeout. A savepoint isolates failure and restores
the caller's settings and usable transaction. Limits are per attempt, not an
assurance that a large backlog disappears in one pass. Nominal capacity is
1,000 expired series/minute per active maintenance loop; monitor active-series
growth and backlog before increasing cardinality.

## Read contract

Minute queries clamp to eight retained days and the current UTC minute. Default
windows cover only the requested bins. Aggregation precedes per-family limits,
with at most 32 canonical families and 12,000 returned points in one SQL query.
Aliases deduplicate before applying budgets. UTC binning and DTO timestamps do
not depend on the database session timezone. Missing minutes remain gaps.

The `(name, bucket_start DESC)` index includes count, sum, min, max, watermark
and gap state. This covers the unfiltered aggregation query. Tag-filtered reads
may still need heap access. No maintained hourly rollup is introduced.

Admin charts use one PostgreSQL batch for both one-hour and 24-hour views.
Their latest observations can lag until the existing five-minute flush; each
chart declares its source, availability and actual observation time. Live
summary, health inputs and queue depth still use Redis. The compatibility facade
keeps Redis minute reads as its default for other consumers. Failed reads have
an unavailable status; empty observations and known source gaps stay distinct.

Route reads retain the same 60-minute dashboard window, capped at 5,000 actual
route/minute buckets and 50,000 retained samples. Atomic index preflight prevents
an unbounded transfer. Headers/sample lists are packed in batches of 250 keys.
No Cartesian route/minute expansion or silent truncation is used. Missing sample
lists are partial evidence; budget failure is unavailable. Percentiles remain
sampled percentiles, with observed and retained counts reported separately.

Redis reads project only required hash fields and deduplicate shared buckets.
`hiredis==3.5.0` adds the native redis-py parser to the API/worker dependency set;
the existing redis-py constraint is unchanged. The shared development virtualenv
was not changed.

Specification review caught loss before the process's first successful write,
and loss after its previous write became stale. Recent local loss now takes
precedence over `empty`/`stale`; global observations from another process cannot
turn this into a healthy score. Four regression cases cover collection state
and health evaluation. Specification review passes after this correction.

## Measurement and validation

The controlled fixture contains 1,152,000 persisted
minute rows (100 active series over eight days), dense Redis observations and
47,200 retained route samples in the effective 60-minute read window. Local
containers have explicit memory/CPU caps. Admin measurements isolate its metric
section with fixed system/tasks/playback auxiliaries; they are not full HTTP
latency or production SLO evidence. The host also runs an unrelated CPU-active
process, which is left untouched.

Each case uses ten warmups, 100 operations and concurrency ten, with the same
frozen UTC clock, data, 60-minute route window and auxiliary mocks before/after.
Response serialization is measured separately from function latency. The final
source snapshot and schema have the native parser and one covering name/time
index, rather than both experimental indexes. Cold means bypassing the Admin
ten-second result cache, not flushing database/OS buffers.

| Read                                | Before p95 (ms) | Final p95 (ms) |
| ----------------------------------- | --------------: | -------------: |
| PostgreSQL, 15 minutes              |            27.0 |           23.7 |
| PostgreSQL, 1 hour                  |             7.1 |           13.5 |
| PostgreSQL, 24 hours                |             8.7 |            7.2 |
| PostgreSQL, 7 days                  |            75.8 |           65.0 |
| Admin metric section, cold 1 hour   |         2,561.4 |          456.7 |
| Admin metric section, cold 24 hours |         1,797.1 |          487.2 |

All final cases have zero exceptions and no silently empty metric families.
The earlier 24-hour Redis path lost the dense latency family to its read budget;
the final PostgreSQL batch returns it. Both cold views meet the local 500 ms
target, and individual indexed reads meet 250 ms. These are development budgets,
not deployment acceptance or production SLOs. Cached metric-section p95 is below
1 ms in this controlled harness; it does not include HTTP/serialization costs.

The covering-index experiment isolates `VACUUM ANALYZE`: PostgreSQL 24-hour
batch p95 is 418 ms before vacuum, 391 ms after vacuum alone, and 193 ms after
the covering index plus vacuum. Existing heap visibility was already 100%.
The covered plan uses an index-only scan with zero heap fetches; buffers fall
from 6,355 to 1,292 and temporary writes from 1,046 blocks to zero. The name/time
index grows from 60.5 to 121.7 MB in this fixture. Covering mutable fields also
increases write/index maintenance; capacity must be rechecked as cardinality grows.

The 500-series stress fixture exceeded its three-minute preparation budget:
inserting 4,608,000 additional rows took 166.15 seconds and vacuum was still
running at the deadline. It was stopped before any latency measurement. Thus
500-series capacity remains **unmeasured**, with no application failure inferred.
Do not extrapolate the successful 100-series results into a 500-series guarantee.
A separate single retention smoke against the expanded 5,760,000-row fixture
deleted 1,000 expired rows in 35.1 ms; rollback restored them. This is neither
a retention percentile nor a write-throughput comparison. Containers were removed.

Raw results and the reproduction harness live in
[`.ecc/benchmarks/observability-pr1a`](../../../../.ecc/benchmarks/observability-pr1a/README.md).
Sequential independent specification and quality reviews pass with no remaining
high/medium code findings.

Closing validation: **640 backend cases pass together across 23 affected test
files**, using the isolated native-parser target and disposable PostgreSQL/Redis.
This includes every changed backend test file plus runtime-saturation consumers.
The command, from `app/`, is:

```bash
PYTHONPATH=<isolated-hiredis-target> ../.venv/bin/python -m pytest \
  tests/test_metric_*.py tests/test_metrics.py tests/test_metrics_middleware.py \
  tests/test_worker_metric_retention.py tests/test_agent_diagnostics.py \
  tests/test_agent_observability.py tests/test_agent_observability_db.py \
  tests/test_api.py tests/test_crate_schema_definition.py \
  tests/test_orm_schema_contract.py tests/test_operator_alert_rules.py \
  tests/test_runtime_saturation_metrics.py tests/test_storage_health.py -q
```

Admin's three affected test files have **31 passing cases**; preview has **two
passing desktop/mobile cases** and updated local screenshots. Admin typecheck,
lint, production build and bundle budget pass (501,132 gzip bytes against 532,480).
The new review scene's scoped TypeScript check passes. React Doctor changed-scope
reports zero new issues. Whole-backend Pyright passes; Ruff check and formatting
pass for all 1,921 Python files. Global Storybook's two pre-existing type errors
remain as documented in checkpoint 2; unrelated scenes are not changed.

No full multi-app test suite is run during this development cut. PR1B and the
phase-one checkpoint C1 still need their own checks and final phase validation.

## Review and rollback

The [local review](http://127.0.0.1:5186/review-observability-integrity.html)
uses the actual Admin page and six fixture states. PostgreSQL watermarks and
sample selections agree; an empty fixture removes both graph and selector.
A Redis outage can preserve stored PostgreSQL history while health stays unknown.
The same scene is available in Storybook.

PR1B continuous playback QoE and checkpoint C1 are still pending. Production
remains on the C0 application/overlay. A future rollback must stop v2 writers
before reverting migration 141; downgrading it drops only the new minute table.
Do not merge legacy rollups back into corrected history or claim recovered data.

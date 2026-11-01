# PR1A metrics benchmark

Local evidence for the metrics integrity/retention checkpoint. This measures the metrics
portion of Admin, not an HTTP endpoint or a production SLO.

## Results

100 active canonical series across 40 real metric families, 8 days of minute snapshots
(1,152,000 PostgreSQL rows). Each case has 10 sequential warmups and 100 operations with
10 concurrent threads. The local budgets were fixed before optimization: individual
PostgreSQL query p95 <250 ms; cold Admin metrics bundle p95 <500 ms.

| Case                  | Baseline p95 |  Final p95 |
| --------------------- | -----------: | ---------: |
| PostgreSQL 15 minutes |    27.008 ms |  23.663 ms |
| PostgreSQL 1 hour     |     7.103 ms |  13.484 ms |
| PostgreSQL 24 hours   |     8.688 ms |   7.186 ms |
| PostgreSQL 7 days     |    75.810 ms |  64.957 ms |
| Cold Admin 1 hour     | 2,561.385 ms | 456.701 ms |
| Cold Admin 24 hours   | 1,797.083 ms | 487.234 ms |

The final run has zero errors and zero empty graph families. The baseline silently
returned an empty `api.latency` graph in all 100 requests for the 24-hour window; its
latency is therefore not a comparison of equivalent complete output. Final 1-hour and
24-hour graph sets contain 1,298 and 550 points respectively. Response sizes include
metadata; `first_graphs` also records graph-only bytes and per-family observation counts.

`results/cover-experiment.json` isolates VACUUM from the covering-index benefit. Batched
24-hour PostgreSQL p95 was 418.154 ms before VACUUM, 391.082 ms after VACUUM only, and
193.319 ms with the covering index. The final plan uses an index-only scan with zero
heap fetches and zero temporary blocks. The covering index occupies 121,667,584 bytes,
versus 60,547,072 bytes for the original index. Both indexes existed during that
experiment; only the original-named covering index existed during `final-100.json`.
This establishes the read benefit and size cost, not the ongoing write cost.

The 500-series stress test is **pending**. Its extra 4,608,000-row insert took 166.15 s.
The attempt was stopped during VACUUM at the three-minute fixture setup limit, before
any latency cases ran. It provides no 500-series application latency result. A single
real retention call against that expanded table deleted 1,000 rows in 35.116 ms and
rollback restored the same selected rows. That is a smoke check, not a percentile or
an original-index/covering-index write comparison. Upsert write-cost comparison remains
unmeasured.

## Scope and controls

- Python 3.13.11 on macOS ARM64; PostgreSQL 15 and Redis 7 in disposable Docker containers.
  Exact image digests, package versions and limits are in `results/config-sanitized.json`.
- PostgreSQL: 768 MiB, 4 CPUs, shared buffers 128 MiB, work memory 8 MiB, parallel gather
  disabled. Redis: 256 MiB/1 CPU, 220 MiB no-eviction limit, persistence disabled.
- Original Redis fixture: 100 normal series for 60 minutes, plus 40 latency series for
  24 hours. This is deliberately not a complete 24-hour Redis fixture for every family.
  The final charts read the complete PostgreSQL fixture; the live summary still reads Redis.
- Route fixture remains 40 routes, 60 minutes, 20 samples per populated minute: 47,200
  observed requests/samples at the fixed query boundary. No final sample cap/window reduction.
- Both recorded runs freeze the same clock, `2026-10-31T19:14:30+00:00`, through metrics,
  database query and Admin helpers. UTC bounds and the fixture timestamps are identical.
- The timer covers the Python function, including database/network I/O to local containers.
  JSON serialization is outside the timer; ASGI, TLS and browser rendering are excluded.
- System, running-task and playback-delivery helpers are constant mocks. Cold requests
  always miss the dashboard cache; cached cases are separate and never count toward the gate.
- The initial redis-py 8.1.0 RESP3 parser was pure Python. Final uses hiredis 3.5.0. Native
  parsing was measured separately before adoption. The raw files record parser classes.
- An unrelated long-running esbuild process used approximately 145% host CPU. It was left
  untouched. Results reflect this local shared host, not an isolated production capacity test.
- Raw result timings/plans are unchanged. Only temporary source path metadata was replaced
  by snapshot labels. Source fingerprints identify the historical immutable code snapshots;
  large temporary source copies are intentionally not included in Git.
  `before-from-final.patch` reconstructs the historical baseline from the measured final
  snapshot; `results/source-manifest.json` records per-file hashes. Applying the patch
  was verified byte-for-byte against the original baseline snapshot.

## Reproduce

Use a local Docker engine and the repository virtualenv with backend dependencies,
`docker`, `psycopg2-binary` and `hiredis==3.5.0` installed. The harness refuses a remote
Docker endpoint, binds published ports to loopback and overrides database/Redis endpoints
with disposable fixture endpoints. Do not point it at an existing stack.

From the repository root:

```bash
export CRATE_BENCH_WORKSPACE="$PWD"
export CRATE_BENCH_PYTHON="$PWD/.venv/bin/python"
export CRATE_BENCH_SOURCE="$PWD/app"
export CRATE_BENCH_STATE="$(mktemp -d /tmp/crate-obsv-bench-XXXXXX)"
export CRATE_BENCH_REFERENCE_UTC="2026-10-31T19:14:30+00:00"
"$CRATE_BENCH_PYTHON" .ecc/benchmarks/observability-pr1a/harness.py session
```

The session snapshots `CRATE_BENCH_SOURCE/crate`, seeds the fixture, measures it under the
label `baseline`, then waits with both containers alive. The label means the first source
in that session; using current code does not reproduce the historical pre-optimization
source. To compare two revisions, set the first source to an immutable pre-optimization
checkout. To reconstruct it, make an isolated copy of the measured final source matching
`source-manifest.json`, then apply `before-from-final.patch` from that copy's repository
root using `patch -p1`. Do not apply this reverse patch to your working branch. The
historical baseline used the pure Python Redis parser, so use separate interpreters or
isolated `PYTHONPATH` dependencies when reproducing that parser comparison.

In a second terminal with the same environment run:

```bash
"$CRATE_BENCH_PYTHON" .ecc/benchmarks/observability-pr1a/harness.py measure final /absolute/path/to/final/app
```

Use the same fixture, fixed reference clock, parser and auxiliary mocks; archive source
fingerprints before changing the source. The final schema has a covering index. If the
fixture was created with the old schema, replace its original `(name,bucket_start DESC)`
index with the final DDL from `metric_minutes_v141.py`, then run `VACUUM (ANALYZE)` before
the final measurement. The historical covering experiment separately kept both indexes
and controlled for VACUUM; its raw plans and sizes are recorded in the results.

Type `stop` in the first terminal when done. Its `finally` block removes its containers
and volumes; interruption also triggers cleanup. `runtime.json` stays in the temporary
state directory and contains only disposable local connection metadata. Do not commit it.
The completed recorded run removed both containers; no production data was accessed.

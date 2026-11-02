# Bounded Redis metric buffer: review evidence

This is a local memory and contract smoke test for the reviewed metric buffer.
It does not measure PostgreSQL write capacity, HTTP latency or a production SLO.

## Reproduce

Run from the repository root, using its existing Python environment with backend
dependencies, `redis` and the Docker Python SDK installed:

```bash
PYTHONPATH=app .venv/bin/python -P \
  .ecc/benchmarks/observability-pr1a/review-buffer-bounds/harness.py
```

The harness resolves the repository relative to its own location. It creates a
dedicated Redis container bound to an ephemeral loopback port and refuses Docker
SSH/TCP endpoints. It never connects to the application Redis or PostgreSQL. Its
`FLUSHDB`, `BGSAVE` and cleanup operations target only that disposable connection.
The container and its anonymous data volume are removed in `finally`.

Docker must be available through a local Unix socket, with `redis:7-alpine`
available locally. To reproduce with the image ID recorded in a prior result:

```bash
CRATE_METRIC_BUFFER_REDIS_IMAGE=sha256:<recorded-image-id> \
  PYTHONPATH=app .venv/bin/python -P \
  .ecc/benchmarks/observability-pr1a/review-buffer-bounds/harness.py
```

The supplied image must be compatible with the Redis 7 contract. The harness
records its actual image ID/digests and Redis version. It does not install or
change dependencies. Preparation has a 120-second limit; explicit RDB saves have
a 30-second limit. A failing assertion or limit returns a failing process exit.

## Configuration and phases

- Redis `maxmemory`: 512 MiB, `volatile-lru`; Docker limit: 768 MiB and two CPUs.
  Default RDB save rules remain enabled and their actual value is recorded.
- Load the actual `_RECORD`, `_RECORD_ROUTE` and `_ACK` Lua strings from the
  current source, using `SCRIPT LOAD` and batches of up to 500 `EVALSHA` calls.
  Record source-module, catalogue, Lua and harness hashes.
- Generate 500 distinct canonical `api.request.count` series from the first 500
  sorted catalogue routes, with GET, 2xx and the API target. Attempt 120 minutes
  per series in chronological order, without ACK: 60,000 attempted buckets must
  result in 24,000 accepted and 36,000 explicit capacity rejections.
- Add 2,000 raw route headers in the same minute, using those 500 paths and
  GET/POST/PUT/DELETE. A new PATCH route in that minute must be rejected. Each
  header and first sample is written with the actual route Lua.
- Fill each route list with 999 additional 23-byte finite-float strings using
  direct batched `RPUSH`. This is a synthetic memory upperbound fixture with two
  million sample slots. Header counts/sums still represent one observation per
  header: it is not a two-million-observation recorder benchmark.
- Execute and await a real `BGSAVE`; record elapsed time, fork time and copy-on-write
  bytes. No concurrent application write-pressure fixture is present.
- Clear the disposable database, then repeat 500 series for 120 minutes with
  actual `pending_snapshots` and ACK Lua every five simulated minutes. This
  models successful durable commits; PostgreSQL is not exercised. All 60,000
  observations must be accepted, pending buckets must never exceed 2,500 and the
  live buffer must stay at or below 24,000. Actual summary reads must mark the
  recut 120-minute window partial and the complete five/one-minute windows available.
- Run 500 raw routes for 120 minutes. All 60,000 writes must be accepted while
  rotating older minutes and retaining at most 2,000 raw buckets. The actual
  five-minute route snapshot must report `partial/live_route_buffer_trimmed`;
  the latest minute must be available. This phase writes raw-route storage only,
  without also recording canonical route counters.

## Interpretation and artifacts

`results.json` is overwritten by each run. It includes limits, stage snapshots,
loss counters, admitted/rejected counts, real summary metadata, hashes, timings
and cleanup status. `used_memory_peak` is cumulative across phases, including
`FLUSHDB`; it is not a separate peak for each phase. Redis client `lastsave`
strings use local time without a timezone; `measured_at_utc` is explicit UTC.

The 120-minute sequences are accelerated fixture timestamps: the harness does
not run for two hours or test wall-clock expiry over that duration. Catalogue
dimensions and long sample strings are representative bounded fixtures, not a
proof of the worst memory use of every possible catalogue family. Application
cache contents and production traffic are absent; zero evictions here does not
guarantee headroom in a populated shared Redis. Single-run duration and fork
timings are not percentiles or capacity guarantees.

Earlier raw results are preserved as:

- `pre-reclamation.json`: before reclaiming acknowledged generic history.
- `post-generic-reclamation.json`: generic reclamation, before the final positive
  persistence-marker and route-rotation changes.
- `pre-reproducible-harness.json`: final Lua measurement before packaging this
  portable harness and refreshing Python-source fingerprints.

Scoped behavioral regression tests remain under `app/tests/`; this harness does
not replace them or run a full test suite.

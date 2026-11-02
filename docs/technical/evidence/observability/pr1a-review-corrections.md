# PR1A review corrections

2026-11-01. Worktree `/Users/diego/Code/crate-observability-integrity`, branch
`codex/observability-integrity`, base `6b1803c4506312b6550fb548cce8ffb333443e20`.
This checkpoint supersedes the completeness claims in checkpoints 1–3 where
Claude's subsequent review found uncovered failure modes. These corrections are
committed locally as `55fc5eddc` and published on the branch; there is no PR,
production rollout or PR1B/QoE implementation.

## Durable coverage and poison isolation

- Source/run identity, loss counters, pending count/oldest minute and bounded
  eight-day gap intervals are committed with snapshots in one transaction.
  Empty flushes establish a baseline. A first active flush without a baseline
  conservatively marks its initial interval unverified.
- Redis restart, reset, evictions or buffer losses produce durable intervals even
  when an entire minute disappeared before its first persistence. A lost backlog
  extends the interval back to the oldest pending minute, including quarantine.
  At most 128 coalesced ranges are retained; overflow conservatively merges old
  ranges. Recent windows recover without erasing the earlier gap.
- Future names or labels go to a separate bounded quarantine; supported rows
  continue flushing. A rotating scan prevents unknown entries from indefinitely
  hiding newly supported entries. Incompatible dimensions are never silently
  normalized into another persisted population. Corrupt snapshots are isolated;
  invalid timestamps retain the original indexed minute in quarantine.
- A successful CAS ACK records a positive `persisted_revision` on the bucket.
  Reclamation requires that exact revision, in addition to absence from pending
  indexes. Losing `DIRTY_KEY` alone cannot authorize deletion of unpersisted data.
- Missing indexed hashes/route headers fail closed. Live index counting and
  selection are one atomic, budgeted operation, avoiding the earlier rollover
  race without removing transfer limits.

## Redis memory and persistence budgets

Redis is the live buffer; PostgreSQL retains eight days. The live default and
maximum TTL are now two hours (minimum one hour), with 24,000 generic buckets,
2,000 raw route buckets and at most 1,000 percentile samples per raw bucket.
Pending and quarantine indexes are pruned and expire. Namespace diagnostics and
cursors have a fixed shape.

At capacity, only positively ACKed generic history can be reclaimed. Raw route
storage rotates older minutes before refusing a new minute. The two buffers have
separate trim watermarks; only windows spanning removed history become partial.
New data is explicitly rejected if only unpersisted generic data or the current
route minute occupies the budget. Local and shared loss counters expose those
rejections, including per-family cardinality limits.

The disposable Redis 7 fixture uses 512 MiB, `volatile-lru`, normal RDB settings
and a 768 MiB container. With 500 series over 120 minutes and ACKs every five
minutes, all 60,000 observations are accepted, pending peaks at 2,500 and ends at
zero, while the generic buffer stays at 24,000. Five-minute windows remain
available; the trimmed 120-minute window is partial. Route churn accepts 60,000
observations while keeping 2,000 raw buckets; a trimmed five-minute route window
is partial and its current minute remains available. No-ACK overload stops at
24,000 buckets with explicit rejections.

The combined fixture is approximately 89 MiB with zero evictions; the maximum
route-list population is a synthetic memory upper bound. RDB save completes.
This exercises Redis admission, ACK and memory contracts, **not PostgreSQL write
capacity, HTTP SLOs or production capacity**. The earlier 500-series PostgreSQL
benchmark remains unmeasured. Reproducible scripts, exact hashes, configuration,
measurements and limitations are under
`.ecc/benchmarks/observability-pr1a/review-buffer-bounds/`.

Flush backlog and retention backlog/oldest remaining expired minute are exposed
in history metadata. Retention checks the next indexed row rather than counting
the table; the existing batch, timeout and savepoint limits remain. Collection
metadata travels once per batch query rather than once per output point.

## Readers and consumers

- Persisted plots become stale after ten minutes without a recent observation;
  the expected flush cadence is five minutes. Coarse points retain gap flags and
  the plot deliberately leaves a discontinuity rather than implying complete
  coverage. Observed totals remain in the response.
- Valid 60/120-minute live summaries no longer expire just because their latest
  observation is older than five minutes. Health inputs still use their own
  short windows.
- Every HTTP request classifies its latency as fast/slow on the parent counter.
  Slow-request zero is derived from that classified population; old/unclassified
  producers remain partial. Missing observations are never manufactured as zero.
- `/metrics/timeseries` uses the same persisted v2 reader and adds status while
  preserving name/period/data, explicit bounds and the historical daily window,
  including requests specifying only an end. Invalid periods/dates return 422.
- Catalogue guards compare documented live routes and literal/constant Python
  producer references with the closed registry. They do not claim full static
  proof of dynamic producers.
- `MetricChart` memoization isolates Nivo from the page's freshness clock while
  real data, status, interval, interaction and motion changes still update.
- Downgrade removes only v2 cutover/collection/retention settings alongside the
  unshipped v2 table; legacy history remains intact.

## Verification and remaining adoption

Regressions were observed failing before their fixes using real disposable
PostgreSQL/Redis. All 239 cases in the affected metric/migration/API consumers
are covered by the scoped checkpoint verification, plus six database-boundary
guards. Frontend verification covers the chart and SystemHealth consumers.
Scoped Pyright and Ruff pass. Independent SPEC then QUALITY reviews approve the
corrections; two additional independent Redis reproductions also pass.

No full platform suite ran. The Stack Map and D1 repairs remain in their separate
worktrees with their own evidence. D2 remote deployment/locking/Linux migration,
PR1B continuous QoE, C1 and final GitHub/documentation-website updates retain their
planned checkpoints. Production C0 is unchanged.

## Review follow-ups 2 — 2026-11-01

Claude took over the remaining plan. These follow-ups are uncommitted on top of
`55fc5eddc`.

- False gaps from a shared cache: the global `INFO evicted_keys` counter no
  longer participates in source-change detection. Any eviction of an unrelated
  cache key used to mark every flushed minute as a gap and every live summary as
  partial. Only our own losses count now: a pending bucket whose hash vanished is
  recorded as `evicted` (or `expired` past its lifetime) in the loss counters,
  which opens a gap through `dropped_samples`. Previously that case only emitted
  a local `expired_before_flush` event and lost the data silently.
- Index durability: series, bucket, names, buffer, dirty and quarantine indexes
  and the trim watermarks no longer carry a TTL, so `volatile-lru` cannot evict
  them. They stay bounded by age trimming in the record script and by a new
  `trim_indexes` step after each flush, which counts trimmed unpersisted entries
  as expired. Bucket hashes keep their TTL.
- Live read race: a bucket that vanishes between index selection and hash reads
  marks only its own key `partial` (`live_bucket_missing`); other keys in the
  batch stay available. Naturally expired index entries are skipped, so long
  windows no longer fail. The previous race test never injected the race and is
  replaced by one that deletes a hash between the two phases.
- Persisted freshness follows the collector heartbeat (`checked_at` of the last
  successful flush, ten-minute limit) instead of the age of the last observation.
  Sparse series stay available while the collector runs; a stopped collector
  marks every series in a current window, including empty ones,
  `stale`/`collection_stale`; windows already covered by the collector never go
  stale.
- Catalogue guard: producers imported inside functions are scanned, with a
  self-test proving it.
- Gauge summaries expose `latest` (sum of each series' latest value). Admin's
  queued depth shows it instead of the five-minute maximum; the alert threshold
  keeps the window maximum on purpose.

Tests: 392 cases across every metric, observability, storage-health and alerting
test module, plus 34 SystemHealth cases, with real disposable Redis and
PostgreSQL. Each new regression was observed failing first. Ruff, Prettier,
ESLint and Admin typecheck pass on the changed files.


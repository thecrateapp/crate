# Federation catalog capacity

## Supported baseline

The initial production baseline is 900 artists, 4,400 albums and 48,000
tracks. The profile creates metadata-only fixtures in an isolated
`crate_test` PostgreSQL database, scans the complete shareable snapshot with
500-item keyset pages, appends a 1% delta and removes every fixture in a
`finally` block. It never creates audio or writes to `/music`.

Run:

```bash
make dev-federation-capacity-test
```

The report is written to `.artifacts/federation-capacity.json`. The command
returns non-zero when any acceptance budget fails:

- snapshot page p95 below 500 ms;
- idle delta p95 below 150 ms;
- 1% delta below 10% of full snapshot time;
- process RSS growth below 64 MiB;
- track pages use `idx_lib_tracks_entity_uid` and do not sequentially scan
  `library_tracks`;
- pages remain bounded to 500 rows and 2 MiB of serialized items by default.

Wall-clock results depend on the Docker host. CI should retain the JSON report
and compare the query plan, row count and byte budgets even when timing
baselines move. A timing exception requires an attached report and must not
waive keyset, memory, page-size or index-plan checks.

Reference run on 2026-07-15 (local Docker test stack): 53,300 total items,
107 pages, 3.29 s full snapshot, 32.52 ms page p95, 4.68 ms idle delta
p95, 7.92 ms for the 480-item delta and 300 KB maximum page. The track plan
used `idx_lib_tracks_entity_uid` with no sequential scan. This is evidence for
the current implementation, not a portable timing guarantee.

## Query shape

The initial snapshot scans `library_albums`, `library_artists` and
`library_tracks` separately in canonical `(entity_type, entity_uid)` order.
Each scan advances with `entity_uid > cursor` through the existing UUID index;
there is no `OFFSET`, global `UNION` sort or accumulation of the full catalog
in worker memory. Policy allowlists and denylists are applied in the indexed
query before `LIMIT`.

Normal synchronization consumes the durable sequence-based delta every two
minutes. A full snapshot is reserved for first sync, cursor retention recovery
and daily drift verification.

## Operational interpretation

- Rising snapshot p95 with a stable index plan usually points to storage or
  database saturation.
- A sequential scan or page latency that grows with cursor position is a query
  regression and blocks release.
- Delta latency with no changes measures scheduler/DB overhead; a high value
  indicates connection or lock contention rather than catalog volume.
- RSS is a high-water mark. Compare before/after growth, not the absolute
  process footprint.

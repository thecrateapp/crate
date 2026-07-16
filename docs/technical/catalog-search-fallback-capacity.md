# Local catalog search fallback capacity

Crate keeps search available during the first global-catalog reconciliation by
serving the existing local library index behind `GET /api/catalog/search`. This
path is a production availability mechanism, not a best-effort emergency UI.

## Release gate

The production-shaped profile seeds 1K artists, 10K albums, and 100K tracks in
the isolated `crate_test` database. It alternates common prefixes, multi-token
queries, Unicode input, and substring fallback cases.

```bash
make dev-catalog-search-capacity-test
```

The command writes
`.artifacts/catalog-search-fallback-capacity.json` and fails when:

- p95 search latency exceeds 300 ms;
- p99 search latency reaches 800 ms;
- a query errors or returns an invalid artists/albums/tracks contract.

The report includes the PostgreSQL track query plan. A regression should be
fixed through query shape or indexes; increasing the read-plane timeout does not
satisfy the gate.

Run this gate before every federation rollout that changes local/global search,
library search vectors, or the read-plane query implementation.

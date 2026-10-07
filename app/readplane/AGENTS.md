# crate-readplane (Go) — app/readplane

Scope: the Go read-only acceleration service. It serves snapshot-backed and
catalog GET/HEAD routes, relays SSE, optionally serves local media bytes, and
proxies federation stream bytes. FastAPI stays the owner of writes, auth
mutations, playback preparation, snapshots (built by `crate-projector`), signing
and federation authorization. Operator detail: `app/readplane/README.md`.

## Layout

- `cmd/crate-readplane/` — service entrypoint (`healthcheck` subcommand used by compose).
- `cmd/readplane-contract-smoke/` — compares readplane vs FastAPI responses.
- `cmd/readplane-benchmark/`, `cmd/federation-benchmark-proxy/` — latency tooling.
- `internal/config/` — all env vars (`config.go` `Load`), defaults and CORS origins.
- `internal/auth/` — token extraction (Bearer > `?token=` > `crate_session_listen` >
  `crate_session` cookie), HS JWT validation (`jwt.go`), session/user lookup,
  bounded identity cache, `media_ticket.go`.
- `internal/snapshots/` — `ui_snapshots` reader with LRU and fresh/stale/expired policy.
- `internal/catalog/` — SQL stores for artists/albums/tracks/genres/global catalog.
- `internal/routes/` — HTTP mux (`server.go`), handlers, SSE (`cache_events.go`,
  home discovery stream), local media, stats.
- `internal/httpx/` — FastAPI fallback reverse proxy with circuit breaker, JSON helpers,
  `X-Crate-Readplane` source header.
- `internal/media/` — path safety, artwork, byte serving. `internal/federation/` — stream relay.
- `internal/contract/` — comparison logic used by the smoke command.

## Commands

```bash
make readplane-test        # go test -cover ./... in golang:1.23-alpine (writes coverage.out, gitignored)
make readplane-vet         # go vet ./...
make readplane-ci          # test + vet + docker build -t crate-readplane:local
make dev-test-readplane    # test + vet
make readplane-contract-smoke   # needs FastAPI + readplane running locally
make readplane-benchmark
docker compose -f docker-compose.dev.yaml -f docker-compose.readplane.dev.yaml up -d --build readplane
```

With a host Go toolchain: `cd app/readplane && go test ./... && go vet ./...`.
CI (`.github/workflows/test-readplane.yml`) also runs
`go test -race ./internal/media ./internal/observability ./internal/routes` with
`CGO_ENABLED=1` on `golang:1.23`; run it locally when touching those packages.
Go version is pinned to 1.23 (`go.mod`, `Dockerfile`, Makefile `READPLANE_GO_IMAGE`).

## Hard rules

- Read-only. The only permitted write is the throttled
  `UPDATE sessions SET last_seen_at` in `internal/auth/auth.go`. Never add
  INSERT/UPDATE/DELETE, Redis writes, or task creation here; send it to FastAPI.
- Non-GET/HEAD requests to `/api/*` must fall back to FastAPI (`routeGetHead`,
  `fallbackOnly`). Never answer a mutation natively.
- Missing, stale-beyond-policy, unauthorized-by-readplane or unknown cases must fall
  back (`tryFallback`) rather than invent data. Responses must match FastAPI's JSON
  contract; the contract smoke is the referee.
- Never build snapshots here. Read `ui_snapshots` only; warming belongs to the projector.
- Local media (`READPLANE_LOCAL_MEDIA_ENABLED`, default `false`) serves only existing
  originals, ready variants and materialized artwork from read-only `/music` and
  `/cache`; JIT/transcode cases fall back. Keep the default `false` (rollback switch),
  enforced by `app/tests/test_readplane_catalog_routing.py`.
- Federation: the readplane never holds private keys. It exchanges a local ticket via
  `POST /internal/federation/streams/authorize` with `CRATE_READPLANE_SERVICE_TOKEN`
  (>= 32 bytes, same value on API). Private peers only with
  `CRATE_FEDERATION_DEV_ALLOW_PRIVATE_NETWORKS=true` in dev.
- Exported functions changed => table-driven test (root testing policy).
- Hot-path SQL follows the root performance rules: no aggregates over
  `library_tracks` per request, batch with `ANY($1)`, honor `READPLANE_QUERY_TIMEOUT_MS`.

## Adding or moving a route

A native handler is only reachable if the edge sends traffic to it. Update together:

1. `internal/routes/server.go` mux registration + handler + tests.
2. `deploy/readplane/routes.json` (route class: interactive / sse / stream).
3. Traefik labels on `crate-readplane` in `docker-compose.yaml`
   (`crate-readplane-{interactive,sse,stream}` rules, priority >= 100) and the
   failover services in `deploy/traefik/federation-readplane.yml`.
4. `app/listen/nginx.conf` readplane locations and `data/caddy/Caddyfile.readplane.dev`.
5. Python guards: `app/tests/test_readplane_route_manifest.py`,
   `app/tests/test_readplane_catalog_routing.py`.

## Pitfalls

- SSE relays Redis pub/sub `crate:sse:cache-invalidation` with replay keyed by
  `cache:invalidation:next_id`; the channel name is shared with Python. The same
  subscription invalidates the auth identity cache (`RunAuthInvalidation`), so
  revocations depend on it.
- Redis is split: `REDIS_CACHE_URL` vs `REDIS_DURABLE_URL` (both default to `REDIS_URL`).
  Read from the store the Python writer uses.
- `JWT_SECRET` falls back to `settings.jwt_secret` in Postgres; tests must not assume env only.
- `READPLANE_ROUTE_MODE` (default `shadow`) is parsed but not consumed by any code path;
  do not rely on it to gate traffic. Routing is decided by Traefik/nginx/Caddy.
- `READPLANE_CACHE_ROOT` must be the same volume as Python `CACHE_DIR`.
- Fallback has a circuit breaker (`READPLANE_FALLBACK_FAILURE_THRESHOLD`,
  `READPLANE_FALLBACK_OPEN_SECONDS`) and bounded timeouts; streaming fallbacks are
  classified separately in `internal/httpx/fallback.go`.

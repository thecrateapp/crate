# crate-readplane

Small Go read-only acceleration service for hot Listen endpoints and the
canonical global catalog.

The service owns snapshot-backed GET routes. In particular, the complete
`/api/catalog/*` namespace is routed through the readplane in production and
in the dev proxy. Native handlers serve the implemented catalog contracts;
unknown or temporarily unavailable catalog reads fall back to FastAPI. Writes
and every non-GET catalog request always go directly to FastAPI.

Core routes include:

- `GET /healthz`
- `GET /readyz`
- `GET /api/auth/me`
- `GET /api/me/home/discovery`
- `GET /api/me/home/discovery-stream`
- `GET /api/catalog/status`
- `GET /api/catalog/search`
- `GET /api/catalog/artists/{artist_slug}`
- `GET /api/catalog/artists/{artist_slug}/albums/{album_slug}`
- `GET /api/catalog/assets/{entity_type}/{global_uid}/{asset_kind}`
- `GET /api/catalog/tracks/{global_track_uid}/playback`
- `GET /api/federation/remote/streams/{local_ticket_uid}`

FastAPI remains the owner of writes, auth mutations, playback preparation,
workers, tasks, enrichment, admin APIs, snapshots, federation authorization,
URL policy, and signing. With `READPLANE_LOCAL_MEDIA_ENABLED=true`, the
readplane may serve existing local originals, ready adaptive variants and
worker-materialized artwork from read-only `/music` and `/data` mounts. Any
disabled, missing, unsafe, stale or JIT-dependent case falls back to FastAPI.
The default remains `false` for an immediate rollback.

The readplane is also the preferred byte relay for remote federation streams
because the reproducible performance gate in
`docs/technical/federation-streaming-benchmark.md` failed for the Python proxy.
FastAPI is used once as fallback only if authorization fails before material is
issued.

The readplane never receives or mounts federation private keys. It exchanges an
opaque local stream ticket for 15-second, method/path/audience-bound signed
headers through `POST /internal/federation/streams/authorize`. Configure the
same random value of at least 32 bytes on API and readplane:

```bash
CRATE_READPLANE_SERVICE_TOKEN="$(openssl rand -hex 32)"
READPLANE_FEDERATION_PROXY_ENABLED=true
```

Production permits only HTTPS peers resolving to public IPs. The
`CRATE_FEDERATION_DEV_ALLOW_PRIVATE_NETWORKS=true` override is limited to local
development harnesses.

Run locally once Go is available:

```bash
go test ./...
go run ./cmd/crate-readplane
```

Run without installing Go on the host:

```bash
make readplane-ci
docker run --rm -p 8686:8686 \
  -e DATABASE_URL='postgres://crate:crate@host.docker.internal:5432/crate?sslmode=disable' \
  -e REDIS_URL='redis://host.docker.internal:6379/0' \
  crate-readplane:local
```

With the Crate dev stack:

```bash
docker compose -f docker-compose.dev.yaml -f docker-compose.readplane.dev.yaml up -d --build readplane
```

Compare P0 contracts against FastAPI:

```bash
make readplane-contract-smoke
```

To include bounded byte-for-byte checks for local tracks and materialized
artwork, provide comma-separated authenticated paths, for example:

```bash
READPLANE_CONTRACT_MEDIA_PATHS='/api/tracks/1/stream,/api/albums/1/cover' \
  make readplane-contract-smoke
```

Native local delivery configuration:

```bash
READPLANE_LOCAL_MEDIA_ENABLED=false
READPLANE_MUSIC_ROOT=/music
READPLANE_DATA_ROOT=/data
READPLANE_CACHE_ROOT=/cache
```

`READPLANE_CACHE_ROOT` must reference the same regenerable cache volume used by
Python's `CACHE_DIR`; stream variants and materialized artwork are read from it.

Set `READPLANE_CONTRACT_CHECK_SSE=false` to skip the SSE initial-event
comparison while Redis or stream routing is being wired.

Compare P0 latency locally:

```bash
make readplane-benchmark
```

Run the selected remote stream data-plane gate:

```bash
make dev-federation-stream-benchmark
```

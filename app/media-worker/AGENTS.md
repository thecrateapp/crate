# crate-media-worker (Rust) — app/media-worker

Scope: the native packager for downloads. It builds album ZIP packages and
single-track artifacts (optionally with rich tags written to staged copies),
finalizes the download cache, and reports progress/cancel state through Redis.
Callers are Python: `app/crate/media_worker.py` (HTTP client, job building) and
`app/crate/media_worker_progress.py` (slot gate, cancel keys, event bridge).

## Layout

- `src/main.rs` — CLI: `serve [--addr]` (default, `0.0.0.0:8687` or
  `CRATE_MEDIA_WORKER_ADDR`), `package-album --job <path|->`, `package-track --job <path|->`.
- `src/http.rs` — hand-rolled HTTP/1.1 server: `GET /healthz`,
  `POST /v1/packages/album`, `POST /v1/packages/track`. 64 KiB header / 16 MiB body caps.
- `src/package.rs` — `PackageJob`/`TrackArtifactJob` (serde, must match Python job dicts),
  staging, safe entry names, temp file + rename.
- `src/zip.rs` — ZIP64 writer, stored (uncompressed) entries, data descriptors,
  cancel checks between chunks.
- `src/metadata.rs` — rich tag writing via `lofty` (most tests live here).
- `src/cache.rs` — download cache finalize/prune, atomic JSON manifests.
- `src/progress.rs` — minimal RESP client: `XADD` events, `HSET` job state, `EXISTS`
  cancel key; also file-based progress/cancel paths.
- `src/observability.rs` — Sentry init and payload scrubbing.

## Commands

```bash
cargo test --manifest-path app/media-worker/Cargo.toml
cargo test --locked --manifest-path app/media-worker/Cargo.toml   # what CI runs
make dev-test-rust                 # media-worker + crate-cli + desktop shell
docker build -f app/Dockerfile --target media-worker app           # production image
```

CI: `.github/workflows/test-native-tools.yml` job `media-worker` runs
`cargo test --locked` in `rust:1.88-slim` and builds the `media-worker` Dockerfile
target. Toolchain is pinned to Rust 1.88 there and in `app/Dockerfile`; do not use
newer language features. Python-side contract tests:
`app/tests/test_media_worker_progress.py` (run them when changing keys/events).

## Hard rules

- Never modify originals. `/music` is mounted read-only; tags are written only to
  staged copies under the job's staging dir, and outputs go to `/data` paths supplied
  by the job. Keep the temp-file + `rename` pattern so partial files never appear.
- Keep the job/result JSON contract in lockstep with `app/crate/media_worker.py`
  (`_album_package_job`, `_track_artifact_job`, `_download_cache_policy`). Adding a
  required field breaks running API containers; add new fields as `Option`/`#[serde(default)]`.
- Redis key/stream names are shared with Python: `crate:media-worker:events`,
  `crate:media-worker:job:<id>`, `crate:media-worker:cancel:<id>` (env-overridable via
  `CRATE_MEDIA_WORKER_{EVENTS_STREAM,JOB_PREFIX,CANCEL_PREFIX}`). Change both sides together.
- Progress goes to the durable Redis (`REDIS_URL` = `REDIS_DURABLE_URL` in compose).
  `CRATE_MEDIA_WORKER_REDIS_URL` overrides it.
- Cancellation must stay cooperative and cheap: check between entries and inside copy/zip
  loops; return errors, never panic.
- Every failure must end as `ok: false` with `errors`, never a hang. Python treats any
  failure or denied admission as "fall back to the Python packager".
- Scrub payloads before Sentry (`observability::scrub_payload`); do not log paths of
  user libraries in Sentry tags.

## Slot gate and concurrency

- Admission is decided in Python, not here: `acquire_media_worker_slot` takes
  `crate:media-worker:slot:<n>` with `SET NX EX` for `n < CRATE_MEDIA_WORKER_MAX_ACTIVE`
  (default 1, TTL = request timeout + 60 s). No slot means Python packages the download itself.
- `http::serve` handles connections sequentially on one thread. Raising
  `CRATE_MEDIA_WORKER_MAX_ACTIVE` above 1 only queues requests in the accept backlog
  unless the server becomes concurrent; change both together.
- Container limits are small (`mem_limit: 256m`, `cpus: 0.25`). Stream files; never
  buffer whole tracks or archives in memory.

## Pitfalls

- `progress.rs` accepts only `redis://` URLs (no `rediss://`, no ACL usernames beyond
  the password part). A TLS Redis silently disables progress (`from_env` returns `None`).
- ZIP entries are stored, not deflated, by design (audio is already compressed); keep
  ZIP64 extra fields correct when sizes or offsets cross 4 GiB, and add a test.
- The API calls this service synchronously (`api/browse_album.py`, `api/browse_media.py`)
  with `CRATE_MEDIA_WORKER_TIMEOUT_SECONDS` (default 900). Long-running changes affect
  request latency.
- No HTTP framework dependency: request parsing is custom. Keep the size caps and timeouts
  (30 s read, 300 s write) when extending `http.rs`.

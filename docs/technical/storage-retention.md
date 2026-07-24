---
title: Storage retention and disk pressure
summary: Bound regenerable caches, container logs and image retention, and recover safely from disk pressure.
section: operations
audience: [operator, developer]
status: canonical
order: 160
verified: 2026-07-21
sources:
  [
    app/crate/streaming/maintenance.py,
    app/crate/storage_health.py,
    scripts/deploy-remote.sh,
  ]
---

# Storage retention and disk pressure

Crate separates durable state from regenerable caches:

- `DATA_DIR` contains PostgreSQL-adjacent application state, uploads, keys, and user-owned assets.
- `CACHE_DIR` contains stream variants, materialized artwork, external artist artwork, and download cache entries.
- `MUSIC_DIR` contains the canonical music library.

Production should place `CACHE_DIR` on a filesystem with enough headroom for transient growth. If it lives below the music mount, use a hidden directory such as `/mnt/music/.crate-cache`; the library scanner and watcher ignore hidden path components.

## Playback cache policy

The maintenance worker runs `cleanup_stream_variants` every hour. It reconciles `stream_variants` with the filesystem before deleting files and uses filesystem access time as the LRU signal. This includes reads served directly by the Go readplane without adding a PostgreSQL write to playback.

The default policy is:

- `CRATE_STREAM_CACHE_MAX_BYTES=12884901888` — 12 GiB high watermark.
- `CRATE_STREAM_CACHE_LOW_WATERMARK_BYTES=10737418240` — 10 GiB target after eviction.
- `CRATE_STREAM_CACHE_MAX_IDLE_SECONDS=2592000` — evict variants idle for 30 days.
- `CRATE_STREAM_CACHE_ORPHAN_GRACE_SECONDS=3600` — protect recently created files while DB metadata commits.
- `CRATE_STREAM_CACHE_CLEANUP_MAX_FILES=100000` — bounded scan size.

Missing or evicted variants are marked `pending`. Playback falls back to the original file and regenerates the requested delivery variant asynchronously.

Metrics exposed through the admin metrics surface include cache bytes/files, removed bytes/files, orphan count, filesystem pressure, and projected days until full. Storage warnings use 75%, critical alerts 85%, and emergency alerts 90%.

## Container image and log retention

After a successful, verified deployment, the remote cleanup keeps images used by running containers plus the active release and one rollback. Older unused image IDs and Docker build cache are removed. The cleanup runs only after `/api/status`, readplane readiness, workers, and public routes pass deployment verification.

All production containers use Docker's `local` logging driver with a 20 MiB file limit and five files. Traefik writes application and access logs to stdout, uses `INFO`, drops headers by default, and records only errors, retries, or requests slower than one second.

Never use `docker system prune --volumes`: PostgreSQL and Redis volumes are durable state. A safe manual audit starts with:

```bash
df -h / /var /mnt/music
docker system df
docker compose ps
curl -fsS https://api.example.com/api/status
```

## Emergency response

1. Confirm which filesystem is under pressure and verify inode availability.
2. Inspect `CACHE_DIR`, Docker images, build cache, logs, backups, downloads, and quarantines independently.
3. Prefer cache eviction and unused-image cleanup. Do not remove music, database volumes, uploads, backups, or quarantines without validating ownership and recovery requirements.
4. Verify all container health checks and `/api/status` after cleanup.
5. Record before/after disk usage and inspect playback-worker errors.

The deployment cleanup removes legacy regenerable cache directories under `DATA_DIR/crate` only after the new stack has passed verification and only when `CACHE_DIR` resolves to a different path.

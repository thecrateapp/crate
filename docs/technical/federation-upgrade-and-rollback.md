# Federation upgrade, canary, and rollback

## Preconditions

- Back up PostgreSQL and verify restore in an isolated database.
- Back up `/data/federation/keys` with encryption and record its key IDs; Redis is ephemeral except where the deployment explicitly enables persistence.
- Generate `CRATE_READPLANE_SERVICE_TOKEN` with at least 32 random bytes and set the same value only on API and readplane.
- Remove `CRATE_FEDERATION_ENABLED`, standalone/global-catalog mode flags, and both HTTP/private-network development overrides from production.
- Record user/library counts and invariant hashes with `scripts/verify-federation-backfill.py --dry-run`.

## Expand-compatible deployment order

1. Deploy database migrations 064 through 070. They add trust/key lifecycle, typed grants/quota state, catalog delta log, import hardening, human-route aliases, global likes/scrobble provenance, signed directories, and bounded risk observations.
2. Deploy API and workers that dual-read legacy local references and write canonical global references.
3. Deploy projector and wait for catalog/source/taxonomy snapshots to be ready.
4. Install `deploy/traefik/federation-readplane.yml` beside the compose files so
   the stream router can fail over to FastAPI when `/readyz` is unhealthy.
5. Deploy Go readplane with the shared service token. It never mounts the federation key directory.
6. Run the resumable backfill/reconciliation and the verification script until unresolved references are understood.
7. Deploy Admin and Listen after backend contracts are healthy.

A backfill failure must not block login or local library reads. Compatibility reads remain active throughout the window; repair unresolved rows explicitly and never delete them automatically.

## Verification

```bash
PYTHONPATH=app .venv/bin/python scripts/verify-federation-backfill.py --dry-run
make dev-test-readplane
make dev-federation-capacity-test
make dev-federation-stream-benchmark
```

Verify users, valid sessions, follows, saved albums, tracks, likes, playlists and ordering, history/play counts, home personalization, human slugs/aliases, local source ownership, grants, genres, tasks, and imports. Counts alone are insufficient: compare invariant hashes and unresolved-reference reports.

## Canary sequence

1. Upgrade one node with no peers and compare singleton baseline.
2. Pair one controlled peer with metadata-only discovery access.
3. Observe health, sync lag, denials, source selection, and user parity for 24 hours.
4. Grant stream access to test subjects with low limits; validate full/Range/revocation/disconnect.
5. Run one approved bounded import and confirm staging cleanup and provenance.
6. Enable directory consumption, global Subsonic, and remote scrobbling only for the intended capabilities/users.
7. Increase peers and quotas only while SLOs and singleton parity remain green.

## Operational rollback

Rollback is capability-first, not schema-first:

1. Revoke the affected grant/capability and signal active tickets.
2. Pause only the failing sync/import/directory jobs.
3. Keep materialized remote rows stale/unavailable so follows, likes, playlists, and history retain identity.
4. Route remote streams to FastAPI if the Go data plane is the fault.
5. Roll back to the last image that understands the expanded schema and canonical references.

Do not downgrade migrations after code has written 064–070-only state unless the restore drill confirms the exact boundary. The safe rollback boundary is the pre-deploy PostgreSQL/key backup plus compatible images, not an unconditional Alembic downgrade to 063. If destructive schema rollback is unavoidable, stop all writers, export canonical user references and audit data, restore the verified pre-upgrade backup, and validate counts/hashes before reopening traffic.

Never generate a new node identity to make old images start. Restore the original encrypted key material or keep federation disabled at the capability/grant level while local service continues.

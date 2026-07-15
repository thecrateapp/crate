# Federated imports

Federated import is the explicit boundary where remote content becomes a normal local library item. Catalog sync, browse, playback, likes, and playlists do not copy audio into the local library.

## Lifecycle

1. An authenticated user requests an album import by canonical global ID or approved peer/entity reference.
2. The consumer checks local permission and peer policy; the owner checks `import.request` and subject constraints.
3. The request remains pending until the configured administrator approval policy is satisfied.
4. The owner produces a signed, bounded manifest. Each entry has an opaque entity ID, normalized relative path, declared byte size, and SHA-256 digest.
5. The consumer atomically reserves peer, global, and disk-headroom bytes before download.
6. A maintenance worker downloads through signed, redirect-free, DNS-pinned transport into `/data/imports/federation/<request_uid>`.
7. The worker enforces file/count/aggregate limits, rejects path traversal and special files, verifies every digest, and publishes through the normal library import/sync pipeline.
8. Catalog reconciliation records local ownership while retaining source/provenance; user-facing identity and human URLs remain unchanged.
9. Completion, failure, cancellation, or expiry reconciles reservations and cleans staging.

API containers mount `/music` read-only and never publish, rename, delete, or tag files. All filesystem writes are Dramatiq worker work.

## Idempotency and resume

The request UUID and manifest digest are idempotency boundaries. Restarting a worker may reuse verified staged files only when path, size, digest, owner node, and manifest digest are unchanged. Publication uses deterministic provenance and must not create duplicate library tracks. A changed manifest or source identity creates a new request rather than mutating an approved one.

Terminal security failures include invalid signature, unsafe URL, redirect, path escape, symlink/special file, size overflow, digest mismatch, policy revision mismatch, revoked grant, and insufficient reserved headroom. These are visible and are not retried automatically.

## Limits and cleanup

- Per-file and aggregate declared bytes are validated before transfer and actual bytes are bounded during transfer.
- Peer and global reservations are atomic and expire/reconcile after crashes.
- A fixed free-space headroom remains after reservation.
- Staging has a TTL; cleanup records failures and retries with bounded backoff.
- Cleanup is restricted to the request staging root. Existing library paths are never removed as cleanup.

## Operations

Admin shows requester, peer, canonical album, approval/state, declared/transferred bytes, reservation, manifest digest, worker task, timestamps, failure code, provenance, and cleanup state. It never returns filesystem paths outside the bounded staging identifier or signed download URLs.

For a stuck request, follow `federation-operations-runbook.md`: inspect task and reservation, resume only an unchanged manifest, reconcile TTL leases after Redis/worker recovery, and never bypass the worker with a manual copy to `/music`.

Active import states renew `CRATE_FEDERATION_IMPORT_LEASE_SECONDS` whenever the
worker advances state or byte progress. The worker service loop expires stale
leases, releases peer/global reservation bytes, marks interrupted work failed,
and deletes only request staging below `.imports/federation/`. The lease must be
longer than the configured maximum import actor runtime.

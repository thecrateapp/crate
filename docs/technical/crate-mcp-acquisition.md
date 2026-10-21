---
title: Reviewed MCP acquisition and schedule boundaries
summary: Exact Soulseek and Tidal receipts, independent Telegram approval and bounded schedule contracts.
section: operations
audience: [operator, developer]
status: canonical
order: 172
verified: 2026-10-22
sources:
  - app/crate/agent_acquisition.py
  - app/crate/agent_acquisition_publish.py
  - app/crate/agent_library_operations.py
  - app/crate/agent_operation_catalog.py
  - app/crate/db/repositories/agent_acquisition.py
  - app/crate/db/repositories/agent_requests.py
  - app/crate/db/repositories/agent_task_control.py
  - app/crate/mcp/acquisition_schemas.py
  - app/crate/mcp/tools.py
  - app/crate/worker_handlers/acquisition.py
  - app/crate/tidal.py
  - app/crate/storage_import.py
  - app/crate/agent_instance_operations.py
  - app/crate/agent_runtime.py
  - app/tests/test_agent_acquisition.py
  - app/tests/test_agent_tidal_artist_acquisition.py
  - app/tests/test_mcp_acquisition.py
---

# Reviewed MCP acquisition and schedule boundaries

The unreleased MCP 1.2.0 contract supports exact, human-approved acquisition from two
sources: bounded Soulseek FLAC selections through the **slskd 0.26.1 batch API**
(including assembly version `0.26.1.0`), and one exact missing Tidal album through
Crate's existing Tidal account and worker. Bandcamp still has no reviewed bounded
selection contract. Provider configuration and source evidence do not guarantee a
successful transfer. No real-target rollout or live-provider acceptance is implied by
local tests.

The default pilot still has no acquisition authority. `library.acquisition.search`
and `library.acquisition.write` both map to the human capability
`library.import.manage`. Actions must be enabled. Provider credentials remain in Crate.
The independent Admin approval engine approves exact plan versions and content hashes;
there is no agent approval tool. Both acquisition operations are high risk and require
approval even when the integration's ordinary approval policy is disabled.

## Operator flow

1. `get_acquisition_readiness(provider="soulseek")` checks configuration and the reviewed
   live API version. `search_acquisition` searches one explicit query, creates no download,
   and returns at most five server-minted, owned selection receipts. Each selection has
   at most 50 FLAC files and 2 GiB of advertised bytes, with positive explicit file sizes,
   bit depths and sample rates. Receipt validity is 15 minutes. Responses retain whole
   selections within a 45 KB source budget; oversized selections are omitted, never
   silently shortened. Search coverage is explicitly partial. There is a daily limit of
   100 persisted receipts per principal.
2. `preview_acquisition` accepts only `receipt_id`, existing `artist_uid`, `max_items`,
   `max_bytes`, `max_cost_minor=0`, `destination_policy="provider_staging_only"` and an
   idempotency key. The provider artist must match that exact local artist; the release
   must not already exist. The plan lists the exact peer, files, sizes, quality, cost,
   caps, source search, batch ID and staging destination. Unknown or paid cost cannot
   satisfy this contract. Source results, receipt validity and current authority are
   checked again before execution.
3. A human approves the exact transfer plan, then `apply_acquisition` submits its ID and
   version. The existing `soulseek_download` actor runs the immutable plan engine in its
   agent-only branch. It retains download windows, active-user/stream gates, concurrency
   slots, runtime admission and current task authority; agent work additionally observes
   the maintenance governor. Agent semaphore failure is fail-closed. Legacy acquisition
   handlers retain their existing behavior. Every agent task has zero automatic retries.
4. A durable transfer reservation is committed before sending. The batch ID is the
   receipt UUID and its destination is `crate-agent/<receipt UUID>` under slskd's configured
   downloads root. The worker's `downloads_path` must mount that same root, with a library
   root that is completely disjoint. Batch destination overrides global placement. No
   basename search, recursive guessing, alternate peer, implicit upgrade, quarantine or
   file substitution is allowed. Batch and transfer identity, advertised sizes, actual
   transferred bytes and failures are checked. HTTP 200/201/207 alone is not success.
5. The worker polls for at most 24 five-second intervals. Completed remote state must
   match every selected file. Local staged files must have the exact unique basenames,
   with no extra files, symlinks or hardlinks; bytes must match, FLAC must fully decode,
   and artist/album tags and quality must match. The worker records SHA-256 and audio
   metadata. Success here means **staged**, with library publication still pending.
6. `preview_acquisition_publication(source_job_id=...)` references the owned transfer.
   Pending or uncertain attempts are reconciled by reading the original batch and exact
   staging files; this never sends another download request. A missing, partial or
   conflicting batch remains non-executable. The new plan binds actual audio hashes,
   bytes, the exact artist UID, new album/track UIDs and the absent library destination.
7. After a second independent approval, `apply_acquisition_publication` copies only the
   approved bytes into a hidden worker staging directory, rechecks hashes, and atomically
   publishes a new album directory with Linux `renameat2(RENAME_NOREPLACE)`. Existing
   files and database identities are never overwritten or merged. Existing library
   upserts index the exact album and tracks and emit the acquisition domain event. Final
   file hashes and index identities are verified. Projector adoption remains **pending**
   until independently observed; file publication is not a claim that every cache is fresh.

### Tidal: find one release or import a complete missing discography

1. `search_tidal_missing_albums(artist=...)` resolves exactly one existing local artist,
   then queries at most 50 Tidal discography entries. It returns at most 50 releases
   whose normalized titles are absent from that artist's indexed Crate albums. An
   ambiguous local/Tidal artist returns no receipts. Search never downloads; receipts
   are owned, exact and valid for 15 minutes. Tidal search may require the existing Crate
   Tidal session to refresh. Provider credentials stay inside Crate.
2. The operator chooses the exact matching release and calls
   `preview_tidal_acquisition(receipt_id, quality=...)`. The high-risk plan binds the
   numeric Tidal album ID, artist UID, release title/date, track count, requested
   quality, quality fallback policy, and new-album-only destination. Preparation
   rechecks the source and that the release remains absent. This uses the existing Tidal
   subscription and does not buy a release.
3. The human reviews and approves that plan in Telegram. One approval covers both the
   Tidal download and the import into `/music`; there is no download before approval.
   `apply_tidal_acquisition` runs as the dedicated `agent_tidal_download` worker task,
   with the normal download concurrency/runtime admission and no automatic retry.
4. The worker refreshes source and authorization, checks cancellation during Tidal
   download output, validates staged artist/album tags against the approved receipt,
   and refuses a release already indexed or a destination directory already present.
   It imports with replacement disabled, syncs the album into the database, starts the
   normal scan, and verifies the indexed title. The underlying Crate Tidal handler can
   fall back to normal quality only when its existing integrity checks find incomplete
   or unrecoverable lossless output; that policy is shown in the plan.
5. The operation is at-most-once after its effect boundary. If download or import ends
   uncertain, inspect the plan/job and reconcile the library before preparing a new
   plan. The worker never silently picks another release, upgrades existing audio or
   retries a Tidal import. Projection freshness remains separate from the database
   verification.

For a whole artist, `search_tidal_missing_artist(artist=...)` paginates the provider
catalog in pages of 50 and observes up to 500 entries. It creates no receipt if the
catalog is ambiguous, the end of the catalog cannot be observed, an entry cannot be
represented safely, or more than 50 releases are missing. A complete result mints one
owned batch receipt containing the exact missing album IDs, titles, release types, dates,
track counts and catalog offsets. The receipt expires in 15 minutes. Already indexed
albums are excluded by normalized title; same-title editions are not treated as upgrades.

`preview_tidal_artist_acquisition(receipt_id, quality=...)` binds every listed release
to one high-risk plan. The full album list is visible in Telegram; one approval covers
that list only. The worker rechecks the entire provider catalog and local target before
the effect boundary, then downloads and imports each exact album sequentially through
Crate's existing single-album integrity and no-overwrite path. It starts one library scan
after the batch. The batch stops on the first failed or unverifiable release and reports
which earlier albums completed; it does not retry the batch. The durable apply operation
is at-most-once, so an uncertain or partial result must be reconciled against the library
before any new plan. Catalogs over 500 entries or with more than 50 missing releases are
reported as incomplete and cannot be approved as a full-artist import.

Use `get_job` and owned `get_plan` for status and exact review. Shared task surfaces expose
only sanitized status, never private source selections or full plans. Reusing an apply
idempotency key returns the original job. A second receipt for the same provider/peer/file
selection cannot redownload it after an uncertain attempt. Configuration/key changes do
not clear this duplicate barrier. Interrupted effects require reconciliation and a new
human-reviewed publication plan, not an automatic retry.

Cancellation is cooperative before transfer send and during polling/publication copy.
Cancellation after provider acceptance stops Crate's work but does **not** assert that
remote transfers stopped; `remote_transfers_may_continue` and the durable batch remain
available for reconciliation. No blanket provider queue cancellation or cleanup occurs.
Publication holds the existing authority/target locks through copy and indexing; revocation
is ordered by that engine. A process/DB failure after atomic filesystem publication can
leave an unindexed album. This is a partial, manual-reconciliation outcome; replay never
publishes or downloads blindly. Staged audio is retained and its cleanup is manual.

The external protocol was reviewed against upstream
[batch requests](https://github.com/slskd/slskd/blob/0.26.1/src/slskd/Transfers/API/DTO/EnqueueDownloadBatchRequest.cs),
[batch responses](https://github.com/slskd/slskd/blob/0.26.1/src/slskd/Transfers/API/Controllers/TransfersController.cs),
and [destination placement](https://github.com/slskd/slskd/blob/0.26.1/src/slskd/Transfers/Downloads/DownloadService.cs).
Deployment acceptance must separately establish supported slskd version, matching downloads
mounts, Linux atomic publication support, ffmpeg availability, current grants and approvals.

## Schedule audit

Only `compute_analytics` has a reviewed MCP run/update contract. It uses the existing
scheduler's deduplication, governor, maintenance window and admission; verification of
an enqueued or already active task remains pending. Plans bind the schedule configuration
revision, which is checked under the scheduler's database lock. MCP interval changes are
limited to zero (disabled) or 600–2,678,400 seconds, preventing an indirect enable/frequency
bypass through `preview_schedule_update`. The Admin scheduler UI retains its existing
human authority and configuration behavior.

| Schedule | Reason MCP run and update remain non-executable |
| --- | --- |
| `enrich_artists` | Unbounded library selection and provider effects |
| `library_pipeline` | Wide filesystem mutation pipeline |
| `check_new_releases` | May auto-download outside an exact approved selection |
| `promote_due_releases` | Downloads without exact source/cost receipts |
| `rematch_album_mbids` | Library-wide identity mutation |
| `repair_duplicate_tracks` | Destructive library-wide duplicate repair |
| `cleanup_incomplete_downloads` | Deletes provider staging outside an exact manifest |
| `cleanup_artwork_variants` | Destructive cache sweep without a frozen selection |
| `cleanup_stream_variants` | Destructive cache sweep without a frozen selection |
| `sync_shows` | External sync without exact bounded source selection |
| `federation_health_poll` | Peer selection is not frozen in the plan |
| `federation_sync_catalog` | Remote selection and downstream work are not frozen |
| `federation_directory_refresh` | Can expand the remote selection |
| `global_catalog_reconcile_incremental` | Dirty batch is bounded, but its genre snapshot refresh is global |
| `global_catalog_reconcile_full` | Delegated global reconciliation is not a bounded plan |

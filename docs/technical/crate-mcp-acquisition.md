---
title: Reviewed MCP acquisition and schedule boundaries
summary: Exact provider receipts, independent publication approval and bounded schedule contracts.
section: operations
audience: [operator, developer]
status: canonical
order: 172
verified: 2026-10-21
sources:
  - app/crate/agent_acquisition.py
  - app/crate/agent_acquisition_publish.py
  - app/crate/db/repositories/agent_acquisition.py
  - app/crate/agent_instance_operations.py
  - app/crate/agent_runtime.py
  - app/tests/test_agent_acquisition.py
  - app/tests/test_mcp_acquisition.py
---

# Reviewed MCP acquisition and schedule boundaries

The unreleased MCP 1.2.0 contract supports one exact, zero-purchase-cost acquisition
path: Soulseek FLAC selections through the **slskd 0.26.1 batch API**. Readiness also
accepts its assembly version `0.26.1.0`. Older and unknown versions are not executable.
Tidal and Bandcamp explicitly report that they lack a reviewed bounded selection and
cost contract. Readiness probes the configured provider; it does not prove a transfer
will succeed. No real-target rollout or provider upgrade is implied by local tests.

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

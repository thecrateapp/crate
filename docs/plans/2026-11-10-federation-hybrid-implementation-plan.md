# Federation: hybrid ingestion and federated search · Implementation plan

Design: `2026-11-10-federation-hybrid-design.md` (decisions FED-D1…D18). Branch: `feat/federation`, worktree `~/Code/Ninja/crate-agents/federation`.

**For agents:**
- Run the phases in order, and start every task with the red test it names.
- Never pass a gate (FG-n) without Diego.
- Follow the monorepo `AGENTS.md`: tests for everything you touch, no `COUNT` over `library_tracks` in requests, and the db layer only through `crate.db.*` modules.
- Each phase ships as its own PR from a branch cut from `feat/federation`, or from `main` once v3.3.1 is merged. Nothing is deployed without the release process.

## State at the start (2026-11-10 10:03)

- **The branch starts at #410's head** (`325c5126c`): pairing retries, Listen grants, catalog status and the v3.3.1 notes.
- **The worktree holds an uncommitted snapshot** of the Codex `hotfix-federation` worktree, copied at 10:03:10: 21 modified files and 9 new ones. They include migration 159 (catalog publication), `federation_manifest_import.py` (batch import), the bootstrap capacity test and the publication tests. Nothing of it is verified yet.
  - The patch and the file list are kept in the session scratchpad (`federation-snapshot/`).
  - **The Codex worktree must stop being edited from now on,** or the two copies diverge.
- **Production runs v9** (`ca620f1c1`). `main` holds v3.3.0 (stems), which is tagged but not deployed.

## FED0 · Hotfix v3.3.1 (#410 + P1 + migration)

**Goal:** ship what #410 and the Codex snapshot fix, plus the P1 fencing, as v3.3.1. Diego approved it: "se sube … y se despliega esa: 410 + P1 + migración".

1. **FED0.1 · Verify the snapshot.** Run every federation test the snapshot touches or adds, against PostgreSQL (`pg_db`). Fix what fails. Commit in coherent, conventional commits:
   - the batch import;
   - the publication feed and migration 159;
   - the tests and docs.
2. **FED0.2 · P1 fencing (FED-D11). Red first:** move the Codex reproduction of "a stale session tombstones a newer session's rows and moves its checkpoint back" into the collected suite. It must fail.
   - **Migration 160:** `federation_catalog_cursors.sync_generation BIGINT NOT NULL DEFAULT 0`, or the equivalent on the peer sync-state row.
   - **Session start:** `UPDATE … SET sync_generation = sync_generation + 1 … RETURNING`, under row lock.
   - **Every write checks `sync_generation = :mine`:** `apply_federation_manifest_page` (rows and cursor), `tombstone_catalog_items_missing_from_revision` and checkpoint updates. A mismatch aborts the session with a clear error.
   - **The checkpoint is monotonic** (`AND next_page <= :new`, or the cursor ordering it uses).
   - **Peer disable and revocation** bump the generation in the same transaction. An admin disable is never blocked by the guard.
   - **Tests:**
     - two sessions interleaved in both orders;
     - a restart in the middle of a page;
     - revocation during a bootstrap;
     - mixed-version writers during upgrade (the v159 bridge).
3. **FED0.3 · Migration order with v10.** Federation takes 159 and 160. Tell the v10 release (#409) to renumber its `159_smart_mix_meter_signals` to 161, or to whatever follows at merge time. Check `test_crate_schema_definition` and `test_crate_migration_follows_the_current_main_head`.
4. **FED0.4 · Release.**
   - Rebase `feat/federation` on `origin/main`.
   - Make a release branch `release/2026-11-10-federation-v3.3.1` and its PR, which supersedes #410; close #410 pointing to it.
   - Update `docs/releases/v3.3.1.md`: it also deploys v3.3.0 (stems), since that is on `main` and not yet live.
   - CI green, then merge.
   - **Annotated tag `v3.3.1`,** pushed only after the merge commit's image build has finished (memory: release tagging).
   - `make deploy-preflight`, then `make deploy`.
   - **Post-deploy checks:**
     - health;
     - alembic at 160;
     - federation pairing and sync with Home;
     - stems checks (see `~/Code/Ninja/crate-agents/handoffs/2026-11-10/deploys.md`);
     - the v9 Smart Mix campaign is still running.

**Gate FG0 · approved by Diego** (2026-11-10). Deploy follows the normal process.

## FED1 · On-demand federated search in Listen

**Goal:** remote results in seconds, before any replica (FED-D2, D4, D5, D14, D16, D17, D18).

**Decided (Diego, 2026-11-12):** the proposed open values (design §10).
- *k* = 5: fan out when there are fewer than 5 local results.
- Listen debounces 300 ms and needs at least 3 characters.
- The remote window: 1.5 s per peer and a 2 s total deadline.
- The metadata lease: 24 h (FED-D7).
- The reference profiles as proposed in design §8.

1. **FED1.1 · The result envelope.** Add the `crate.federation.results/1` schema on the owner side, together with A's adapter into Listen's search contract.
   - **Red:** contract tests, plus "unknown fields are ignored" and "a missing optional field is fine".
2. **FED1.2 · Fan-out.** In `app/crate/federation/search_fanout.py`:
   - direct authorised peers only;
   - bounded concurrency;
   - a per-peer timeout and a total deadline;
   - a negative cache per (query, peer);
   - inbound quotas on the owner;
   - results grouped by entity.
   - **Red:** a slow peer never delays the first results; the quota returns 429; a late answer is cached.
3. **FED1.3 · Triggers (FED-D14).**
   - The server applies the rule: local results under *k*, or a stale replica. Summaries come in FED2.
   - **Listen debounces:** 300–500 ms and at least 3 characters (`app/listen/src/pages/SearchResults.tsx`).
   - **Red:** no fan-out per keystroke; a fan-out when local results are under *k*.
4. **FED1.4 · Streaming and coverage.**
   - Local results come at once and remote ones within the window, over SSE or an incremental response through FastAPI and the read plane fallback.
   - Listen shows coverage ("3 of 4 peers") and "more results from the network".
   - **Red:** the coverage state; an empty result never says "not in the network".
5. **FED1.5 · Capability negotiation.** Old clients keep the canonical search path.

**Gate FG1 (Diego):** check the federated search experience in Listen, on the dev stack against a paired peer.

## FED2 · Per-peer summaries

**Goal:** route queries and decide the triggers from summaries (FED-D3).

1. **FED2.1 · Generation on the owner.** Bloom filters of normalised artist, album and track keys, with versioned parameters and about 1 % false positives. A worker keeps them up to date from catalogue changes; requests never rebuild them.
   - **Red:** no false negatives on a fixture set; the measured false-positive rate.
2. **FED2.2 · Transport.** Summaries travel in the delta feed (v159), with a fetch endpoint for bootstrap. They are scoped: a peer gets only the summary of what it may see.
   - **Red:** scope isolation; a summary update after a catalogue change.
3. **FED2.3 · Routing.**
   - Fan-out goes only to peers whose filter may contain the key.
   - The "more material at the peer" trigger compares, per artist, the local album count against the peer summary counts.
   - **Red:** a non-matching peer is never queried.

## FED3 · Snapshot bootstrap and the source index

**Goal:** the ≤600 s replica (FED-D8, D9, D12).

1. **FED3.1 · Snapshot generation on the sender.**
   - A worker job reads at `REPEATABLE READ` with an exported snapshot and records watermark S from the same snapshot.
   - It writes NDJSON gzip blocks (block size from measurement, starting near 5,000 records) with per-block SHA-256 and a manifest (sender, schema, scope, S, block list), cached per scope.
   - **Red:** blocks equal the catalogue at S, even with concurrent writes during generation; scope isolation.
2. **FED3.2 · Serving.** Endpoints for the manifest and the blocks. Download tokens are bound to the peer and its scope. The endpoint never builds anything.
3. **FED3.3 · Import on the receiver.**
   - `COPY` into staging, then set-based upserts into the source index, with the checkpoint in the same transaction, under the FED0 fencing.
   - A generation is published after the checks; the previous one stays readable.
   - **Red:** resumes from any block; a corrupt block is rejected; a newer generation is never overwritten.
4. **FED3.4 · Source-index search.** FTS over the source index, with permission, peer-state and freshness filters (reuse the `federation_catalog` FTS).
5. **FED3.5 · Measurement.** Set the reference profiles (design §8). Measure generation, transfer, import, indexing and search availability separately at 140,000 tracks.

**Gate FG2 (Diego):** the ≤600 s acceptance on the reference profile.

## FED4 · Deltas, leases and revocation

1. **FED4.1 · Delta consumer** on the v159 feed. Idempotent per page with its checkpoint. A no-change poll writes nothing.
   - **Red:** A → B → A; delete → restore → delete; out-of-order commits; a second no-change poll.
2. **FED4.2 · Recovery bootstrap** only for a cursor outside the history, a scope change or an explicit repair.
3. **FED4.3 · Leases (FED-D7).** Metadata leases of 24 h (decided by Diego, 2026-11-12) renewed at half-life, plus revocations pushed through the feed. On expiry, cached results are hidden but kept. Playback always revalidates.
   - **Red:** a revocation applies immediately when online and at expiry when offline; playback fails closed.

## FED5 · Source identity in navigation and playback

1. **FED5.1 · Source references and the alias map (FED-D6).**
   - User references (likes, playlists, URLs) are stored as source references.
   - Canonical resolution happens at read time through the alias map; references are never rewritten.
   - **Red:** a reference survives consolidation, an unmerge and a peer going offline.
2. **FED5.2 · Pages.** Artist and album pages accept source identities (`app/shared/web/library-routes.ts`, the API detail routes in `app/crate/api/federation_remote.py`).
3. **FED5.3 · Playback source choice at play time** (FED-D4): availability, latency and quality, with fallback to the next source (`app/listen/src/lib/playable-track.ts`).

## FED6 · Background consolidation

1. **FED6.1 · Consumer.** Source-index changes, then bounded batches in dependency order, with prompt retries for children waiting on a parent.
2. **FED6.2 · Matching** only on strong identifiers: MusicBrainz recording and release IDs, ISRC, AcoustID. A name alone never merges.
   - **Red:** two artists sharing a name stay apart; an MBID match merges them.
3. **FED6.3 · Metrics** that keep source records, consolidated entities and pending work apart. No unique-work counts while duplicates remain.

## FED7 · Integrity by block digests

Compare per-block digests with the owner and repair only the differing blocks; no full bootstrap to check coherence.

## Future (not planned)

- **Introductions:** a peer says "E may have it", and the user can ask to pair with E.
- **Summary-based routing** between trusted groups.
- **Multi-hop relay:** only with transitive trust and limits defined (design §6).

## Risks

- **The Codex snapshot is unverified,** and Codex may still be editing the old worktree. Stop that worktree before FED0.1.
- **v3.3.1 also deploys stems (v3.3.0).** Both sets of checks are needed.
- **The migration renumbering with v10.**
- **The ≤600 s target depends on the reference profile.** Diego accepted the proposed profiles on 2026-11-12 (design §8).

# Federation: hybrid ingestion and federated search · Design

Date: 2026-11-10. Status: **approved direction**. Diego chose the hybrid approach and per-peer summaries, and asked to ship the hotfix as v3.3.1 (#410 + P1 + migration). The values marked *to confirm* are still his.

This consolidates the Codex proposal (`docs/superpowers/specs/2026-11-10-federation-hybrid-ingestion-design.md` in the `hotfix-federation` worktree) with Claude's review. The implementation plan is `2026-11-10-federation-hybrid-implementation-plan.md`.

## 1. Goal

- A paired instance can search and use another instance's authorised catalogue without waiting for global deduplication.
- **First usable replica:** about 1,050 artists, 11,000 albums and 140,000 tracks become searchable, navigable and referenceable in **≤600 s** on a fixed reference profile.
- After that, normal operation runs on deltas. There is no daily full download, and a no-change poll creates no work.
- **On-demand search** returns useful remote results in seconds after a valid pairing, before any replica exists.

## 2. Evidence (from the Codex investigation)

- **Page size:** Listen's search preset `max_results=20` capped manifest pages, so 140,000 tracks took about 7,000 requests (about 0.93 s each, end to end, receiver included).
- **Import cost:** the old import ran one transaction and one queue item per record. The batch importer saves 200 records with six queries and one commit, checkpoint included.
- **The bottleneck is canonical projection, not transport:**
  - 1,000 tracks imported in 0.17 s, but projection and search took 19.83 s (21,570 queries, 1,065 commits);
  - extrapolated, projection alone would take about 46 minutes for 140,000 tracks.
  - **This is why projection must leave the critical path.**
- **P1 race,** reproduced on PostgreSQL:
  - `tombstone_catalog_items_missing_from_revision` tombstones every peer row whose `remote_revision` differs from the caller's;
  - `apply_federation_manifest_page` upserts the cursor unconditionally;
  - so a stale bootstrap session can tombstone rows written by a newer session and move its checkpoint back.

## 3. Decisions

| ID | Decision |
| --- | --- |
| FED-D1 | **Three separate jobs:** discover results, replicate metadata, consolidate identities. The first two never wait for the third. |
| FED-D2 | **Remote search goes to direct, authorised peers only,** in parallel, with bounded concurrency and a total deadline. No multi-hop relay in v1 (§6). |
| FED-D3 | **Per-peer summaries:** Bloom filters of normalised artist, album and track keys, published by the owner and carried by the delta feed. They route queries and decide when remote search is worth it. No DHT. |
| FED-D4 | **Results aggregate within a short window.** No single winner: first results show at about 300 ms, the window stays open up to 1.5–2 s, and late answers go to the cache and to "more results from the network". The playback source is chosen per track at play time (availability, latency, quality), with the next source as fallback. |
| FED-D5 | **A common, versioned result envelope,** not the full API DTOs (§5). Changes are additive; unknown fields are ignored. |
| FED-D6 | **Source identity** = `node_uid + entity_type + remote_entity_uid`. User references (likes, playlists, URLs) are stored as source references and resolved through an alias map to the canonical entity at read time. They are never rewritten, and a wrong merge can be undone without breaking references. |
| FED-D7 | **Metadata access lease of 24 h** (*to confirm*), renewed at half-life. Revocations are **pushed** through the delta feed, so with the peer online they apply immediately; the lease only bounds the worst case while the owner is unreachable. Once it expires, cached remote results are hidden but kept. **Playback always revalidates** and fails closed. |
| FED-D8 | **Selective replication:** pairing enables on-demand search; a full replica is an opt-in per peer. The acceptance case (Home with Les Pedants) keeps the full replica. |
| FED-D9 | **Snapshot:** the sender's worker reads at `REPEATABLE READ` (with `pg_export_snapshot()` for parallel readers), records watermark S from the same snapshot, and writes compressed NDJSON blocks, bounded, checksummed and resumable. Blocks are cached per permission scope. HTTP only serves an existing generation and never rebuilds the catalogue. |
| FED-D10 | **Deltas** use the v159 publication feed: an outbox whose rows get their public sequence only after commit, from a single publisher. That gives commit order, and A → B → A and delete → restore → delete reach consumers as separate rows. A cursor outside the retained history, a scope change or an explicit repair triggers a bootstrap; nothing else does. |
| FED-D11 | **Fencing:** a per-peer `sync_generation` is incremented under row lock when a session starts. Every page write, tombstone and checkpoint update checks `generation = :mine`, and the checkpoint only moves forward. A stale session aborts instead of writing. Revoking a peer bumps the generation in the same transaction. **This fixes P1.** |
| FED-D12 | **Import:** blocks are loaded with `COPY` into staging, followed by set-based upserts, with the checkpoint in the same transaction. A generation is published only after integrity, version and scope checks. The previous generation stays readable until then. |
| FED-D13 | **Consolidation** runs asynchronously from source-index changes. It processes bounded batches in dependency order (artist → album → track); a child waiting for its parent is retried promptly, not hidden for an hour. Matching uses strong identifiers (MusicBrainz recording and release IDs, ISRC, AcoustID when present); **a shared name never merges on its own**. Matching never authorises touching local files. |
| FED-D14 | **Remote search triggers:** <ul><li>only on a submitted query, or as-you-type debounced at 300–500 ms with at least 3 characters;</li><li>it fans out when local results are under *k* (*to confirm*, starting at 5), when a peer's summary suggests more material than the local index has (for example more albums of the artist), or when that peer's replica is stale beyond its freshness budget;</li><li>a hit only goes to peers whose summary may contain the key.</li></ul> |
| FED-D15 | **`node_uid` is stable** across reinstalls and key rotation, and is never derived from the hostname. |
| FED-D16 | **Privacy:** remote queries carry the node identity. They carry a scoped user grant only when the owner's permissions require it. Query text is not logged beyond what abuse limits need. |
| FED-D17 | **Protection:** inbound query quotas per peer, per-peer timeouts, and a negative cache per query and peer (short TTL). |
| FED-D18 | **Compatibility:** new behaviour is negotiated through capabilities. Old clients keep the canonical search path, and FastAPI, the read plane and Listen move together behind a capability flag. |

## 4. Flows

### Search (Listen → A)

1. Listen asks A, which is its only application server. A queries its local index (canonical and source) and the summaries.
2. If FED-D14 triggers, A fans out to the selected direct peers in parallel.
3. A answers with local results at once. Remote results stream in during the window, through SSE or an incremental response, grouped by entity.
4. The response states its coverage: "local · 3 of 4 peers answered". An empty result never claims the content is absent from the network.
5. A queues the remote results for indexing and consolidation, without blocking the answer.

### Open and play

- **Pages:** artist and album pages accept source identities through the same identity adapter (`app/shared/web/library-routes.ts`). A result never links to a canonical entity that does not exist yet.
- **Playback:** a source reference (`remote:<node>:<entity>`, already understood by `app/listen/src/lib/playable-track.ts`) is resolved through A's proxy with the owner's current permission. The source is chosen at play time (FED-D4).

### Replication

1. Bootstrap: the snapshot generation at watermark S, imported in blocks under a fencing generation, then published.
2. After that, deltas from S.
3. Integrity is checked later with per-block digests, and only the differences are repaired.

### Consolidation

Source-index changes feed the consolidation consumer. It keeps a stable map from source references to canonical entities.

Its metrics keep three things apart: available source records, consolidated entities and pending work. Source counts are never shown as exact counts of unique works.

## 5. Result envelope (v1)

```json
{
  "contract": "crate.federation.results/1",
  "source": {"node_uid": "…", "node_name": "…", "fetched_at": "…"},
  "items": [
    {
      "entity_type": "artist|album|track",
      "remote_entity_uid": "…",
      "revision": "…",
      "fields": {"name": "…", "artist": "…", "album": "…", "year": 1979,
                 "duration_ms": 0, "track_number": 0, "mbid": "…", "isrc": "…",
                 "cover": {"url": "…", "etag": "…"}},
      "availability": {"playable": true, "formats": ["flac"], "bitrate": 0},
      "lease": {"scope": "…", "expires_at": "…"}
    }
  ],
  "coverage": {"complete": true, "truncated": false}
}
```

A's adapter maps this envelope to the public contract Listen already consumes.

## 6. Why not multi-hop broadcast in v1 (Diego's proposal, evaluated)

- **Trust:** pairing A with D grants nothing over D's peers. A multi-hop answer from E leads to one of two bad outcomes:
  - D proxies E's audio: D pays the bandwidth, and E serves a stranger without consent;
  - A needs E's permission, and then E is a direct peer anyway.

  The useful part becomes an **introduction**: D answers "E may have it", and A can ask to pair with E. That is listed as future work.
- **Amplification:**

| Variant | Messages per search | Load on each node |
| --- | --- | --- |
| Direct peers (P = 2–20) | P | Only its own peers' users |
| Flooding, degree 10, TTL 3 | Up to 1,110; about N with deduplication | Grows with the users of the whole network: with N = 1,000 and 5 searches/s network-wide, about 5 queries/s per node from strangers |
| Direct peers + summaries | Only peers whose filter matches, usually 1–3 | Lowest; summary cost is about 14 KB per peer for artists and albums at 1 % false positives, and about 170 KB with 140,000 track keys |

The hybrid lets this evolve later (introductions, summary-based routing between trusted groups) without changing playback or identity.

## 7. Failure behaviour

| Case | Behaviour |
| --- | --- |
| Late answer after the window | Cached; offered as "more results" and in the next search |
| Peer offline | Its results stay visible as "unavailable"; nothing is deleted |
| Revocation | Pushed and applied at once if the peer is online, otherwise at lease expiry; playback fails closed |
| Empty result | "No results in 3 of 4 peers; 1 did not answer" |
| Local indexing fails | The answer already served is unaffected; indexing retries with backoff |
| Stale bootstrap session | Fenced: it aborts without writing (FED-D11) |
| Cursor outside history | Recovery bootstrap; the previous generation stays readable |

## 8. Acceptance budgets

| Area | Criterion |
| --- | --- |
| Initial access | Useful remote results within seconds after pairing, without a bootstrap |
| Initial replica | 140,000 tracks searchable (FTS built), navigable and referenceable in ≤600 s on the reference profile |
| Steady state | A no-change sync calls no manifest and creates no dirty rows or normalisation work |
| Small delta | Work proportional to the change |
| Concurrency | Restarts, two tasks for one peer and a lost lease never move a checkpoint back or delete a newer generation |
| Permissions | Search, snapshot, delta, metadata and playback keep their own scopes and revocations |
| Identity | A result can be opened, saved and played before and after consolidation without breaking references |

**Reference profiles** (*to confirm*):
- **Laptop:** 8 cores, NVMe, 100 Mbit/s, RTT 30 ms.
- **CI runner.**

Each measurement separates generation, transfer, import, indexing, search availability and consolidation.

## 9. Delivery and compatibility

- **v3.3.1** = #410 + the P1 fencing + the publication migration, released from `feat/federation`. No v3.3.1 tag exists yet, so there is no retag.
- **Deploying it also deploys** what `main` holds (v3.3.0, Smart Mix stems).
- **Migration numbering:** the federation publication takes 159 and the fencing 160. The v10 release (#409, currently `159_smart_mix_meter_signals`) must be renumbered after them.
- **The v159 publisher bridge** for older writers must survive partial service starts during upgrade and rollback (`docs/technical/federation-upgrade-and-rollback.md`).
- **Out of scope:** audio download during bootstrap, obligations to share whole libraries, visual changes to Admin or Listen beyond the coverage and "more results" states, a DHT, and multi-hop relay.

## 10. Open values for Diego

1. **Metadata lease:** 24 h, with pushed revocation (FED-D7).
2. ***k* for "too few local results":** 5 (FED-D14).
3. **Aggregation window:** first results at about 300 ms, closing at 1.5–2 s (FED-D4).
4. **The reference profiles** (§8).

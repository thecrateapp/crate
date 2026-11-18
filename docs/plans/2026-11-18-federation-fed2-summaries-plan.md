# FED2 · Per-peer summaries · Implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** an owner publishes a Bloom summary of what each peer may search. The receiver stores it and asks only the peers whose summary may contain the query, plus the peers whose summary shows more albums of a found artist than the local library has.

**Architecture:**
- **Owner:** a maintenance task builds one summary per distinct permission scope (scope = the existing catalog policy digest computed with the `catalog.search` decision) and stores it in `federation_catalog_summaries`. HTTP only serves stored rows: the new `GET /catalog/summary` and a `summary` descriptor added to each `/catalog/delta` page.
- **Receiver:** fetches on a changed descriptor or on a 15-minute conditional poll, then stores the summary in `federation_peer_summaries`. `decide_fanout` filters peers through the summaries. A peer without a summary is never excluded.

**Tech Stack:** Python 3.13, FastAPI, SQLAlchemy `text()`, Dramatiq tasks, PostgreSQL 15. The Bloom filter is pure Python (`hashlib.blake2b`), with no new dependency.

**Spec:** `docs/plans/2026-11-10-federation-hybrid-design.md` (FED-D3, D14, D16, D18) and the FED2 section of `docs/plans/2026-11-10-federation-hybrid-implementation-plan.md`.

## Decisions this plan makes (not in the design; confirm before execution)

1. **What goes into the filter.** Search on the owner is FTS (`build_fts_query`: every token whole, AND, with the last token as a prefix) plus a substring `ILIKE`. Whole-name keys would miss nearly every query, so the filter holds **word tokens and their prefixes of 3+ characters** taken from artist names, album titles with their artist, and track titles with their artist and album. A query routes when every probe term may be in the filter. **Accepted gap:** a match in the middle of a word (`head` → Radiohead) is not routed.
2. **The delta feed carries a descriptor, not the bytes.** A summary for 140K tracks is a few hundred KB. Each delta page carries `{"contract", "etag", "source_sequence"}`, and the body comes from `GET /api/federation/v1/catalog/summary`.
3. **Album counts for the "more material" trigger** travel next to the Bloom as `artist_album_counts`: a map from `blake2b-64(normalised artist name)` to the number of albums in scope.
4. **Scope = search scope.** The summary uses the `catalog.search` decision, taken at node level with no user assertion. When that is denied (for example a grant only for some roles), no summary exists for that peer, and the receiver then treats it as "may contain anything".
5. **FED1 scope leak, fixed here (Task 2).** `POST /search` on the owner never applies the grant's `allowed_entity_types`/`allowed_entity_uids` or the node's `catalog_filter` allow and deny lists, while the manifest and the delta do. A summary built from the real scope would be narrower than what search returns. Search now filters through the same predicate.
6. **Capability.** The descriptor advertises `catalog.summary` for negotiation (FED-D18), and the endpoint authorises with the existing `catalog.search` grant, so stored grants need no migration.

## Global Constraints

- False-positive target 1 % (`FP_TARGET = 0.01`), measured. No false negatives for word-prefix queries, ever.
- Requests never build a summary (FED-D3, root `AGENTS.md`). `GET /catalog/summary` returns 404 `summary_pending` and enqueues the build with `create_task_dedup`.
- Query text is never logged or stored (FED-D16). Summaries hold hashed bits and hashed artist keys only.
- *k* = 5 for "too few local results" (`FanoutSettings.min_local_results`, unchanged).
- New migration `167` (origin/main head is `166_decks_cues`). Renumber after the head at merge time (db `AGENTS.md` rule 7).
- The db layer only through `crate.db.queries|repositories|jobs.*`; `async def` routes in `api/federation.py` wrap sync calls in `asyncio.to_thread` (`tests/test_federation_async_boundaries.py`).
- One branch `feat/fed2-summaries` cut from `origin/main`, one PR (memory: one integration PR).
- During development run only the scoped tests. Run the full validation once, in Task 9.

## Review Focus

1. **Accented, punctuated and non-Latin names** (`Björk`, `AC/DC`, `Sigur Rós`, `坂本龍一`): the owner's and the receiver's tokenizers must agree with `build_fts_query`, or routing silently drops the peer. Pinned in Task 3 (`test_tokens_agree_with_fts_query`).
2. **Queries with no usable probe** (`U2`, `!!!`, `a b`): they must never exclude a peer. Pinned in Task 3 (`test_unroutable_queries_return_none`) and Task 8 (`test_unroutable_query_keeps_every_peer`).
3. **A peer without a summary** (old version, per-role grants, first fetch still pending): it must still be asked. Pinned in Task 8 (`test_peer_without_summary_is_still_asked`).
4. **A new album at the owner:** routable after the next build (≤5 min) and the next delta sync (≤2 min). The etag must change only when the content changes, so unrelated catalogue churn costs a 304. Pinned in Task 5 (`test_unchanged_content_keeps_etag`) and Task 6 (`test_delta_page_carries_summary_descriptor`).
5. **An empty scope** (everything denied): a valid, empty filter that matches nothing, never a crash or a full filter. Pinned in Task 3 (`test_empty_filter_matches_nothing`).

---

### Task 1: Extract the catalog scope helpers

A behaviour-preserving move, so the worker can compute the same scope the API enforces.

**Files:**
- Create: `app/crate/federation/catalog_scope.py`
- Modify: `app/crate/api/federation.py:436-482` and `:1773-1843` (move them out; the call sites import from the new module); the digest computation in `catalog_delta` (`:1533-1539`)
- Test: `app/tests/test_federation_catalog_scope.py`

**Interfaces:**
- Produces:
  - `catalog_share_policy() -> dict`
  - `catalog_scope_allows_item(item: dict, scope: dict) -> bool`
  - `catalog_policy_allows_item(item: dict, policy: dict) -> bool`
  - `catalog_policy_allows_live_search(policy: dict) -> bool`
  - `catalog_policy_for_grant(policy: dict, decision: AuthorizationDecision | None, *, include_genres: bool, metadata_decision: AuthorizationDecision | None = None) -> dict`
  - `catalog_policy_params(policy: dict) -> dict` (was `_catalog_manifest_policy_params`)
  - `catalog_scope_digest(policy: dict) -> str`: the sha256 hex that `catalog_delta` puts in its cursor
  - `peer_search_policy(peer: dict) -> dict | None`: `authorize(peer=…, grants=repo.get_peer_grants(uid), capability="catalog.search", subject_hash=None, roles=set())`. Returns `None` when the decision is denied or `catalog_policy_allows_live_search` is false; otherwise returns `catalog_policy_for_grant(catalog_share_policy(), decision, include_genres=False)`.

- [ ] **Step 1: Write the failing tests**
  - `test_scope_digest_matches_delta_cursor`: a delta cursor's `policy_digest` (decode it with `decode_catalog_cursor`) equals `catalog_scope_digest(...)` for the same policy.
  - `test_peer_search_policy_none_when_denied`: an unapproved peer, and a node with `catalog_filter.share_scope = "favorites"`, both give `None`.
  - `test_peer_search_policy_carries_grant_scope`: a grant with `allowed_entity_types=["album"]` → `policy["_grant_scope"]["allowed_entity_types"] == ["album"]`.
- [ ] **Step 2: Run them and confirm they fail with ImportError.** `cd app && ../.venv/bin/python -m pytest tests/test_federation_catalog_scope.py -q`
- [ ] **Step 3: Move the helpers and add `catalog_scope_digest` and `peer_search_policy`.** `api/federation.py` keeps no copies.
- [ ] **Step 4: Run the new tests plus the delta, manifest and async-boundary suites; all must be green.** `pytest tests/test_federation_catalog_scope.py tests/test_federation_catalog_delta.py tests/test_federation_catalog_publication.py tests/test_federation_async_boundaries.py -q`
- [ ] **Step 5: Commit** `refactor(federation): move catalog scope helpers out of the API router`

### Task 2: Owner search honours the catalog scope

**Files:**
- Modify: `app/crate/api/federation.py` (`federated_search`, `:572-612`)
- Test: `app/tests/test_federation_search_scope.py`

**Interfaces:**
- Consumes: `catalog_policy_for_grant`, `catalog_policy_allows_item` (Task 1).

- [ ] **Step 1: Write the failing tests** (`test_app`, a signed peer, a monkeypatched `handle_remote_search` returning albums A and B):
  - `test_search_drops_entities_outside_grant_uids`: a grant with `allowed_entity_uids=[A]` → the response albums are `[A]`.
  - `test_search_drops_denied_entities`: `catalog_filter.deny_entity_uids=[B]` → B is absent from both the plain and the envelope response.
  - `test_search_drops_disallowed_entity_types`: `allowed_entity_types=["track"]` → artists and albums are empty.
- [ ] **Step 2: Run them; they fail (B is returned).**
- [ ] **Step 3: Filter before `apply_result_limit`.** Build `policy = catalog_policy_for_grant(share_policy, decision, include_genres=False)`, then keep an item when `catalog_policy_allows_item({"entity_type": <group singular>, "remote_entity_uid": item["entity_uid"], **item}, policy)`. Do it inside the existing `asyncio.to_thread` call.
- [ ] **Step 4: Run them, plus `tests/test_federation_async_boundaries.py` and the FED1 search tests (`-k search`); all green.**
- [ ] **Step 5: Commit** `fix(federation): apply the catalog scope to remote search results`

### Task 3: Tokenizer and Bloom filter

**Files:**
- Create: `app/crate/federation/summary_bloom.py`
- Test: `app/tests/test_federation_summary_bloom.py`

**Interfaces:**
- Produces:
  - Constants: `SUMMARY_CONTRACT = "crate.federation.summary/1"`, `TOKENIZER = "fts-simple-v1"`, `MIN_PREFIX = 3`, `FP_TARGET = 0.01`
  - `name_tokens(text: str | None) -> list[str]`: `re.findall(r"\w+", text.lower(), re.UNICODE)`, the same rule as `build_fts_query`
  - `summary_terms(*texts: str | None) -> set[str]`: every token whole, plus its prefixes of length `MIN_PREFIX..len-1`
  - `query_probe_terms(query: str) -> list[str] | None`: every token except the last, whole; the last token only when `len >= MIN_PREFIX`. Returns `None` when nothing is left.
  - `artist_key(name: str | None) -> str | None`: `blake2b(" ".join(name_tokens(name)).encode(), digest_size=8).hexdigest()`; `None` for an empty name
  - `class BloomFilter`: `sized(n: int, fp_rate: float = FP_TARGET) -> BloomFilter` (classmethod; `m = max(64, ceil(-n·ln p / ln²2))`, `k = max(1, round(m/n·ln 2))`); `add(term: str) -> None`; `__contains__(term: str) -> bool`; `to_bytes() -> bytes`; `from_bytes(data: bytes, *, m: int, k: int) -> BloomFilter` (classmethod); `params -> dict` returning `{"m", "k", "n", "fp_target", "hash": "blake2b-128-km", "tokenizer": TOKENIZER, "min_prefix": MIN_PREFIX}`.
  - Hashing (Kirsch–Mitzenmacher): `d = blake2b(term.encode(), digest_size=16, person=b"crate-sum-v1").digest()`, `h1 = int.from_bytes(d[:8], "little")`, `h2 = int.from_bytes(d[8:], "little") | 1`, bit `i = (h1 + i*h2) % m`, with the bits little-endian inside each byte.

- [ ] **Step 1: Write the failing tests**
  - `test_no_false_negatives_on_fixture`: build from ~2,000 fixture names (artist, album and track triples, including `Björk`, `AC/DC`, `Sigur Rós`, `坂本龍一`, `!!!`). Every `summary_terms` member is `in` the filter, and for every name, `query_probe_terms` of every word-prefix query (`"sigur r"`, `"bjö"`) is fully contained.
  - `test_measured_false_positive_rate`: n = 50,000 inserted terms and 20,000 random non-member terms; the measured rate is ≤ 0.015.
  - `test_round_trip_bytes`: `from_bytes(f.to_bytes(), m=f.params["m"], k=f.params["k"])` answers like `f`.
  - `test_tokens_agree_with_fts_query`: for the fixture names, `name_tokens(n) == build_fts_query(n)` with the separators and `:*` removed.
  - `test_unroutable_queries_return_none`: `query_probe_terms` is `None` for `"u2"`, `"!!!"`, `"a b"`; `query_probe_terms("joy di") == ["joy"]`.
  - `test_empty_filter_matches_nothing`: `BloomFilter.sized(0)` contains no term.
- [ ] **Step 2: Run them; they fail with ImportError.**
- [ ] **Step 3: Implement the module.**
- [ ] **Step 4: Run them; all green.**
- [ ] **Step 5: Commit** `feat(federation): add the summary tokenizer and Bloom filter`

### Task 4: Migration 167 and summary storage

**Files:**
- Create: `app/crate/db/schema_sections/federation_catalog_summaries_v167.py`, `app/crate/db/migrations/versions/167_federation_catalog_summaries.py`, `app/crate/db/jobs/federation_catalog_summaries.py`, `app/crate/db/queries/federation_catalog_summaries.py`, `app/crate/db/repositories/federation_peer_summaries.py`
- Modify: `app/crate/db/schema_bootstrap.py` (after `decks_cues_v166`), `app/tests/test_crate_schema_definition.py` (`get_heads() == ["167"]`)
- Test: `app/tests/test_federation_summaries_storage.py` (`pg_db`), `app/tests/test_federation_summaries_migration.py`

**Interfaces:**
- DDL (idempotent):
  - `federation_catalog_summaries(scope_digest TEXT PRIMARY KEY, contract TEXT NOT NULL, params_json JSONB NOT NULL, bloom BYTEA NOT NULL, artist_album_counts_json JSONB NOT NULL DEFAULT '{}', entry_count INTEGER NOT NULL, source_sequence BIGINT NOT NULL, etag TEXT NOT NULL, built_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`
  - `federation_peer_summaries(node_uid UUID PRIMARY KEY REFERENCES federation_nodes(node_uid) ON DELETE CASCADE, contract TEXT NOT NULL, params_json JSONB NOT NULL, bloom BYTEA NOT NULL, artist_album_counts_json JSONB NOT NULL DEFAULT '{}', source_sequence BIGINT NOT NULL, etag TEXT NOT NULL, fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`
  - The downgrade drops both.
- Produces (every function takes `*, session: Session | None = None`):
  - jobs: `upsert_catalog_summary(summary: dict) -> None` (keys = the owner table's columns minus `built_at`); `delete_catalog_summaries_except(scope_digests: list[str]) -> int`
  - queries: `list_catalog_summary_heads() -> list[dict]` (`scope_digest, contract, source_sequence, etag`); `get_catalog_summary(scope_digest: str) -> dict | None`
  - repositories: `upsert_peer_summary(node_uid: str, *, contract: str, params: dict, bloom: bytes, artist_album_counts: dict[str, int], source_sequence: int, etag: str) -> None`; `delete_peer_summary(node_uid: str) -> None`; `list_peer_summary_etags(node_uids: list[str]) -> dict[str, str]`; `get_peer_summaries(node_uids: list[str]) -> list[dict]` (both use `ANY(:uids)`)

- [ ] **Step 1: Write the failing tests:** the upsert/get round trip with `bytes` intact; `delete_catalog_summaries_except(["a"])` removes `"b"` only; deleting a peer cascades its summary; the migration test (`RecordingExecutor` pattern) checks that upgrade creates both tables and downgrade drops them.
- [ ] **Step 2: Run them; they fail.** `pytest tests/test_federation_summaries_storage.py tests/test_federation_summaries_migration.py tests/test_crate_schema_definition.py -q`
- [ ] **Step 3: Implement the DDL, the migration, the bootstrap call and the functions.** Each module ends with `__all__`.
- [ ] **Step 4: Run them plus `tests/test_db_access_boundaries.py tests/test_runtime_boundaries.py`; all green.**
- [ ] **Step 5: Commit** `feat(federation): store catalog and peer summaries (migration 167)`

### Task 5: Owner build task

**Files:**
- Create: `app/crate/federation/summary_builder.py`
- Modify: `app/crate/worker_handlers/federation.py` (handler + `*_TASK_HANDLERS`), `app/crate/worker.py` (`_HANDLER_GROUPS`), `app/crate/actors.py` (`"federation_build_catalog_summaries": TaskPoolConfig("maintenance", 3, 900, 1)`), `app/crate/scheduler.py` (`DEFAULT_SCHEDULES[...] = 300`, added to `FEDERATION_SCHEDULED_TASKS`), `app/crate/task_registry.py` (label)
- Test: `app/tests/test_federation_summary_builder.py` (`pg_db`)

**Interfaces:**
- Consumes: `peer_search_policy`, `catalog_scope_digest`, `catalog_policy_params` (Task 1); `summary_terms`, `artist_key`, `BloomFilter`, `SUMMARY_CONTRACT` (Task 3); the Task 4 jobs and queries; `list_federation_manifest_rows(after_entity_type=, after_entity_uid=, limit=, policy_params=)`; `catalog_high_water_mark()`; `repo.list_peers(trust_state="approved")`.
- Produces:
  - `@dataclass(frozen=True) BuiltSummary(scope_digest: str, contract: str, params: dict, bloom: bytes, artist_album_counts: dict[str, int], entry_count: int, source_sequence: int, etag: str)`
  - `build_scope_summary(policy_params: dict, *, scope_digest: str, source_sequence: int, page_size: int = 5000) -> BuiltSummary`. It pages the manifest rows twice: first to collect the term set (size the filter from `len(terms)`), then to fill it. Artist rows give their `title`; album rows give `title` and `artist`, and count one per `artist_key(artist)`; track rows give `title`, `artist` and `album`. `etag = sha256(contract ‖ canonical params JSON ‖ bloom ‖ canonical counts JSON).hexdigest()`, so it does not depend on `source_sequence`.
  - `refresh_catalog_summaries() -> dict` returns `{"scopes": int, "built": int, "skipped": int, "deleted": int}`. It groups the approved, enabled peers by `catalog_scope_digest(policy)` (skipping `None` policies), skips a scope whose head has the same `contract` and a `source_sequence` equal to the current high-water mark, builds and upserts the rest, and calls `delete_catalog_summaries_except(live_digests)`.
  - Task `federation_build_catalog_summaries`: the handler calls `refresh_catalog_summaries()` and checks `is_cancelled` between scopes.

- [ ] **Step 1: Write the failing tests:**
  - `test_summary_has_no_false_negatives_on_catalog`: seed artists, albums and tracks. Every seeded name's word-prefix probes are in the built filter.
  - `test_scope_isolation`: peer P1 has no constraints, peer P2 has `deny_entity_uids=[album X]`, and album X's title carries a unique token (`zyxqvalbum`). The token is in P1's filter and not in P2's; peers with equal scopes share one row.
  - `test_counts_albums_per_artist`: an artist with 3 albums gives `counts[artist_key(name)] == 3`.
  - `test_second_run_skips` (`built == 0`); `test_catalog_change_rebuilds`: add an album and append a change, so the high-water mark moves; the next run has `built == 1` and the new title is in the filter.
  - `test_unchanged_content_keeps_etag`: move the high-water mark with no content change; the etag is unchanged.
  - `test_dropped_scope_is_deleted`; `test_denied_peer_gets_no_scope`.
- [ ] **Step 2: Run them; they fail.**
- [ ] **Step 3: Implement the builder, the handler and the registrations.**
- [ ] **Step 4: Run them plus `tests/test_task_runtime_contract.py tests/test_task_queue_routing.py tests/test_actors.py tests/test_scheduler.py`; all green.**
- [ ] **Step 5: Commit** `feat(federation): build per-scope catalog summaries in the worker`

### Task 6: Owner transport (endpoint, delta descriptor, capability)

**Files:**
- Modify: `app/crate/api/federation.py` (new `GET /catalog/summary` registered before any parametric `/catalog/*` sibling; `catalog_delta` adds `summary`), `app/crate/federation/contracts.py` (`"catalog.summary"` in `CAPABILITIES`; `CAPABILITY_ENDPOINTS["catalog.summary"] = (("GET", "/api/federation/v1/catalog/summary"),)`), `docs/technical/federation-protocol.md` (the summary contract)
- Test: `app/tests/test_federation_catalog_summary_api.py`

**Interfaces:**
- Consumes: `peer_search_policy`, `catalog_scope_digest` (Task 1); `get_catalog_summary`, `list_catalog_summary_heads` (Task 4).
- Produces:
  - `GET /api/federation/v1/catalog/summary`: signed node request. 403 when `peer_search_policy(peer)` is `None`. A matching `If-None-Match` gives 304 with the `ETag` header. With no stored row: 404 `{"code": "summary_pending"}`, plus `create_task_dedup("federation_build_catalog_summaries", {}, dedup_key="federation:catalog-summaries")`. Otherwise 200: `{"contract", "etag", "source_sequence", "built_at", "params", "bloom": base64, "artist_album_counts": {hex: int}}`, with an `ETag` header.
  - Delta pages gain `"summary": {"contract", "etag", "source_sequence"}` when the peer's search policy exists and a head with that digest exists; otherwise the key is absent.

- [ ] **Step 1: Write the failing tests:**
  - `test_summary_scope_isolation`: two peers with different scopes get different etags, and the denied token is absent from the decoded filter of the restricted peer.
  - `test_summary_not_modified` (304, empty body); `test_summary_requires_search_grant` (403); `test_summary_pending_enqueues_build` (404 plus a dedup task row).
  - `test_delta_page_carries_summary_descriptor`, and its absence when the peer has no search grant.
  - `test_capability_registry_matches_openapi`: extend the existing contract test (`tests/test_capabilities_federation.py`) so it passes with `catalog.summary`.
- [ ] **Step 2: Run them; they fail.**
- [ ] **Step 3: Implement.** Every sync call goes through `asyncio.to_thread`.
- [ ] **Step 4: Run them plus `tests/test_federation_async_boundaries.py tests/test_federation_catalog_delta.py tests/test_openapi_contract.py`; all green.**
- [ ] **Step 5: Commit** `feat(federation): serve scoped summaries and announce them in the delta feed`

### Task 7: Receiver fetch and store

**Files:**
- Create: `app/crate/federation/peer_summaries.py`
- Modify: `app/crate/worker_handlers/federation.py` (`_sync_peer_catalog_delta` reads the last page's `summary`; new handler), `app/crate/worker.py`, `app/crate/actors.py` (`"federation_fetch_peer_summaries": TaskPoolConfig("maintenance", 2, 300, 0)`), `app/crate/scheduler.py` (900 s, in `FEDERATION_SCHEDULED_TASKS`), `app/crate/task_registry.py`
- Test: `app/tests/test_federation_peer_summaries.py`

**Interfaces:**
- Consumes: the Task 4 repositories, `BloomFilter`, `SUMMARY_CONTRACT`, `TOKENIZER` (Task 3), `federated_get` (`crate.federation.client`), `eligible_search_peers`.
- Produces:
  - `class InvalidSummary(ValueError)`
  - `peer_advertises_summary(peer: dict) -> bool`: the same list/dict handling as `_advertises_search`, but `False` when capabilities are unknown or empty
  - `parse_summary_payload(payload: dict) -> dict`: raises `InvalidSummary` for an unknown `contract`, a `params.tokenizer != TOKENIZER`, or a bloom length `!= ceil(m/8)`
  - `refresh_peer_summary(peer: dict, local_node: dict, *, known_etag: str | None) -> Literal["updated", "unchanged", "unavailable"]`: a signed GET with `If-None-Match`; 304 → `"unchanged"`; 404, 403 or `InvalidSummary` → `"unavailable"`, with no write
  - Task `federation_fetch_peer_summaries`: for each eligible peer that advertises a summary, refresh with the etag from `list_peer_summary_etags`. Returns `{"peers", "updated", "unchanged", "unavailable"}`.
  - In `_sync_peer_catalog_delta`: when the last page's `summary.etag` differs from the stored etag, call `refresh_peer_summary`. A failure there never fails the sync (log at debug).

- [ ] **Step 1: Write the failing tests** (with a stubbed `federated_get`):
  - `test_not_modified_writes_nothing`; `test_new_etag_is_stored`; `test_unknown_contract_is_not_stored`.
  - `test_peer_without_capability_is_never_asked`.
  - `test_delta_descriptor_triggers_fetch` and `test_same_descriptor_skips_fetch`.
  - `test_summary_fetch_failure_keeps_sync_result`.
- [ ] **Step 2: Run them; they fail.**
- [ ] **Step 3: Implement it and register the task.**
- [ ] **Step 4: Run them plus `tests/test_federation_catalog_worker_bootstrap.py tests/test_federation_catalog_sync_resume.py tests/test_task_runtime_contract.py tests/test_scheduler.py`; all green.**
- [ ] **Step 5: Commit** `feat(federation): fetch and store peer summaries on the receiver`

### Task 8: Routing in the fan-out decision

**Files:**
- Modify: `app/crate/federation/peer_summaries.py` (`PeerSummary`, `load_peer_summaries`), `app/crate/federation/search_fanout.py` (`decide_fanout`, `FanoutReason`), `app/crate/federation/search_stream.py` (passes `local_artists` and the summaries)
- Test: `app/tests/test_federation_summary_routing.py`, `app/listen/src/pages/SearchResults.network.test.tsx`

**Interfaces:**
- Consumes: the Task 7 storage and Task 3 `query_probe_terms` and `artist_key`.
- Produces:
  - `@dataclass(frozen=True) PeerSummary(node_uid: str, etag: str, bloom: BloomFilter, artist_album_counts: dict[str, int])` with `may_match(query: str) -> bool` (`True` when `query_probe_terms` is `None`) and `album_count(artist_name: str) -> int | None`
  - `load_peer_summaries(node_uids: list[str]) -> dict[str, PeerSummary]`: one `list_peer_summary_etags` call per request; it loads bodies only for etags missing from a process-local dict keyed by `(node_uid, etag)`, with at most 64 entries
  - `FanoutReason` gains `"no_summary_match"` and `"peer_has_more"`
  - `decide_fanout(query, *, local_total, peers, local_artists: Sequence[dict] = (), summaries: Callable[[list[str]], dict[str, PeerSummary]] | None = None, stale_node_uids=None, settings=None) -> FanoutDecision`. The order:
    1. `query_too_short`, then `no_peers` (unchanged).
    2. `candidates` = the peers with no summary, or whose `may_match(query)` is true.
    3. `local_total < k`: `few_local_results(candidates)`, or `no_summary_match` with no peers when `candidates` is empty.
    4. `more` = the peers whose `album_count(a["name"]) > a["album_count"]` for any of the first 3 `local_artists`.
    5. `stale` = the stale peers that are in `candidates`.
    6. When `more ∪ stale` is non-empty, the reason is `peer_has_more` if `more` is non-empty, else `stale_replica`, and the peers are the union in their original order. Otherwise `enough_local_results`.
  - `federated_search_events` passes `local_artists=local.get("artists") or []` and accepts `summaries: Callable | None = None` for tests (default `load_peer_summaries`).

- [ ] **Step 1: Write the failing tests:**
  - `test_non_matching_peer_is_never_queried`: through `federated_search_events` with fake peers A and B, where only A's summary has the term. Only A is asked (the fake query records calls) and coverage lists A only.
  - `test_peer_without_summary_is_still_asked`; `test_unroutable_query_keeps_every_peer` (`"u2"`).
  - `test_no_candidate_skips_with_no_summary_match`.
  - `test_peer_has_more_albums_triggers_fanout`: 6 local results, the local artist with `album_count=2`, the peer count 5 → only that peer, reason `peer_has_more`. `test_equal_counts_do_not_trigger`.
  - `test_stale_replica_is_filtered_by_summary`.
  - `test_summary_cache_reloads_on_new_etag`.
  - Listen: `"says nothing about the network when no summary matches"`, the existing `no_peers` case with `reason: "no_summary_match"`.
- [ ] **Step 2: Run them; they fail.**
- [ ] **Step 3: Implement.** The legacy `federated_search` (`scope=federated`) stays unchanged.
- [ ] **Step 4: Run them plus the FED1 suites (`-k "fanout or search_stream"`) and `npm run --workspace=app/listen test -- SearchResults.network`; all green.**
- [ ] **Step 5: Commit** `feat(federation): route federated search through peer summaries`

### Task 9: Measurement, docs and full validation

**Files:**
- Modify: `docs/technical/federation-overview.md` (summaries in the flow), `docs/technical/federation-capacity.md` (the measured size and FP rate), `docs/plans/2026-11-10-federation-hybrid-implementation-plan.md` (FED2 marked done, with this plan linked)
- Test: `app/tests/test_federation_summary_bloom.py::test_reference_catalog_size` (marked `slow`)

- [ ] **Step 1: Add `test_reference_catalog_size`.** It builds the filter from a synthetic catalogue of 1,050 artists, 10,900 albums and 138,000 tracks (seeded generator), asserts the measured FP ≤ 0.015, and prints `len(to_bytes())` and the build time.
- [ ] **Step 2: Run it and record the numbers in `federation-capacity.md`.**
- [ ] **Step 3: Update the three docs.**
- [ ] **Step 4: Run the full validation once.** `make dev-test`. Expected: green.
- [ ] **Step 5: Commit** `docs(federation): document per-peer summaries and their measured cost`, then open the PR from `feat/fed2-summaries`.

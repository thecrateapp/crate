# Node-First Federated Catalog Implementation Plan

> **For agents:** REQUIRED SUB-SKILL: Use viterbit:executing-plans to implement this plan task-by-task.

**Goal:** Make every Crate installation a node with a mandatory canonical catalog, so an installation with zero approved peers is a private one-node federation rather than a separate standalone runtime mode.

**Architecture:** `library_*` remains the only local write model. `global_catalog_*` becomes the mandatory, durable read model for Listen and the Go readplane; every local library entity is represented as a local source and every approved peer contributes federated sources. Node identity is always bootstrapped, while sharing is controlled exclusively by peer trust, grants, and an empty peer set—not by `CRATE_FEDERATION_ENABLED`, `CRATE_GLOBAL_CATALOG_ENABLED`, or per-surface catalog flags. A versioned, signed `crate-core` genre taxonomy supplies immutable global genre IDs and hierarchy; nodes federate source-level genre assertions, never editable taxonomy topology. The global catalog must be made event-driven and ready-aware before it becomes mandatory: a first-run backfill builds it, local mutations enqueue dirty sources, full reconciliation is resumable and prunes deleted local sources, and the UI/readplane never serve a silently partial catalog.

**Tech Stack:** Python 3.13, FastAPI, SQLAlchemy Core/ORM, Alembic, PostgreSQL 15, Redis Streams/domain events, Dramatiq, React 19/Vitest, Go 1.23 readplane with pgx, Docker Compose, pytest.

---

## Why This Plan Exists

The worktree already has the desired core data shape:

```text
local files -> library_* -----------+-> global_catalog_* -> Listen/readplane
                                     |        ^
approved peer -> federation_catalog_items -+
```

`global_catalog_sources.source_kind` already distinguishes `local` and
`federated`; the source resolver already prefers a healthy local source for
display, artwork, and playback. Therefore this is not a protocol rewrite and
does not create a peer pointing at the same instance.

The incomplete pieces are operational correctness and mode removal:

1. the global catalog is feature-gated and is not built on every node;
2. the task named `incremental` performs a full materialization today;
3. new installations can query empty canonical tables before the scheduled job
   runs;
4. deletes and historical user references are not fully projected; and
5. Go readplane routes/query tables are still local-library-only.

## Scope And Non-Goals

### In scope

- Every installation gets a persistent node identity at startup.
- Every installation builds and maintains a canonical catalog from its local
  library.
- A node with no approved peer has one catalog source per local entity and no
  network traffic.
- Listen and readplane use canonical `/api/catalog/*` read routes.
- Existing local user data is backfilled to the global references already
  introduced in migrations 055 and 057.
- Local source mutations and deletions are projected incrementally.
- The Go readplane exposes canonical catalog routes, serves safe native queries,
  and deliberately falls back to FastAPI for source resolution/assets/playback
  that require it.
- A `crate-core` taxonomy release gives every node stable global genre IDs,
  aliases, and hierarchy, including a one-node federation.
- Global genre membership is projected from attributed source assertions rather
  than copied from a peer's editable taxonomy database.

### Explicitly out of scope

- Replicating `library_*`, filesystem contents, tags, scanners, or worker write
  commands between nodes.
- Automatically approving, discovering, or pairing peers.
- Creating a self-peer row.
- Making remote likes a new product feature. Existing local likes remain backed
  by `user_liked_tracks`; remote-like semantics require a separate product
  decision.
- Replacing legacy Admin/local-write APIs or Subsonic paths with global IDs.
  They remain local compatibility/write interfaces.
- Native Go proxying of remote binary assets or stream tickets. Those stay in
  FastAPI behind the existing signed federation/proxy path.
- A CRDT, peer-majority vote, or automatic merge of taxonomy nodes, aliases, or
  edges. Peers can corroborate catalog membership only; they cannot redefine
  genre semantics.

## Terminology And Invariants

| Term | Meaning |
| --- | --- |
| Node | Every Crate installation with one `federation_nodes` local identity. |
| One-node federation | A node with zero approved peers. Its global catalog contains local sources only. |
| Canonical ID | `global_artist_uid`, `global_album_uid`, or `global_track_uid`; it is stable across local and federated sources. |
| Local write model | `library_*` and user-local mutation tables. It is never replaced by the global catalog. |
| Peer capability | A trust/grant decision for an already configured peer; it is not an instance mode. |
| Catalog readiness | Durable state proving that the initial canonical build and user-reference backfill completed successfully. |
| `crate-core` taxonomy | Product-owned, versioned and signed vocabulary whose global IDs, canonical names, and locked hierarchy have the same meaning on every node. |
| Genre assertion | Attributed evidence that one concrete local or federated catalog source belongs to one `crate-core` genre. It retains the raw label, mapping method, confidence, and source revision. |
| Genre membership | The aggregate, queryable projection of active assertions for one canonical catalog entity and one global genre. It is not an assertion that every source used that genre. |

The implementation must preserve all of these invariants:

1. No request can obtain a peer catalog, detail, asset, or stream without an
   approved peer and the existing grant/assertion checks.
2. A canonical local source wins over a remote source whenever both can serve a
   facet.
3. A local write endpoint never reads or writes a remote filesystem path.
4. A deleted local source is removed from global selection in the same
   projection cycle; it may remain as an audit/tombstone record only.
5. Canonical routes return either a complete ready catalog, a clear warming
   response, or a genuine not-found. They never silently fall back to an
   incomplete local-only response.
6. Legacy `/api/search?scope=local` remains local-compatible. It is a legacy
   query scope, not a deployment mode.
7. No runtime code branches on `CRATE_FEDERATION_ENABLED`,
   `CRATE_GLOBAL_CATALOG_ENABLED`, `global_catalog_listen_surfaces`, or
   `global_catalog_allow_remote_playlist_refs` after the migration completes.
8. A global genre identity is an immutable `global_genre_uid`; a slug is a
   display/route value and may be renamed or deprecated without changing the
   identity.
9. A taxonomy release is accepted only when its ID, version, and digest are
   recognized. A peer with an unknown release can still contribute raw labels,
   but cannot introduce a canonical genre, alias, or graph edge.
10. Parent/related hierarchy is evaluated at query time. A `hardcore-punk`
    assertion must not be persisted as a direct `punk` assertion merely because
    `punk` is an ancestor.
11. An assertion has at most one active contribution per source, entity, and
    genre. Stale, deleted, revoked, or remapped sources cannot keep a genre
    visible in the canonical catalog.

## Existing Plans And Supersession

This document supersedes only the *mode/feature-flag compatibility* parts of:

- `docs/plans/2026-07-10-federated-global-collection-implementation-plan.md`
- `docs/plans/2026-07-10-federated-read-facade-implementation-plan.md`

It preserves their matching rules, source facets, signing, trust/grants,
read-through cache, source resolver, and Listen transparency goals. Do not
edit those historical plans during implementation; update `README.md` and this
plan's checklist as the source of the new architecture decision.

## Delivery Order

| Phase | Outcome | Blocking acceptance condition |
| --- | --- | --- |
| 0 | Testable baseline and no-mode contracts | global policy can import; old mode tests are intentionally replaced |
| 1 | Durable catalog state and dirty-source schema | migrations create state/queue safely on existing databases |
| 2 | Identity always exists; local changes project incrementally | no self-peer; no catalog gates remain |
| 3 | Resumable bootstrap, backfill, and prune | a migrated node cannot serve a partial global catalog |
| 4 | FastAPI and Listen consume canonical read APIs | zero-peer Listen shows exactly local content through global IDs |
| 5 | Admin/deploy/protocol cleanup | peer trust controls sharing; removed flags are absent from runtime configs |
| 6 | Go readplane canonical routing and native reads | FastAPI/readplane parity for supported catalog routes |
| 7 | Global genre taxonomy and catalog membership | all nodes share `crate-core` semantics; source assertions project safely |
| 8 | Two-node E2E, performance, and release checks | singleton and peer flows both pass end-to-end |

---

## Phase 0 — Freeze The Contract And Repair Testability

### Task 0.1: Remove the policy import cycle before changing behavior

**Files:**

- Modify: `app/crate/federation/global_policy.py`
- Modify: `app/crate/db/queries/genres_library_detail.py`
- Test: `app/tests/test_global_catalog_policy.py`
- Test: `app/tests/test_federation_regressions.py`

**Step 1: Add a direct-import regression test.**

Add a test that imports the policy module in a clean interpreter/module state.
It must prove that import does not traverse the `crate.db` compatibility facade.

```python
def test_catalog_policy_import_is_leaf_module():
    module = importlib.import_module("crate.federation.global_policy")
    assert module is not None
```

**Step 2: Run the focused test and record the current failure.**

```bash
PYTHONPATH=app uv run pytest app/tests/test_global_catalog_policy.py -q
```

Expected before the fix: collection fails with a partially initialized
`crate.federation.global_policy` import. The trace must show the cycle through
`crate.db.__init__` and `genres_library_detail`.

**Step 3: Make configuration access lazy and temporary.**

Do not import `get_setting` at module import time. Move the concrete
`crate.db.cache_settings` import inside `_safe_get_setting()` while the module
still exists. This is deliberately a narrow testability repair; Phase 2
removes the mode policy altogether.

```python
def _safe_get_setting(key: str, default: str | None = None) -> str | None:
    try:
        from crate.db.cache_settings import get_setting

        return get_setting(key, default)
    except Exception as exc:
        log.debug("Unable to read setting %s: %s", key, exc)
        return default
```

**Step 4: Verify the import and current compatibility suite.**

```bash
PYTHONPATH=app uv run pytest \
  app/tests/test_global_catalog_policy.py \
  app/tests/test_global_catalog_compatibility.py \
  app/tests/test_federation_regressions.py -q
```

Expected: green. Do not change any catalog behavior in this task.

**Step 5: Commit the isolated repair.**

```bash
git add app/crate/federation/global_policy.py \
  app/tests/test_global_catalog_policy.py \
  app/tests/test_federation_regressions.py
git commit -m "fix: break global catalog policy import cycle"
```

### Task 0.2: Replace standalone compatibility tests with node-first contracts

**Files:**

- Create: `app/tests/test_node_first_catalog_contract.py`
- Modify: `app/tests/test_global_catalog_compatibility.py`
- Modify: `app/tests/test_global_catalog_policy.py`
- Modify: `docs/plans/2026-07-12-node-first-federated-catalog-implementation-plan.md`

**Step 1: Write failing behavior tests for the new architecture.**

Cover these cases with monkeypatched repositories/handlers, not an external
database:

```python
def test_zero_approved_peers_is_a_valid_one_node_catalog(): ...
def test_catalog_api_never_uses_a_feature_flag_to_choose_local_shape(): ...
def test_network_sync_with_zero_approved_peers_makes_no_http_requests(): ...
def test_local_scope_remains_an_explicit_legacy_query_scope(): ...
def test_global_track_reference_is_valid_without_a_remote_source(): ...
```

**Step 2: Run the new tests.**

```bash
PYTHONPATH=app uv run pytest app/tests/test_node_first_catalog_contract.py -q
```

Expected: red because policies and playlist resolution still use feature gates.

**Step 3: Delete assertions that encode the old product mode.**

Remove tests asserting that a disabled federation/global-catalog flag is the
normal isolated behavior. Keep tests for explicit `scope=local` compatibility,
trust enforcement, and zero-peer no-network behavior.

**Step 4: Run the contract files together.**

```bash
PYTHONPATH=app uv run pytest \
  app/tests/test_node_first_catalog_contract.py \
  app/tests/test_global_catalog_compatibility.py \
  app/tests/test_global_catalog_policy.py -q
```

Expected: still red until Phases 1–2; preserve the failures as the TDD target.

**Step 5: Commit the contract change.**

```bash
git add app/tests/test_node_first_catalog_contract.py \
  app/tests/test_global_catalog_compatibility.py \
  app/tests/test_global_catalog_policy.py \
  docs/plans/2026-07-12-node-first-federated-catalog-implementation-plan.md
git commit -m "test: define node-first catalog contracts"
```

---

## Phase 1 — Add Durable Readiness And Dirty-Source State

### Task 1.1: Create the catalog-state and dirty-source migration

**Files:**

- Create: `app/crate/db/migrations/versions/058_node_first_catalog_state.py`
- Test: `app/tests/test_global_catalog_schema.py`
- Test: `app/tests/test_node_first_catalog_migration.py`

**Step 1: Add failing schema assertions.**

Assert that migration 058 creates the following durable structures and indexes:

```text
global_catalog_state
  singleton boolean primary key check (singleton)
  status text check (status in ('cold', 'backfilling', 'ready', 'failed'))
  generation uuid not null
  bootstrap_cursor_json jsonb not null default '{}'
  user_refs_backfilled_at timestamptz
  last_full_reconcile_at timestamptz
  last_error text
  created_at / updated_at timestamptz

global_catalog_dirty_sources
  id bigserial primary key
  dedupe_key text not null unique
  entity_type text check (artist, album, track)
  source_kind text check (local, federated)
  local_entity_uid uuid nullable
  node_uid uuid nullable
  remote_entity_uid text nullable
  operation text check (upsert, delete)
  source_revision text nullable
  requested_at / claimed_at / completed_at timestamptz
  attempts integer not null default 0
  last_error text nullable
```

Assert the check constraint: a local row requires `local_entity_uid`; a
federated row requires `node_uid` and `remote_entity_uid`.

**Step 2: Run the migration test.**

```bash
PYTHONPATH=app uv run pytest \
  app/tests/test_global_catalog_schema.py \
  app/tests/test_node_first_catalog_migration.py -q
```

Expected: red because revision 058 does not exist.

**Step 3: Implement migration 058.**

Use `CREATE TABLE IF NOT EXISTS`, explicit check constraints, and indexes for
claiming outstanding work:

```sql
CREATE INDEX IF NOT EXISTS idx_global_catalog_dirty_sources_pending
ON global_catalog_dirty_sources (requested_at, id)
WHERE completed_at IS NULL;

INSERT INTO global_catalog_state (singleton, status, generation)
VALUES (true, 'cold', gen_random_uuid())
ON CONFLICT (singleton) DO NOTHING;
```

Do not modify migrations 050–057. The downgrade drops only new indexes/tables.

**Step 4: Verify upgrade and downgrade in the existing migration test harness.**

```bash
PYTHONPATH=app uv run pytest \
  app/tests/test_global_catalog_schema.py \
  app/tests/test_node_first_catalog_migration.py -q
```

Expected: green; rerunning upgrade is idempotent.

**Step 5: Commit.**

```bash
git add app/crate/db/migrations/versions/058_node_first_catalog_state.py \
  app/tests/test_global_catalog_schema.py \
  app/tests/test_node_first_catalog_migration.py
git commit -m "feat: add node-first catalog state"
```

### Task 1.2: Add repository helpers for readiness and dirty records

**Files:**

- Create: `app/crate/db/repositories/global_catalog_state.py`
- Create: `app/crate/db/repositories/global_catalog_dirty_sources.py`
- Test: `app/tests/test_global_catalog_state.py`
- Test: `app/tests/test_global_catalog_dirty_sources.py`

**Step 1: Write failing repository tests.**

The tests must exercise a real `pg_db` fixture and prove:

- `get_catalog_state()` creates/returns the singleton safely;
- only the legal state transitions are allowed;
- `enqueue_dirty_source()` coalesces repeated writes using `dedupe_key`;
- a new mutation after completion reopens the same row;
- `claim_dirty_sources()` uses `FOR UPDATE SKIP LOCKED` and does not claim a
  row already claimed by another worker;
- `complete_dirty_source()` and `fail_dirty_source()` preserve diagnostics.

**Step 2: Run the tests.**

```bash
PYTHONPATH=app uv run pytest \
  app/tests/test_global_catalog_state.py \
  app/tests/test_global_catalog_dirty_sources.py -q
```

Expected: red because the repositories do not exist.

**Step 3: Implement a narrow repository API.**

Expose only these functions; keep SQL in repository modules and pass an
existing `Session` when a caller needs atomic mutation + enqueue behavior.

```python
def get_catalog_state(*, session: Session | None = None) -> dict: ...
def transition_catalog_state(status: CatalogStatus, *, session: Session | None = None, **fields: object) -> dict: ...
def enqueue_local_dirty_source(entity_type: str, entity_uid: str, operation: str, *, session: Session) -> None: ...
def enqueue_federated_dirty_source(entity_type: str, node_uid: str, remote_entity_uid: str, operation: str, *, session: Session) -> None: ...
def claim_dirty_sources(limit: int, *, session: Session) -> list[dict]: ...
def complete_dirty_source(id: int, *, session: Session) -> None: ...
def fail_dirty_source(id: int, error: str, *, session: Session) -> None: ...
```

**Step 4: Re-run the focused tests.**

```bash
PYTHONPATH=app uv run pytest \
  app/tests/test_global_catalog_state.py \
  app/tests/test_global_catalog_dirty_sources.py -q
```

Expected: green.

**Step 5: Commit.**

```bash
git add app/crate/db/repositories/global_catalog_state.py \
  app/crate/db/repositories/global_catalog_dirty_sources.py \
  app/tests/test_global_catalog_state.py \
  app/tests/test_global_catalog_dirty_sources.py
git commit -m "feat: persist catalog readiness and dirty sources"
```

---

## Phase 2 — Remove Instance Modes And Project Local Changes

### Task 2.1: Make node identity unconditional without creating a self-peer

**Files:**

- Modify: `app/crate/federation/bootstrap.py`
- Modify: `app/crate/federation/policy.py`
- Modify: `app/crate/api/federation.py`
- Modify: `app/crate/api/federation_remote.py`
- Modify: `app/crate/api/admin_federation.py`
- Test: `app/tests/test_federation_phase1.py`
- Test: `app/tests/test_federation_regressions.py`
- Test: `app/tests/test_node_first_catalog_contract.py`

**Step 1: Write failing identity and privacy tests.**

Cover all of the following:

```python
def test_startup_bootstraps_one_local_node_without_env_flag(): ...
def test_bootstrap_is_idempotent_and_keeps_existing_key(): ...
def test_bootstrap_never_inserts_the_local_node_as_a_peer(): ...
def test_descriptor_is_available_for_the_local_identity(): ...
def test_unapproved_peer_cannot_read_manifest_or_request_stream(): ...
def test_zero_peer_sync_returns_zero_without_network_client_call(): ...
```

**Step 2: Run the tests.**

```bash
PYTHONPATH=app uv run pytest \
  app/tests/test_federation_phase1.py \
  app/tests/test_federation_regressions.py \
  app/tests/test_node_first_catalog_contract.py -q
```

Expected: red because `bootstrap_federation_identity()` and federation routes
call `is_federation_enabled()`/`require_federation_enabled()`.

**Step 3: Remove mode gates, retaining trust/grant gates.**

- Make `bootstrap_federation_identity()` always ensure the local identity after
  `init_db()`.
- Delete `FEDERATION_ENABLED`, `is_federation_enabled()`, and
  `require_federation_enabled()`; do not replace them with a new mode flag.
- Remove only the instance-mode calls from descriptor, signed federation, and
  local proxy routes.
- Keep existing request signing, peer lookup, approved trust state, grants,
  quotas, assertions, and stream-ticket checks unchanged.
- Make the Admin status describe `node_uid`, peer count, pending peers, and
  trust state—not `enabled: false`.

**Step 4: Verify all federation tests.**

```bash
PYTHONPATH=app uv run pytest app/tests/test_federation_*.py -q
```

Expected: green, including a node with no peers and rejected unapproved peer
requests.

**Step 5: Commit.**

```bash
git add app/crate/federation/bootstrap.py \
  app/crate/federation/policy.py \
  app/crate/api/federation.py \
  app/crate/api/federation_remote.py \
  app/crate/api/admin_federation.py \
  app/tests/test_federation_phase1.py \
  app/tests/test_federation_regressions.py \
  app/tests/test_node_first_catalog_contract.py
git commit -m "feat: make every crate instance a node"
```

### Task 2.2: Mark local upserts dirty in the same transaction

**Files:**

- Modify: `app/crate/db/repositories/library_artist_upserts.py`
- Modify: `app/crate/db/repositories/library_album_upserts.py`
- Modify: `app/crate/db/repositories/library_track_upserts.py`
- Modify: `app/crate/db/repositories/library_enrichment_writes.py`
- Modify: `app/crate/db/repositories/library_analysis_writes.py`
- Test: `app/tests/test_global_catalog_local_projection.py`

**Step 1: Write failing mutation-to-dirty-record tests.**

Use an existing session fixture and assert that an artist, album, or track
upsert creates exactly one pending `upsert` dirty row referring to its stable
entity UID. Repeat the same mutation before the worker runs and assert that
there is still one row, not two.

Also cover metadata changes that affect a catalog facet: artist photo,
album cover, track analysis/quality, MBIDs, and local display names.

**Step 2: Run the tests.**

```bash
PYTHONPATH=app uv run pytest app/tests/test_global_catalog_local_projection.py -q
```

Expected: red because local write repositories do not enqueue projection work.

**Step 3: Enqueue only canonical source changes.**

After the source entity UID is known, call the repository helper with the same
SQLAlchemy session:

```python
enqueue_local_dirty_source(
    entity_type="track",
    entity_uid=str(entity_uid),
    operation="upsert",
    session=s,
)
```

Do not enqueue for path-only or transient worker-state updates that are absent
from `global_sources.py`. Do enqueue whenever a field consumed by local source
extraction changes. Never call a worker/HTTP client directly from these
repositories.

**Step 4: Verify projection enqueue behavior.**

```bash
PYTHONPATH=app uv run pytest \
  app/tests/test_global_catalog_local_projection.py \
  app/tests/test_global_catalog_dirty_sources.py -q
```

Expected: green and no duplicate dirty work under repeated upserts.

**Step 5: Commit.**

```bash
git add app/crate/db/repositories/library_artist_upserts.py \
  app/crate/db/repositories/library_album_upserts.py \
  app/crate/db/repositories/library_track_upserts.py \
  app/crate/db/repositories/library_enrichment_writes.py \
  app/crate/db/repositories/library_analysis_writes.py \
  app/tests/test_global_catalog_local_projection.py
git commit -m "feat: project local catalog changes incrementally"
```

### Task 2.3: Tombstone deleted local sources before deleting the write model

**Files:**

- Modify: `app/crate/db/repositories/library_enrichment_writes.py`
- Modify: `app/crate/worker_handlers/management.py`
- Modify: `app/crate/library_sync.py`
- Modify: `app/crate/federation/global_reconciliation.py`
- Test: `app/tests/test_global_catalog_local_deletions.py`
- Test: `app/tests/test_admin_local_catalog_boundary.py`

**Step 1: Write failing deletion tests.**

Cover deletion through each supported boundary:

- a missing file in `LibrarySync`;
- a management album deletion;
- a management artist deletion cascading to albums/tracks;
- a direct repository track deletion.

For every case assert that the local entity UID is captured before deletion,
the matching `global_catalog_sources` row is tombstoned, the canonical row is
recomputed, and a remote alternative remains visible only when one actually
exists.

**Step 2: Run the focused tests.**

```bash
PYTHONPATH=app uv run pytest \
  app/tests/test_global_catalog_local_deletions.py \
  app/tests/test_admin_local_catalog_boundary.py -q
```

Expected: red because current local delete calls remove write rows without
projecting source deletion.

**Step 3: Capture identity before destructive SQL.**

Read the affected artist/album/track entity UIDs inside the same session,
enqueue `operation="delete"`, execute the local deletion, then let the
projection worker mark the matching local source as deleted and refresh
`has_local`, source count, preferred source, and canonical availability.

Never delete a canonical row while another local or federated source remains.
If its source count reaches zero, delete the canonical row and all associated
cache rows in one transaction.

**Step 4: Verify local and peer fallback behavior.**

```bash
PYTHONPATH=app uv run pytest \
  app/tests/test_global_catalog_local_deletions.py \
  app/tests/test_global_catalog_remote_reconciliation.py \
  app/tests/test_admin_local_catalog_boundary.py -q
```

Expected: green. The Admin boundary test must still prove that local write
operations never turn into a remote write.

**Step 5: Commit.**

```bash
git add app/crate/db/repositories/library_enrichment_writes.py \
  app/crate/worker_handlers/management.py \
  app/crate/library_sync.py \
  app/crate/federation/global_reconciliation.py \
  app/tests/test_global_catalog_local_deletions.py \
  app/tests/test_admin_local_catalog_boundary.py
git commit -m "fix: tombstone deleted local catalog sources"
```

### Task 2.4: Turn reconciliation into real incremental work

**Files:**

- Modify: `app/crate/federation/global_sources.py`
- Modify: `app/crate/federation/global_reconciliation.py`
- Modify: `app/crate/worker_handlers/global_catalog.py`
- Modify: `app/crate/task_registry.py`
- Modify: `app/crate/actors.py`
- Test: `app/tests/test_global_catalog_worker.py`
- Test: `app/tests/test_global_catalog_reconciliation.py`
- Test: `app/tests/test_global_catalog_local_projection.py`

**Step 1: Write failing bounded-work tests.**

Add tests that prove:

```python
def test_incremental_reconcile_claims_only_pending_dirty_sources(pg_db): ...
def test_incremental_reconcile_does_not_materialize_all_library_rows(pg_db): ...
def test_incremental_reconcile_retries_only_failed_dirty_rows(pg_db): ...
def test_full_reconcile_uses_keyset_cursor_and_is_resumable(pg_db): ...
```

Use more sources than one batch and assert the first execution updates only the
claimed batch. Patch the old `iter_local_sources` full iterator to raise in the
incremental test so accidental full scans cannot return.

**Step 2: Run the tests.**

```bash
PYTHONPATH=app uv run pytest \
  app/tests/test_global_catalog_worker.py \
  app/tests/test_global_catalog_reconciliation.py \
  app/tests/test_global_catalog_local_projection.py -q
```

Expected: red because both handlers call `list(iter_local_sources(...))` and
`list(iter_remote_sources(...))`.

**Step 3: Split incremental from verification reconciliation.**

Implement these explicit entry points:

```python
def reconcile_dirty_catalog_sources(*, limit: int) -> dict[str, int]: ...
def reconcile_full_catalog(*, batch_size: int, cursor: dict | None) -> dict: ...
def tombstone_local_source(entity_type: str, entity_uid: str, *, session: Session) -> None: ...
```

Rules:

- incremental reconciliation claims `global_catalog_dirty_sources` with
  `SKIP LOCKED` and never calls the complete local iterator;
- a federated manifest sync enqueues only received/tombstoned remote source
  keys, then schedules incremental reconciliation;
- full verification uses keyset pagination by stable primary key/entity UID,
  persists its cursor in `global_catalog_state.bootstrap_cursor_json`, and
  finishes only after a prune pass;
- all events are batch-level. Never emit an event per 48K local track.

**Step 4: Run the worker/reconciliation suites.**

```bash
PYTHONPATH=app uv run pytest \
  app/tests/test_global_catalog_worker.py \
  app/tests/test_global_catalog_reconciliation.py \
  app/tests/test_global_catalog_events.py \
  app/tests/test_global_catalog_scheduler.py -q
```

Expected: green; test output should report bounded source counts, not a full
source list for an incremental run.

**Step 5: Commit.**

```bash
git add app/crate/federation/global_sources.py \
  app/crate/federation/global_reconciliation.py \
  app/crate/worker_handlers/global_catalog.py \
  app/crate/task_registry.py \
  app/crate/actors.py \
  app/tests/test_global_catalog_worker.py \
  app/tests/test_global_catalog_reconciliation.py \
  app/tests/test_global_catalog_local_projection.py
git commit -m "feat: reconcile canonical catalog from dirty sources"
```

---

## Phase 3 — Bootstrap Existing Nodes And Backfill User References

### Task 3.1: Add a resumable catalog bootstrap task and readiness endpoint

**Files:**

- Modify: `app/crate/api/__init__.py`
- Modify: `app/crate/worker_handlers/global_catalog.py`
- Modify: `app/crate/task_registry.py`
- Modify: `app/crate/actors.py`
- Modify: `app/crate/api/admin_global_catalog.py`
- Create: `app/crate/api/schemas/catalog_state.py`
- Test: `app/tests/test_global_catalog_bootstrap.py`
- Test: `app/tests/test_admin_global_catalog.py`

**Step 1: Write failing bootstrap state-machine tests.**

Assert the precise lifecycle:

```text
cold -> backfilling -> ready
cold/backfilling -> failed
failed -> backfilling   (manual retry only)
ready -> backfilling    (explicit full rebuild only)
```

Also assert API lifespan creates a deduplicated
`global_catalog_bootstrap` task while state is `cold` **or** while
`user_refs_backfill_version` is missing/stale, and that it runs after
`init_db()` and identity bootstrap. A node that was marked `ready` by an older
projection must not skip a newly added user-reference migration.

**Step 2: Run the tests.**

```bash
PYTHONPATH=app uv run pytest \
  app/tests/test_global_catalog_bootstrap.py \
  app/tests/test_admin_global_catalog.py -q
```

Expected: red because no bootstrap task/state endpoint exists.

**Step 3: Implement bootstrap with an observable readiness contract.**

The bootstrap handler must:

1. transition `cold` to `backfilling` atomically;
2. run the resumable local full reconciliation until it completes;
3. run the user-reference backfill from Task 3.2;
4. enqueue a deduplicated incremental reconcile for any mutations received
   during bootstrap;
5. transition to `ready` only after both catalog and user data are complete,
   and persist the applied user-reference projection version plus an
   unresolved-reference report;
6. store a concise error and transition to `failed` on exception.

Expose an authenticated Admin status payload with `status`, generation,
cursor/progress counts, last error, and last full reconcile time. During
`cold`/`backfilling`, canonical API routes must return `503` with a stable
`catalog_warming` detail and `Retry-After`; never local-fallback.

**Step 4: Verify bootstrap behavior.**

```bash
PYTHONPATH=app uv run pytest \
  app/tests/test_global_catalog_bootstrap.py \
  app/tests/test_admin_global_catalog.py \
  app/tests/test_global_catalog_worker.py -q
```

Expected: green and idempotent under a simulated restart.

**Step 5: Commit.**

```bash
git add app/crate/api/__init__.py \
  app/crate/worker_handlers/global_catalog.py \
  app/crate/task_registry.py \
  app/crate/actors.py \
  app/crate/api/admin_global_catalog.py \
  app/crate/api/schemas/catalog_state.py \
  app/tests/test_global_catalog_bootstrap.py \
  app/tests/test_admin_global_catalog.py
git commit -m "feat: bootstrap mandatory catalog read model"
```

### Task 3.2: Backfill existing follows, saves, playlists, and play references

**Files:**

- Modify: `app/crate/db/repositories/global_user_library.py`
- Modify: `app/crate/db/repositories/global_catalog_state.py`
- Modify: `app/crate/db/repositories/playlists_tracks.py`
- Modify: `app/crate/db/repositories/playlists_duplicate.py`
- Modify: `app/crate/db/repositories/user_library_playback_writes.py`
- Modify: `app/crate/db/repositories/user_library_preferences.py`
- Modify: `app/crate/db/queries/user_library_library.py`
- Modify: `app/readplane/internal/catalog/store.go`
- Create: `app/crate/db/migrations/versions/061_user_ref_backfill_version.py`
- Test: `app/tests/test_global_catalog_user_refs.py`
- Test: `app/tests/test_global_catalog_playlists.py`
- Test: `app/tests/test_global_catalog_library_api.py`
- Test: `app/tests/test_user_ref_backfill_migration.py`

**Step 1: Write failing idempotent backfill tests.**

Seed local library rows plus legacy user data, then assert:

- `user_follows.artist_name` maps to its local artist's canonical global UID;
- `user_saved_albums.album_id` maps to the canonical global album UID;
- legacy `playlist_tracks` with a local track ID/entity UID gain
  `global_track_uid` while retaining local fields for compatibility;
- generated `playlist_track_exclusions` gain the same global identity so a
  regeneration cannot reintroduce an intentionally removed canonical track;
- `user_play_events` and `user_track_stats` resolve a global track UID from
  their local entity UID/track ID;
- listening aggregates are rebuilt from projected events, including the
  canonical `entity_key`, rather than patched in place;
- a second run changes zero rows;
- an existing `ready` node with an older checkpoint queues the backfill again;
- ambiguous/missing rows are counted and recorded, never guessed, deleted, or
  hidden from the user;
- FastAPI compatibility routes and the Go readplane return the same canonical
  rows plus unresolved legacy fallbacks, including remote-only follows/saves.

Keep `user_liked_tracks` local in this phase. Its existing local-track join is
the current product contract; do not create remote likes implicitly.

**Step 2: Run the new tests.**

```bash
PYTHONPATH=app uv run pytest \
  app/tests/test_global_catalog_user_refs.py \
  app/tests/test_global_catalog_playlists.py \
  app/tests/test_global_catalog_playback.py -q
```

Expected: red because migrations 055/057 only create columns/tables.

**Step 3: Implement the versioned backfill.**

Add migration 061 with a monotonically versioned
`global_catalog_state.user_refs_backfill_version`, a JSON unresolved report,
the missing exclusion `global_track_uid`, and indexes for local-to-global track
lookups. Use `INSERT ... ON CONFLICT DO NOTHING`/conditional updates. A full
reconcile must run local catalog projection before this job.

Return and persist structured counters:

```python
{
    "artist_follows": 0,
    "album_saves": 0,
    "playlist_tracks": 0,
    "playlist_track_exclusions": 0,
    "play_events": 0,
    "listening_stats_users": 0,
    "unresolved_artist_follows": 0,
    "unresolved_album_saves": 0,
    "unresolved_playlist_tracks": 0,
    "unresolved_playlist_track_exclusions": 0,
    "unresolved_play_events": 0,
}
```

Do not delete legacy references. New mutations should write canonical IDs when
available and retain local references only where the local write model needs
them. If no exact mapping exists, leave the local row intact and expose it as
the compatibility fallback; an operator may repair it later from the persisted
report. `user_liked_tracks` remains deliberately local in v1 because remote
likes are out of scope.

**Step 4: Verify data preservation and rerun safety.**

```bash
PYTHONPATH=app uv run pytest \
  app/tests/test_global_catalog_user_refs.py \
  app/tests/test_global_catalog_playlists.py \
  app/tests/test_global_catalog_library_api.py \
  app/tests/test_node_first_catalog_contract.py \
  app/tests/test_user_ref_backfill_migration.py -q
```

Expected: green. Verify the second bootstrap/backfill invocation reports zero
additional migrated rows, while an old checkpoint schedules exactly one retry.
Verify the Go readplane count/list/follow-state contract as well; a canonical
count with a legacy-only list is a release blocker.

**Step 5: Commit.**

```bash
git add app/crate/db/repositories/global_user_library.py \
  app/crate/db/repositories/global_catalog_state.py \
  app/crate/db/repositories/playlists_tracks.py \
  app/crate/db/repositories/playlists_duplicate.py \
  app/crate/db/repositories/user_library_playback_writes.py \
  app/crate/db/repositories/user_library_preferences.py \
  app/crate/db/queries/user_library_library.py \
  app/crate/db/migrations/versions/061_user_ref_backfill_version.py \
  app/readplane/internal/catalog/store.go \
  app/tests/test_global_catalog_user_refs.py \
  app/tests/test_global_catalog_playlists.py \
  app/tests/test_global_catalog_library_api.py \
  app/tests/test_user_ref_backfill_migration.py
git commit -m "fix: backfill canonical user references"
```

### Task 3.3: Separate canonical track references from remote-source permission

**Files:**

- Modify: `app/crate/api/playlists.py`
- Modify: `app/crate/db/repositories/playlists_tracks.py`
- Modify: `app/crate/federation/global_source_resolver.py`
- Modify: `app/crate/federation/cross_instance.py`
- Test: `app/tests/test_global_catalog_playlists.py`
- Test: `app/tests/test_federation_p1p2.py`

**Step 1: Write failing playlist contract tests.**

Assert that a local canonical global track may be added to a playlist on a
one-node installation without a remote feature flag. Assert separately that a
remote-only canonical track is accepted only when its selected source passes
the existing grant/trust checks at playback time.

**Step 2: Run the focused tests.**

```bash
PYTHONPATH=app uv run pytest \
  app/tests/test_global_catalog_playlists.py \
  app/tests/test_federation_p1p2.py -q
```

Expected: red because `global_catalog_remote_playlist_refs_allowed()` rejects
all global IDs when the old catalog flag is off.

**Step 3: Remove the reference gate.**

- Resolve `global_track_uid` against `global_catalog_tracks` unconditionally.
- Keep `deny_remote_for_local_action()` for actual local-only write actions.
- Let playback/source resolution decide whether a remote stream is allowed;
  never infer it from presence of a global ID.
- Preserve playlist title/artist/album snapshots as today.

**Step 4: Verify local and remote playlist behavior.**

```bash
PYTHONPATH=app uv run pytest \
  app/tests/test_global_catalog_playlists.py \
  app/tests/test_global_catalog_playback.py \
  app/tests/test_federation_p1p2.py -q
```

Expected: green.

**Step 5: Commit.**

```bash
git add app/crate/api/playlists.py \
  app/crate/db/repositories/playlists_tracks.py \
  app/crate/federation/global_source_resolver.py \
  app/crate/federation/cross_instance.py \
  app/tests/test_global_catalog_playlists.py \
  app/tests/test_federation_p1p2.py
git commit -m "fix: treat global track ids as canonical references"
```

---

## Phase 4 — Make FastAPI And Listen Canonical By Default

### Task 4.1: Remove catalog feature gates and local fallbacks from `/api/catalog/*`

**Files:**

- Modify: `app/crate/api/catalog.py`
- Modify: `app/crate/federation/global_policy.py` (delete after imports are removed)
- Modify: `app/crate/api/browse_media.py`
- Modify: `app/crate/api/browse_artist.py`
- Modify: `app/crate/api/me.py`
- Modify: `app/crate/radio_engine.py`
- Test: `app/tests/test_global_catalog_api.py`
- Test: `app/tests/test_global_catalog_search.py`
- Test: `app/tests/test_node_first_catalog_contract.py`

**Step 1: Write failing canonical-route tests.**

Assert that, after readiness is `ready`:

```python
def test_catalog_search_uses_global_query_with_zero_peers(monkeypatch): ...
def test_catalog_artist_page_never_delegates_to_legacy_local_route(monkeypatch): ...
def test_catalog_me_routes_return_backfilled_global_references(monkeypatch): ...
def test_catalog_warming_returns_503_instead_of_local_fallback(monkeypatch): ...
```

Patch legacy handlers such as `api_search()` to raise; canonical endpoints
must still succeed from `global_catalog_*`.

**Step 2: Run the API tests.**

```bash
PYTHONPATH=app uv run pytest \
  app/tests/test_global_catalog_api.py \
  app/tests/test_global_catalog_search.py \
  app/tests/test_node_first_catalog_contract.py -q
```

Expected: red because `/api/catalog/*` delegates to legacy endpoints when
`global_catalog_surface_enabled()` is false.

**Step 3: Make canonical APIs unconditional after readiness.**

- Delete `global_catalog_surface_enabled()` and
  `is_global_catalog_enabled()` imports/calls from runtime code.
- Make `/api/catalog/*` query canonical tables and the existing source facade
  only.
- Preserve legacy `/api/search?scope=local`; leave its default contract local
  for Admin/compatibility callers.
- For legacy `scope=auto`/`scope=federated`, either keep the existing explicit
  semantics or return a deprecation-compatible global shape; do not make them
  drive node mode.
- Replace cache keys that encode `local|global` rollout state with catalog
  generation/readiness revision.

**Step 4: Verify FastAPI behavior.**

```bash
PYTHONPATH=app uv run pytest \
  app/tests/test_global_catalog_api.py \
  app/tests/test_global_catalog_search.py \
  app/tests/test_global_catalog_artist_page.py \
  app/tests/test_global_catalog_album_detail.py \
  app/tests/test_global_catalog_playback.py -q
```

Expected: green for zero peers, local-only data, and remote-only canonical
entities.

**Step 5: Commit.**

```bash
git add app/crate/api/catalog.py \
  app/crate/api/browse_media.py \
  app/crate/api/browse_artist.py \
  app/crate/api/me.py \
  app/crate/radio_engine.py \
  app/crate/federation/global_policy.py \
  app/tests/test_global_catalog_api.py \
  app/tests/test_global_catalog_search.py \
  app/tests/test_node_first_catalog_contract.py
git commit -m "feat: make catalog facade mandatory"
```

### Task 4.2: Move global home, explore, stats, and radio reads off surface gates

**Files:**

- Modify: `app/crate/db/home.py`
- Modify: `app/crate/db/home_context.py`
- Modify: `app/crate/db/home_builder_curated_lists.py`
- Modify: `app/crate/db/home_builder_global_recommendations.py`
- Modify: `app/crate/db/home_builder_upcoming_artists.py`
- Modify: `app/crate/db/home_personalized_collections.py`
- Modify: `app/crate/db/queries/browse_artist_filters.py`
- Modify: `app/crate/db/queries/browse_media_mood.py`
- Modify: `app/crate/db/queries/genres_library_detail.py`
- Modify: `app/crate/db/queries/radio_stations.py`
- Modify: `app/crate/db/queries/user_library_history.py`
- Modify: `app/crate/db/queries/user_library_stats_month.py`
- Modify: `app/crate/db/queries/user_library_stats_overview.py`
- Modify: `app/crate/db/queries/user_library_stats_tops.py`
- Modify: `app/crate/projector.py`
- Test: `app/tests/test_global_catalog_home.py`
- Test: `app/tests/test_global_catalog_explore.py`
- Test: `app/tests/test_global_catalog_radio.py`
- Test: `app/tests/test_stats_api_contracts.py`

**Step 1: Write failing singleton parity tests.**

Seed only local sources, mark catalog ready, and assert Home, Explore, genre,
radio, history, and stats return the same visible entities as the old local
flow but carry canonical IDs/routes. Add one remote source in a separate test
to prove the same calls can include it without UI vocabulary changes.

**Step 2: Run the focused tests.**

```bash
PYTHONPATH=app uv run pytest \
  app/tests/test_global_catalog_home.py \
  app/tests/test_global_catalog_explore.py \
  app/tests/test_global_catalog_radio.py \
  app/tests/test_stats_api_contracts.py -q
```

Expected: red where helpers still branch on `global_catalog_surface_enabled()`.

**Step 3: Replace gates with readiness-aware canonical queries.**

Use the same global query in a one-node and multi-node installation. The only
remaining conditional is readiness/fallback safety, not an operator setting.
Retain local IDs in output where legacy actions require them, but include the
canonical ID whenever a global entity exists.

**Step 4: Re-run the phase tests and snapshot/projector tests.**

```bash
PYTHONPATH=app uv run pytest \
  app/tests/test_global_catalog_home.py \
  app/tests/test_global_catalog_explore.py \
  app/tests/test_global_catalog_radio.py \
  app/tests/test_global_catalog_projector.py \
  app/tests/test_stats_api_contracts.py -q
```

Expected: green.

**Step 5: Commit.**

```bash
git add app/crate/db/home.py app/crate/db/home_context.py \
  app/crate/db/home_builder_curated_lists.py \
  app/crate/db/home_builder_global_recommendations.py \
  app/crate/db/home_builder_upcoming_artists.py \
  app/crate/db/home_personalized_collections.py \
  app/crate/db/queries/browse_artist_filters.py \
  app/crate/db/queries/browse_media_mood.py \
  app/crate/db/queries/genres_library_detail.py \
  app/crate/db/queries/radio_stations.py \
  app/crate/db/queries/user_library_history.py \
  app/crate/db/queries/user_library_stats_month.py \
  app/crate/db/queries/user_library_stats_overview.py \
  app/crate/db/queries/user_library_stats_tops.py \
  app/crate/projector.py app/tests/test_global_catalog_home.py \
  app/tests/test_global_catalog_explore.py \
  app/tests/test_global_catalog_radio.py \
  app/tests/test_stats_api_contracts.py
git commit -m "feat: use canonical catalog across listen reads"
```

### Task 4.3: Remove residual Listen local/remote branching

**Files:**

- Modify: `app/listen/src/lib/library-routes.ts`
- Modify: `app/shared/web/library-routes.ts`
- Modify: `app/listen/src/pages/SearchResults.tsx`
- Modify: `app/listen/src/pages/Artist.tsx`
- Modify: `app/listen/src/pages/Album.tsx`
- Modify: `app/listen/src/components/cards/ArtistCard.tsx`
- Modify: `app/listen/src/components/cards/AlbumCard.tsx`
- Modify: `app/listen/src/components/cards/TrackRow.tsx`
- Modify: `app/listen/src/lib/remote-track-playback.ts`
- Modify: `app/listen/src/contexts/player-types.ts`
- Test: `app/listen/src/lib/library-routes.test.ts`
- Test: `app/listen/src/pages/SearchResults.test.tsx`
- Test: `app/listen/src/pages/Album.test.tsx`
- Test: `app/listen/src/pages/Artist.test.tsx`
- Test: `app/listen/src/components/cards/TrackRow.test.tsx`

**Step 1: Write failing UI contract tests.**

Assert that local-only fixture content routes through `/catalog/...` pages and
`/api/catalog/...` asset/playback routes whenever global IDs are supplied.
Assert cards never render `Remote`, a node name, or a special remote route.
The player may retain source metadata internally, but it must request playback
through the canonical catalog endpoint.

**Step 2: Run the focused UI tests.**

```bash
npm run --workspace=app/listen test -- \
  library-routes SearchResults Album Artist TrackRow
```

Expected: red where temporary remote helpers or local-only route preference
remain.

**Step 3: Normalize client-facing references.**

- Prefer `global*Uid` in all routing/action payloads when present.
- Send `POST /api/catalog/tracks/{global_track_uid}/playback` rather than the
  direct `federation/remote` playback path from UI code.
- Keep remote source fields private to backend response handling/player state;
  do not display them.
- Keep numeric/local ID fallback only for legacy pages that have not yet
  received a canonical ID from old API payloads.

**Step 4: Verify type safety and focused behavior.**

```bash
npm run --workspace=app/listen test -- \
  library-routes SearchResults Album Artist TrackRow
npm run --workspace=app/listen typecheck
npm run --workspace=app/listen lint
```

Expected: all green.

**Step 5: Commit.**

```bash
git add app/listen/src/lib/library-routes.ts \
  app/shared/web/library-routes.ts \
  app/listen/src/pages/SearchResults.tsx \
  app/listen/src/pages/Artist.tsx app/listen/src/pages/Album.tsx \
  app/listen/src/components/cards/ArtistCard.tsx \
  app/listen/src/components/cards/AlbumCard.tsx \
  app/listen/src/components/cards/TrackRow.tsx \
  app/listen/src/lib/remote-track-playback.ts \
  app/listen/src/contexts/player-types.ts \
  app/listen/src/lib/library-routes.test.ts \
  app/listen/src/pages/SearchResults.test.tsx \
  app/listen/src/pages/Album.test.tsx \
  app/listen/src/pages/Artist.test.tsx \
  app/listen/src/components/cards/TrackRow.test.tsx
git commit -m "refactor: route listen through canonical catalog"
```

---

## Phase 5 — Remove Deployment Modes And Preserve Operational Privacy

### Task 5.1: Remove flags from scheduler, workers, compose, and Admin

**Files:**

- Modify: `app/crate/scheduler.py`
- Modify: `app/crate/worker_handlers/federation.py`
- Modify: `app/crate/worker_handlers/global_catalog.py`
- Modify: `app/ui/src/pages/Federation.tsx`
- Modify: `docker-compose.federation-dev.yaml`
- Modify: `docker-compose.yaml`
- Modify: `docker-compose.dev.yaml`
- Modify: `Makefile`
- Modify: `README.md`
- Test: `app/tests/test_global_catalog_scheduler.py`
- Test: `app/tests/test_federation_completion_gaps.py`
- Test: `app/ui/src/pages/GlobalCatalog.test.tsx`

**Step 1: Write failing no-mode tests.**

Assert that:

- global bootstrap/incremental/full tasks are schedulable without environment
  feature flags;
- health/catalog sync with no approved peers completes as a no-op;
- `docker-compose.federation-dev.yaml` contains no catalog/federation enable
  flags;
- Admin says "No approved peers" rather than "Federation disabled".

**Step 2: Run the tests.**

```bash
PYTHONPATH=app uv run pytest \
  app/tests/test_global_catalog_scheduler.py \
  app/tests/test_federation_completion_gaps.py -q
npm run --workspace=app/ui test -- GlobalCatalog
```

Expected: red because scheduler/worker paths return `*_disabled` and the Admin
page renders the legacy banner.

**Step 3: Remove only mode conditionals.**

- Schedule catalog bootstrap/incremental/full based on readiness and pending
  work, not environment flags.
- Leave federation health/sync tasks peer-driven: zero approved rows means a
  successful no-op.
- Remove all four old catalog/federation mode variables from Compose files and
  docs.
- Keep runtime config for legitimate limits (timeouts, page budgets, cache
  TTLs, grants) because those are operational tuning, not instance modes.
- Update Admin copy and status cards to display readiness, local source counts,
  peer counts, stale peers, and pending pairing requests.

**Step 4: Verify Python/UI behavior and configuration syntax.**

```bash
PYTHONPATH=app uv run pytest \
  app/tests/test_global_catalog_scheduler.py \
  app/tests/test_federation_completion_gaps.py \
  app/tests/test_admin_federation.py \
  app/tests/test_admin_global_catalog.py -q
npm run --workspace=app/ui test -- GlobalCatalog
docker compose -f docker-compose.federation-dev.yaml config >/dev/null
docker compose -f docker-compose.dev.yaml -f docker-compose.readplane.dev.yaml config >/dev/null
```

Expected: green and valid Compose output.

**Step 5: Commit.**

```bash
git add app/crate/scheduler.py \
  app/crate/worker_handlers/federation.py \
  app/crate/worker_handlers/global_catalog.py \
  app/ui/src/pages/Federation.tsx docker-compose.federation-dev.yaml \
  docker-compose.yaml docker-compose.dev.yaml Makefile README.md \
  app/tests/test_global_catalog_scheduler.py \
  app/tests/test_federation_completion_gaps.py \
  app/ui/src/pages/GlobalCatalog.test.tsx
git commit -m "refactor: remove standalone federation mode"
```

### Task 5.2: Audit all mode-policy call sites and delete obsolete policy code

**Files:**

- Delete: `app/crate/federation/global_policy.py`
- Modify: every runtime module returned by:

  ```bash
  rg -l 'global_catalog_surface_enabled|is_global_catalog_enabled|global_catalog_remote_playlist_refs_allowed|is_federation_enabled|require_federation_enabled' app/crate
  ```

- Test: `app/tests/test_no_federation_mode_flags.py`

**Step 1: Add a static regression test.**

The test must scan `app/crate`, production compose files, and the Makefile for
the prohibited symbols/environment names. It must permit historical plans and
migration comments only when explicitly excluded by path.

```python
PROHIBITED = {
    "CRATE_FEDERATION_ENABLED",
    "CRATE_GLOBAL_CATALOG_ENABLED",
    "CRATE_GLOBAL_CATALOG_LISTEN_SURFACES",
    "CRATE_GLOBAL_CATALOG_ALLOW_REMOTE_PLAYLIST_REFS",
}
```

**Step 2: Run the audit test.**

```bash
PYTHONPATH=app uv run pytest app/tests/test_no_federation_mode_flags.py -q
```

Expected: red with the remaining runtime paths listed in failure output.

**Step 3: Remove residual imports and delete the policy module.**

Use direct readiness/catalog repository calls where a module previously needed
a surface gate. Do not solve the audit by returning `True` from a replacement
flag helper. Delete the module once no production import remains.

**Step 4: Verify the audit and broad catalog suite.**

```bash
PYTHONPATH=app uv run pytest \
  app/tests/test_no_federation_mode_flags.py \
  app/tests/test_federation_*.py \
  app/tests/test_global_catalog_*.py -q
```

Expected: green.

**Step 5: Commit.**

```bash
git add -u app/crate app/tests docker-compose.yaml docker-compose.dev.yaml \
  docker-compose.federation-dev.yaml Makefile
git add app/tests/test_no_federation_mode_flags.py
git commit -m "refactor: delete federation mode policies"
```

---

## Phase 6 — Adapt The Go Readplane To Canonical Catalog APIs

The readplane work is mandatory in this plan. It must not bypass canonical
semantics by continuing to answer `/api/search` from `library_*` when Listen is
using `/api/catalog/*`.

This phase deliberately establishes canonical catalog routing before native
global-genre reads exist. Keep `/api/catalog/*/genre`, genre browsing, and
taxonomy-dependent radio decisions on FastAPI fallback until Phase 7 publishes
an atomically compatible taxonomy/membership snapshot. Do not make Go's current
static top-level map in `internal/catalog/taxonomy.go` another authoritative
taxonomy.

### Task 6.1: Add global schema readiness and explicit `/api/catalog/` routing

**Files:**

- Modify: `app/readplane/internal/postgres/schema.go` (or the module defining `RequiredTablesReady`)
- Modify: `app/readplane/internal/routes/server.go`
- Create: `app/readplane/internal/routes/global_catalog.go`
- Test: `app/readplane/internal/routes/global_catalog_test.go`
- Test: `app/readplane/internal/routes/server_test.go`

**Step 1: Write failing route/readiness tests.**

Assert that:

- readplane readiness requires `global_catalog_state`, the three canonical
  catalog tables, and `global_catalog_sources`;
- `GET /api/catalog/search` is registered rather than falling through to a
  `ServeMux` 404;
- `GET /api/catalog/...` requests are authenticated before a native query or
  FastAPI fallback;
- write methods (`POST`/`DELETE` under `/api/catalog/me/...`) always use the
  normal FastAPI fallback;
- if catalog readiness is not `ready`, readplane forwards to FastAPI so both
  planes return the same `catalog_warming` response.

**Step 2: Run Go tests.**

```bash
make readplane-test
```

Expected: red because `Server.Handler()` has no `/api/catalog/` route and the
schema check knows only legacy tables.

**Step 3: Add an explicit dispatcher, not a broad anonymous proxy.**

Register the prefix and route it by method/path:

```go
mux.HandleFunc("/api/catalog/", s.routeCatalog)
```

`routeCatalog` must:

1. authenticate the request using the same catalog auth helpers;
2. check `global_catalog_state.status`;
3. serve only explicitly native, parity-tested GET endpoints;
4. call `s.fallback.ServeHTTP` for writes, assets, streams, and unimplemented
   reads;
5. mark every response with `X-Crate-Readplane: hit` or `fallback`.

Never return a local-library response for a canonical path.

**Step 4: Run Go tests and vet.**

```bash
make readplane-test
make readplane-vet
```

Expected: green.

**Step 5: Commit.**

```bash
git add app/readplane/internal/postgres \
  app/readplane/internal/routes/server.go \
  app/readplane/internal/routes/global_catalog.go \
  app/readplane/internal/routes/global_catalog_test.go \
  app/readplane/internal/routes/server_test.go
git commit -m "feat: route canonical catalog through readplane"
```

### Task 6.2: Implement native Go global search and user-library reads

**Files:**

- Create: `app/readplane/internal/catalog/global_store.go`
- Create: `app/readplane/internal/catalog/global_store_test.go`
- Modify: `app/readplane/internal/catalog/store.go`
- Modify: `app/readplane/internal/routes/global_catalog.go`
- Modify: `app/readplane/internal/routes/global_catalog_test.go`
- Modify: `app/readplane/cmd/readplane-contract-smoke/main.go`

**Step 1: Write SQL shape-parity tests.**

Use pgx/fixture tests to assert these native store methods return the exact
JSON field names expected by FastAPI for a one-node catalog:

```go
func (s *Store) GlobalSearch(ctx context.Context, query string, limit int) (map[string]any, error)
func (s *Store) GlobalUserLibraryCounts(ctx context.Context, userID int64) (map[string]any, error)
func (s *Store) GlobalFollowedArtists(ctx context.Context, userID int64) ([]map[string]any, error)
func (s *Store) GlobalSavedAlbums(ctx context.Context, userID int64) ([]map[string]any, error)
func (s *Store) IsGlobalArtistFollowed(ctx context.Context, userID int64, uid string) (map[string]any, error)
func (s *Store) IsGlobalAlbumSaved(ctx context.Context, userID int64, uid string) (map[string]any, error)
```

The test data must include one local source and one remote-only source. Assert
that IDs use `global_*_uid`, local fields are nullable, and no raw node name or
filesystem path leaks into returned JSON.

**Step 2: Run Go tests.**

```bash
make readplane-test
```

Expected: red because the store queries `library_*`, `user_follows`, and
`user_saved_albums` directly.

**Step 3: Implement bounded canonical queries.**

- Use the same `queryTimeout`, `clamp`, and `rowsToMaps` patterns as current
  store methods.
- Query `global_catalog_artists`, `global_catalog_albums`,
  `global_catalog_tracks`, `user_global_artist_follows`, and
  `user_global_album_saves`.
- Preserve FastAPI ordering and empty-result shape exactly.
- Do not implement remote facet fetching in Go. Search/list/state routes use
  canonical materialized data only; asset/detail/playback requests fall back.

**Step 4: Add contract-smoke coverage.**

In `readplane-contract-smoke`, add a `mustCheckCanonicalCatalog` routine:

1. compare `/api/catalog/search?q=<query>&limit=5`;
2. select first artist/album global UID from that result;
3. compare `/api/catalog/me/artists`, `/api/catalog/me/albums`, and applicable
   follow/save-state reads;
4. assert `X-Crate-Readplane: hit` for native routes;
5. skip detail checks only when the canonical search result is empty.

**Step 5: Verify and commit.**

```bash
make readplane-test
make readplane-vet
git add app/readplane/internal/catalog/global_store.go \
  app/readplane/internal/catalog/global_store_test.go \
  app/readplane/internal/catalog/store.go \
  app/readplane/internal/routes/global_catalog.go \
  app/readplane/internal/routes/global_catalog_test.go \
  app/readplane/cmd/readplane-contract-smoke/main.go
git commit -m "feat: serve canonical catalog reads from readplane"
```

### Task 6.3: Add native canonical detail reads only where parity is stable

**Files:**

- Modify: `app/readplane/internal/catalog/global_store.go`
- Modify: `app/readplane/internal/catalog/global_store_test.go`
- Modify: `app/readplane/internal/routes/global_catalog.go`
- Modify: `app/readplane/internal/routes/global_catalog_test.go`
- Modify: `app/readplane/cmd/readplane-contract-smoke/main.go`

**Step 1: Write the detail parity matrix before native implementation.**

Add a table-driven route test with these rules:

| Route | Native eligibility | Fallback rule |
| --- | --- | --- |
| `/api/catalog/artists/{uid}/page` | only local preferred source and no remote facet hydration needed | any remote/cached rich facet requirement |
| `/api/catalog/albums/{uid}` | only local preferred source and full local row available | remote-only or facet hydration |
| `/api/catalog/tracks/{uid}/info` | only canonical/local data fields | remote info/analysis facet |
| photos, backgrounds, covers | never in this task | always FastAPI |
| playback, stream, EQ, genre | never in this task | always FastAPI |

**Step 2: Run the tests.**

```bash
make readplane-test
```

Expected: red for explicitly native local detail paths.

**Step 3: Implement native details conservatively.**

Use direct canonical/local joins only after the resolver eligibility query says
the preferred source is local. For all other cases call FastAPI fallback. Do
not duplicate signed remote client, content-cache, binary image, or stream
ticket logic in Go.

**Step 4: Extend contract smoke and run it against a live stack.**

```bash
make readplane-test
make readplane-vet
make federation-dev-up
make federation-dev-global-catalog-e2e
READPLANE_CONTRACT_CHECK_P1=true make readplane-contract-smoke
```

Expected: JSON parity, `hit` on eligible local detail reads, and `fallback` on
remote/assets/playback paths.

**Step 5: Commit.**

```bash
git add app/readplane/internal/catalog/global_store.go \
  app/readplane/internal/catalog/global_store_test.go \
  app/readplane/internal/routes/global_catalog.go \
  app/readplane/internal/routes/global_catalog_test.go \
  app/readplane/cmd/readplane-contract-smoke/main.go
git commit -m "feat: accelerate local canonical detail reads"
```

### Task 6.4: Route production/dev traffic safely and document readplane coverage

**Files:**

- Modify: `docker-compose.readplane.dev.yaml`
- Modify: `data/caddy/Caddyfile.readplane.dev`
- Modify: `docker-compose.yaml`
- Modify: `Makefile`
- Modify: `README.md`
- Test: `app/readplane/internal/routes/global_catalog_test.go`

**Step 1: Add a configuration-level contract test/check.**

Document and test that shadow mode can compare `/api/catalog/*` without making
it externally active, and that active routing sends only the explicit catalog
prefix to readplane with FastAPI fallback enabled.

**Step 2: Validate current Compose/Caddy configuration.**

```bash
docker compose -f docker-compose.dev.yaml -f docker-compose.readplane.dev.yaml config >/dev/null
docker compose -f docker-compose.yaml config >/dev/null
```

Expected before the change: valid configuration but canonical catalog paths are
not explicitly covered by readplane routing documentation.

**Step 3: Add a staged route-mode rollout.**

1. Keep `READPLANE_ROUTE_MODE=shadow` for initial validation.
2. Add catalog routes to contract smoke in shadow mode.
3. Enable only `/api/catalog/*` in the readplane proxy after parity is green.
4. Keep `READPLANE_FALLBACK_ENABLED=true` until at least one production release
   has no catalog parity mismatches.
5. Do not route legacy `/api/search` to canonical Go queries in this change;
   it remains its local compatibility route.

**Step 4: Verify config and smoke commands.**

```bash
docker compose -f docker-compose.dev.yaml -f docker-compose.readplane.dev.yaml config >/dev/null
make readplane-test
make readplane-vet
READPLANE_CONTRACT_CHECK_P1=true make readplane-contract-smoke
```

Expected: green.

**Step 5: Commit.**

```bash
git add docker-compose.readplane.dev.yaml data/caddy/Caddyfile.readplane.dev \
  docker-compose.yaml Makefile README.md \
  app/readplane/internal/routes/global_catalog_test.go
git commit -m "docs: document canonical readplane rollout"
```

---

## Phase 7 — Add Global Genre Taxonomy And Catalog Membership

`crate-core` is a shared vocabulary, not a distributed mutable graph. It is
installed locally with Crate, works with zero peers, and has a stable identity
independent from a genre slug. A peer contributes evidence that a source belongs
to a genre; it cannot publish a new canonical node, redirect an alias, or alter
an edge. This phase replaces the current best-effort aggregation of raw
`source_payload_json.genres` with durable, attributable canonical memberships.

### Task 7.1: Version and freeze the `crate-core` taxonomy contract

**Files:**

- Create: `app/crate/db/migrations/versions/059_core_genre_taxonomy.py`
- Modify: `app/crate/db/schema_sections/library_genres.py`
- Modify: `app/crate/genre_taxonomy.py`
- Modify: `app/crate/db/jobs/genre_taxonomy.py`
- Modify: `app/crate/api/genres.py`
- Test: `app/tests/test_genre_taxonomy_global_contract.py`
- Test: `app/tests/test_genre_taxonomy.py`

**Step 1: Write failing global-taxonomy contract tests.**

Cover the following before adding the migration:

```python
def test_core_taxonomy_descriptor_is_stable_for_same_release() -> None:
    descriptor = get_core_taxonomy_descriptor()
    assert descriptor["taxonomy_id"] == "crate-core"
    assert descriptor["version"]
    assert descriptor["digest"].startswith("sha256:")


def test_core_genre_uid_survives_slug_rename() -> None:
    original = core_genre_uid("hardcore-punk")
    assert original == stored_global_genre_uid("hardcore-punk")
    rename_core_genre_for_test("hardcore-punk", "hardcore")
    assert stored_global_genre_uid("hardcore") == original
```

Also assert that a local alias/overlay change does not change the advertised
`crate-core` digest, that seeded core edges are locked, and that Admin accepts a
local mapping proposal without treating it as a core taxonomy release change.

**Step 2: Run the focused tests to prove the contract is missing.**

```bash
PYTHONPATH=app uv run pytest \
  app/tests/test_genre_taxonomy_global_contract.py \
  app/tests/test_genre_taxonomy.py -q
```

Expected: red because no core descriptor, immutable global genre UID, or release
metadata exists.

**Step 3: Add immutable core identity and release metadata.**

The migration must:

1. create `genre_taxonomy_releases` with `taxonomy_id`, `version`, `digest`,
   `signature`, `published_at`, and exactly one active `crate-core` release;
2. add nullable-then-backfilled `global_genre_uid`, `taxonomy_id`, and `origin`
   (`core` or `overlay`) to `genre_taxonomy_nodes`, then enforce uniqueness for
   `(taxonomy_id, global_genre_uid)`;
3. derive every seeded core UID deterministically with a fixed UUIDv5 namespace
   and its original core key, not the mutable display slug;
4. mark seeded core hierarchy edges `locked = true`; and
5. preserve existing node `entity_uid`, custom nodes, aliases, covers, and
   descriptions. No migration may delete or overwrite local curation.

Expose `get_core_taxonomy_descriptor()` from `genre_taxonomy.py`. Its SHA-256
digest must be built from a canonically sorted serialization of the active core
nodes, canonical aliases, and locked edges. It must exclude node-local aliases,
overlays, covers, descriptions, and EQ tuning so a private admin edit cannot
silently fork the network vocabulary.

Treat a renamed/deprecated core slug as an immutable UID with a replacement
route; never regenerate IDs from a new display slug. Keep current local aliases
as local mappings. Update curator writes so a core node/edge cannot be mutated
in place; the supported route is an overlay/proposal or a future signed core
release.

**Step 4: Verify migration and lock behavior.**

```bash
PYTHONPATH=app uv run pytest \
  app/tests/test_genre_taxonomy_global_contract.py \
  app/tests/test_genre_taxonomy.py -q
PYTHONPATH=app uv run alembic upgrade head
```

Expected: green; an existing database retains every local taxonomy row, has one
active `crate-core` release, and reports stable IDs/digest after a restart.

**Step 5: Commit the vocabulary contract.**

```bash
git add app/crate/db/migrations/versions/059_core_genre_taxonomy.py \
  app/crate/db/schema_sections/library_genres.py \
  app/crate/genre_taxonomy.py app/crate/db/jobs/genre_taxonomy.py \
  app/crate/api/genres.py app/tests/test_genre_taxonomy_global_contract.py \
  app/tests/test_genre_taxonomy.py
git commit -m "feat: version crate core genre taxonomy"
```

### Task 7.2: Transport genre assertions and project canonical membership

**Files:**

- Create: `app/crate/db/migrations/versions/060_global_catalog_genres.py`
- Create: `app/crate/federation/global_genres.py`
- Modify: `app/crate/api/federation.py`
- Modify: `app/crate/worker_handlers/federation.py`
- Modify: `app/crate/federation/global_sources.py`
- Modify: `app/crate/federation/global_reconciliation.py`
- Modify: `app/crate/db/queries/global_catalog.py`
- Test: `app/tests/test_federation_manifest.py`
- Test: `app/tests/test_global_catalog_genres.py`
- Test: `app/tests/test_global_catalog_remote_reconciliation.py`

**Step 1: Write failing source-provenance and projection tests.**

The fixture matrix must include:

```text
one-node: local artist/album/track tags -> assertion -> canonical membership
matching peer: declared crate-core UID/digest -> preserved as peer evidence
unknown digest: raw label retained -> no canonical membership until receiver maps it
two peers: same entity/genre -> two sources, never two votes from one source
tombstone/revoke: source removed -> prior contribution disappears
parent graph: hardcore-punk direct -> punk discoverable by hierarchy, not stored direct
```

Add an API-level assertion that the pre-existing `genres: list[str]` manifest
field remains readable for older peers while the new typed field is present for
new peers. Test that a peer without the explicit `catalog.metadata.genres`
grant receives neither raw nor canonical genre assertions.

**Step 2: Run the focused tests to confirm the old raw path is insufficient.**

```bash
PYTHONPATH=app uv run pytest \
  app/tests/test_federation_manifest.py \
  app/tests/test_global_catalog_genres.py \
  app/tests/test_global_catalog_remote_reconciliation.py -q
```

Expected: red because local global sources omit genres, peer manifests have only
untyped strings, and the catalog has no attributed membership projection.

**Step 3: Add source assertions and aggregate memberships.**

Migration 060 must create:

```text
global_catalog_genre_assertions
  source_id -> global_catalog_sources.id
  global_genre_uid nullable -> genre_taxonomy_nodes.global_genre_uid
  taxonomy_id, taxonomy_version, taxonomy_digest
  raw_label, mapping_method, confidence, weight, is_direct
  source_revision, asserted_at, invalidated_at

global_catalog_entity_genres
  entity_type, global_entity_uid, global_genre_uid
  direct_score, aggregate_score, supporting_source_count, supporting_node_count
  preferred_for_display, computed_at
```

Enforce one active assertion per `(source_id, raw_label, global_genre_uid)` and
one aggregate row per `(entity_type, global_entity_uid, global_genre_uid)`. A
null global UID is valid only in the assertion table: it preserves unmapped
remote evidence for curator review and must never appear as a browseable genre.

Implement `global_genres.py` with pure, table-tested helpers that:

1. normalize an incoming typed assertion or legacy raw string;
2. accept a remote canonical UID only when the declared `crate-core` descriptor
   matches a recognized release;
3. otherwise resolve through this node's aliases/inference and record
   `receiver_mapping` or `unmapped`, without mutating the core taxonomy;
4. calculate one bounded contribution per source; and
5. recompute only the affected global entity after an upsert, re-match, stale
   transition, peer revoke, or local tombstone.

The manifest response must include a top-level taxonomy descriptor and, per
item, `genre_assertions` with raw label, immutable UID, canonical slug, method,
confidence, and weight. Continue sending the old `genres` list until the
federation protocol has an explicitly scheduled removal. Gate both fields by
`catalog.metadata.genres` in addition to the existing signed `catalog.sync`
capability.

Populate local source payloads from `artist_genres`, `album_genres`, and track
tags as well as remote ones. Replace the current query-time JSON aggregation of
`source_payload_json->'genres'` in `global_catalog.py` with
`global_catalog_entity_genres` joins. Do not materialize parent, sibling,
related, or fusion memberships; hierarchy belongs in the reader.

**Step 4: Backfill and verify source lifecycle behavior.**

Add the assertion backfill to the Phase 3 catalog bootstrap state machine. It
must be resumable by source cursor and must mark the catalog genre projection
ready only after the active taxonomy release and source revisions agree.

```bash
PYTHONPATH=app uv run pytest \
  app/tests/test_federation_manifest.py \
  app/tests/test_global_catalog_genres.py \
  app/tests/test_global_catalog_remote_reconciliation.py -q
PYTHONPATH=app uv run pytest app/tests/test_global_catalog_worker.py -q
```

Expected: green. A singleton exposes only local canonical genre memberships;
removing its last tagged source removes that membership without a full scan.

**Step 5: Commit the protocol and projection.**

```bash
git add app/crate/db/migrations/versions/060_global_catalog_genres.py \
  app/crate/federation/global_genres.py app/crate/api/federation.py \
  app/crate/worker_handlers/federation.py \
  app/crate/federation/global_sources.py \
  app/crate/federation/global_reconciliation.py \
  app/crate/db/queries/global_catalog.py \
  app/tests/test_federation_manifest.py \
  app/tests/test_global_catalog_genres.py \
  app/tests/test_global_catalog_remote_reconciliation.py
git commit -m "feat: project global catalog genre assertions"
```

### Task 7.3: Serve global genre browsing consistently in FastAPI, Listen, and Go

**Files:**

- Modify: `app/crate/api/catalog.py`
- Modify: `app/crate/api/schemas/genres.py`
- Modify: `app/crate/db/queries/global_catalog.py`
- Modify: `app/crate/projector.py`
- Modify: `app/crate/db/ui_snapshot_building.py`
- Modify: `app/crate/db/ui_snapshot_writes.py`
- Modify: `app/listen/src/components/explore/ExploreViews.tsx`
- Modify: `app/listen/src/pages/Explore.test.tsx`
- Modify: `app/readplane/internal/catalog/taxonomy.go`
- Create: `app/readplane/internal/catalog/global_genre_store.go`
- Create: `app/readplane/internal/catalog/global_genre_store_test.go`
- Modify: `app/readplane/internal/routes/global_catalog.go`
- Modify: `app/readplane/internal/routes/global_catalog_test.go`
- Modify: `app/readplane/internal/routes/server.go`
- Modify: `app/readplane/internal/snapshots/store.go`
- Test: `app/tests/test_catalog_genres_api.py`

**Step 1: Write failing API, UI, and Go parity tests.**

Define the canonical endpoints and response guarantees before implementation:

```text
GET /api/catalog/genres
GET /api/catalog/genres/{slug}
GET /api/catalog/tracks/{global_track_uid}/genre
```

Each response must include `global_genre_uid`, `canonical_slug`, taxonomy
descriptor/version, direct versus inherited membership semantics, source count,
and only non-sensitive aggregate evidence. The detail response must distinguish
direct genre assignments from hierarchy-expanded browse results.

Add a Go table-driven test proving that the readplane serves a global genre
request only when these two snapshots reference the same taxonomy descriptor:

```text
scope=global-catalog-taxonomy, subject=crate-core
scope=global-catalog-genres, subject=<catalog revision>
```

Test a taxonomy revision mismatch, missing snapshot, and stale snapshot: each
must use FastAPI fallback rather than returning an old hierarchy with new
memberships. Add Listen tests that the genre detail uses `/api/catalog/genres`
and still renders the existing hero/cover UX from canonical data.

**Step 2: Run the red tests.**

```bash
PYTHONPATH=app uv run pytest app/tests/test_catalog_genres_api.py -q
npm run --workspace=app/listen test -- Explore
make readplane-test
```

Expected: red because canonical genre routes/schemas and compatible snapshots
do not exist; current Go genre reads query local `library_*` assignments.

**Step 3: Build canonical read models and atomically publish snapshots.**

Implement FastAPI query functions over `global_catalog_entity_genres` and the
active `crate-core` taxonomy. Browse a parent genre by recursively expanding
locked core `parent` edges at query time; surface a child membership as
`inherited`, never `direct`. Keep the legacy `/api/genres/*` route local for
Admin/compatibility until a separately approved API migration.

Have the projector build and atomically upsert these `ui_snapshots` rows after
taxonomy or assertion changes:

```json
{
  "scope": "global-catalog-taxonomy",
  "subject_key": "crate-core",
  "payload": {"taxonomy": {"id": "crate-core", "version": "...", "digest": "..."}}
}
```

The companion `global-catalog-genres` payload must carry the same descriptor
and the catalog/source revision used to build aggregate memberships. Mark both
snapshots stale in the transaction that changes an active assertion, source
validity, or core release; rebuild both before publishing their snapshot event.

In Go, remove the hard-coded map as an authority from `taxonomy.go`. Add
snapshot decoding/validation and `GlobalGenres`/`GlobalGenreDetail` store
methods. Route only the new canonical genre GETs through
`routeCatalog`; use FastAPI fallback for mutations, covers, shows, EQ, radio,
unknown taxonomy versions, missing snapshots, and any response that needs a
remote facet. Do not query `global_catalog_*` on the Go hot path for these
taxonomy-dependent routes.

**Step 4: Move Listen without changing the public UX.**

Switch `GenreDetailView` to canonical catalog genre endpoints and update the
typed response. Preserve existing query-string routes, cover URLs, responsive
layout, share URLs, and hero behavior. In a one-node fixture it must render the
same direct genre content through global IDs; in a two-node fixture it can show
the aggregated catalog count without exposing peer identity or raw labels.

**Step 5: Verify parity and snapshot fallback.**

```bash
PYTHONPATH=app uv run pytest app/tests/test_catalog_genres_api.py -q
npm run --workspace=app/listen test -- Explore
npm run --workspace=app/listen typecheck
make readplane-test
make readplane-vet
READPLANE_CONTRACT_CHECK_P1=true make readplane-contract-smoke
```

Expected: green. Matching snapshots produce `X-Crate-Readplane: hit`; a stale
or mismatched pair produces `fallback`; FastAPI and Go agree for singleton and
two-node canonical genre reads.

**Step 6: Commit the end-to-end genre surface.**

```bash
git add app/crate/api/catalog.py app/crate/api/schemas/genres.py \
  app/crate/db/queries/global_catalog.py app/crate/projector.py \
  app/crate/db/ui_snapshot_building.py app/crate/db/ui_snapshot_writes.py \
  app/listen/src/components/explore/ExploreViews.tsx \
  app/listen/src/pages/Explore.test.tsx \
  app/readplane/internal/catalog/taxonomy.go \
  app/readplane/internal/catalog/global_genre_store.go \
  app/readplane/internal/catalog/global_genre_store_test.go \
  app/readplane/internal/routes/global_catalog.go \
  app/readplane/internal/routes/global_catalog_test.go \
  app/readplane/internal/routes/server.go \
  app/readplane/internal/snapshots/store.go \
  app/tests/test_catalog_genres_api.py
git commit -m "feat: serve global catalog genres"
```

### Task 7.4: Add governance, compatibility, and operational acceptance checks

**Files:**

- Modify: `app/crate/api/admin_global_catalog.py`
- Modify: `app/crate/api/genres.py`
- Modify: `app/crate/genre_taxonomy_proposals.py`
- Modify: `app/crate/worker_handlers/global_catalog.py`
- Modify: `app/crate/projector.py`
- Test: `app/tests/test_global_catalog_genres.py`
- Test: `app/tests/test_genre_taxonomy_global_contract.py`
- Test: `app/tests/test_admin_global_catalog.py`

**Step 1: Write failing governance and observability tests.**

Assert that Admin can inspect active release/digest, assertion backlog,
unmapped labels, source/node support counts, and snapshot revision without
displaying raw labels from a peer that withheld the genre grant. Assert an
unknown remote taxonomy creates a review-only mapping proposal; it never adds a
node, alias, or edge automatically. Assert compatible N-1 releases remain
readable according to an explicit compatibility list, while unsupported
versions are retained only as raw evidence.

**Step 2: Run the focused tests.**

```bash
PYTHONPATH=app uv run pytest \
  app/tests/test_global_catalog_genres.py \
  app/tests/test_genre_taxonomy_global_contract.py \
  app/tests/test_admin_global_catalog.py -q
```

Expected: red because release/mapping state is not yet visible or bounded.

**Step 3: Implement review-only governance.**

Expose release and projection health in the existing global-catalog Admin
surface. Reuse the current taxonomy proposal flow for unknown labels, but make
application an explicit curator action. Record counts and revisions, not
peer-private raw metadata, in normal worker output. Cap all queues and
assertion recomputation batches; do not run a full catalog rebuild merely
because one alias proposal changed.

**Step 4: Verify compatibility and bounded work.**

```bash
PYTHONPATH=app uv run pytest \
  app/tests/test_global_catalog_genres.py \
  app/tests/test_genre_taxonomy_global_contract.py \
  app/tests/test_admin_global_catalog.py \
  app/tests/test_global_catalog_worker.py -q
```

Expected: green. A peer cannot modify `crate-core`; its revoked or stale
assertions disappear deterministically; an unmapped label is inspectable but
never changes browse semantics without curator approval.

**Step 5: Commit governance and observability.**

```bash
git add app/crate/api/admin_global_catalog.py app/crate/api/genres.py \
  app/crate/genre_taxonomy_proposals.py \
  app/crate/worker_handlers/global_catalog.py app/crate/projector.py \
  app/tests/test_global_catalog_genres.py \
  app/tests/test_genre_taxonomy_global_contract.py \
  app/tests/test_admin_global_catalog.py
git commit -m "feat: govern global genre taxonomy mappings"
```

---

## Phase 8 — End-To-End Verification, Performance, And Release

### Task 8.1: Add singleton and two-node acceptance scenarios

**Files:**

- Modify: `scripts/federation-dev-e2e.py`
- Modify: `scripts/federation-smoke.sh`
- Modify: `docker-compose.federation-dev.yaml`
- Test: `app/tests/test_federation_dev_harness.py`
- Test: `app/tests/test_global_catalog_events.py`
- Test: `app/tests/test_global_catalog_remote_reconciliation.py`
- Test: `app/tests/test_global_catalog_genres.py`

**Step 1: Write scenario tests and assertions.**

The harness must cover both paths:

```text
singleton:
  migrate -> identity -> bootstrap -> ready -> local search/detail/playback/genre
  assert peer_count == 0 and no outbound federation request
  assert crate-core descriptor and global genre memberships are present

two nodes:
  migrate both -> bootstrap both -> pair/approve -> sync manifest -> reconcile
  assert Node A canonical search sees local + Node B source
  assert a local duplicate is merged conservatively
  assert matching crate-core assertions aggregate without exposing peer identity
  assert unknown taxonomy digest remains raw/unmapped and changes no hierarchy
  assert local playback wins when both nodes have a source
  assert revoked peer disappears after invalidation/reconcile
```

**Step 2: Run unit tests first.**

```bash
PYTHONPATH=app uv run pytest \
  app/tests/test_federation_dev_harness.py \
  app/tests/test_global_catalog_events.py \
  app/tests/test_global_catalog_remote_reconciliation.py \
  app/tests/test_global_catalog_genres.py -q
```

Expected: red until helper output/readiness checks are updated.

**Step 3: Extend scripts with readiness polling, not sleeps.**

Add a `wait_for_catalog_ready(base_url)` helper that polls the Admin/catalog
status endpoint with a bounded timeout. The scripts must fail with the current
state/last error if a node remains `cold`, `backfilling`, or `failed`.

**Step 4: Run the full dev scenarios.**

```bash
make federation-dev-reset
make federation-dev-up
make federation-dev-smoke
make federation-dev-e2e
make federation-dev-global-catalog-e2e
```

Expected: all commands green. A running harness by itself is not proof of a
Listen cross-node result; the E2E must complete pairing, approval, indexing,
and canonical search/playback assertions.

**Step 5: Commit.**

```bash
git add scripts/federation-dev-e2e.py scripts/federation-smoke.sh \
  docker-compose.federation-dev.yaml app/tests/test_federation_dev_harness.py \
  app/tests/test_global_catalog_events.py \
  app/tests/test_global_catalog_remote_reconciliation.py \
  app/tests/test_global_catalog_genres.py
git commit -m "test: cover one-node and peer catalog flows"
```

### Task 8.2: Establish bounded-work performance and observability checks

**Files:**

- Modify: `app/crate/federation/global_reconciliation.py`
- Modify: `app/crate/worker_handlers/global_catalog.py`
- Modify: `app/crate/api/admin_global_catalog.py`
- Modify: `app/crate/projector.py`
- Test: `app/tests/test_global_catalog_worker.py`
- Test: `app/tests/test_global_catalog_scheduler.py`
- Test: `app/tests/test_global_catalog_projector.py`

**Step 1: Write failing bounded-work/metrics tests.**

Assert one incremental batch reports:

```json
{
  "claimed": 500,
  "completed": 498,
  "failed": 2,
  "remaining": 1200,
  "mode": "incremental"
}
```

Assert full reconcile reports a cursor and never emits more than one catalog
event per batch. Assert genre assertion projection reports its own bounded
claimed/completed/remaining counts without scheduling a complete catalog scan.
Assert Admin status exposes queue depth, readiness state, active taxonomy
release/digest, snapshot revision, last full verification, and stale peer count.

**Step 2: Run the focused tests.**

```bash
PYTHONPATH=app uv run pytest \
  app/tests/test_global_catalog_worker.py \
  app/tests/test_global_catalog_scheduler.py \
  app/tests/test_global_catalog_projector.py \
  app/tests/test_global_catalog_genres.py -q
```

Expected: red until metrics/state fields are present.

**Step 3: Implement bounded observability.**

- Keep detailed progress in Admin/task events.
- Keep normal worker agent output compact: one line per batch, no per-track
  logging.
- Recompute memberships for only affected global entities; an alias proposal or
  taxonomy overlay must not start a full reconciliation.
- Run full verification daily (or another explicitly configured conservative
  interval) rather than every incremental interval.
- Do not start full verification while a scan or bootstrap is in progress.

**Step 4: Verify and perform a representative local-library run.**

```bash
PYTHONPATH=app uv run pytest \
  app/tests/test_global_catalog_worker.py \
  app/tests/test_global_catalog_scheduler.py \
  app/tests/test_global_catalog_projector.py \
  app/tests/test_global_catalog_genres.py -q
```

Then inspect the Admin status while a local backfill runs. Confirm bounded
batch counts, monotonic cursor progress, and no per-entity event flood.

**Step 5: Commit.**

```bash
git add app/crate/federation/global_reconciliation.py \
  app/crate/worker_handlers/global_catalog.py \
  app/crate/api/admin_global_catalog.py app/crate/projector.py \
  app/tests/test_global_catalog_worker.py \
  app/tests/test_global_catalog_scheduler.py \
  app/tests/test_global_catalog_projector.py
git commit -m "feat: expose bounded catalog reconciliation progress"
```

### Task 8.3: Run the release verification matrix

**Files:**

- Modify only if a verification failure identifies a scoped defect.

**Step 1: Run Python federation/catalog coverage.**

```bash
PYTHONPATH=app uv run pytest \
  app/tests/test_federation_*.py \
  app/tests/test_global_catalog_*.py \
  app/tests/test_genre_taxonomy_global_contract.py \
  app/tests/test_scheduler.py \
  app/tests/test_user_library_queries.py \
  app/tests/test_stats_api_contracts.py -q
```

**Step 2: Run frontend checks.**

```bash
npm run --workspace=app/listen typecheck
npm run --workspace=app/listen lint
npm run --workspace=app/listen test -- \
  SearchResults Album Artist Library TrackRow library-routes
npm run --workspace=app/ui typecheck
npm run --workspace=app/ui lint
```

**Step 3: Run Go checks.**

```bash
make readplane-test
make readplane-vet
READPLANE_CONTRACT_CHECK_P1=true make readplane-contract-smoke
```

**Step 4: Run environment acceptance.**

```bash
make federation-dev-reset
make federation-dev-up
make federation-dev-smoke
make federation-dev-e2e
make federation-dev-global-catalog-e2e
```

**Step 5: Record release evidence.**

Before opening a PR, attach:

- migration/backfill duration and source counts from a representative catalog;
- singleton and two-node E2E output;
- readplane contract-smoke output showing `hit` vs `fallback` for catalog
  routes;
- the active `crate-core` release/digest and genre snapshot revision on both
  nodes, including the unknown-version fallback result;
- explicit confirmation that no old mode environment variable remains in
  runtime code or Compose configuration.

Do not claim the feature is complete if the catalog is only green in the
two-node harness but the one-node bootstrap/backfill is unverified.

---

## Implementation Verification — 2026-07-13

- Python: `2709 passed, 2 skipped` in one uninterrupted final run.
- Python static checks: Ruff check/format and Pyright pass with zero errors.
- Go readplane: `go test ./...` and `go vet ./...` pass.
- Frontends: Listen (`1444 passed, 4 skipped`), Admin (`123 passed`), and
  `@crate/ui` (`194 passed`) pass together with their typecheck/lint/build
  checks.
- Migration `063`: fresh `upgrade head`, `downgrade 062`, and `upgrade 063`
  pass. Both `global_genre_uid` and `taxonomy_id` defaults disappear at `062`
  and are restored at `063`.
- Singleton harness: bootstrap, local sync, genre indexing, full
  reconciliation, canonical search, human artist/album routes, artwork, and
  range playback pass with zero federation requests.
- Two-node harness: bidirectional reachability/pairing, remote sync, global
  reconciliation, `/artists/rival-schools/found`, artwork, and remote range
  playback pass.
- Readplane live contract smoke: P0/P1/P2, SSE, canonical global catalog,
  genres, and user-library routes pass; catalog reads report `source=hit`.
- Core taxonomy: `crate-core` `1.0.0`, 61 genres,
  `sha256:9d6af6a06c7b0d404820f2c4014d976a7251433ad3f61ddea3e03b7dc65c1de3`.
- Production, development/readplane, and federation Compose configurations
  validate; the deprecated mode-flag scan returns no matches.

---

## Final Acceptance Checklist

- [x] A fresh node gets exactly one local identity without environment mode flags.
- [x] A fresh node reaches `ready` after a resumable bootstrap before Listen
      receives catalog data.
- [x] A migrated node preserves follows, saves, playlists, history, and stats
      through canonical references.
- [x] A stale user-reference checkpoint automatically requeues the full
      reconciliation, records its projection version/report, and never deletes
      an unresolved historical row.
- [x] Local upserts enqueue bounded dirty projection work.
- [x] Local deletes tombstone/remove their canonical source correctly.
- [x] A no-peer node makes no federation HTTP request and exposes only local
      catalog content.
- [x] A peer is visible only after existing approval/grant rules are satisfied.
- [x] Local sources win display/artwork/playback when a remote duplicate exists.
- [x] Listen has no user-visible standalone/remote/node-mode branch.
- [x] `/api/catalog/*` never silently falls back to legacy local data while
      warming or after readiness.
- [x] Legacy local write and compatibility APIs remain local.
- [x] Go readplane routes `/api/catalog/*`, hits native parity-tested reads,
      and falls back safely for remote facets/assets/playback.
- [x] FastAPI/readplane contract smoke passes for canonical search and
      user-library reads.
- [x] FastAPI and Go return the same canonical-plus-unresolved-legacy count,
      list, and follow-state semantics for user-library compatibility routes.
- [x] Every node, including a zero-peer node, advertises one stable signed
      `crate-core` taxonomy descriptor with immutable global genre IDs.
- [x] Peer manifests retain legacy raw genres during protocol compatibility and
      emit typed assertions only when `catalog.metadata.genres` is granted.
- [x] Global genre memberships retain source/revision provenance, are removed
      on tombstone/revoke, and never materialize hierarchy as a direct tag.
- [x] Unknown taxonomy versions remain reviewable raw evidence and cannot
      create or mutate a canonical node, alias, or edge.
- [x] Go serves a canonical genre read only from matching taxonomy and
      membership snapshots; mismatch/staleness uses FastAPI fallback.
- [x] `rg` finds no deprecated federation/global-catalog mode flags in runtime
      code, Compose files, or Makefile.

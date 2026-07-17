# Federated Playback Prewarm Implementation Plan

> **For agents:** REQUIRED SUB-SKILL: Use viterbit:executing-plans to implement this plan task-by-task.

**Goal:** Prepare at most two upcoming remote queue tracks on their owner node
without delaying playback, while proving normal web pause/resume reuses its
loaded source.

**Architecture:** Listen continues to call its own playback preparation API.
The consumer node resolves global track ownership and relays eligible remote
items over the existing signed federation transport with a scoped user
assertion. The owner authenticates, authorizes, rate-limits and deduplicates
the request before reusing the existing low-priority transcoding pipeline.
Playback itself is unchanged: only normal ticket/session creation can deliver
bytes, and it falls back to the original if a prepared variant is not ready.

**Tech Stack:** React 19, TypeScript, Vitest, FastAPI, Pydantic v2,
Python 3.13, SQLAlchemy 2.0, Redis Lua, Dramatiq, pytest, Ed25519 federation
signatures and the existing Go-independent FastAPI control plane.

---

## Guardrails and execution rules

- Read `docs/plans/2026-07-17-federated-playback-prewarm-design.md` before
  starting. It is the source of truth for scope and limits.
- Run `@viterbit-ai-tools:test-driven-development` before every functional
  task and `@viterbit-ai-tools:systematic-debugging` for any unexpected test
  failure.
- Run `@vercel-react-best-practices` before changing Listen code.
- Preserve unrelated worktree changes. This plan only touches files named in
  each task plus generated API documentation where necessary.
- Do not add `CRATE_FEDERATION_ENABLED`, standalone branches, a browser peer
  client, a remote-media cache, a stream-ticket shortcut or filesystem writes
  from a FastAPI route.
- Each task follows red → green → focused suite → commit. Do not batch
  implementation ahead of failing tests.

## Phase 0 — Freeze current pause/resume behaviour

### Task 0.1: Write the ordinary web pause/resume regression test

**Files:**

- Modify: `app/listen/src/lib/gapless-player.test.ts`
- Modify: `app/listen/src/lib/gapless-player-audio-recovery.test.ts`

**Step 1: Write the failing tests.**

Add a web-engine test that loads one stable URL, clears mocks, performs
`pause(); await play();`, then asserts:

```ts
expect(mock.pause).toHaveBeenCalledTimes(1);
expect(mock.play).toHaveBeenCalledTimes(1);
expect(mock.removeAllTracks).not.toHaveBeenCalled();
expect(mock.getTracks()).toEqual(["/tracks/a.flac"]);
```

Capture the installed `onloadstart` callback and assert it is not invoked by
pause/resume. Extend the native recovery test to assert that a stale/closed
context creates exactly one replacement engine and preserves tracks, cursor and
position.

**Step 2: Run the red test.**

```bash
npm run --workspace=app/listen test -- gapless-player.test.ts gapless-player-audio-recovery.test.ts
```

Expected: the new assertion fails if the mock cannot expose queue replacement
or the normal resume path rebuilds it.

**Step 3: Implement the smallest correction.**

Only if red, adjust `app/listen/src/lib/gapless-player.ts` so the ordinary
`play()` path does not call reconstruction helpers unless the `AudioContext` is
closed or the existing Tauri stale-output predicate is true. Do not add a new
cache or fetch layer.

**Step 4: Run focused verification.**

```bash
npm run --workspace=app/listen test -- gapless-player.test.ts gapless-player-audio-recovery.test.ts
npm run --workspace=app/listen typecheck
```

Expected: PASS.

**Step 5: Commit.**

```bash
git add app/listen/src/lib/gapless-player.test.ts app/listen/src/lib/gapless-player-audio-recovery.test.ts app/listen/src/lib/gapless-player.ts
git commit -m "test(playback): lock pause resume buffer reuse"
```

## Phase 1 — Define the bounded federation contract

### Task 1.1: Add strict request and response models

**Files:**

- Modify: `app/crate/api/schemas/federation.py`
- Modify: `app/crate/api/federation.py`
- Test: `app/tests/test_federation_playback_prepare_contract.py` (create)

**Step 1: Write the failing model tests.**

Test that the models reject unknown fields, a non-UUID owner entity UID, more
than two items, `original` as a prewarm policy, and any node UID mismatch. Test
the response enum is constrained to `ready`, `preparing`, `unavailable`, or
`rate_limited` and has no stream material.

```python
with pytest.raises(ValidationError):
    FederatedPlaybackPrepareBody.model_validate({
        "requesting_node_uid": NODE_UID,
        "delivery_policy": "balanced",
        "remote_entity_uids": [TRACK_UID, TRACK_UID, TRACK_UID],
    })
```

**Step 2: Run the red test.**

```bash
PYTHONPATH=app uv run pytest app/tests/test_federation_playback_prepare_contract.py -q
```

Expected: FAIL because the models and route contract do not exist.

**Step 3: Implement the models and route declaration.**

Move `StreamTicketBody` from `app/crate/api/federation.py` into the federation
schema module only if doing so does not create a broad unrelated refactor.
Add:

```python
class FederatedPlaybackPrepareBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    requesting_node_uid: UUID
    delivery_policy: Literal["balanced", "data_saver"]
    remote_entity_uids: list[UUID] = Field(min_length=1, max_length=2)
```

Use a strict response model whose item has only `remote_entity_uid` and
`status`. Register `POST /playback/prepare` underneath the existing
`/api/federation/v1` router; do not expose it through the Go readplane.

**Step 4: Run focused verification.**

```bash
PYTHONPATH=app uv run pytest app/tests/test_federation_playback_prepare_contract.py app/tests/test_federation_openapi_contract.py -q
```

Expected: PASS and OpenAPI describes the new signed-node route.

**Step 5: Commit.**

```bash
git add app/crate/api/schemas/federation.py app/crate/api/federation.py app/tests/test_federation_playback_prepare_contract.py
git commit -m "feat(federation): define playback prepare contract"
```

### Task 1.2: Extend the protocol capability map and assertion purpose

**Files:**

- Modify: `app/crate/federation/contracts.py`
- Modify: `app/crate/federation/assertions.py`
- Test: `app/tests/test_federation_playback_prepare_contract.py`

**Step 1: Write failing authorization-contract tests.**

Prove `stream.prepare` is listed as a route requiring the same playback grants
as the selected delivery mode, and that a user assertion with purpose
`stream.ticket` is rejected by a prepare request while `stream.prepare` is
accepted.

**Step 2: Run the red test.**

```bash
PYTHONPATH=app uv run pytest app/tests/test_federation_playback_prepare_contract.py -q
```

Expected: FAIL because the protocol map and purpose are absent.

**Step 3: Implement the narrow contract change.**

Add the route to the capability map. Reuse `federation.stream.play` for the
assertion capability, `stream.proxy` for the peer transport grant, and require
`stream.transcoded` for `balanced`/`data_saver`. Add `stream.prepare` to the
allowed assertion purposes without weakening ticket validation. Do not create a
new grant type or migration in this iteration.

**Step 4: Run focused verification.**

```bash
PYTHONPATH=app uv run pytest app/tests/test_federation_playback_prepare_contract.py app/tests/test_federation_policy_enforcement.py -q
```

Expected: PASS.

**Step 5: Commit.**

```bash
git add app/crate/federation/contracts.py app/crate/federation/assertions.py app/tests/test_federation_playback_prepare_contract.py
git commit -m "feat(federation): authorize bounded playback prepare"
```

## Phase 2 — Enforce owner-side limits and preparation semantics

### Task 2.1: Add atomic peer and global preparation reservations

**Files:**

- Create: `app/crate/federation/playback_prepare.py`
- Modify: `app/crate/federation/abuse.py`
- Test: `app/tests/test_federation_playback_prepare_quotas.py` (create)

**Step 1: Write failing quota tests.**

Use a fake Redis supporting `eval` to prove the reservation helper:

- allows four unique cache keys for a peer;
- rejects the fifth for that peer;
- allows twenty unique keys across peers and rejects the twenty-first;
- permits a duplicate cache key without consuming an additional slot;
- prunes expired reservations before counting;
- fails closed for preparation if Redis is unavailable.

**Step 2: Run the red test.**

```bash
PYTHONPATH=app uv run pytest app/tests/test_federation_playback_prepare_quotas.py -q
```

Expected: FAIL because no reservation helper exists.

**Step 3: Implement a small Lua-backed helper.**

In `playback_prepare.py`, use these bounded keys:

```text
federation:playback-prepare:peer:{peer_node_uid}
federation:playback-prepare:global
```

Add `acquire_prepare_reservation(redis, peer_node_uid, cache_key)` using one
Lua script that prunes both ZSETs, recognizes an existing cache-key reservation,
and atomically inserts only when `< 4` and `< 20`. Use a 20-minute TTL, aligned
with the existing transcode-slot TTL. Return a typed result (`accepted`,
`duplicate`, `peer_limited`, `global_limited`, `unavailable`), never an
exception to the route.

**Step 4: Run focused verification.**

```bash
PYTHONPATH=app uv run pytest app/tests/test_federation_playback_prepare_quotas.py app/tests/test_federation_quotas_integration.py -q
```

Expected: PASS.

**Step 5: Commit.**

```bash
git add app/crate/federation/playback_prepare.py app/crate/federation/abuse.py app/tests/test_federation_playback_prepare_quotas.py
git commit -m "feat(federation): bound playback prepare work"
```

### Task 2.2: Implement the owner endpoint without creating stream state

**Files:**

- Modify: `app/crate/api/federation.py`
- Modify: `app/crate/federation/playback_prepare.py`
- Modify: `app/crate/streaming/service.py`
- Test: `app/tests/test_federation_playback_prepare_owner.py` (create)

**Step 1: Write failing owner-route tests.**

Mock signed-node validation, assertion verification, authorization, the entity
resolver and `prepare_playback`. Cover a ready cache hit, queued preparation,
unknown/denied entity, peer limit, global limit, wrong requesting node UID,
wrong assertion purpose and missing transcode grant. Assert no test path calls
`create_ticket`, `create_stream_ticket`, or writes a stream session.

**Step 2: Run the red test.**

```bash
PYTHONPATH=app uv run pytest app/tests/test_federation_playback_prepare_owner.py -q
```

Expected: FAIL because the endpoint has no behaviour.

**Step 3: Implement the minimal owner flow.**

For each entity UID:

1. validate the signed request and ensure `requesting_node_uid` equals the
   signing peer;
2. verify `stream.prepare` assertion and existing policy/entity authorization;
3. fetch the local delivery row by entity UID; return `unavailable` if absent;
4. call a new narrow service helper that computes the existing variant
   descriptor before acquiring a reservation;
5. return `ready` for a cache hit, `rate_limited` when the reservation helper
   declines, otherwise call `prepare_playback(track, policy, reason="lookahead")`;
6. map the result to `preparing` or `unavailable` without leaking task/cache
   details.

Refactor `streaming.service` only enough to expose the descriptor/cache-state
check needed to avoid consuming a reservation for a ready variant. Keep active
playback priority and the existing `prepare_stream_variant` task payload/dedupe
semantics unchanged.

**Step 4: Run focused verification.**

```bash
PYTHONPATH=app uv run pytest \
  app/tests/test_federation_playback_prepare_owner.py \
  app/tests/test_streaming_policy.py \
  app/tests/test_playback_variant_priority.py \
  app/tests/test_federation_stream_tickets.py -q
```

Expected: PASS; stream-ticket tests confirm preparation did not alter Range or
ticket-session behaviour.

**Step 5: Commit.**

```bash
git add app/crate/api/federation.py app/crate/federation/playback_prepare.py app/crate/streaming/service.py app/tests/test_federation_playback_prepare_owner.py
git commit -m "feat(federation): prepare owner playback variants"
```

## Phase 3 — Relay preparation from the consumer node

### Task 3.1: Resolve remote preparation targets through the global catalogue

**Files:**

- Modify: `app/crate/api/browse_media.py`
- Modify: `app/crate/federation/playback_prepare.py`
- Modify: `app/crate/federation/client.py` only if a narrower timeout constant is needed
- Test: `app/tests/test_playback_prepare.py`
- Test: `app/tests/test_federation_playback_prepare_consumer.py` (create)

**Step 1: Write failing consumer tests.**

Extend the existing global local-source test and add remote cases proving:

- an owner-local global track still uses the local `prepare_playback` flow;
- a remote global track becomes an outbound `POST /api/federation/v1/playback/prepare`;
- the outbound body contains owner entity UIDs, not local IDs, source paths or
  global IDs;
- the signed assertion purpose is `stream.prepare` and policy is concrete;
- peer timeout, 4xx/5xx, malformed body and unavailable item are returned to
  Listen as a best-effort item result, not a 5xx for the whole request;
- at most two remote tracks for one peer are sent.

**Step 2: Run the red tests.**

```bash
PYTHONPATH=app uv run pytest app/tests/test_playback_prepare.py app/tests/test_federation_playback_prepare_consumer.py -q
```

Expected: FAIL because remote sources are currently discarded.

**Step 3: Implement consumer resolution and relay.**

Split `_resolve_playback_prepare_track()` into a small local/remote target
resolver. For a remote global selection, load the approved peer, build the
existing signed outbound user assertion with purpose `stream.prepare`, and call
`federated_post()` with a short, bounded prepare timeout. Batch at most two
tracks belonging to the same owner and policy; never fan out to multiple peers
from a single UI preparation request. Preserve the current local result shape
and return a neutral non-error result for remote failures.

Do not have the browser construct peer requests, do not follow redirects, and
do not persist remote response payloads.

**Step 4: Run focused verification.**

```bash
PYTHONPATH=app uv run pytest \
  app/tests/test_playback_prepare.py \
  app/tests/test_federation_playback_prepare_consumer.py \
  app/tests/test_federation_outbound_transport.py \
  app/tests/test_federation_remote_playback.py -q
```

Expected: PASS.

**Step 5: Commit.**

```bash
git add app/crate/api/browse_media.py app/crate/federation/playback_prepare.py app/crate/federation/client.py app/tests/test_playback_prepare.py app/tests/test_federation_playback_prepare_consumer.py
git commit -m "feat(federation): relay remote playback preparation"
```

### Task 3.2: Select two remote queue tracks from Listen

**Files:**

- Modify: `app/listen/src/lib/playback-delivery.ts`
- Modify: `app/listen/src/lib/playback-delivery.test.ts`
- Modify: `app/listen/src/contexts/use-player-queue-actions.ts` only if the
  current immediate call does not cover queue start and cursor changes

**Step 1: Write failing client tests.**

Add tracks with interleaved local and remote origins. Assert that local
preparation keeps its existing window, remote preparation contributes only the
first two future remote `global_track_uid` references, and `original` causes no
request. Assert an empty or singleton queue sends no remote preparation.

```ts
expect(upcomingRemoteDeliveryTracks(queue, 0)).toEqual([
  queue[1],
  queue[3],
]);
```

**Step 2: Run the red test.**

```bash
npm run --workspace=app/listen test -- playback-delivery.test.ts
```

Expected: FAIL because remote tracks are currently filtered out.

**Step 3: Implement bounded selection.**

Add a pure `upcomingRemoteDeliveryTracks()` helper. It scans forward from the
current cursor, returns at most two remote tracks with a global UID, and is
used only for the background preparation request. Keep the current 6/5/2 local
window, debounce and request dedupe. The local API remains the sole browser
destination.

**Step 4: Run focused verification.**

```bash
npm run --workspace=app/listen test -- playback-delivery.test.ts player-engine-adapter.test.ts
npm run --workspace=app/listen typecheck
```

Expected: PASS.

**Step 5: Commit.**

```bash
git add app/listen/src/lib/playback-delivery.ts app/listen/src/lib/playback-delivery.test.ts app/listen/src/contexts/use-player-queue-actions.ts
git commit -m "feat(listen): prewarm next remote playback tracks"
```

## Phase 4 — Metrics, integration proof and operator documentation

### Task 4.1: Emit privacy-safe aggregate preparation metrics

**Files:**

- Modify: `app/crate/federation/playback_prepare.py`
- Modify: `app/crate/api/playback_telemetry.py`
- Test: `app/tests/test_federation_playback_prepare_metrics.py` (create)

**Step 1: Write failing metric tests.**

Mock `crate.metrics.record` and assert only the seven design metric names are
emitted with `origin` and policy labels. Assert metric tags never contain node
UID, user subject, entity UID, cache key, task ID, source path, URL or token.

**Step 2: Run the red test.**

```bash
PYTHONPATH=app uv run pytest app/tests/test_federation_playback_prepare_metrics.py -q
```

Expected: FAIL because the metric helper is absent.

**Step 3: Implement minimal metric calls.**

Emit owner-side request/result metrics in the federation helper. In the normal
playback resolver, derive `ready_before_play` versus `fallback_original` from
the existing delivery result without retaining an event history. Do not alter
the client QoE schema or add IDs to telemetry.

**Step 4: Run focused verification.**

```bash
PYTHONPATH=app uv run pytest \
  app/tests/test_federation_playback_prepare_metrics.py \
  app/tests/test_playback_telemetry.py \
  app/tests/test_playback_observability.py -q
```

Expected: PASS.

**Step 5: Commit.**

```bash
git add app/crate/federation/playback_prepare.py app/crate/api/playback_telemetry.py app/tests/test_federation_playback_prepare_metrics.py
git commit -m "feat(federation): observe playback preparation"
```

### Task 4.2: Exercise two-node fallback and ready-variant flows

**Files:**

- Modify: `scripts/federation-dev-e2e.py`
- Modify: `app/tests/test_federation_dev_harness.py`
- Create: `app/tests/test_federation_playback_prepare_e2e.py`

**Step 1: Write failing E2E/contract tests.**

Add a harness scenario that:

1. pairs two nodes and grants streaming;
2. requests remote preparation for a `data_saver` track;
3. observes `preparing`, completes the fixture worker task, then observes
   `ready` on normal playback;
4. repeats with a delayed task and asserts normal playback still serves the
   original fallback;
5. exceeds peer/global limits and proves no extra task was created.

**Step 2: Run the red test.**

```bash
PYTHONPATH=app uv run pytest app/tests/test_federation_playback_prepare_e2e.py app/tests/test_federation_dev_harness.py -q
```

Expected: FAIL until the scenario and endpoint exist.

**Step 3: Implement the smallest harness support.**

Add `playback-prepare` as an explicit scenario to the existing federation dev
harness. Reuse the same signed requests and deterministic fixture data as the
stream-ticket scenario; do not add an external peer simulator or browser test
dependency.

**Step 4: Run focused verification.**

```bash
PYTHONPATH=app uv run pytest \
  app/tests/test_federation_playback_prepare_e2e.py \
  app/tests/test_federation_dev_harness.py \
  app/tests/test_federation_stream_proxy_e2e.py -q
```

Expected: PASS.

**Step 5: Commit.**

```bash
git add scripts/federation-dev-e2e.py app/tests/test_federation_dev_harness.py app/tests/test_federation_playback_prepare_e2e.py
git commit -m "test(federation): exercise playback prepare flow"
```

### Task 4.3: Update contracts, runbooks and release gates

**Files:**

- Modify: `docs/technical/federation-protocol.md`
- Modify: `docs/technical/federation-operations-runbook.md`
- Modify: `docs/technical/playback-slos.md`
- Modify: `docs/technical/playback-release-gates.md`
- Modify: `app/tests/test_federation_openapi_contract.py`
- Modify: `app/tests/test_federation_observability.py`

**Step 1: Write failing documentation assertions.**

Assert that protocol documentation names the signed prepare route, its limits,
assertion purpose and no-ticket invariant. Assert the SLO/runbook covers
prepare saturation, ready-before-play ratio and fallback-original ratio, with
peer-local containment rather than a global federation switch.

**Step 2: Run the red tests.**

```bash
PYTHONPATH=app uv run pytest \
  app/tests/test_federation_openapi_contract.py \
  app/tests/test_federation_observability.py -q
```

Expected: FAIL until the new protocol and runbook content exists.

**Step 3: Document exact operation and rollback.**

Describe the limits, relevant Redis reservation keys, expected metrics,
triage sequence and rollback: reduce the owner preparation limit to zero or
deny preparation capability while leaving normal stream tickets and local
playback untouched. Add the canary acceptance condition: fallback-original
ratio must not rise and interactive transcode queue wait must remain below the
existing SLO.

**Step 4: Run documentation verification.**

```bash
PYTHONPATH=app uv run pytest \
  app/tests/test_federation_openapi_contract.py \
  app/tests/test_federation_observability.py -q
```

Expected: PASS.

**Step 5: Commit.**

```bash
git add docs/technical/federation-protocol.md docs/technical/federation-operations-runbook.md docs/technical/playback-slos.md docs/technical/playback-release-gates.md app/tests/test_federation_openapi_contract.py app/tests/test_federation_observability.py
git commit -m "docs(federation): document playback prepare operations"
```

## Phase 5 — Full verification and controlled rollout

### Task 5.1: Run the release matrix before merge

**Files:**

- Modify: `docs/technical/playback-release-gates.md` only if a command or
  acceptance criterion discovered during verification is missing

**Step 1: Run all focused Python suites.**

```bash
PYTHONPATH=app uv run pytest \
  app/tests/test_playback_prepare.py \
  app/tests/test_federation_playback_prepare_contract.py \
  app/tests/test_federation_playback_prepare_quotas.py \
  app/tests/test_federation_playback_prepare_owner.py \
  app/tests/test_federation_playback_prepare_consumer.py \
  app/tests/test_federation_playback_prepare_metrics.py \
  app/tests/test_federation_playback_prepare_e2e.py \
  app/tests/test_federation_stream_tickets.py \
  app/tests/test_federation_remote_playback.py \
  app/tests/test_streaming_policy.py \
  app/tests/test_playback_variant_priority.py -q
```

Expected: PASS.

**Step 2: Run Listen tests and static checks.**

```bash
npm run --workspace=app/listen test -- \
  playback-delivery.test.ts \
  gapless-player.test.ts \
  gapless-player-audio-recovery.test.ts
npm run --workspace=app/listen typecheck
```

Expected: PASS.

**Step 3: Run federation and affected backend suites.**

```bash
PYTHONPATH=app uv run pytest app/tests/test_federation_*.py app/tests/test_playback_*.py -q
pre-commit run --files \
  app/crate/api/federation.py \
  app/crate/api/browse_media.py \
  app/crate/federation/playback_prepare.py \
  app/crate/streaming/service.py \
  app/listen/src/lib/playback-delivery.ts
```

Expected: PASS. If host capacity prevents the wildcard suites, record the
exact skipped command and run the focused matrix above; do not claim full
verification.

**Step 4: Execute the two-node canary.**

```bash
make dev-federation
PYTHONPATH=app uv run python scripts/federation-dev-e2e.py --scenario playback-prepare
```

Expected: ready and fallback cases pass; a fifth unique peer preparation and a
twenty-first global preparation are rejected; ordinary local playback and web
pause/resume remain unaffected.

**Step 5: Commit the final release-gate evidence.**

```bash
git add docs/technical/playback-release-gates.md
git commit -m "docs(playback): add federated prewarm release gates"
```

Skip this commit if no documentation changed in this task.

## Rollout checklist

1. Deploy schema-free code to a two-node canary; no Alembic migration is
   required because reservations are TTL-backed Redis operational state.
2. Confirm the owner has Redis available; preparation fails closed when Redis
   is unavailable, while regular playback remains available.
3. Observe one hour of `requested`, `preparing`, `ready_before_play`,
   `fallback_original`, interactive transcode queue wait and resource-governor
   decisions.
4. Keep defaults at four reservations per peer and twenty per owner node.
5. If workers, disk or queue wait regress, set the owner preparation limit to
   zero or deny preparation requests; do not revoke stream grants or delete
   cached variants.
6. Promote only after singleton, local playback, remote ready and remote
   fallback flows all remain green.

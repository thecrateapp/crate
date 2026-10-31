---
title: Smart Mix, native Android and VirtualDJ: continuation plan
summary: Tasks, dependencies, tests and gates to complete the unified feature from its WIP state.
section: developer
audience: [developer, operator]
status: canonical
order: 45
verified: 2026-09-09
sources:
  [
    app/crate,
    app/tests,
    app/listen,
    app/readplane,
    tools/crate-cli,
    tools/vdj-plugin,
    Makefile,
    .github/workflows,
  ]
---

# Smart Mix, native Android and VirtualDJ: continuation plan

> **Implemented behaviour and diagnostics:** see [Smart Mix: how it works and how to operate it](smart-mix-operations.md), checked against the release named on that page. This document keeps the continuation design/plan and its gates; a proposed task does not prove a deployed capability.

> **For agents:** use the `viterbit-ai-tools:executing-plans` guide to execute and verify the tasks. This plan and the [unified design](smart-mix-design.md) are the only current development guides for this feature. Do not execute the superseded plans/spikes or create parallel plans.

**Goal:** deliver Smart Mix, native Android crossfade and the VirtualDJ plugin in releases R1–R4, which close independently (§1.1). Anything that does not belong to a release stays in the §1.1 backlog and does not block closures.

**Architecture:** a common backend for analysis, profiles, ranking and plans; Android and VirtualDJ are executors with their own validation. PostgreSQL/Redis, the existing workers and shared media/auth keep their responsibilities. No local daemon is added and the algorithm is not replicated in clients.

**Stack:** Python/FastAPI/Pydantic/SQLAlchemy/Alembic, Rust `crate-cli`, Go readplane, React/TypeScript/Vitest, Java/Media3/Gradle and C++20/CMake/CTest/private VirtualDJ SDK.

**Baseline:** 2026-10-08, `codex/feat-smart-mix-phase-1` after committing the WIP (PAT, VDJ catalog, routing, `tools/vdj-plugin/`) and integrating `origin/main`. The branch migrations were renumbered to `104_smart_mix_profiles` and `105_user_access_tokens` because main already uses 090–103. The previous baseline (2026-09-09, `140f9e34` plus working tree) remains as history in §8. This is a plan pending execution; no future task is marked complete because the document was written. Code paths are relative to the worktree root. `Create` identifies proposed files, not existing ones.

## 1. How to continue without losing the WIP

All the WIP is committed on the branch; a clean checkout of the branch is enough. Before starting a package, integrate `origin/main` if the branch has gone more than a week without doing so and check `alembic heads`. Do not use `git reset --hard`, `git clean` or `git add .`.

Each package breaks down into the listed regressions/contracts: a RED that fails for the expected reason, a minimal change, GREEN, a review of the diff and a scoped conventional commit where appropriate. The steps are separate checkpoints, not an instruction to write all the tests and the whole feature before verifying. Refactors that are already finished are not repeated to satisfy historical numbering.

A skipped suite, a build that was not run or a pending host gate is recorded as such. To mark something `done`, attach the commit(s), commands/results, environment and the required evidence. A contract change updates both documents and the fixtures in the same change; it does not tacitly reopen the design from an adapter.

### 1.1 Releases, order and backlog

Each release closes with its own gate and can be deployed behind flags without waiting for the following ones. A failed gate keeps only that release open.

| Release                                       | Packages                                                                                                                             | Closing gate                                                                                                                                                                               |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R1: correct Smart Mix on Android adaptive     | C00, P01 (versions, contracts and migrations), SM01–SM05, SM06 (cache keys, eligibility before the limit, R15–R17), A01–A05, A09–A10 | Green automated suites; R01–R06 and R15–R17 with regressions; v2 reanalysis in progress with correct status; adaptive without clipping or underrun on a reference device (subset of A06)   |
| R2: VirtualDJ A (local source) on macOS arm64 | VH01, P02 (including the token UI in Listen), P03 (prod/home/dev routing and flags), P04, P05, V01–V04                               | Connect, search, browse folders, load, seek and revoke in real VirtualDJ Pro on macOS arm64; installable package with no default origin                                                    |
| R3: VirtualDJ B, Crate Automix and platforms  | V05, V06, SM07, V09 (DJ filters and native CI), V10 (Windows x64 and macOS Intel)                                                    | Compatibles and Crate metadata visible; Crate Automix feeds the native queue without sending mix commands; packages for all three platforms; SM07 benchmarks recorded                      |
| R4: advanced Android and joint release        | A06 (full matrix), A07, A08, X01–X04                                                                                                 | Gates from §7 of the design for beatmatch and bass; soak and rollback                                                                                                                      |
| R5: Smart Mix on iOS                          | I01–I06                                                                                                                              | Adaptive parity with R1 on a reference iPhone: planned transitions, background and locked screen, interruptions and route changes without dropouts; no clipping or underrun in the capture |

**R1 physical gate deferred (2026-10-18).** R1 is complete in code and validated on device with QoE logs (`clippedSamples=0`, transitions with the screen off, network, calls, seek). Only its physical gate is missing, the A06 subset: record the output with an external loopback (cable or USB interface at ≥48 kHz) and measure clipping and underrun on a reference device. It is deferred for lack of capture equipment; the QoE logs do not replace it. R1 does not close until it is run, and A06–A08 (R4) depend on the same lab.

**Backlog outside R1–R4.** An item enters a release only by editing this table with an explicit decision: P06 and V07 (radio as a source for Crate Automix and presence; private cues are withdrawn for VDJ because VDJ already persists cues per online track; the play events scope fix stays in P02 and its native client in V06), V08 (encrypted audio cache, offline and prefetch, only if VH01 confirms local paths in `GetStreamUrl`), integrated SDK OAuth, the federated path of SM06, a v1 compatibility wrapper with no proven distributed consumer, and PAT parity in the Go readplane.

Non-implicit dependencies: P01 precedes every contract/migration change. P02/P03 can advance alongside SM02–SM05. A01 can fix networking using fixtures after P01; final Android integration requires SM06. VH01 precedes V03, V04 and V06 and can run as soon as the probe plugin exists. V01 uses P01; V02 uses P02/P03; V03 uses P04 and VH01; V04 uses P05 and VH01; V05 uses SM06; V06 uses V05 and VH01; V09 integrates results; V10 uses X03; X04 uses V10.

Packages P02–P05 first deliver contracts and a backend implementation verified with automated integration. The `backend-ready` state unblocks V02/V03/V04 even if the joint host gate is pending. The later `integrated-in-host` state is recorded in the corresponding V task and in X03.

**Ownership of shared changes:** P04 implements the folders SQL/API and the filter syntax; V03/V09 are their consumers. P05 implements tickets/media; V04 the host integration. SM06 implements planner/cache/summary. P01 assigns the migration chain; no agent reserves a number in advance. X02 unifies CI; V09 maintains the native job and X02 does not create another equivalent pipeline.

### 1.2 Findings traceability

| ID  | Reproduced finding or verified gap                                                                         | Packages that close it    |
| --- | ---------------------------------------------------------------------------------------------------------- | ------------------------- |
| R01 | Cue at 176 s + 12 s fade on a 180 s track produces a transition outside the track                          | SM03, A02                 |
| R02 | Downmix hides the stereo peak; RMS published as LUFS                                                       | SM01–SM02, A03            |
| R03 | Idempotency prevents partial Python → full Rust                                                            | SM04                      |
| R04 | Source is checked after analysing; old done excluded from a new backfill                                   | SM04–SM05                 |
| R05 | Planning blocks startup, also goes to the network when offline and has no deadline                         | A01                       |
| R06 | Standby ready before seek, late global trigger, envelope driven by main-thread ticks                       | A02–A03                   |
| R07 | Capabilities not integrated and unknown non-empty contract accepted                                        | P01, V01–V02              |
| R08 | Catalog-only PAT allows writing play-events                                                                | P02, P06                  |
| R09 | prod/home proxy sends an opaque PAT to the Go JWT verifier                                                 | P03, X02                  |
| R10 | Cache returns success on 401/403/cancel; stale callbacks survive                                           | V01–V03                   |
| R11 | Hand-written JSON parsers, Unicode/body not covered; sanitizer does not link                               | V01, V09                  |
| R12 | Flat/truncated catalog, normalized genres excluded, relative covers                                        | P04, V03–V04              |
| R13 | C only a spike; our own executor is not viable with the SDK (no events, no timer, different VDJ grid)      | V06 (Crate Automix)       |
| R14 | No physical/host matrix, complete settings, packaging/soak                                                 | A04–A08, V07–V10, X01–X04 |
| R15 | `GET /api/admin/smart-mix/status` counts ~48K `library_tracks` on every request                            | SM05                      |
| R16 | Plans: cache get/set per edge (up to 64 round trips) and `DELETE LIKE` in the request                      | SM06                      |
| R17 | Compatibles apply `LIMIT 500` before filtering eligibility                                                 | SM06                      |
| R18 | VDJ catalog walks and sorts `library_tracks` per page with unbounded OFFSET                                | P04                       |
| R19 | Catalog response exposes `path`; PAT search accepts `scope=federated`; suffix allowlist without method     | P02, P04                  |
| R20 | `policy.py` uses a −0.1 dBFS ceiling; the design sets ≤−1 dBTP                                             | SM03, A03                 |
| R21 | Spike: production origin by default, no login, log redaction has no effect, race when cancelling a search  | V02–V03                   |
| R22 | C++ tests using `assert` check nothing in Release                                                          | V01                       |
| R23 | Online Source and AutoStart require a VirtualDJ Pro license; this was not in the documents                 | V02, V10                  |
| R24 | The SDK has no subfolders or pagination; P04/V03 assumed hierarchy and cursors                             | P04, V03                  |
| R25 | VDJ persists the cover URL and analyses tracks with its own grid/key                                       | V03, V05, V06             |
| R26 | Renaming the plugin orphaned its entries in `database.xml`                                                 | V02, V10                  |
| R27 | Android applies the plan gain as a constant during the fade and jumps to unity when it ends (a ~3 dB step) | A03                       |
| R28 | With the screen off the WebView freezes: no replanning and no radio/infinite refill                        | A09–A10                   |

## 2. Common preparation and verification

### C00: Freeze the operational baseline and preserve changes

**Status:** pending when implementation starts. **Files:** this plan, the design, local Git inventory and existing test tooling. No functional changes.

1. From the worktree, run `git status --short`, `git rev-parse HEAD`, `git branch --show-current`, `git worktree list` and `git log --oneline origin/main..HEAD`. Record the working tree and check the untracked modules; do not dump secrets or the contents of `.env`.
2. Record the divergence using local references and decide whether to bring in main before assigning migrations. Update remote references only if the execution requires it; do not mistake the 7/25 from the review for a permanent figure. Resolve any integration in isolation, preserving the WIP snapshot; do not automatically rebase other people's work.
3. Confirm the repo toolchains and dependencies: Python 3.13/requirements, Cargo lock, Node/package-lock, JDK/Android SDK pinned by the build, current Media3 and CMake/private SDK. The `java` command was not configured during the review; do not record that as a Gradle failure or update dependencies to work around it.
4. Bring up **ephemeral, exclusive** PostgreSQL/Redis, without prod/dev volumes and on a free port. Export only the test variables expected by `app/tests/conftest.py` and `postgres_test_database.py`; verify the `crate_test` name and the clone protection. Do not depend on an inherited DB_URL. Document the exact sanitized commands and the teardown of your own resources.
5. Rerun the focused core/PAT suites and CTest. Turn each of the manual reproductions R01–R11 into a test within its package; do not require the whole physical matrix to open a backend fix PR.

**DoD:** inventory preserved, services isolated, toolchains identified and current baseline noted in §8. Differences since the review are incorporated before marking tasks.

### Base commands

The following commands run from the root unless stated otherwise. They do not authorize a deploy or a run against production. Install dependencies from the lockfile before testing; check that a new test is registered and actually runs.

```sh
PYTHONPATH=app python -m pytest -q app/tests/test_smart_mix_models.py app/tests/test_smart_mix_planner.py app/tests/test_smart_mix_api.py
PYTHONPATH=app python -m pytest -q app/tests/test_access_token_auth.py app/tests/test_access_token_api.py app/tests/test_vdj_catalog.py app/tests/test_media_access_tickets.py
cargo test --manifest-path tools/crate-cli/Cargo.toml --no-default-features --features analysis
npm run --workspace=app/listen test -- src/lib/smart-mix.test.ts src/lib/android-native-engine.test.ts src/contexts/player-engine-adapter.test.ts
cmake -S tools/vdj-plugin -B build/vdj-headless -DCRATE_VDJ_BUILD_REAL_PLUGIN=OFF -DCRATE_VDJ_BUILD_TESTS=ON
cmake --build build/vdj-headless --parallel 4
ctest --test-dir build/vdj-headless --output-on-failure
node scripts/check-docs.mjs
```

From `app/listen/android`: `./gradlew :app:testDebugUnitTest` for unit tests and `./gradlew :app:connectedDebugAndroidTest` for instrumentation on an explicitly selected device. From `app/readplane`: `go test ./internal/routes ./internal/catalog ./internal/snapshots` when its contract is touched. Add Ruff/Pyright and the existing frontend checks according to the affected files; do not replace the repository gates with this minimal list.

The existing targets `make cap-android-smart-mix-artifacts` and its local test variant produce an APK explicitly pointed at dev. The `prod-artifacts` variant requires an explicit choice of environment and is not part of the default CI. `make vdj-test`, `vdj-build` and `vdj-package` are deliverables of V09/V10: do not assume yet that they exist.

## 3. Shared platform: P01 to P06

Each package starts with a focused regression/contract test that fails, implements the minimal change, runs its checks and records the commit/evidence in the canonical plan. The existing WIP is reviewed and completed; green isolated unit tests do not on their own complete a manual/SDK gate.

**Responsibility between packages:** P04 owns the folders and filters backend; P06 (backlog) owns the radio/presence backend. V09 implements the filters client and the CI/bench integration. Contracts and fixtures are shared, but these responsibilities are not duplicated across two tasks.

### P01: Pin integrated contracts, migration lineage and evidence manifest

**Depends on:** C00 and the canonical integrated design; can start without the native SDK being available.

**Files:** modify `app/crate/api/schemas/capabilities.py`, `app/crate/api/capabilities.py`, `app/crate/api/schemas/smart_mix.py`, `app/tests/test_vdj_contract_baseline.py`, `app/tests/test_smart_mix_openapi.py`, `app/tests/test_federation_migration_matrix.py`; review `app/crate/db/migrations/versions/090_smart_mix_profiles.py` and the WIP `091_user_access_tokens.py`. Update only the canonical design/plan and the compatibility manifest used by the native package release.

1. Record the branch, real HEAD and working tree inventory; use `docs/technical/smart-mix-design.md` and the canonical `smart-mix-implementation-plan.md` as the only active design/plan sources. Reviewed baseline: `140f9e34`; local main had revision 089, the committed worktree 090 and the WIP adds 091. Rerun `alembic heads` when implementing: these numbers are observations, not reservations of future migrations.
2. Pin in fixtures shared with the native clients the `2026-09` contract for routes/scopes/identity, schema `1` additions, grid `delta-ms-v1`, analyzer/implementation `smart-mix-audio-v2` and batch planner `smart-mix-v2`/plan and integer score `2`, keeping the current wire types, together with version compatibility, additive fields, errors and default flags. Include earlier Listen/Android payloads and the minimum/maximum plugin contracts supported.
3. Before adding cues/search schema, check the migration head and release history again. Only then assign the next available revision; do not fix 092/093 in advance. Renumber only a conflicting tail verified as not published/not applied, updating down-revision and tests together. Do not create convenience branch heads or rewrite deployed history.
4. Test a clean install, the supported upgrade chain including 103→104→105, repetition where supported and upgrading from the production schema fixture. Verify that users/library/sessions survive. Define rollback through compatible binaries/flags; a destructive downgrade will be an explicit recovery operation, not automatic deployment behaviour.
5. Include a completion manifest inside the canonical plan: requirement/owning task, artifact, contract version, tracked commit, automated evidence, native/manual evidence and pending limitations. Every accepted requirement for Android, A, B, C and extensions must map to tasks. Correctly mark untracked WIP and capabilities only demonstrated with mocks; obsolete plans are historical references, not competing sources of completion.

**Checks (from `app/`, isolated PG):** `alembic heads`; `python -m pytest -q tests/test_smart_mix_migration.py tests/test_federation_migration_matrix.py tests/test_vdj_contract_baseline.py tests/test_smart_mix_openapi.py tests/test_capabilities.py tests/test_vdj_capabilities.py`.

**Done when:** there is a single migration lineage and a canonical map of contracts/evidence; no task depends on an invented future revision or presumes that a mock proves platform support.

### P02: Complete least-privilege PATs and the connection UI

**Depends on:** P01.

**Files:** modify the WIP `app/crate/api/access_tokens.py`, `app/crate/api/schemas/access_tokens.py`, `app/crate/db/repositories/access_tokens.py`, `app/crate/api/auth.py`, `app/crate/api/permissions.py` where applicable, `app/crate/api/me.py`, `app/crate/api/schemas/auth.py`, `app/crate/api/__init__.py`; extend `app/tests/test_access_token_repository.py`, `app/tests/test_access_token_api.py`, `app/tests/test_access_token_auth.py`, `app/tests/test_auth.py`, `app/tests/test_play_event_contracts.py`. Create `app/listen/src/components/settings/AccessTokensSection.tsx` and its render test; integrate it into `app/listen/src/pages/Settings.tsx`; update the existing catalogs in `app/listen/src/i18n/catalogs/`. Coordinate the plugin's identity/login/credential store with the native package.

1. Replace permissive route-suffix authorization with a method/route/scope policy. Cover every allowed route and the neighbouring denied ones, missing scopes, suspended/deleted users, expired/revoked tokens and attempts to use the owner's Admin role. Preserve session/JWT permissions.
2. Add the PAT response for `/api/auth/me` and test connection identity without allowing token/profile/session mutations. Require `vdj.play_events.write` before any event write. Keep the future cues/radio routes denied until P06 implements their authorization. Record `vdj.automation` as legacy with no automatic equivalence to `vdj.automation.execute`, showing how to assign the new permission explicitly.
3. Remove `FOR UPDATE` from authentication reads. Add a bounded conditional last-use update and concurrency tests that tell authentication throughput apart from rotation atomicity. Verify the effect of revocation on later reads/ticket requests; keep rotation atomic and isolation per owner.
4. Implement the create/list/rotate/revoke UI with name, explanation of scopes, expiry, prefix and last-used. Show the secret only in the create/rotate result; clear it on close/unmount or when switching account/server. Copy it only through a user action and show useful rotation/revocation errors. No PAT in URL/localStorage/sessionStorage, automatic clipboard writes or logs.
5. Connect the plugin's real login/token entry UI and account information callbacks to the same contracts and to the OS credential store. Test valid/invalid token, missing scopes, incompatible server contract, cancellation, account/server switch and reconnection after rotation. The server/UI can finish before the SDK is verified, but the integrated connection flow is not complete until it passes the native check.

**Checks:** from `app/`, `python -m pytest -q tests/test_access_token_repository.py tests/test_access_token_api.py tests/test_access_token_auth.py tests/test_auth.py tests/test_play_event_contracts.py`; from the root, `npm run --workspace=app/listen test -- src/components/settings/AccessTokensSection.test.tsx src/pages/Settings.test.tsx src/pages/Login.test.tsx` and `npm run --workspace=app/listen i18n:check`. Run the native login/credential tests identified in their package.

**Done when:** a normal user can create a token with scopes, connect, identify their account, rotate and revoke through a supported UI; forbidden operations fail before side effects; authentication no longer serializes every request on the token row.

### P03: Make routing and effective kill switches consistent

**Depends on:** P01, P02.

**Files:** modify `app/crate/config.py`, `app/crate/api/auth.py`, `app/crate/api/capabilities.py`, protected VDJ routes, `docker-compose.yaml`, `docker-compose.home.yaml`, `docker-compose.dev.yaml`, `data/caddy/Caddyfile.readplane.dev`, `app/tests/test_readplane_catalog_routing.py`, `app/tests/test_vdj_capabilities.py`; create `app/tests/test_vdj_feature_gates.py` and `app/tests/test_vdj_proxy_contract.py`. Touch Go auth/routes only if the measured readplane decision later requires parity.

1. Add a PAT bypass and routing for the tickets/media aliases ahead of the readplane in all three deployment shapes. Test valid/invalid opaque PATs, JWT, session cookies, unauthenticated artwork, exact-route tickets, HEAD and Range. Cover canonical search/profile/auth-me and the configured FastAPI/readplane availability policy.
2. Run real requests against the proxy using isolated FastAPI/readplane fixtures. Keep the configuration assertions as cheap checks, but do not treat them as proof of routing/authorization. Tell invalid credentials apart from an unavailable backend.
3. Apply the VDJ/assistant flags in server operations, keeping normal Listen/Android identity and playback unrelated to VDJ. Apply the independent flag to automation authorization; test combinations of flags/scopes and clients that keep a cache, in addition to the `/capabilities` result.
4. Expose in `/api/capabilities` the effective state of the automation flag and of the `vdj.automation.execute` scope for the token, with the same value the server enforces. There is no lease: Crate Automix checks this state before each track it enqueues (design §6.3). Test flag off, missing scope, revocation and a token without automation with an uncached response.
5. Measure FastAPI p50/p95/p99 for search, profile summary, compatible context, plan batch and stream authorization with representative catalog size and concurrency. If it meets the existing SLOs, record FastAPI as the supported VDJ route. If not, implement Go parity with the same fixtures before changing routing; do not rewrite the readplane unconditionally. Share the evidence with V09, which owns client/CI/bench integration.

**Checks (from `app/`, isolated services):** `python -m pytest -q tests/test_readplane_catalog_routing.py tests/test_vdj_proxy_contract.py tests/test_vdj_feature_gates.py tests/test_vdj_capabilities.py`; if Go routing/auth changes, from `app/readplane/`, `go test ./internal/auth ./internal/routes ./internal/catalog ./internal/contract`. Record real flag-change scenarios in the native executor evidence.

**Done when:** prod/home/dev accept the same valid classes of credentials and reject the same invalid ones; disabling VDJ or automation takes effect on the server and on the plugin's next capabilities refresh.

### P04: One-level VDJ folders and DJ search with filter syntax

**Depends on:** P01, P02. Can run in parallel with P03. P04 is the only backend owner of folders and filters; V09 consumes the contract and covers client/CI/bench.

**Files:** modify the WIP `app/crate/api/vdj_catalog.py`, `app/crate/api/schemas/vdj_catalog.py`, `app/crate/db/queries/vdj_catalog.py`, `app/crate/api/browse_media.py`, `app/crate/api/schemas/media.py`, `app/crate/db/queries/browse_media_search.py`, `app/tests/test_vdj_catalog.py`, `app/tests/test_browse_queries.py`, `app/tests/test_browse_schemas.py`; create `app/tests/test_vdj_search_filters.py` and `app/tests/test_vdj_catalog_queries.py`. Add indexes justified by measurements in `app/crate/db/migrations/versions/` only when P01 assigns a real revision. Coordinate `tools/vdj-plugin/src/client/catalog_client.cpp` and `search_client.cpp` with the native package.

1. One-level folders according to design §6.5, because the SDK does not support subfolders: one per authorized playlist (order preserved, split into numbered parts of 500 if longer), Genres, Moods, Recently played and Compatibles. Respect ownership/membership and local availability; bounded responses for empty/deleted folders and missing metadata. Remove `path` from the response.
2. Unify genre selection and filtering so that tracks classified only through `album_genres` still appear. Test real SQL with isolated data for raw, inherited, normalized and missing genres; cover moods and the per-entity references of recently-played.
3. Replace the unbounded OFFSET with queries bounded to 500 tracks per folder or part, with deterministic ordering. No cursors: the SDK cannot request next pages.
4. Add to search the filter syntax inside the text (`artist:`, `album:`, `bpm:120-128`, `key:8A`, `energy:`, `analyzed:no`) and the `fields=dj` projection, with a maximum of 50 results. Require local scope for VDJ PATs on the server. Keep the legacy response/order when there is no DJ syntax and check Listen for regressions.
5. Run representative query/latency plans with 48K tracks before adding indexes. Do not aggregate the whole listening history for ordinary folders; load only the requested folder.

**Checks (from `app/`, isolated PG):** `python -m pytest -q tests/test_vdj_catalog.py tests/test_vdj_catalog_queries.py tests/test_vdj_search_filters.py tests/test_browse_queries.py tests/test_browse_schemas.py tests/test_catalog_local_browse.py`.

**Done when:** the plugin walks playlists, genres, moods, recent and compatibles, and finds artists and albums through search with filter syntax; normalized metadata and visibility match search; the SQL is covered by tests with a DB and bounded to 500 tracks per response.

### P05: Prove media delivery, ranges and revocation

**Depends on:** P01, P02, P03; completing a load on a real deck depends on the native media/cache package.

**Files:** modify `app/crate/api/media_access.py`, `app/crate/media_access.py`, `app/crate/api/browse_media.py`, `app/crate/api/browse_album.py`, `app/crate/api/schemas/media.py`, `app/tests/test_media_access_tickets.py`, `app/tests/test_vdj_stream_scope.py`, `app/tests/test_artwork_route_delivery.py`; create `app/tests/test_vdj_media_contract.py`. Coordinate the existing `tools/vdj-plugin/src/client/media_access_client.cpp`, `stream_resolver.cpp` and the native cache/prefetch implementation.

1. Test ticket issuance and real use together: exact route/audience, owner, expiry, revocation, suspension, scope change, storage failure, bounded number of targets and no credentials in diagnostics. Confirm that Listen session tickets keep their behaviour.
2. Align the resolution payload, the media alias and the plugin resolver on delivery policy, preparing state, local identity and allowed origin. Validate headers/status instead of accepting any non-empty body. The API keeps read-only access to the music filesystem; preparation writes stay in worker tasks.
3. Serve and verify GET/HEAD, full/partial/suffix ranges, invalid ranges, seeking, large files and interrupted transfers through the real proxy. Cover expiry/revocation before the first request and between ranges. Specify that an already authorized response may finish; do not promise recovery of bytes already delivered.
4. Set the VDJ ticket TTL so that it covers the full initial download (initial value 15 minutes, adjusted with the VH01 measurement), keeping exact route, token identity and per-request revocation. If VH01 shows Range requests after the ticket expires, implement the mechanism that the gate validates before closing A.
5. Verify at the same time continuity of the loaded track and denial of new loads without authorization. Coordinate prefetch cancellation and the absence of tickets in persistent caches/spools; redact PATs, tickets and signed URLs on every success/error path.

**Checks (from `app/`, isolated services):** `python -m pytest -q tests/test_media_access_tickets.py tests/test_vdj_stream_scope.py tests/test_vdj_media_contract.py tests/test_artwork_route_delivery.py`. Run native stream/cache tests and record real SDK seek/expiry/revocation/offline load scenarios in the release matrix.

**Done when:** an authenticated track loads and allows seeking with bounded-lifetime credentials, expired/revoked credentials do not authorize new requests and continuity of already loaded audio is demonstrated without long-lived credentials in URLs.

**Additional P05 contract:** album covers are public and VDJ persists their URL: the plugin receives absolute URLs without a ticket and PAT tickets are not extended to artwork. `offlineEligibleUntil` stays in the backlog with V08.

### P06: Complete the backend for cues, radio, now-playing and idempotent telemetry

**Depends on:** P01, P02; closing the cues integration requires SM03/SM06 already verified with fixtures. Uses local identity/visibility from P04 and playback provenance from P05; its integration with flags depends on P03. P06 is the only owner of these backend endpoints/services; V07 implements their native clients.

**Files:** modify `app/crate/api/smart_mix.py`, `app/crate/api/me.py`, `app/crate/api/schemas/me.py`, `app/crate/db/repositories/user_library_playback_writes.py`, `app/crate/api/radio.py`, `app/crate/radio_engine.py`, `app/crate/db/repositories/radio.py`, `app/crate/api/auth.py`, `app/crate/metrics.py`, `app/crate/api/__init__.py`; extend `app/crate/api/dj.py` and `app/crate/api/schemas/dj.py` from P03; create `app/crate/db/orm/cue_points.py`, `app/crate/db/repositories/cue_points.py`, `app/crate/services/dj_presence.py` and the cues migration with the revision assigned in P01. Extend `app/tests/test_play_event_contracts.py`, `app/tests/test_radio_contracts.py`, `app/tests/test_shaped_radio_engine.py`; create `app/tests/test_dj_cue_points.py`, `app/tests/test_dj_now_playing.py`, `app/tests/test_dj_play_events.py`, `app/tests/test_vdj_security.py`, `app/tests/test_vdj_observability.py`.

1. Add read/upsert/delete of private cues per user and local entity UID with an expected revision, conflict responses and monotonic revisions. Keep the profile's automatic cues global and untouched; the deterministic merge keeps the overrides private. Integrate applicable overrides with the planner's shared contract and the cache identity, carrying the cues revision so that a stale plan is rejected after cues are edited. Test ownership, stale writes/plans, isolation between users in the plan cache, deleted entities, offline cache reads and the absence of any extra dependency during deck loading.
2. Reuse the radio endpoints/engine and add an explicit owner to the next/feedback/end service calls. Expose them to PATs only with `vdj.radio`; apply local candidates and expiry/concurrency semantics. Preserve Listen behaviour and feedback effects for valid owners.
3. Implement ephemeral presence with user/client/deck isolation, bounded fields/rate, a 30-second heartbeat and a 90-second TTL. Missing presence or a Redis outage must not stop playback; avoid unbounded metric cardinality.
4. Require a stable VDJ `client_event_id` and the telemetry scope before calling the current repository. Specify the audible threshold in the shared contract, test repetition of identical events and ID reuse with a conflicting payload, and guarantee that each accepted event produces each downstream effect exactly once. Keep a bounded native retry spool without credentials.
5. Complete abuse/observability coverage for scopes, cues/radio ownership, cursor parsing, ticket replay/expiry, redirects/TLS, excessive metadata, corrupt cache and log redaction. Emit bounded request/fallback metrics with contract/plugin/planner versions; no tokens, user text or entity UIDs as unbounded-cardinality labels.

**Checks (from `app/`, isolated PG/Redis):** `python -m pytest -q tests/test_smart_mix_api.py tests/test_dj_cue_points.py tests/test_dj_now_playing.py tests/test_dj_play_events.py tests/test_play_event_contracts.py tests/test_radio_contracts.py tests/test_shaped_radio_engine.py tests/test_vdj_security.py tests/test_vdj_observability.py tests/test_access_token_auth.py tests/test_federation_migration_matrix.py`.

**Done when:** every accepted extension works through the current user/library contracts, isolation and idempotency withstand retries/concurrency, and a telemetry/cues failure cannot take over a deck or delay loaded audio.

## 4. Smart Mix core: SM01 to SM07

The following paths are relative to the root of the active worktree. Each task starts with a reproduction that fails because of the identified behaviour, continues with the minimal change and ends by running the affected suites. Tests that already exist do not need to be redone. Commits are grouped by task and include no automatic attribution. `pytest` runs with the working environment's Python; closure uses Crate's isolated test stack, never production credentials/DB. The contract tasks coordinate their changes with the Android and VDJ blocks of the consolidated document.

### SM01: Implement provenance and persistence under the P01 contracts

**Depends on:** P01, which closes global versions/contracts and reserves the migration chain. **Unblocks:** SM02–SM06 and client adapters.

**Modify:** `app/crate/smart_mix/models.py`, `app/crate/smart_mix/policy.py`, `app/crate/api/schemas/smart_mix.py`, `app/crate/api/schemas/capabilities.py`, `app/crate/api/capabilities.py`, `app/crate/db/orm/smart_mix.py`, `app/crate/db/repositories/smart_mix.py`, `app/crate/db/repositories/library_analysis_writes.py`, `tools/crate-cli/src/mix_profile.rs`.

**Create:** a new revision in `app/crate/db/migrations/versions/` with the next free number, identified in the commit itself as `smart_mix_measurement_provenance`.

**Tests:** `app/tests/test_smart_mix_models.py`, `test_smart_mix_repository.py`, `test_smart_mix_migration.py`, `test_smart_mix_openapi.py`, `test_capabilities.py`, `test_vdj_capabilities.py`, `test_federation_migration_matrix.py`, `tools/crate-cli/tests/smart_mix_analysis.rs`.

1. RED: roundtrip of a decoder duration that differs from `library_tracks.duration`; measurement/limit fields missing in legacy; rejection of NaN/infinity/non-positive BPM, a cue beyond duration and unknown producer/version where they require degradation. Characterize the v1 contract that the WIP consumes today.
2. Run `PYTHONPATH=app python -m pytest -q app/tests/test_smart_mix_models.py app/tests/test_smart_mix_repository.py app/tests/test_smart_mix_migration.py app/tests/test_smart_mix_openapi.py` and confirm the specific new failure; do not mistake a skip caused by missing PG for a useful RED.
3. Add optional fields and persistence of the exact duration, reuse the P01 version constants and create the additive migration in the position it reserved. Do not modify 090 or delete legacy data. Keep the codec golden.
4. Implement the negotiated versions and compatibility from P01; update the backend capabilities/OpenAPI adapters and their matrices in coordination with the owner of the global contract. Keep `profileVersion:1` additive and the batch `smart-mix-v2`/integer plan `2` mapping, separate from the schema.
5. GREEN: repeat the suite and `PYTHONPATH=app python -m pytest -q app/tests/test_capabilities.py app/tests/test_vdj_capabilities.py app/tests/test_federation_migration_matrix.py` with an isolated DB. `cargo test --manifest-path tools/crate-cli/Cargo.toml --no-default-features --features analysis` validates the Rust contract.

**DoD:** schema, ORM, JSON and fixtures agree; readers tell legacy apart from verified measurements; migration up and down on test clones; capabilities do not enable features merely because columns exist.

### SM02: Measure multichannel loudness/true peak and bound the DSP

**Depends on:** SM01. **Unblocks:** publication of corrected profiles, planner staging gates.

**Modify:** `app/crate/smart_mix/analyzer.py`, `app/crate/smart_mix/cue_detection.py`, `app/crate/audio_analysis.py`, `tools/crate-cli/src/analyze.rs`, `tools/crate-cli/src/mix_profile.rs`, `tools/crate-cli/Cargo.toml`, `app/requirements-worker-analysis.txt` and the image build configuration that the chosen dependency requires.

**Create:** `app/crate/smart_mix/loudness.py`, `app/tests/test_smart_mix_loudness.py`; a dedicated Rust adapter if it avoids mixing the meter with beat detection.

**Existing tests:** `app/tests/test_smart_mix_audio_analysis.py`, `test_smart_mix_rust_parity.py`, `test_audio_analysis.py`, `tools/crate-cli/tests/smart_mix_analysis.rs`.

1. RED: out-of-phase stereo `L=0.9*sin`, `R=-0.8*sin` whose per-channel peak cannot become the peak of the mean; a fixture with an intersample peak, silence, a single channel, windows with different loudness, a short file and a tail after minute 120. Expectations come from the oracle, not from the same helper under test.
2. Run `PYTHONPATH=app python -m pytest -q app/tests/test_smart_mix_loudness.py app/tests/test_smart_mix_audio_analysis.py` and record that the current measurement fails.
3. Bring in a real meter, preserve channels for its analysis and keep mono only for features that require it. Emit `measurementVersion`, null out data that was not measured and version the analyzer. Define windows with reproducible duration/position; validate the build/license of the chosen dependency before updating lockfiles.
4. Implement a bounded decoder/scan: per-track budgets, reading in blocks or windows and a strategy for long durations. Share/cache features from a single decode when possible; avoid repeating FFT/onset/key over the whole audio without need.
5. GREEN Python/Rust: `cargo build --manifest-path tools/crate-cli/Cargo.toml --no-default-features --features analysis`, then `PYTHONPATH=app python -m pytest -q app/tests/test_smart_mix_loudness.py app/tests/test_smart_mix_audio_analysis.py app/tests/test_smart_mix_rust_parity.py app/tests/test_audio_analysis.py` and `cargo test --manifest-path tools/crate-cli/Cargo.toml --no-default-features --features analysis`.
6. The parity test fails if the binary is missing in core CI; a local skip is still allowed with an explicit reason. Pin tolerances in the fixtures and the meter contract: initial proposal ±0.1 LU on controlled fixtures and ±0.1 dBTP against the compatible oracle, confirmed by its precision. Do not carry those tolerances over to BPM/key without their own independent protocol.

**DoD:** both backends measure the same quantities, pass out-of-phase/intersample/silence, do not publish RMS as LUFS, do not load unbounded durations and produce a real parity artifact. The cost baseline is handed to SM07.

### SM03: Fix transition limits, phase and effective cues

**Depends on:** SM01 and SM02 fixtures. **Coordinates with:** Android models/engine and private cue resolution in VDJ block C.

**Modify:** `app/crate/smart_mix/planner.py`, `app/crate/smart_mix/policy.py`, `app/crate/smart_mix/models.py`, `app/crate/api/smart_mix.py`, `app/crate/api/schemas/smart_mix.py`.

**Tests:** `app/tests/test_smart_mix_planner.py`, `test_smart_mix_api.py`, `test_smart_mix_models.py`.

1. Parametrized RED: 180 s outgoing/176 s cue with a 12 s fade; short incoming or a cue close to the end; ratios 0.94/1/1.06; leading/trailing silence; half/double grids; explicit private cues; missing profiles/duration; outgoing and incoming anchors with different phases.
2. Run `PYTHONPATH=app python -m pytest -q app/tests/test_smart_mix_planner.py` and confirm that the new temporal invariants fail on the current code.
3. Implement pure resolution of limits/cues and duration. Check that `cue + audio consumed by the fade` falls within the usable interval of each track after the tempo/phase adjustment. Keep the intent of private cues, the audible body and album/manual defaults; degrade when there is no safe interval.
4. Compute the offset using both grids and their effective time. Use verified measurements for gain staging; missing legacy data does not allow an optimistic boost. Generate the planner v2 revision and compatible reasons.
5. Add properties over many bounded combinations: no negative cue, no handoff after the outgoing track or consumption after the incoming one, bounded ratio, same input produces same output, immutable global profiles. Do not require every case to produce beatmatch.
6. GREEN: `PYTHONPATH=app python -m pytest -q app/tests/test_smart_mix_planner.py app/tests/test_smart_mix_api.py app/tests/test_smart_mix_models.py`. Hand JSON fixtures with expected results to engines/clients to avoid reinterpretations of milliseconds vs frames.

**DoD:** the 180/176/12 case no longer produces an unviable plan; both ends and tempo/phase are covered; unknown/legacy degrades with a reason; the pure interface accepts already resolved/authorized cue values and its fixtures pass. Integration with their private persistence is closed in the corresponding VDJ task, without creating a circular dependency with the core.

### SM04: Publish correct profiles for the source and allow promotions

**Depends on:** SM01–SM02. **Unblocks:** SM05 and the reanalysis rollout.

**Modify:** `app/crate/db/jobs/analysis_storage.py`, `app/crate/db/repositories/smart_mix.py`, `app/crate/db/repositories/library_analysis_writes.py`, `app/crate/worker_handlers/analysis.py`, `app/crate/audio_analysis.py` and the Rust result wiring in those modules.

**Create:** `app/tests/test_smart_mix_publication.py` for races with two real sessions/connections; extract a publication-specific helper if it keeps the module readable.

**Existing tests:** `app/tests/test_smart_mix_analysis_storage.py`, `test_smart_mix_repository.py`, `test_smart_mix_backfill.py`.

1. RED: file change between capture and store, path reassigned to the same track, old job after a winner, loss of claim, identical retry, `crate-python/partial → crate-rust/full`, same source with a new analyzerVersion, transient failure after a valid full.
2. Run `PYTHONPATH=app python -m pytest -q app/tests/test_smart_mix_publication.py app/tests/test_smart_mix_analysis_storage.py` on an isolated DB. Mocks are fine for function reproductions, but they do not prove the CAS/concurrency.
3. Carry the captured context and define a stable capture mechanism for the existing writers. Open a transaction only to validate identity/claim/expected revision and publish. Use CAS or a row lock plus an equivalent condition; do not hold a PostgreSQL transaction during DSP/decoding.
4. Fix idempotency and the promotion/replacement policy: same source+implementation+config does not change; partial→full allowed; legacy/full from a different source is not considered current; a failure keeps useful history without falsifying state.
5. Complete only the owner's claim, emit invalidation for the new revision and do not emit a ready event for a discarded publication. Enqueue a new generation when the source changed without consuming decoder retries as if it were an audio error.
6. GREEN: repeat the suite plus `PYTHONPATH=app python -m pytest -q app/tests/test_smart_mix_repository.py app/tests/test_smart_mix_backfill.py`; crash windows and two connections must produce a single winner and a consistent state.

**DoD:** an old draft is not stored as a new source, a Rust full is not lost because it shares the version string with Python, a loser does not complete claims it does not own and there is no DSP inside a transaction.

### SM05: Backfill by generation, operational control and source invalidation

**Depends on:** SM04. **Coordinates with:** the existing scheduler/resource governor and Admin status.

**Modify:** `app/crate/db/jobs/smart_mix_backfill.py`, `app/crate/worker_handlers/analysis.py`, `app/crate/db/queries/smart_mix_admin.py`, `app/crate/api/smart_mix_admin.py`, `app/crate/api/schemas/smart_mix_admin.py`; add target/claim metadata in a new migration only if the adopted protocol needs it. When the audio replacement writers are identified, modify their specific invalidation points within `app/crate/worker_handlers/` and the existing sync/repositories, not a new parallel process.

**Tests:** `app/tests/test_smart_mix_backfill.py`, `test_smart_mix_admin.py`, `test_smart_mix_analysis_storage.py`, `test_smart_mix_publication.py`, existing tests for the writers touched.

1. RED: a v1 profile with processing done must be claimed for target v2; a replaced source is reanalysed; an exhausted retry for the old target does not block the new one; two workers do not process the same target; an expired claim recovers its owner; pause/resume/cancel with children already enqueued.
2. Run `PYTHONPATH=app python -m pytest -q app/tests/test_smart_mix_backfill.py app/tests/test_smart_mix_admin.py` with test PostgreSQL.
3. Include the target generation in eligibility, dedup and checkpoint. Keep the priorities and the limit of 100. Reset the attempts budget only when the target changes, not on every resume click. Document who enqueues the next batch and when the campaign ends; the status does not present a single batch that has already finished as a running campaign.
4. Connect source/implementation-change invalidation; do not recompute profiles on GET. Define the pausing of new claims and the precise behaviour of the current batch. Cancelling does not destroy profiles; resuming does not duplicate active work.
5. Adjust status/coverage to current profiles versus stale/legacy/failed/exhausted. Record counters for claimed/completed/promoted/stale-discard/retry-exhausted and reasons; no protected path or token in logs.
6. GREEN: the previous suites plus publication and tests for each writer touched. Run a bounded local canary, interrupt it and resume it, verifying checkpoint and convergence; record quantity and target, without launching the full catalog to test control.

**DoD:** migration of versions and sources converges, pause/resume/cancel are real, retries do not revive indefinitely and status reflects the correct target. Rollout can start before 100% coverage; pending tracks degrade.

### SM06: Deliver versioned plans and candidates with a coherent cache and readplane

**Depends on:** SM03–SM04. **Coordinates with:** VDJ auth/scopes and the Android/VDJ client contracts. The cue resolution port is tested here with fixtures of authorized values/revisions; the persistence implementation and the real integrated test belong to P06/V07, which depends on the core and not the other way round.

**Modify:** `app/crate/api/smart_mix.py`, `app/crate/api/schemas/smart_mix.py`, `app/crate/db/cache_store.py`, `app/crate/db/queries/smart_mix_compatible.py`, `app/crate/smart_mix/compatible.py`, `app/readplane/internal/routes/smart_mix.go`, `app/readplane/internal/catalog/smart_mix_store.go`, `app/readplane/internal/snapshots/smart_mix.go` and existing summary adapters/contracts.

**Tests:** `app/tests/test_smart_mix_api.py`, `test_smart_mix_openapi.py`, `test_smart_mix_compatible_tracks.py`, `test_smart_mix_compatible_service.py`, `test_smart_mix_compatible_query_plan.py`, `test_vdj_contract_baseline.py`, `test_readplane_catalog_routing.py`, `app/readplane/internal/{routes,catalog,snapshots}/smart_mix*_test.go`.

1. RED: the same pair with a different profile/cue revision or user does not share an incorrect plan; cached v1 is not served as v2; an unknown version fails/degrades according to the contract; the summary response omits the grid; token scope and session keep the established permissions. Do not duplicate or replace the auth mechanism that VDJ develops.
2. Run `PYTHONPATH=app python -m pytest -q app/tests/test_smart_mix_api.py app/tests/test_smart_mix_compatible_tracks.py app/tests/test_smart_mix_openapi.py`.
3. Include policy revision, source/profile, resolved cues and context/owner in keys where appropriate. Resolve private cues before the pure planner. Keep a maximum batch of 32, a maximum of 500 candidates and responses without credentials. Invalidate the cache by identity, without indiscriminately purging Redis.
4. Move local eligibility/quarantine/availability before the candidate limit and ensure the queries do not turn into N+1 or read grids. Characterize the current weights, dedup and tie-break; do not use this work to introduce another ranking formula.
5. Apply summary/version parity in FastAPI and the readplane; unknown versions do not become full profiles. Complete the federation summaries required by the original scope using existing contracts; detailed grids are not replicated to every global row and VDJ `scope=local` remains local.
6. GREEN: API/ranking/routing suites and, from `app/readplane`, `go test ./internal/routes ./internal/catalog ./internal/snapshots`. Keep the existing Go session/JWT routes correct. PAT acceleration in Go can remain unimplemented if FastAPI meets the SLO and routing is consistent; that does not prevent closing the feature.

**DoD:** old and new clients receive compatible and authorized plans; private preferences do not contaminate other sessions; changed data does not reuse old plans; ranking stays bounded and semantically stable; FastAPI/readplane match or the new route stays on FastAPI until it passes parity.

**Mandatory federated path for SM06:** modify `app/crate/db/queries/federation_manifest.py`, `app/crate/db/jobs/federation_catalog_changes.py`, `app/crate/db/repositories/federation_catalog.py` and the remote profile adaptation. Create `app/tests/test_smart_mix_federation.py`; extend `app/tests/test_federation_catalog_delta.py` and `app/tests/test_federation_catalog_change_producer.py`. RED: publishing a new profileRevision without changing track metadata produces a delta and then a new remote plan, never reusing the old revision. GREEN: snapshot/delta contain an optional versioned summary and ingestion tolerates legacy peers without grid/private cues/paths. Run the three tests with isolated PG and repeat the remote planning contract. The existing Go session/JWT parity is mandatory; Go PAT auth/routing is an optimization conditional on the SLO, not a mandatory pending item if FastAPI meets it. Add `app/crate/api/federation.py`, `app/crate/db/repositories/global_catalog_dirty_sources.py`, `app/crate/worker_handlers/federation.py` and `app/crate/db/jobs/global_catalog_reconciliation.py` to that path. After the winning CAS, enqueue `enqueue_local_dirty_source` in the same transaction to emit a delta with the new profileRevision; do not emit for a no-op/lost CAS. Snapshot goes through `_sync_single_peer_catalog`/`upsert_catalog_item`; delta through `_sync_peer_catalog_delta`/`apply_federation_delta_page`. Ingestion validates the summary in raw_json and projects the remote revision. Also extend `app/tests/test_federation_catalog_sync_resume.py` with idempotent replay, tombstone and a peer without a summary.

### SM07: Reproducible benchmarks, audio matrix and core gates

**Depends on:** SM01–SM06. **Integrates with:** the final Android and VDJ verifier.

**Create/reuse according to the consolidated lab block:** `tools/smart-mix-lab/benchmark_server.py`, `tools/smart-mix-lab/benchmark_analysis.py`, `tools/smart-mix-lab/schemas/release-gates-v1.json`, `tools/smart-mix-lab/tests/test_benchmark_contract.py`.

**Modify:** `.github/workflows/test-backend.yml`, `.github/workflows/test-native-tools.yml`, `.github/workflows/test-readplane.yml`, `Makefile`, current query/parity tests. The global verification script must be unique and shared with the Android/VDJ blocks.

1. RED: the results parser rejects samples without hardware/version/dataset/warm-up, a percentile above the threshold, a skipped Rust suite or an audio fixture that is declared but not run. Generate small fake results to test the verifier; those results do not count as performance evidence.
2. Implement fixtures of 48K profiles for the server and a reproducible audio corpus: deterministic synthesized material plus real samples with identified usage rights. Include very short/long fades, silence, contrasting/out-of-phase stems, variable tempo, ambiguous key and long durations.
3. Measure cached/uncached/ranking with limits of 50/150/250 ms p95, declared warm-up and load; measure analyzer time/RSS for normal and long tracks on the target worker. Keep comparisons against a baseline from the same host. Instrument decoder errors, stale publication, fallback reason and cache hit/miss, without protected URLs.
4. GREEN: `PYTHONPATH=app python -m pytest -q tools/smart-mix-lab/tests/test_benchmark_contract.py`. Create the CLIs with explicit options for the following scenarios and run them, with the environment pointing at the isolated stack: `PYTHONPATH=app python tools/smart-mix-lab/benchmark_server.py --fixture representative-48k --warmup 100 --iterations 1000 --concurrency 16 --output /tmp/smart-mix-server-benchmark.json` and `PYTHONPATH=app python tools/smart-mix-lab/benchmark_analysis.py --fixture generated-v1 --long-duration-seconds 7200 --output /tmp/smart-mix-analysis-benchmark.json`. The first reports cached batch32, uncached batch32 and compatible500 separately; the second generates the sources in blocks and adds the real corpus identified in the lab manifest. The CLI must require an isolated test DSN or a local corpus, reject production targets by default and not auto-provision on the application DB. Each JSON records the effective command and scenario.
5. Close the suites: `make dev-test-backend`, `cargo test --manifest-path tools/crate-cli/Cargo.toml --no-default-features --features analysis`, `cargo clippy --manifest-path tools/crate-cli/Cargo.toml --no-default-features --features analysis -- -D warnings`, `cargo fmt --manifest-path tools/crate-cli/Cargo.toml -- --check`; readplane through its existing target or `go test ./...` from `app/readplane`. Confirm that no other agent was using the fixed `crate-test` stack before the target that recreates it, or use an equivalent isolated project/ports.
6. Store artifacts with commit SHA + WIP diff, command, environment, date and result. Repeat when DSP/policy/publication change; do not repeat indiscriminately when nothing relevant changes. The release verifier consumes these artifacts together with the engine's physical ones.

**DoD:** CI runs and validates the core evidence, without treating skips or mocks as real acceptance; the original budgets are measured. Partial rollout can continue with flags off, but the final report explicitly distinguishes existing code, tests run and pending acceptance.

## 5. Native Android: A01 to A08

In this block, `JAVA` abbreviates `app/listen/android/app/src/main/java/app/cratemusic/crate/`, `UNIT` abbreviates `app/listen/android/app/src/test/java/app/cratemusic/crate/` and `DEVICE` abbreviates `app/listen/android/app/src/androidTest/java/app/cratemusic/crate/`. These are existing directories; the classes marked as Create are proposals.

### A01: Take planning out of startup and make offline real

**Depends on:** P01; integrate corrected plans after SM06. **Modify:** `app/listen/src/lib/smart-mix.ts`, `android-native-engine.ts`, `playback-engine.ts`, `app/listen/src/contexts/player-engine-adapter.ts` and their existing tests. **Create:** `app/listen/src/lib/smart-mix-plan-cache.ts` and its test only if separating the cache simplifies the current client.

1. RED with an API promise that never resolves: starting the queue/playing does not wait for the plan. Offline does not issue a request; the deadline cancels; a change of user/origin/queue/cue discards the old result; disabling Smart Mix also cancels.
2. Run the client and adapter tests from the base commands and check the startup/offline failures, not a global runner timeout.
3. Separate media loading from plan preloading; queue/play does not `await Promise.all(streams, plans)`. Limit to the next 3 edges, dedup, a 1 s deadline and a real AbortSignal; install results only if the generation and conditions are still current and the transition has not started.
4. Reuse the cache with a key of versions/context/provenance; offline uses a validated cache or an immediate fallback. Verify that getting a fallback is not retried in a loop and that reconnecting enables new generations.
5. Focused GREEN; run `npm run --workspace=app/listen typecheck`. A fake bridge integration proves that the first playback command precedes the planning result.

**DoD:** no music network dependency blocks play, offline does not call the server, stale requests/plans do not mutate the engine and no URLs/tickets are stored.

### A02: Prepare at the cue and execute only within both tracks

**Depends on:** A01, SM03/SM06. **Modify:** `JAVA/NativeMixController.java`, `ExoPlayerNativePlaybackDeck.java`, `NativePlaybackDeck.java`, `NativeTransitionPlan.java`, `NativeMixTiming.java`, `CrateNativePlaybackService.java`; tests `UNIT/NativeMixControllerTest.java`, `NativeMixTimingTest.java`, `FakeNativePlaybackDeck.java`, `DEVICE/ExoPlayerNativePlaybackDeckTest.java`.

1. RED: a deck that is initially ready and goes back to buffering after seek; incoming cue != 0; little buffer; short ending; late plan; duration 180/cue 176/fade 12; ratio 1.06; plan from another load/queue; repeat-one. The fake must model asynchronous preparation, not always return true.
2. Prepare the media and seek to the cue before emitting a valid ready. Readiness includes identity/generation, tolerated position and buffer after the seek; set a minimum initial margin of 1 s when enough audio remains and measure it in A06. Little buffer degrades/retries up to the cue deadline, never extends the outgoing track.
3. Trigger on the cue/current position and the executor's limits validator; shorten only under declared rules or fall back. Remove the artificial repeat-one and the global crossfade condition that fires too late. The decoder's effective data takes precedence over an approximate legacy duration.
4. Run the `./gradlew :app:testDebugUnitTest` suite and the instrumented real seek/buffer test. Record that play is not emitted before the new readiness.

**DoD:** the transition never starts with a standby that is not prepared for its cue, does not exceed the time limits and ordinary playback remains available if the plan fails.

### A03: Full envelope in PCM, gain and clipping

**Depends on:** A02 and SM02/SM03. **Modify:** `JAVA/NativeMixAudioProcessor.java`, `NativeMixController.java`, `ExoPlayerNativePlaybackDeck.java`, `CrateNativePlaybackService.java`; `UNIT/NativeMixAudioProcessorTest.java`, `NativeMixSignalTest.java`, `NativeMixControllerTest.java`. **Create:** `DEVICE/NativeMixEnvelopeTimingTest.java` and an envelope helper if it allows pure tests.

1. RED with deterministic PCM, variable buffer sizes, cancellation in the middle of a buffer, the main thread stalled for 250 ms and two correlated signals. The curve must continue by frames and fail with the current dependency on 20 ms ticks.
2. Schedule start/duration/curve/gains in the sample domain; a parameter snapshot with no allocations/I/O/blocking locks on the audio path. Volume/duck/cancel changes have a short controlled ramp and do not restart the whole transition.
3. Apply staging with verified peaks, headroom for EQ and a conservative fallback when measurements are missing; test clipping of the total mix, not only the range of each processor. Two AudioTracks are not presented as a common limiter that does not exist.
4. Signal/unit and instrumentation GREEN. Export WAVs of the fixtures to the A06 lab and measure true peak/continuity with an independent oracle. Review CPU/allocation traces under load.

**DoD:** the full fade does not depend on main, there are no clicks from parameter changes and the corpus meets staging; no test assumes that equal-power means no clipping.

### A04: Close lifecycle, session, queue and audible accounting

**Depends on:** A02–A03. **Modify:** `JAVA/CrateMixPlayer.java`, `NativeMixController.java`, `NativeTransitionStateMachine.java`, `CrateNativePlaybackService.java`, `CrateNativePlaybackPlugin.java`, `PlaybackCheckpointStore.java`, `NativePlaybackTelemetry.java`; existing tests for those classes and `DEVICE/CrateMixMediaSessionTest.java`; callback/visualization hooks in `app/listen/src/contexts/` and `src/lib/native-transition-visual.ts` if the contract changes.

1. RED for each interruption in each phase: pause/resume, seek, next/previous, queue replacement, repeat-one, deck error/end, focus loss/duck, call, route change/disconnection and service shutdown. Old callbacks after cancellation do not advance or publish progress.
2. Consolidate executionId/generations and a single owner of handoff/advance. Tell the metadata crossover apart from the audible end; report exactly one transition/advance with play events for audio that was actually audible. Do not count preloading as listening.
3. Keep the same facade/MediaSession, OS commands/capabilities, EQ and audio-session routing for both decks; preparing the next track does not recreate the notification. Persist a stable checkpoint and restore a deck without reviving a partial automation.
4. GREEN for unit + instrumented MediaSession + Vitest for callbacks/visualization. Test process death, auth renewal, downloaded playback and switching to streaming on the A06 device.

**DoD:** one session/notification, no double advance/duplicate play-event, continuous OS controls and deterministic recovery in every phase.

### A05: Settings, negotiation and persistent opt-out

**Depends on:** P01, A01–A04. **Modify:** `app/listen/src/pages/Settings.tsx`, `Settings.test.tsx`, `src/lib/player-playback-prefs.ts`, `player-playback-prefs.test.ts`, `android-native-engine.ts` and its test, `src/lib/smart-mix.ts`, the `src/i18n/catalogs/` catalogs; wiring of the existing capabilities and flags. **Create:** `src/components/settings/SmartMixSettings.tsx` and a render test if the extraction is useful and it is integrated into Settings.

1. RED: capable native Android shows the controls; a mobile browser does not enable them; desktop keeps its preferences; opt-out is not lost on refresh; duration 0 disables; a sequential album stays gapless; an unknown server/engine hides or explains the mode.
2. Implement the Smart Mix control, maximum duration, beatmatch and bass with the effective capability. Do not expose active toggles for ignored fields; the last two are enabled after A07/A08. Tell a local testing flag apart from a release capability, with no accidental bypass.
3. Migrate legacy preferences only once and keep an explicit choice. Cancel pending plans/transitions when disabling, using the safe A04 contract; a new profile version does not change consent.
4. GREEN for Settings/prefs/native tests; `npm run --workspace=app/listen i18n:check` and typecheck. Review label/state accessibility, persistence across restarts and account/origin.

**DoD:** the user can control and understand the available mode; opt-out is durable and there is no regression in other engines. The adaptive UI closes now; the beat/bass toggles close with their tasks.

### A06: Reproducible lab and physical adaptive gate

**Depends on:** A01–A05, SM07 for the corpus. **Create:** `tools/smart-mix-lab/generate_fixtures.py`, `capture_analysis.py`, `benchmark.py`, `tests/test_capture_analysis.py` and small data fixtures/manifests with licenses; not another decisions README. **Modify:** `Makefile`, Android instrumentation and telemetry to export bounded metrics.

1. Test the capture analyser with known delay/drift/clipping: it detects injected failures and does not produce a favourable metric for an empty, silent or misaligned capture. The test fixture/oracle does not share the implementation that production measures.
2. Generate deterministic 48 kHz clicks/pilots with fixed BPM/half-double/drift, silence, transients and stereo; add a licensed music corpus and correlated pairs. The manifest stores parameters/hash, not protected audio without a license.
3. Add the reproducible commands `python tools/smart-mix-lab/generate_fixtures.py --output artifacts/smart-mix/fixtures` and `python tools/smart-mix-lab/capture_analysis.py --manifest artifacts/smart-mix/fixtures/manifest.json --capture <capture.wav> --output artifacts/smart-mix/results.json`. Implement and test those interfaces, which are still proposals.
4. Measure the single-deck and dual baseline on the same device/route/volume/EQ/build. Acceptance audio comes from an external cable/USB loopback at ≥48 kHz; the Java log is secondary correlation. Record route latency compensation; do not arbitrarily subtract phase error.
5. Run the §7 matrix: reference Pixel and Xiaomi 13/equivalent, cable/USB routes and at least Bluetooth/speaker for continuity; background/lockscreen/Doze/calls/auth/offline/route/process. Block main and degrade the network during the transition.
6. GREEN: adaptive meets clipping, underrun and memory. Store captures/metrics and per-device results, including failures, as artifacts; link the evidence in §8. Do not enable beatmatch with this task.

**DoD:** the lab detects real regressions, adaptive is approved on hardware and the baseline is reproducible; results do not depend on subjective impressions or callback timestamps.

**Scope change (2026-10-19): Xiaomi 13 and internal bus capture.** There is no loopback equipment or second device, so A06–A08 are certified on the Xiaomi 13 using the PCM bus output instead of an external capture. Debug builds record, through `adb shell am broadcast -a app.cratemusic.crate.debug.BUS_CAPTURE_START --es name <name>` (and `BUS_CAPTURE_STOP`), a 6-channel 48 kHz WAV with the final mix and each deck's contribution, plus a JSON with transition markers, `AudioTrack` underruns and dropped frames, in `Android/data/app.cratemusic.crate.debug/files/captures/`. Fixtures: `python tools/smart-mix-lab/generate_fixtures.py --output artifacts/smart-mix/fixtures`. Analysis: `python tools/smart-mix-lab/capture_analysis.py --capture <capture.wav> --output artifacts/smart-mix/results/<name>.json`.

It covers what the bus decides: the phase between decks is fixed before the output and any later latency shifts both decks equally, and clipping, true peak and bass are measured on the PCM that the app delivers. It does not cover the system mixer, the HAL or the DAC; underruns in that part are counted with `AudioTrack.getUnderrunCount()` but are not heard. Phase measured on real music by onset correlation is not reliable (tempo estimates for the same track vary between 115 and 124 BPM), so the phase gate is proven with click fixtures and music remains informational data. Bluetooth/cable routes, calls and route changes are validated by hand on the same device.

### A07: Tempo/phase with a physical gate and bounded contingency

**Depends on:** SM03/SM07, A06. **Modify:** `JAVA/NativeTransitionPlan.java`, `NativeMixTiming.java`, `NativeMixController.java`, `ExoPlayerNativePlaybackDeck.java`, the respective processor/bridge/capabilities/tests. **Create:** `DEVICE/NativeBeatmatchTest.java`; ratio/drift fixtures and lab tests.

1. RED: a beatmatch plan is not treated as adaptive by ignoring tempo/phase; reject unknown profiles/ratios/phase; restore tempo without a jump; media duration and cues remain valid after a rate change.
2. Implement rate/pitch preservation, alignment using both grids, start coordination and tempo recovery with limits of ≤4% by default/≤6% absolute. Do not adjust the clock with JS/main timers or silently move private cues.
3. Unit/instrumented GREEN; run an external capture on every route advertised as capable. Gate p95 ≤20 ms with corpus/drift and the §7 protocol. Publish capability per executor/route actually certified; Bluetooth does not inherit certification from USB.
4. **If it fails with two outputs:** leave beatmatch inactive and the task pending. Run a feasibility spike bounded to the same executor: two decoders → common PCM bus → one output, preserving facade/session/queue. Measure sync, CPU, RSS, route/focus/EQ and licenses/dependencies. Do not implement a new DSP platform in advance.
5. If the spike passes, update section 5 of the design with evidence and the breakdown of this same A07 before integrating the replacement; repeat A02–A06 and phase. If it fails or substantially changes cost/scope, record the blocker/alternative for review; do not close beatmatch by renaming it a future phase.

**PCM bus spike result (2026-10-19, branch `codex/smart-mix-pcm-bus`).** With two outputs, beatmatch locked in ~1/7 transitions with errors of up to seconds, so the step 4 spike was run. Each deck is still an ExoPlayer with its `DefaultAudioSink`, but it writes through its own `AudioOutputProvider` into a PCM ring; one thread mixes the two channels at 48 kHz into a single 16-bit `AudioTrack`. Facade, session and queue do not change.

- **Sync.** The incoming deck is prepared held and muted at its tempo ratio, and the mixer starts it on an exact bus frame (median of per-tick estimates). It locks if the median of the last nine phase samples is within ±10 ms. Result on device with the local corpus (16 tracks, 118–127 BPM, 44.1/48/96 kHz): 8/8 locked over several runs, start error 0.1–6.6 ms and end error 1–9 ms, with no speed changes during the mix. Measured with ExoPlayer positions, not with an external capture: the p95 ≤20 ms gate from step 3 is still pending the A06 lab.
- **Defects found along the way.** `SonicAudioProcessor.reset()` clears the output frequency, so from the second track on each deck the audio arrived without resampling (44.1 kHz 8.8% fast, 96 kHz at half speed); it is wrapped so the frequency is set again after each reset. The default stereo matrices of `ChannelMixingMatrix` in Media3 1.10.1 are indexed backwards.
- **CPU.** Non-debuggable build, app in the background: audio threads at ~6% of one core with two outputs and ~10% with the bus. The extra is the bus thread (mixing, conversion and EQ in Java). RSS and battery over a long session not measured.
- **Route, focus and EQ.** Pausing or losing focus pauses the bus `AudioTrack` after 500 ms with no active channels. Removing Bluetooth headphones pauses; on resume, audio plays through the speaker, and reconnecting them sends audio back to them. A write with `ERROR_DEAD_OBJECT` rebuilds the track (not reproduced on device: Android restored the track on its own). Calls not tested. The system `Equalizer` fails with `ERROR_NO_INIT` on the reference device (Xiaomi), so the bus applies a software EQ with the bands and Q of the web EQ, validated by ear. Inputs of up to 5.1 are downmixed to stereo.
- **Dependencies.** Only Media3 1.10.1, already present; no new libraries or licenses.

With two outputs beatmatch is disabled (it falls back to adaptive), because only a deck with a bus channel can hold its start. Pending before integrating the replacement: the external gate capture, calls, RSS and battery, and repeating A02–A06 on the bus.

**DoD:** tempo/phase actually executed and measured, correct restoration and manual cancellation, A05 opt-in toggle enabled only for proven capabilities. Adaptive can ship earlier; this task is not listed as done until it passes its gate or an explicit scope change is agreed.

### A08: Bass handoff and acceptance of the final preferences

**Depends on:** A03, A07 and the SM06 plan/capabilities. **Modify:** `JAVA/NativeMixAudioProcessor.java`, controller/plan/engine, signal tests; Settings and catalogs from A05. **Create:** filter/handoff tests if they require a separate module.

1. RED: a balanced plan on an engine without support degrades; enabling/disabling produces no click; correlated bass and positive EQ do not saturate; sample rates of 44.1/48/96k remain stable.
2. Implement the bass handoff filter/envelope in audio, bounded to the transition period and separate from the global EQ; persist the opt-in and undo state on cancel/finish. No allocations/I/O in callbacks.
3. Signal/unit and instrumentation GREEN; measure true peak/spectrum/continuity and do a corpus listening test with bass off/on at a controlled volume. Repeat the affected A06/A07 gates.
4. Complete UI/capabilities and verify album, user opt-out, route change and legacy. Keep adaptive if the bass mode is not available.

**DoD:** bass is a delivered and tested option, without clipping or a phase/EQ regression; parsing the field or leaving it permanently hidden is not enough.

### A09: Native continuation: token and plans in the background

**Depends on:** A01–A04, SM06. **Modify:** `app/crate/api/smart_mix.py`, `app/crate/api/schemas/smart_mix.py`, session auth for the scoped token, `JAVA/CrateNativePlaybackService.java`, `NativeQueueState.java`, `app/listen/src/contexts/player-engine-adapter.ts`, `android-native-engine.ts` and tests. **Create:** `JAVA/NativeContinuationClient.java`, `JAVA/NativeContinuationPolicy.java` with their unit tests and `app/tests/test_playback_continuation.py`.

1. Server RED: token bound to `sid` (migration 115); expired, revoked, after logout or outside its single route (`POST /api/playback/transition-plans`) → 401/403; it does not appear in the Settings token list and cannot be rotated from it. No descriptor: plans-only mode reuses `/transition-plans` and the descriptor arrives with A10.
2. Native RED: the policy requests only in the background, with ≤3 planned edges, once per track, with backoff and never offline or with Smart Mix disabled; a 401 stops the continuation without retrying in a loop.
3. Implement `POST /api/playback/continuation-token` (interactive session, 12 h, one per session), a native client on `/transition-plans` and issuance/renewal from Listen when the queue loads and when returning to the foreground. Token only in the service's memory.
4. GREEN: pytest for the endpoint, Java unit tests and the affected Listen tests. On device: a static queue of more than 33 tracks with the screen off; edges after the window arrive with `cueMs` from the server.

**DoD:** with the WebView frozen, the service keeps server plans for the whole static queue; least-privilege credential that can be revoked with the session.

### A10: Native continuation: radio/infinite refill and reconciliation

**Depends on:** A09. **Modify:** the A09 endpoint and descriptor (variants of `fetchRadioContinuation` and `fetchInfiniteContinuation`), `NativeQueueState.java`, `CrateNativePlaybackService.java`, `app/listen/src/contexts/use-playback-radio-refill.ts`, `use-playback-continuation.ts`, the native events bridge and tests.

1. Server RED: each variant (artist, track, album, playlist, home-playlist, shaped session, infinite) returns tracks without repeating `recentEntityUids`, with exact-scope stream tickets and plans for the joining edge.
2. Native/Listen RED: append with the same revision and sequence; on returning to the foreground Listen adopts exactly the appends; a user edit discards pending appends; no double refill when Listen and the service overlap in the foreground; play events without duplicates.
3. Implement the native append, the append event and reading the queue from the sequence; move refilling to native only in the background.
4. GREEN: affected suites. On device: radio and infinite for 30 min with the screen off, the queue grows and transitions use server plans; on unlocking, the UI shows the real queue.

**DoD:** radio and infinite continue with the screen off with the same transition quality as in the foreground and without queue divergence.

## 5b. iOS: I01 to I06 (R5)

**Starts after R1 closes.** The contract between Listen and the native player (`setQueue`, `setTransitionPlans`, `transition*`/`trackChanged` events, checkpoint) already proven on Android is reused as is; server, analysis, planner and Listen planning do not change. Today iOS plays in the WebView (HTML5) and only has native plugins for media session, Cast, secure session and offline.

**Engine decision:** `AVAudioEngine` with two `AVAudioPlayerNode` and a mixer, not two `AVPlayer`. It costs more (feeding from cache/download instead of direct HTTP streaming), but it is the only path that later serves beatmatch (`AVAudioUnitTimePitch`, sample-accurate scheduling) and bass handoff (`AVAudioUnitEQ` per deck) without a rewrite.

- **I01: `CrateNativePlayback` plugin in Swift** with the same contract as Android and an `iosNativeEngine` in Listen behind `PlaybackEngine`; `.playback` audio session and background lifetime.
- **I02: Feeding the decks:** progressive download to cache of the active track and the next one, reusing offline storage; media tickets and renewal. Background continuation reuses the endpoint, descriptor and token from A09–A10.
- **I03: Mixing:** equal-power envelope with staging ≤0 dB, cue trigger with a buffer margin, state machine and cancellation on skip, error or end of queue; same QoE telemetry.
- **I04: Lifecycle:** queue and plans checkpoint, Now Playing and remote controls, interruptions (calls, Siri) and route changes (headphones, Bluetooth, AirPlay).
- **I05: Tests:** XCTest for envelope, trigger and state; a harness equivalent to `drive.mjs` through Safari Web Inspector; access to the local backend over HTTPS with a trusted certificate, or production with flags (there is no `adb reverse`).
- **I06: On-device gate:** the R1 battery on a reference iPhone and capture with the system recorder for clipping and gaps.

## 6. VirtualDJ: VH01 and V01 to V10

Design §6.1 sets out what the SDK (official version of 2021-10-03) and the VirtualDJ 8.5 host allow, with its evidence. The following tasks fit that surface. P01 pins contracts; P02/P03 auth and flags; P04 folders and filters; P05 media; SM06 ranking and profiles. Each step is a RED/GREEN/refactor checkpoint; results are recorded in §8.

Common native verification commands:

```sh
cmake -S tools/vdj-plugin -B build/vdj-headless -DCRATE_VDJ_BUILD_REAL_PLUGIN=OFF -DCRATE_VDJ_BUILD_TESTS=ON
cmake --build build/vdj-headless --parallel 4
ctest --test-dir build/vdj-headless --output-on-failure
```

Baseline: 14 green tests headless and 16 with the local SDK. New targets must be registered in CTest. Tests in Release use checks that do not disappear with `NDEBUG`. SDK builds use a private `VIRTUALDJ_SDK_ROOT`; SDK headers/samples, credentials and generated bundles are not added to Git.

### VH01: Host gate: check in VirtualDJ what the SDK does not document

**Dependencies:** none; blocks V03, V04 and V06. **Requires:** VirtualDJ Pro on macOS arm64, opened by a person for about 15 minutes.

**Create:** `tools/vdj-plugin/probe/host_probe.cpp` (development target, excluded from packages) and `tools/vdj-plugin/probe/README.md` with the script. The probe is an Online Source that records in a local log, without tokens or signed URLs, each callback with its thread, duration and result.

Checks, each with its result recorded in §8:

1. Thread of `OnSearch`, `GetFolder` and `GetStreamUrl`, and whether `GetFolder` accepts `S_FALSE` + `finish()`.
2. Whether VDJ calls `GetStreamUrl` again on seek, reload or network loss, and which HTTP requests it makes (full GET, Range, HEAD) against a local test server, including a ticket that expires in the middle of a download.
3. Whether `GetStreamUrl` accepts a local path or `file://`.
4. Whether `IVdjSubfoldersList::add` with a hierarchical identifier or name produces subfolders.
5. What login looks like with `IsLogged`/`OnLogin`, and whether a native window can be opened from `OnLogin`.
6. Whether `SendCommand`/`GetInfo` work from a thread owned by the plugin.
7. Whether `automix_add_next` and `playlist_add` accept `netsearch://plugin-<name>/<uid>` and the track loads and mixes in automix.
8. Whether the Online Source stays loaded with the browser in another folder during a long session.
9. Whether `Release` finishes cleanly with a search and a thread in progress, and after restarting VDJ.
10. Format of `get_filepath` on a deck with a Crate track (confirm `netsearch://plugin-Crate/<uid>`).

**DoD:** all ten checks have a result and the VDJ version recorded. If one contradicts design §6, the design and the affected tasks are updated before implementing them.

### V01: Core as a reliable production boundary

**Dependencies:** P01. **Status:** existing core; fixes pending.

**Modify:** `tools/vdj-plugin/CMakeLists.txt`, `include/crate_vdj/{http_client,models,contract_negotiator,credential_store}.hpp`, `src/core/{models,search_results,catalog_results,contract_negotiator,credential_store}.cpp`, `src/client/curl_http_client.cpp`, `src/mapping/{mix_profile,compatible_tracks}.cpp` and existing client/auth tests.
**Create:** `tools/vdj-plugin/src/core/json_mapping.cpp`, `tools/vdj-plugin/include/crate_vdj/json_mapping.hpp`, `tools/vdj-plugin/tests/client/json_mapping_test.cpp`, `tools/vdj-plugin/tests/security/redaction_test.cpp`.

1. RED: unknown non-empty contract, Unicode escapes/surrogate pairs, optional null, numeric limits, malformed nesting and an excessive body.
2. GREEN: a maintained JSON parser pinned in CMake; body limit in libcurl before appending bytes; `CURLOPT_NOSIGNAL`, explicit `curl_global_init` and handle reuse; rejection of unexpected origin/redirect/status.
3. GREEN: negotiation by contract ranges, availability and independent flags; runtime/package version from a single value; central redaction of secrets with tests.
4. RED/GREEN: propagate the sanitizer flags to the test executables and replace `assert` with checks that work in Release.
5. Commit `fix(vdj): harden native contracts and test tooling`.

**DoD:** known repros covered and green; normal, Release and sanitizer builds correct; dependency and license inventory updated.

### V02: User connection in a single binary

**Dependencies:** V01, P02 and P03. **Status:** credential stores in WIP; no login.

**Modify:** `tools/vdj-plugin/src/auth/credential_store_macos.mm`, `tools/vdj-plugin/src/auth/credential_store_windows.cpp`, `tools/vdj-plugin/include/crate_vdj/core.hpp`, `tools/vdj-plugin/CMakeLists.txt`.
**Create:** `tools/vdj-plugin/src/client/capability_client.cpp`, `tools/vdj-plugin/src/core/connection_settings.cpp`, `tools/vdj-plugin/include/crate_vdj/connection_settings.hpp`, `tools/vdj-plugin/src/platform/connection_dialog_macos.mm`, `tools/vdj-plugin/src/platform/connection_dialog_windows.cpp`, `tools/vdj-plugin/tests/auth/connection_session_test.cpp`, `tools/vdj-plugin/tests/client/capability_client_test.cpp`.

1. RED: no network when not configured; invalid origin; invalid, revoked or scopeless token; incompatible contract; rotation; server switch; credential store write errors.
2. GREEN: `IsLogged`/`OnLogin`/`OnLogout`; `OnLogin` opens the native dialog with origin and token according to the VH01 result. Store the token only in Keychain or Credential Manager, with one account per normalized origin; propagate write errors; read the credential once per session, not on every request.
3. GREEN: handshake with `/api/auth/me` and `/api/capabilities`, bounded periodic refresh and independent flags for A, B and Crate Automix.
4. Fix the plugin name as `Crate` and document it as a permanent contract; show in the dialog that the plugin requires VirtualDJ Pro.
5. Native auth/capability tests and, from `app`, `pytest -q tests/test_access_token_repository.py tests/test_access_token_api.py tests/test_access_token_auth.py tests/test_vdj_capabilities.py`. Test connect, replace and disconnect on macOS.
6. Commit `feat(vdj): connect and negotiate scoped sessions`.

**DoD:** no default origin; configuration survives restarts; auth errors ask for reconnection; disabling B or Crate Automix keeps A.

### V03: Replace the spike and complete browsing

**Dependencies:** V01, V02, P04 and VH01. **Status:** search, folder and compatibles callbacks in the spike.

**Modify:** `tools/vdj-plugin/CMakeLists.txt`, `tools/vdj-plugin/src/client/{search_client,catalog_client}.cpp`, `tools/vdj-plugin/src/cache/sqlite_metadata_cache.cpp`, `tools/vdj-plugin/include/crate_vdj/metadata_cache.hpp`.
**Create:** `tools/vdj-plugin/src/sdk/online_source_plugin.cpp`, `tools/vdj-plugin/src/online_source/online_source.cpp`, `tools/vdj-plugin/include/crate_vdj/online_source.hpp`, `tools/vdj-plugin/src/core/request_coordinator.cpp`, `tools/vdj-plugin/include/crate_vdj/request_coordinator.hpp`, `tools/vdj-plugin/tests/sdk/online_source_lifecycle_test.cpp`.

1. RED: overlapping searches, cancellation between the end of the network call and publication, a single `finish`, a callback after unload, a slow folder. Exercise the production adapter with the fake SDK.
2. GREEN: production adapter with a generation coordinator; asynchronous search; asynchronous folders or folders served from cache depending on VH01. Fix the `OnSearchCancel` race.
3. RED/GREEN: P04 one-level folders; search filter syntax; context menu entries "More from this artist" and "This album" that launch that search; covers as a public absolute URL on every path (search, folders, compatibles).
4. RED/GREEN: metadata cache with stale only on transport errors or 5xx; 401/403/cancel/version are still errors; SQLite migration inside a transaction; separation by origin and account.
5. `ctest --test-dir build/vdj-headless -R 'online_source|catalog|search|cache' --output-on-failure` and, from `app`, `pytest -q tests/test_vdj_catalog.py tests/test_browse_queries.py tests/test_browse_schemas.py`. On the host: fast searches, cancellation, unload/reload with two decks playing.
6. Commits in parts, ending with `feat(vdj): ship cancellable local catalog source`.

**DoD:** A walks playlists, genres, moods, recent and compatibles, and finds artists and albums through search; cancellation does not publish old results; the host unloads the plugin cleanly.

### V04: Media proven on real decks

**Dependencies:** V02, V03, P05 and VH01. **Status:** the resolver generates the URL; 60 s ticket without refresh.

**Modify:** `tools/vdj-plugin/src/client/{stream_resolver,media_access_client}.cpp`, `tools/vdj-plugin/src/sdk/online_source_plugin.cpp`, `tools/vdj-plugin/tests/client/stream_resolver_test.cpp`.
**Create:** `tools/vdj-plugin/tests/sdk/media_delivery_contract_test.cpp`.

1. RED: complete playback payload (UID, locality, format, preparing state), failed authorization, redirect to another origin, deleted media, revocation.
2. GREEN: validate the payload before issuing the ticket; URL with a ticket whose TTL follows P05; deadline in `GetStreamUrl`; the URL is not persisted.
3. RED/GREEN depending on VH01: if there are Range requests after the ticket expires, implement the mechanism validated by the gate.
4. Host gate: load two different Crate tracks (including FLAC), play, seek, cut the network, revoke the token and try a new load. Record version, architecture and results.
5. Commit `feat(vdj): validate authorized deck media delivery`.

**DoD:** A works on a real host with correct playback, seek and revocation; restart and unload leave no active workers.

### V05: Assistant with Crate's ranking

**Dependencies:** V03 and SM06. **Status:** Compatibles folder connected; profile mapper unused.

**Modify:** `tools/vdj-plugin/src/client/smart_mix_client.cpp`, `tools/vdj-plugin/src/mapping/{mix_profile,compatible_tracks}.cpp`, `tools/vdj-plugin/src/online_source/compatible_tracks.cpp`.
**Create:** `tools/vdj-plugin/tests/online_source/smart_mix_presentation_test.cpp`.

1. RED: Crate BPM and key in the SDK fields; Camelot, energy and confidence in `comment` with a fixed, localized format; a missing profile does not break the track; an incompatible profile version disables the presentation; order equal to the server's; context menu seed versus loaded track.
2. GREEN: connect the profiles client to the presentation; "Open in Crate" from the context menu. The plugin does not consume `TransitionPlan`.
3. `ctest --test-dir build/vdj-headless -R 'smart_mix|compatible' --output-on-failure`. On the host: compatibles from the loaded track with two and four decks.
4. Commit `feat(vdj): present Crate compatibility in VirtualDJ`.

**DoD:** B is visible in the real plugin and does not contradict VDJ's own analysis.

### V06: Crate Automix and play events

**Dependencies:** V05, P03 and VH01 (checks 6, 7 and 8). **Status:** only the spike's fixed commands for deck 1.

**Create:** `tools/vdj-plugin/src/automix/{deck_poller,automix_feeder,play_event_reporter}.cpp`, `tools/vdj-plugin/include/crate_vdj/automix.hpp`, `tools/vdj-plugin/tests/automix/{deck_poller,automix_feeder,play_event_reporter}_test.cpp`.

1. RED: bounded polling of `get_filepath`, `is_audible` and `get_time` per deck with unknown or partial values; identification of Crate tracks by `netsearch://plugin-Crate/<uid>`; two and four decks.
2. GREEN: a single worker serializes the VDJScript calls, through the mechanism that VH01 validates.
3. RED/GREEN: the feeder keeps 2 tracks ahead in the automix queue with the validated verbs, replaces them if the playing track changes, checks capabilities, flag and scope before each addition and stops adding when disabled. It never sends crossfader, tempo, EQ or play commands.
4. RED/GREEN: play events to the existing endpoint with a stable `client_event_id`, an audible threshold and a bounded spool without credentials.
5. Host: automix with Crate tracks during a session of at least one hour, manual intervention, flag turned off midway and network loss.
6. Commits in parts up to `feat(vdj): feed VirtualDJ automix from Crate`.

**DoD:** Crate Automix feeds the native queue without mix commands, stops cleanly and records play events exactly once.

### V07: Radio and presence (backlog)

Enters with P06 when decided in §1.1: Crate radio as a source for the V06 feeder and now-playing presence. Private cues stay withdrawn for VDJ. Reference: design §6.8.

### V08: Encrypted audio cache and prefetch (backlog)

Only if VH01 confirms that `GetStreamUrl` accepts local paths. Reference: design §2.4 and §6.8.

### V09: DJ filters, measurement and continuous verification

**Dependencies:** P04 and V01–V06; CI can start after V01.

**Modify:** `.github/workflows/test-backend.yml`, `Makefile`, `tools/vdj-plugin/CMakeLists.txt`, search client.
**Create:** `tools/vdj-plugin/src/client/search_syntax.cpp`, `tools/vdj-plugin/tests/client/search_syntax_test.cpp`, `.github/workflows/vdj-plugin.yml` and a measurement harness under `tools/vdj-plugin/tests/performance/`.

1. RED/GREEN: the plugin passes the P04 filter syntax through without reinterpreting it and shows syntax errors as an empty result with a message.
2. PR jobs: headless Linux/macOS, sanitizer, Release, dependencies/licenses/secrets without the private SDK; `make vdj-test` and `make vdj-build`; unsigned Windows build of the core.
3. Measure p50/p95/p99 for search, folders, compatibles and stream authorization against FastAPI with a 48K-track dataset. Readplane only if the recorded SLO fails.

**DoD:** reproducible CI covers the real native code; filters without a Listen regression; performance measured.

### V10: Packages and closing the host gates

**Dependencies:** V01–V06 and X03.

**Create:** `tools/vdj-plugin/packaging/manifest.json`, scripts under `tools/vdj-plugin/packaging/`, `.github/workflows/vdj-plugin-release.yml`.
**Modify:** `tools/vdj-plugin/CMakeLists.txt`, `tools/vdj-plugin/README.md`, `Makefile`.

1. Manifest with the plugin SemVer, minimum and maximum tested Crate contracts, tested VDJ versions and the Pro license requirement.
2. macOS arm64 and x86_64 (or universal) bundle installed in `PluginsMacArm/OnlineSources` or `Plugins64/OnlineSources` depending on architecture, and a Windows x64 DLL in `Plugins64/OnlineSources`. Exclude the spike, probe, SDK headers and credentials. Checksums, SBOM and license inventory.
3. Signing: macOS needs Developer ID and notarization to be distributed outside the development machine; today there are no Apple signing secrets. Until they exist, the macOS package is only for internal testing and is documented as such. Windows: Authenticode signing if there is a certificate; if not, this is documented.
4. `make vdj-package`; verify exports, metadata, installation folder and host loading for each package.
5. Consume the X03 evidence and repeat on the packages: installation, update, credentials, media and Crate Automix.

**DoD:** installable packages per platform with documented requirements (Pro, architecture, signing); A, B and Crate Automix verified on a real host.

## 7. Integration, acceptance and operation: X01 to X04

### X01: Integrated contracts, privacy and QoE

**Depends on:** SM06/SM07, P01–P06; adapter integration when the corresponding A/V are ready. **Modify:** schema/planner fixtures and tests, `app/crate/metrics.py`, Android/VDJ telemetry and existing federation contracts. **Extend:** the cross-language golden corpus under `app/tests/fixtures/smart_mix/`, reused by Rust/Java/C++ without copying divergent values.

1. End-to-end RED/GREEN: analysis of source A → profile revision → authorized plan → Android/VDJ validators → execution; changing source/cue/queue/user revokes the validity of the same artifact. Include a v1 consumer and an unknown one.
2. Test optional federated summaries and their absence on old nodes; no grids/private cues/paths/tickets. A partial remote profile is good for safe adaptive in Listen where remote media is already allowed; VDJ stays local. Do not create new endpoints based on names from old roadmaps.
3. Instrument timings for analysis/planning/cache/preload/readiness, fallback reasons, phase, underrun, cancellation and play events. Labels limited to mode/result/bounded version; IDs only in sanitized traces under a retention policy, not in metric series.
4. Verify that Redis/telemetry failures do not block playback and that stale data does not falsify coverage. Add metrics to existing Admin surfaces; do not build another dashboard before the need is demonstrated.

**Checks:** relevant SM/P suites, Go summary, Rust golden, Vitest/Gradle/CTest validators and `node scripts/check-docs.mjs`. **DoD:** identical meaning across consumers, auditable events and useful observability without leaks/unbounded cardinality.

### X02: Behavioural CI and real topologies

**Depends on:** P03–P05, V01/V09, X01; extend as A/V are delivered. **Modify:** `.github/workflows/test-backend.yml`, the V09 VDJ workflow, existing Android/frontend workflows and smoke/integration scripts; `Makefile` when reproducible targets are missing.

1. Ensure mandatory jobs for PostgreSQL, real Rust parity, Go, Vitest, Java unit and normal/Release/ASan-UBSan CMake/CTest. SDK and signing only in private jobs; public headless does not require proprietary headers.
2. Bring up dev/home/prod topologies through sanitized fixtures/config. Make real PAT requests through the proxy to search/profile/catalog/tickets/stream: checking that a YAML label contains a substring is not enough. JWT/session keep the existing route and scopes.
3. Add publication/claim races, concurrent token rotate/revoke, media HEAD/Range after TTL, real libcurl/fake SDK cancellation and a body limits contract. A new test is discovered and run in CI; a file without a target does not count.
4. Run documentation/portal tests and link integrity. Path filters include new C++/contracts/proxy/manifest; relevant tests are not skipped because only compose or a shared fixture changed.

**DoD:** known failures have a regression that runs automatically and the PAT flow through the proxy is tested; the physical/manual suites stay separate and explicit.

### X03: Physical/host matrix and rollback rehearsal

**Depends on:** A01–A08, V01–V09, complete P/SM, X01–X02. **Files:** this plan and manifests/results under `artifacts/smart-mix/` or CI storage; no new acceptance guide.

1. Run the following matrix on builds equivalent to release. Identify model, OS/build, architecture, Media3/VirtualDJ, Crate/plugin/analyzer/planner, dataset, current profiles, network/route, knobs and flag values.
2. Android: at least 20 transitions per functional case and ≥1000 transitions for the aggregate rate per configuration to be certified. Report `failures/N` and the Wilson 95% upper bound; require an upper bound <0.5%, increasing the sample if needed. Do not infer a rate from 20 cases. Memory compares stable p95 RSS and maximum after warmup against single deck; both ≤1.5× under the same scenario and without sustained growth.
3. Phase: ≥200 beatmatch transitions per certified configuration, multiple pairs/tempos/drift; report p50/p95/max and an uncertainty interval. p95 ≤20 ms on valid audio, true peak ≤−1 dBTP and zero clipped samples. An invalid capture repeats the scenario and is not counted as a success.
4. VirtualDJ: Windows x64, macOS Intel and macOS arm64; minimum/maximum supported versions, fixed in the manifest before testing; 2/4 decks, search/folders/media/seek after TTL, reconnection, auth rotate/revoke, user/origin switch, cache, cues/radio, takeover in each phase and unload/restart. 4 h soak per supported platform; measure worker queue and stable memory.
5. For Crate Automix, record that the plugin sends no mix commands, that the queue keeps the configured lead with 2 and 4 decks, and how long it takes to stop adding tracks after the flag is turned off or the token is revoked.
6. Rehearse independent disabling of C/VDJ/beatmatch/adaptive and rollback to compatible binaries. New work is cancelled/denied; audible audio and manual controls are kept. Test deliberate recovery/re-arming and do not downgrade the DB automatically.

**DoD:** every cell advertised as supported has real evidence with a result; a failure on one platform/mode is not hidden by aggregating successes from another. Unviable gates are recorded as pending and raise a concrete decision in the same documents.

### Minimum scenario matrix

| Surface       | Mandatory cases                                                                                                                                                                |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Audio         | Mono/stereo out-of-phase/correlated, silence/short intro/short outro, variable tempo, 44.1/48/96k, supported MP3/AAC/FLAC, long tracks                                         |
| Android       | Reference Pixel and Xiaomi 13/equivalent; speaker, cable/USB headphones, Bluetooth and car/Android Auto; focus/duck/calls; foreground/background/lockscreen/Doze/process death |
| Network/media | Downloaded local, authenticated stream, slow/offline, plan timeout, ticket expired on seek/range, token/session renewed/revoked, source file replaced                          |
| Queue/user    | Gapless album, shuffle/radio/playlist, repeat-one, next/seek/pause in each phase, change of queue/cues/origin/account, persistent opt-out                                      |
| VDJ           | Pro license; 2 and 4 decks; deck with a non-Crate track; search cancelled and replaced; unload/restart; Crate Automix with manual intervention and flag off; token revocation  |

### X04: Progressive rollout and single closure

**Depends on:** X03 and V10; does not block the earlier creation of pilot packages. **Modify:** this plan, existing flags/capabilities/config and independent releases. Do not deploy to production as a side effect of running a test.

1. Deploy additive migrations/capabilities with flags off. Small analysis canary, pause/resume verified; grow under the resource governor. Full coverage does not block playback: legacy/partial keeps falling back. Do not launch a 48K reanalysis all at once to test the pipeline.
2. Enable internal accounts; Android adaptive and VDJ A/B opt-in first. Beatmatch/bass/C only on approved configurations with separate toggles. The plugin has its own tag/manifests compatible with the stack; it does not require publishing the same version number.
3. Expand 5%→25%→100% with at least 7 days and 1000 observable transitions without failed gates at each relevant stage. If the installed base does not allow that volume, stay in beta or explicitly agree on another documented criterion; the passage of time does not replace missing data.
4. On a regression, turn off the affected mode and keep manual/gapless. Disable VDJ entirely only if A also fails. Revert to compatible binaries; do not delete profiles or automatically downgrade 090/091/queues. Record the cause and a new acceptance before re-arming.
5. Audit §8 and the scope matrix: every SM/P/A/V/X completed with evidence, extensions included, SDK not packaged, correct permissions/signatures/rollback, consistent docs/manifest/portal and old guides superseded. Only then declare the feature complete.

**DoD:** joint delivery verified, compatible versions, observed rollout and no pending item disguised as a disabled option.

## 8. Execution and decision log

Update these tables at every checkpoint; do not create another tracking plan. The initial results belong to the 2026-09-09 review and do not replace the execution of future tasks.

| Initial evidence                           | Result                                   | Limit                                |
| ------------------------------------------ | ---------------------------------------- | ------------------------------------ |
| Focused Python core                        | 113 pass / 16 skipped, 11.02 s           | PG skipped in that run               |
| PAT/media/capabilities/migrations platform | 60 pass, 12.98 s, exclusive ephemeral PG | No host or complete end-to-end proxy |
| C++ headless macOS arm64                   | 14/14 CTests                             | No SDK host or Windows/Intel         |
| C++ sanitizers                             | Link failure confirmed                   | R11 pending                          |
| Full Rust/Vitest/Gradle/devices/VDJ soak   | Not run in the review                    | Evidence pending                     |

Evidence from 2026-10-08, branch before integrating main (the post-merge result is recorded in the merge commit):

| Evidence                                           | Result                                         | Limit                                           |
| -------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------- |
| Python Smart Mix, capabilities, routing, migration | 156 pass / 1 skip (Rust parity without binary) | PostgreSQL via Testcontainers                   |
| Python PAT/media/VDJ catalog                       | 45 pass                                        | No end-to-end proxy                             |
| Rust `--features analysis`                         | 43 pass                                        |                                                 |
| Go readplane                                       | `go test ./...` OK                             |                                                 |
| Vitest Listen/Admin Smart Mix                      | 61/61 and 2/2                                  |                                                 |
| C++ headless / with local SDK                      | 14/14 and 16/16 CTests                         | Sanitizers do not link; Release without asserts |

SM07 evidence from 2026-10-09 on local development hardware (MacBook arm64, 10 CPUs, PostgreSQL 15.19 in Docker, no reachable Redis). This is not release evidence: the gates are measured on the deployed host.

| Scenario `representative-48k` (warmup 20, 300 iterations, concurrency 8) | p50     | p95      | p99      | p95 budget |
| ------------------------------------------------------------------------ | ------- | -------- | -------- | ---------- |
| cached_batch32                                                           | 8.1 ms  | 17.2 ms  | 48.8 ms  | 50 ms      |
| uncached_batch32                                                         | 17.3 ms | 28.1 ms  | 36.7 ms  | 150 ms     |
| compatible500                                                            | 72.9 ms | 145.0 ms | 170.7 ms | 250 ms     |

| Analysis `generated-v1` (long file shortened to 1800 s) | Python          | Rust           |
| ------------------------------------------------------- | --------------- | -------------- |
| click 120 BPM, 30 s                                     | 26.3 s, 359 MB  | 0.8 s, 7.9 MB  |
| out-of-phase stereo, 20 s                               | 2.2 s, 364 MB   | 0.05 s, 5.0 MB |
| long, 1800 s                                            | 22.2 s, 4122 MB | 4.8 s, 158 MB  |

The Python fallback loads the whole track: at 30 minutes it exceeds the worker recycling threshold of 1.5 GB (open gap for ARM).

SM05 evidence from 2026-10-14, canary on an isolated local stack (MacBook arm64, OrbStack, `test-music` library with 863 tracks, migrations 109–114 applied on an empty DB). Branch `9a234b09` with green CI.

| Step                                             | Result                                                                                                                      |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| Start, batches of 10                             | Precomputed coverage without COUNT in the request; the batch waits in `heavy` behind higher-priority work without deferral  |
| Pause in the middle of the third batch           | The 2 tracks in flight finish; the queued batch exits with `claimed: 0, control: paused`; 20 `done`, 0 claims retained      |
| Full stack restart while paused                  | Campaign stays `paused`, with no pending tasks or automatic resume                                                          |
| Resume                                           | Continues from the checkpoint: 0 of the previous 20 reanalysed, 0 duplicate `compute` per track                             |
| Cancel in the middle of a batch                  | Batch in flight finishes (70 `done`); the next one exits with `control: cancelled`; 0 claims retained                       |
| Rust analyzer after `make crate-cli-linux-arm64` | `crate-rust` profiles with LUFS (mean −7.8); the 70 `crate-python` partials of the same target do not become eligible again |

Canary findings and their resolution: (1) the `crate-python` profiles of the current target did not become eligible again when Rust was available; resolved in `5f2ebf58` (they are claimed after the tracks without a profile and within the attempts budget). (2) The grid for dense music barely reached `full`; resolved with the tracker and downbeat described below. (3) The ARM development images use the Python fallback without warning if `app/bin/crate-cli-linux-arm64` is missing; open.

SM07 evidence from 2026-10-15, grid quality against BPM tags (`tools/smart-mix-lab/evaluate_tempo.py`, `test-music`, 110 tracks from 23 artists, mostly hardcore/metal, maximum 6 per artist, seed 20261014). Reference: integer BPM tags sourced from Tidal, without manual verification; no downbeat reference.

| Analyzer                                           | BPM ±4 % | With octaves | Stable ≥0.8 | Downbeat | `full` |
| -------------------------------------------------- | -------- | ------------ | ----------- | -------- | ------ |
| Rust peaks above threshold (before)                | 4.5 %    | 9.1 %        | 3.6 %       | 0 %      | 0 %    |
| Python librosa (96 readable; does not read `.m4a`) | 50.0 %   | 50.0 %       | 55.2 %      | 3.1 %    | 3.1 %  |
| Rust mel onset + tempogram + Ellis DP (`1c686b8b`) | 65.5 %   | 69.1 %       | 58.2 %      | 11.8 %   | 12.7 % |
| + downbeat from bass/harmonic change/halves        | 65.5 %   | 69.1 %       | 58.2 %      | 39.1 %   | 30.9 % |

The tempo prior uses 1.5 octaves (Acc1 41.8 % with 0.5; 59.1 % with 1.0; 65.5 % with 1.5; 60.0 % with 3.0). Harmonic summation of the tempogram and a bass-reinforced onset made Acc1 worse and were discarded. With downbeat, the tempo is correct in 86 % of tracks versus 52 % without it, and in 88 % of the `full` ones. Both analyzers move to `smart-mix-audio-v3`, so the per-generation backfill reanalyses the library. Pending: a downbeat reference before A06; the Python fallback does not read `.m4a` and segfaults if several processes compile numba at the same time on the same cache.

SM07 evidence from 2026-10-15 in production (x86_64, read-only container with 1 CPU and `nice 19`, `crate-cli` from `e00792c3`). Candidates: 4000 random tracks from the DB, maximum 2 per artist, genre family from the album's highest-weighted genre; sample of 360 with BPM in tags, 40 per family. Second reference: the Essentia BPM stored in `library_tracks`.

| Family              | Rust v3 BPM ±4 % | Rust with octaves | Downbeat | `full` | Essentia ±4 % | Essentia with octaves |
| ------------------- | ---------------- | ----------------- | -------- | ------ | ------------- | --------------------- |
| Total (360)         | 76.4 %           | 83.3 %            | 43.6 %   | 33.6 % | 56.9 %        | 83.9 %                |
| electronic          | 70 %             | 72 %              | 40 %     | 30 %   | 60 %          | 90 %                  |
| hip-hop             | 68 %             | 90 %              | 62 %     | 53 %   | 55 %          | 80 %                  |
| metal               | 75 %             | 85 %              | 57 %     | 42 %   | 47 %          | 88 %                  |
| punk/hardcore       | 68 %             | 75 %              | 35 %     | 25 %   | 55 %          | 85 %                  |
| rock/alt            | 72 %             | 80 %              | 40 %     | 30 %   | 60 %          | 90 %                  |
| experimental/noise  | 78 %             | 80 %              | 35 %     | 25 %   | 42 %          | 68 %                  |
| pop/soul/jazz/other | 85 %             | 85 %              | 42 %     | 28 %   | 57 %          | 78 %                  |

With downbeat, the tempo is correct in 87 % of tracks (68 % without it) and in 90 % of the `full` ones. In 60 of the 85 tempo failures Essentia also fails; Rust's own failures are concentrated at 4/3 in electronic and 2/3 in punk/hardcore.

A06/A07/A08 evidence from 2026-10-19 on a Xiaomi 13 with internal bus capture (local stack, debug build, fixtures playlist 120 → 118 → 122 → 60 → 121 with drift, each fixture in its own album because native playback does not mix tracks from the same album). The lab uncovered three failures that the app's internal measurement did not see:

| Failure                                                                            | Measured effect                           | Fix                                                                             |
| ---------------------------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------- |
| Rust grid quantized to 512-sample frames at 22.05 kHz and delayed by ~22 ms        | 10–38 ms bias per beat; 24–33 ms of phase | Beats at the sharpest attack in 1 ms energy (`72146294`); grid at ≤1 ms         |
| BPM from the mean frame interval, extrapolated by the planner up to late cues      | ~19 ms at a cue at 138 s                  | BPM by regression over the refined grid (`72146294`); error 0.0003 %            |
| The held deck received its tempo at start and played ~600 ms at the previous speed | (ratio − 1) × 600 ms of error             | Rebuffer of the held deck after applying the tempo (`0b8034b3`)                 |
| Global BPM and phase from the anchor on a track with tempo drift                   | 25–28 ms of phase at the cue              | Local tempo and beat at each cue, with rejection of displaced hits (`d36c235c`) |

| Transition          | Ratio | Phase p95 (capture) | Internal error | Clipping | True peak | Incoming bass (start → end) |
| ------------------- | ----- | ------------------- | -------------- | -------- | --------- | --------------------------- |
| 120 → 118           | 1.017 | 3.0 ms              | −1.0 ms        | 0        | −3.7 dBTP | −13.6 → −2.7 dB             |
| 118 → 122           | 0.967 | 2.4 ms              | 0.3 ms         | 0        | −4.1 dBTP | −13.6 → −4.1 dB             |
| 122 → 60 (½ tempo)  | 1.017 | 6.0 ms              | −0.5 ms        | 0        | −4.1 dBTP | −14.4 → −3.9 dB             |
| 60 → 121 with drift | 0.989 | 25.0 ms             | 0.8 ms         | 0        | −4.6 dBTP | −13.3 → −3.6 dB             |

With local tempo (`d36c235c`), same playlist: 7.2 / 4.4 / 3.4 ms on the first three and **4.0 ms** on the drifting one (ratio 0.9916 versus 0.9893 with the global BPM); 0 clipping, true peak ≤ −4.1 dBTP. The analyzer measures 121.018 BPM at the start and 121.587 at the end of the drifting fixture (actual ≈ 121.0 / 121.58).

Complete capture (0 dropped frames); 3 `AudioTrack` underruns coincide with the script's seeks that jump to the cue.

Lifecycle matrix (`python tools/smart-mix-lab/device_matrix.py --serial <serial> --output artifacts/smart-mix/results/<date>`, seek outside the capture): baseline 2.4 ms, screen off 2.0 ms and forced Doze 6.0 ms of phase p95, all with 0 underruns, 0 clipping and a measured transition. **Correction (2026-10-19): the Doze result was not valid.** The capture was cut off in the middle of the mix (18–21 s of ~30 s) and the gate did not see it. Cause: the service passed `player.isPlaying()` to `onUpdateNotification`, Media3 calls `stopForeground` with `false`, and any buffering (a seek, a rebuffer) in the background left the service out of the foreground with no way back; without foreground and with the screen locked the app loses network, the incoming deck runs out of data and the bus, which waits for both decks to keep the phase, freezes entirely until Media3's `StuckPlayerDetector` kills the player. Fixes: the service uses Media3's condition (`playWhenReady` and READY or BUFFERING); a channel without data only blocks the bus for 200 ms and then plays as silence and abandons its deck (incoming before the handoff: it is cancelled and the outgoing continues; outgoing: handover to the incoming); the analysis adds the `captureContinuous` gate (captured frames versus real time, `stoppedAtMs` in the summary). Matrix repeated on the Xiaomi 13 on the fixtures: baseline 6.0 ms, screen off 5.2 ms, Doze 2.8 ms and no server 5.0 ms, all locked and complete, continuous capture (|gap| ≤ 0.06 s), 0 underruns, 0 player errors and 0 foreground failures. Abandonment for lack of data is covered by unit tests; on device it did not trigger because the incoming deck already had buffer. Without a server (`adb reverse` tunnel removed during the pre-roll) the beatmatch mix locks and an adaptive one completes with the incoming deck already buffered; the first pass uncovered that the pre-roll rebuffer requested samples that had already been read over the network again, and it was fixed with 5 s of back buffer per deck (`d101841b`). Calls, Bluetooth/cable routes and process death remain manual tests on the same device. Pending: process death, calls and routes on the same device, forcing the lack of data in the middle of a mix on device, and v4 reanalysis of the library.

**Analyzer v5 (2026-10-20).** With 10,304 v4 profiles in production, 75 % were `partial`: 87 % of those had no downbeat (in 44 % it was the only cause) and 4,368 had global stability < 0.8. Detection required a single bar phase for the whole track and for both halves to match, so a lost beat or a section change invalidated it even in steady genres (new wave without downbeat in 51 %, with unstable tempo in only 9 %). The planner does not need the bar for phase. v5 measures tempo, drift and jitter in the 12 s that play at each cue (at least 24 beats): drift comes from two regressions over the refined grid, jitter from the tracker's beats after subtracting the half-frame quantization, and cue stability is `1 − drift/10 % − jitter/20 %`. The downbeat is phased over 32 beats around each cue. `full` no longer requires downbeat. Migration 118 stores `intro/outro_tempo_stability` and `intro/outro_downbeat_ms`. The planner beatmatches with a reference beat at both cues, uses the stability of the cue being mixed with the 0.8 threshold and requires 2 bars of overlap; with less it does an adaptive crossfade (`insufficient_window`). Validation in production (760 tracks from 19 genres, separate read-only container) ruled out two calibrations: measuring on the refined attacks gave 0 % `full`, because in real recordings they deviate 15–60 ms from the line even when the pulse is steady. With the final calibration: `full` 23 % → 32 % (house 80 %, new wave 70 %, rock 52 %, heavy metal 12 %, death metal 12 %) and downbeat at both cues in 47 %. With a 0.7 threshold it would be 46 %; it can be lowered later without reanalysing. Lab on the Xiaomi 13: fixtures 7/6/6/12 ms of phase p95 and matrix baseline 3.0, screen off 6.0, Doze 7.4 and no server 6.0 ms, without underruns or clipping. The same package fixes a backfill race: a batch in progress rewrote the campaign when it finished and cancelled out a pause; progress updates are now a conditional update in the DB.

| Package     | Initial status | Commit / commands / artifacts / next blocker                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C00/P01–P06 | In progress    | P01 (`572f06b9`). P02: per-method allowlist, play events scope, local PAT search, no `path` in the catalog or in token search, auth without `FOR UPDATE` (`770ced11`, `0ecf37f9`, `55296480`, `7d5fa812`); minimal identity in `/api/auth/me` with a token (`20c9289a`); token UI in Listen with Crate Automix opt-in (`13a86be4`, `53b1e858`). P03: Traefik router for `Bearer crv_` to FastAPI in prod/home with priority 150, `CRATE_VDJ_ENABLED` gate and per-token automation state in capabilities (`20c9289a`, `f3204e51`). P04: one-level folders with parts of 500, DJ filter syntax, migration 113 for mood indexes, no seq scan on `library_tracks` (`1f774d15`). P05: 15 min token tickets, HEAD on the VDJ stream, `entity_uid` in playback (`162c1c9f`). Pending: validation of the playback payload in the plugin (V04), P06 in the backlog                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| SM01–SM07   | In progress    | SM03 (`f47ee91e`) and planner v2 (`7841daed`). SM01: migration 111 with decoder duration and measurement provenance (`580f4ad8`). SM02: BS.1770 with `ebur128` in Rust, streaming; Python publishes `null`; analyzer `smart-mix-audio-v2` (`63b43a6b`), bounded memory on long tracks (`00bd7749`). SM04: prior capture, CAS and claim tokens (`787a619a`). SM05: target generation (migration 112), campaign with pause/cancel and precomputed coverage without COUNT in the request (`0a45449a`); backfill with the Rust analyzer and protection against staggered deploys (`51faf79e`). SM06 (R1 part): eligibility before the limit with a ×2 profile window without scanning `library_tracks` (`d440c95b`), plan cache in one MGET and one pipeline per batch without PostgreSQL or `DELETE LIKE`, without decoding grids (`f7387031`). Invalidation from writers via library sync by source revision (`5b1e0f15`, `417fe2ab`). Local canary of 2026-10-14 verified (see evidence). `crate-python` profiles promoted to Rust automatically: the backfill claims them as soon as the worker has `crate-cli`, after the tracks without a profile and within the retry limit (`5f2ebf58`). Pending: musical validation of the grid in SM07, the rest of SM06 (federation in the backlog)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| A01–A08     | In progress    | A01 (`53d28608`, `beebff6a`), A02 (`c0cf2bb2`), A03 with R27 (`e08714d4`). A04: `executionId` and a single owner of handoff and advance, interruption matrix before and after the handoff, deck errors resolved once without double recovery in JS, one play event per audible track, checkpoint in the middle of a fade without reviving the transition (`04cdc2e9`, `1dd0986b`). A05: Smart Mix Settings on native Android with persistent opt-out and beatmatch/bass hidden (`000d5b90`); native reloads keep the duration (`787af8db`). Gradle 98/98, contexts Vitest 377/377. Android does not apply positive gain (staging ≤0 dB). A07 (2026-10-18, Xiaomi 13, local playlist of 16 `full` pairs at 118–127 BPM): native executes the beatmatch plans with per-deck speed, start cue shifted by `beatPhaseOffsetMs × ratio`, 2.5 s muted pre-roll, phase correction by positions, return to speed 1.0 over 4 s and fallback to adaptive if the phase does not lock; the mix always starts. With two Media3 outputs the phase measured by positions is not reliable: the error at the cue ranges from −1.6 s to +0.4 s with speed via AudioTrack or via Sonic and it only locks 1 in ~7 transitions. Common PCM bus (2026-10-19, `0de50a8b`…`8b9411cf`): incoming start on an exact bus frame, 8/8 locked with 0.1–6.6 ms start error measured by positions, software EQ with a ramp, resampler to 48 kHz, downmix of up to 5.1, idle pause and rebuilding of the `AudioTrack`; Gradle 178/178 (see A07). A08 (2026-10-19, `c4238c76`, `7fe2fc0b`, `55b97fb7`): 150 Hz shelf down to −24 dB per deck inside the envelope, swapping around `handoffProgress` over 1/8 of the mix, only with beatmatch locked; release in 100 ms on cancel; flag `CRATE_ANDROID_BASS_HANDOFF_ENABLED`, capability `android_bass_handoff` and `allowBassHandoff` in the context, which the server only honours with the flag; beatmatch and bass swap opt-in in Settings. On device, Derrota → Fazer with swap: `balanced` plan, filter active ~6.7 s per deck, −4.3 dB of energy on the incoming and −3.8 dB on the outgoing, no clipping; without swap, `bass=none`. Gradle 191/191. Pending: external capture for A06/A07/A08, calls, RSS and battery over a long session, repeat A02–A06 on the bus |
| A09–A10     | Done           | A09: continuation token bound to `sid` (migration 115) and native plans in the background; Xiaomi 13, 2026-10-18: at index 30 of 40 it requested 9 edges and 32→33 and 33→34 arrived with a server cue. A10a: the token also authorizes streams (native uses the JWT until 60 s before its `exp`) and the readplane delegates `crv_` tokens to FastAPI; the queue kept playing 21 min after the JWT expired (12:28), all 200/206. A10b: `POST /api/playback/continuation` with the descriptor in the token (migration 116) and an owner check on `/api/radio/next`. A10c: native refill and adoption in Listen; with the WebView frozen the radio added 10 tracks with 10 plans at index 16, they played (by-entity 200) and Listen adopted them on return, showing the real track. Pending: rebuild tracks added after process death (out of scope)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| V01–V10     | In progress    | V01: nlohmann/json 3.11.3 pinned by SHA with body, depth and collection limits; libcurl HTTPS only without redirects, NOSIGNAL and a body cap; negotiation by ranges with a single version 1.0.0; real redaction in logs; stale only on transport errors or 5xx; transactional SQLite migration; validation of the playback payload; `CRATE_CHECK` instead of `assert` and sanitizers linking (`6899f736`, `f9f22430`, `56f104de`, `226739f3`, `844ac11f`, `ede6ea79`, `6d9cf984`). CTest 17/17 headless, Release and ASan/UBSan; 19/19 with the SDK. VH01 prepared: `CrateProbe` probe plugin, local server with Range/HEAD/expiring tickets, summarizer and 15 min script (`7eeb0b5e`); pending execution on the host. Next: V02 and V03 after VH01                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| X01–X04     | Pending        | No joint acceptance/release                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

When a task starts, its individual row is expanded: `pending → in progress → verified` or `blocked` with a concrete cause and next step. Note which gates are missing, not subjective progress percentages.

| Date       | Current decision                                                                                             | Consequence                                                                    |
| ---------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| 2026-09-09 | A single design and a single plan for Smart Mix + Android + VDJ                                              | They supersede earlier plans/spikes; no third per-platform guide               |
| 2026-09-09 | Keep WIP and shared contracts; API 2026-09/analyzer v2/batch planner string v2/integer plan 2                | P01 freezes fixtures, SM01 migrates additively                                 |
| 2026-09-09 | Two Android decks first; PCM bus only on a failed physical gate                                              | A06/A07 decide with capture, not by architectural preference                   |
| 2026-09-09 | VDJ A+B and C in two binaries without daemon/IPC                                                             | Independent negotiation and state; SDK host is a gate                          |
| 2026-09-09 | All earlier deliverables kept; incremental milestones                                                        | Turning off an option does not close missing work                              |
| 2026-10-08 | Releases R1–R4 that can close separately, and an explicit backlog                                            | No deliverable blocks another release                                          |
| 2026-10-08 | VDJ fits the 2021 SDK: one folder level, no cursors, ticket in URL, public covers                            | P04, P05, V03 and V04 rewritten; VH01 settles what is undocumented             |
| 2026-10-08 | C becomes Crate Automix on top of VDJ's native automix; no lease or own executor                             | P03 without lease; V06 rewritten; private cues withdrawn for VDJ               |
| 2026-10-08 | A single Online Source binary with the permanent name `Crate`; Pro license requirement                       | V02 and V10; second binary only if VH01 requires it                            |
| 2026-10-13 | Main uses 104–108 in production; the branch renumbers its migrations to 109–114                              | `schema_sections` modules and tests renamed with the same number               |
| 2026-10-15 | Smart Mix Android is completed before VirtualDJ: order R1 → R4 and then R2–R3                                | The VDJ plugin and its platform (PAT, VDJ catalog) leave the R1 PR             |
| 2026-10-15 | With Smart Mix active, every automatic queue is mixed except albums; only a manual skip uses a short ramp    | Planner `rules_revision` 2 in the plan cache key                               |
| 2026-10-15 | Smart Mix comes to iOS as R5 after R1 closes, with `AVAudioEngine` and the same native contract              | New Swift plugin; server and Listen are reused                                 |
| 2026-10-19 | A06–A08 are certified only on the Xiaomi 13 with internal PCM bus capture                                    | No external loopback or Pixel; DAC/HAL outside the gate (see A06)              |
| 2026-10-19 | `crate-python` profiles are promoted to Rust without a separate campaign                                     | The backfill reanalyses them when `crate-cli` is present; no pending decision  |
| 2026-10-19 | Android uses the common PCM bus as executor; replaces the 2026-09-09 decision to wait for the physical gate  | Beatmatch only with the bus; A07 stays open until the external capture         |
| 2026-10-20 | Beatmatch based on beat stability at each cue (v5) with a 0.8 threshold; downbeat is no longer a requirement | 32 % of the sample eligible; the threshold can be adjusted without reanalysing |
| 2026-10-20 | Beatmatch requires 2 bars of overlap; the chosen duration is not blocked                                     | Shorter mixes do an adaptive crossfade                                         |

A review that changes a decision must state the reason, evidence, impact on contracts/capabilities/migration and the affected tasks. Every old guide remains historical even if its checkboxes say complete.

### Documentation validation for this review

On 2026-09-09 both documents and their publication in the portal were verified: `node scripts/check-docs.mjs` passed with 37 canonical documents; from `app/docs`, `npm test -- src/smoke.test.tsx` passed 7/7 including both deep links and their reciprocal links, and `npm run build` completed TypeScript/Vite. The dependencies already installed in the main checkout were used temporarily, without changing lockfiles. This evidence validates the documentation and its loaders; it does not prove execution of the plan's functional packages.

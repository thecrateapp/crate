# Crate VirtualDJ Integration Implementation Plan

> **For agents:** REQUIRED SUB-SKILL: Use viterbit-ai-tools:executing-plans to implement this plan task by task.

**Goal:** Deliver A+B+C VirtualDJ integration in the Crate monorepo: Online
Source catalog access, Smart Mix assistance and guarded automatic transitions.

**Architecture:** A native Online Source target handles catalog and Smart Mix
actions. A separate General Automation target controls VirtualDJ decks through
the SDK base callbacks and VDJScript. Both targets use an SDK-independent C++20
core. Crate remains authoritative for Smart Mix, auth, profiles, ranking, cues
and transition plans.

**Tech Stack:** Python 3.13, FastAPI, SQLAlchemy 2.0, PostgreSQL 15, Redis 7,
Go readplane, C++20, CMake, SQLite, VirtualDJ SDK v8, pytest, Go tests,
Vitest, CTest, Windows DLL and macOS bundles.

---

## 0. Execution rules

- Work in the Smart Mix worktree and rebase/update from main before coding.
- Keep the plugin in tools/vdj-plugin inside the monorepo.
- Never commit VirtualDJ SDK headers or sample sources.
- Use VIRTUALDJ_SDK_ROOT for local/private SDK discovery.
- Treat the current migration head as authoritative. The validated Smart Mix
  worktree currently ends at revision 090; if main advances, renumber all
  unmerged VDJ migrations as one linear tail before creating them.
- Keep the existing Smart Mix profile and planner contracts authoritative.
- Do not copy compatibility weights, analysis or planner logic into C++.
- Every network operation is cancellable and off the VirtualDJ UI thread.
- Automation is disabled by default and must have a server-side kill switch.
- User interaction always wins over automatic control.
- Readplane is a measured decision, not a default requirement.
- Rekordbox is not part of this plan.
- Follow RED, GREEN, REFACTOR and commit each completed task.

## 1. Definition of done

- A user can create, rotate and revoke a least-privilege VirtualDJ token.
- The plugin can negotiate Crate/plugin/profile/planner compatibility.
- VirtualDJ can browse and search the local Crate catalog.
- A local Crate track can be loaded and played in a deck.
- Smart Mix profiles and compatible-track ranking are visible without local
  reimplementation.
- A transition plan can be validated and executed by the General Automation
  target through VirtualDJ commands.
- Manual deck intervention cancels automation safely.
- Missing analysis, stale plans, unsupported commands and network failures
  fall back to manual playback.
- Metadata cache, optional audio cache, prefetch, radio, cues, now-playing,
  play events, search filters and observability are implemented or explicitly
  gated by their own phase.
- Readplane is either implemented with proven parity or documented as
  unnecessary after measurement.
- Plugin and Crate versions are independently released and compatibility is
  visible through capabilities.
- Windows and macOS packages pass the signed release and soak gates.

## Phase 0 — Contracts, versioning and SDK feasibility

### Task 1: Freeze current Crate contracts

**Files:**

- Modify: app/crate/config.py
- Modify: app/crate/api/capabilities.py
- Modify: app/crate/api/schemas/capabilities.py
- Create: app/tests/test_vdj_contract_baseline.py
- Create: app/tests/test_vdj_capabilities.py

**Step 1: Write failing characterization tests**

Cover the current behavior of:

- GET /api/capabilities;
- GET /api/search with scope=local;
- POST /api/auth/media-access;
- GET /api/tracks/by-entity/{uid}/playback;
- GET /api/tracks/by-entity/{uid}/mix-profile;
- GET /api/tracks/by-entity/{uid}/compatible;
- POST /api/playback/transition-plans;
- POST /api/me/play-events.

Assert that existing Listen and Android capability fields remain unchanged.

**Step 2: Run the tests**

Run:

~~~text
cd app
pytest -q tests/test_vdj_contract_baseline.py tests/test_vdj_capabilities.py
~~~

Expected: the new baseline tests fail only for the VDJ fields that do not yet
exist.

**Step 3: Add additive VDJ capabilities**

Add configuration and typed fields for:

- integration enabled;
- minimum and maximum plugin version;
- contract version;
- profile schema;
- planner version;
- source, assistant and automation availability;
- automation kill-switch state.

Do not require VDJ auth for the public capability discovery request. The
authenticated plugin request must still be checked before private features are
used.

**Step 4: Verify**

Run the focused tests and the existing capability suite:

~~~text
cd app
pytest -q tests/test_capabilities.py tests/test_vdj_contract_baseline.py tests/test_vdj_capabilities.py
~~~

**Step 5: Commit**

~~~text
git add app/crate/config.py app/crate/api/capabilities.py app/crate/api/schemas/capabilities.py app/tests/test_vdj_contract_baseline.py app/tests/test_vdj_capabilities.py
git commit -m "feat(vdj): expose versioned plugin capabilities"
~~~

### Task 2: Prove SDK loading and deck control

**Files:**

- Create: tools/vdj-plugin/CMakeLists.txt
- Create: tools/vdj-plugin/cmake/FindVirtualDJSDK.cmake
- Create: tools/vdj-plugin/spike/control_spike.cpp
- Create: tools/vdj-plugin/tests/sdk/control_spike_contract.md
- Create: tools/vdj-plugin/README.md

**Step 1: Add private SDK discovery**

Make the real plugin target require VIRTUALDJ_SDK_ROOT and validate the
presence of the required SDK headers. Keep a headless target that builds
without the SDK.

**Step 2: Build the smallest General plugin**

Implement a private spike that:

- loads through the VirtualDJ plugin folder;
- calls GetInfo for current deck, BPM, beat position and elapsed time;
- calls SendCommand for play, sync, auto_bpm_transition and auto_crossfade;
- records command result and observed state;
- exits safely when unloaded.

**Step 3: Validate the Online Source lifecycle**

Implement only enough of the Online Source interface to prove asynchronous
search completion, cancellation, stream URL resolution and context menu
registration.

**Step 4: Run the manual gate**

Test on a supported VirtualDJ installation:

- load/unload;
- two decks;
- manual takeover during a command;
- slow command response;
- unsupported or rejected command;
- VirtualDJ restart.

Record the result in control_spike_contract.md. If high-level automation
cannot be made safe, stop before backend work and revise the executor boundary.

**Step 5: Commit**

~~~text
git add tools/vdj-plugin
git commit -m "test(vdj): prove SDK control boundary"
~~~

### Task 3: Scaffold the SDK-independent C++ core and mock harness

**Files:**

- Modify: tools/vdj-plugin/CMakeLists.txt
- Create: tools/vdj-plugin/include/crate_vdj/http_client.hpp
- Create: tools/vdj-plugin/include/crate_vdj/models.hpp
- Create: tools/vdj-plugin/include/crate_vdj/core.hpp
- Create: tools/vdj-plugin/src/core/http_client.cpp
- Create: tools/vdj-plugin/src/core/models.cpp
- Create: tools/vdj-plugin/tests/client/http_client_test.cpp
- Create: tools/vdj-plugin/tests/sdk/mock_virtualdj.hpp
- Create: tools/vdj-plugin/tests/sdk/lifecycle_test.cpp

**Step 1: Write failing core tests**

Cover:

- strict JSON mapping with unknown-field tolerance;
- required-field and schema-version rejection;
- URL origin validation;
- request cancellation and timeout;
- normalized errors;
- mock callback completion exactly once;
- destruction with in-flight work.

**Step 2: Implement the core interfaces**

Keep SDK types out of all core headers. Define interfaces for:

- HttpClient;
- CredentialStore;
- MetadataCache;
- Clock;
- CapabilityClient;
- VirtualDJCommandPort;
- VirtualDJStatePort.

**Step 3: Add warnings and sanitizers**

Enable strict warnings, AddressSanitizer and UndefinedBehaviorSanitizer where
the host compiler supports them.

**Step 4: Verify**

~~~text
cmake -S tools/vdj-plugin -B build/vdj-headless -DCRATE_VDJ_BUILD_REAL_PLUGIN=OFF -DCRATE_VDJ_BUILD_TESTS=ON
cmake --build build/vdj-headless
ctest --test-dir build/vdj-headless --output-on-failure
~~~

**Step 5: Commit**

~~~text
git add tools/vdj-plugin
git commit -m "feat(vdj): scaffold SDK-independent core"
~~~

## Phase 1 — Authentication and source foundation

### Task 4: Add scoped VirtualDJ access tokens

**Files:**

- Create: app/crate/db/migrations/versions/091_user_access_tokens.py
- Create: app/crate/db/orm/access_tokens.py
- Modify: app/crate/db/orm/__init__.py
- Create: app/crate/db/repositories/access_tokens.py
- Create: app/crate/api/access_tokens.py
- Create: app/crate/api/schemas/access_tokens.py
- Modify: app/crate/api/auth.py
- Modify: app/crate/api/__init__.py
- Create: app/tests/test_access_token_repository.py
- Create: app/tests/test_access_token_api.py
- Create: app/tests/test_access_token_auth.py
- Modify: app/tests/test_federation_migration_matrix.py

**Step 1: Confirm the migration head**

Run:

~~~text
cd app
alembic heads
~~~

If the head is no longer 090, rename the three unmerged VDJ migration files
before staging them. Never create an Alembic branch head for convenience.

**Step 2: Write failing repository tests**

Cover:

- 256-bit random secret generation;
- digest and prefix storage;
- one-time secret return;
- expiry and immediate revocation;
- allowed scopes;
- atomic rotation;
- user isolation;
- rate-limited last-used updates.

**Step 3: Implement persistence**

Create user_access_tokens with a user foreign key, unique digest, token type,
scope data, expiry, revocation and lookup indexes. Store no raw token.

**Step 4: Write and pass API/auth tests**

Cover create, list, rotate, revoke, bearer authentication, missing scopes,
expired tokens, revoked tokens and secret redaction.

**Step 5: Verify migrations**

~~~text
cd app
pytest -q tests/test_access_token_repository.py tests/test_access_token_api.py tests/test_access_token_auth.py tests/test_federation_migration_matrix.py
~~~

**Step 6: Commit**

~~~text
git add app/crate app/tests
git commit -m "feat(auth): add scoped VirtualDJ access tokens"
~~~

### Task 5: Implement secure credentials and plugin negotiation

**Files:**

- Create: tools/vdj-plugin/src/auth/credential_store_windows.cpp
- Create: tools/vdj-plugin/src/auth/credential_store_macos.mm
- Create: tools/vdj-plugin/src/auth/credential_store_test.cpp
- Create: tools/vdj-plugin/src/client/capability_client.cpp
- Create: tools/vdj-plugin/src/client/contract_negotiator.cpp
- Create: tools/vdj-plugin/tests/auth/credential_redaction_test.cpp
- Create: tools/vdj-plugin/tests/client/contract_negotiator_test.cpp

**Step 1: Write failing tests**

Cover:

- OS credential store interface;
- process-only test store;
- no plaintext config fallback;
- cached capability expiry;
- incompatible major version;
- unsupported optional feature;
- profile/planner mismatch;
- redaction of token, media ticket and signed URL.

**Step 2: Implement platform stores**

Use Windows Credential Manager and macOS Keychain. Keep test doubles in
memory. Production diagnostics must contain only token prefix or token ID.

**Step 3: Implement negotiation**

Send the plugin version and requested features, validate server ranges, cache
capabilities for a bounded period and expose a typed feature set to both
adapters.

**Step 4: Verify and commit**

~~~text
cmake --build build/vdj-headless
ctest --test-dir build/vdj-headless --output-on-failure
git add tools/vdj-plugin
git commit -m "feat(vdj): add secure credentials and negotiation"
~~~

## Phase 2 — A: Online Source

### Task 6: Implement local browse and search mapping

**Files:**

- Create: tools/vdj-plugin/src/online_source/online_source.cpp
- Create: tools/vdj-plugin/src/online_source/search_client.cpp
- Create: tools/vdj-plugin/src/mapping/search_results.cpp
- Create: tools/vdj-plugin/include/crate_vdj/online_source.hpp
- Create: tools/vdj-plugin/tests/online_source/search_mapping_test.cpp
- Create: tools/vdj-plugin/tests/fixtures/search_local.json

**Step 1: Write mapping tests**

Cover artists, albums, tracks, missing artwork, missing analysis, empty
results, malformed optional fields, stale results and localized errors.

**Step 2: Implement asynchronous search**

Every request sends scope=local. Return S_FALSE for network-backed searches,
call finish exactly once, cancel stale requests and never block the UI thread.

**Step 3: Implement folders**

Map artists, albums, playlists, genres, moods and recently played to bounded
cursor-backed VirtualDJ folders.

**Step 4: Verify**

~~~text
cmake --build build/vdj-headless
ctest --test-dir build/vdj-headless --output-on-failure
~~~

**Step 5: Commit**

~~~text
git add tools/vdj-plugin
git commit -m "feat(vdj): browse and search local catalog"
~~~

### Task 7: Resolve streams through current media contracts

**Files:**

- Create: tools/vdj-plugin/src/client/media_access_client.cpp
- Create: tools/vdj-plugin/src/client/stream_resolver.cpp
- Create: tools/vdj-plugin/tests/client/stream_resolver_test.cpp
- Modify: app/tests/test_media_access_tickets.py
- Create: app/tests/test_vdj_stream_scope.py

**Step 1: Write failing tests**

Cover:

- local entity identity;
- bearer token scope;
- POST /api/auth/media-access;
- playback resolution;
- ticket expiration;
- one bounded authorization retry;
- range support;
- cross-origin redirect rejection;
- no ticket or URL persistence;
- log redaction.

**Step 2: Implement just-in-time resolution**

Store entity identity and media metadata only. Keep ticket and signed URL in
memory. Resolve through the existing playback and stream endpoints.

**Step 3: Verify**

~~~text
cd app
pytest -q tests/test_media_access_tickets.py tests/test_vdj_stream_scope.py
cd ..
ctest --test-dir build/vdj-headless --output-on-failure
~~~

**Step 4: Commit**

~~~text
git add app/tests tools/vdj-plugin
git commit -m "feat(vdj): load authenticated local streams"
~~~

### Task 8: Add versioned metadata cache

**Files:**

- Create: tools/vdj-plugin/src/cache/sqlite_metadata_cache.cpp
- Create: tools/vdj-plugin/include/crate_vdj/metadata_cache.hpp
- Create: tools/vdj-plugin/tests/cache/metadata_cache_test.cpp
- Create: tools/vdj-plugin/tests/cache/cache_migration_test.cpp

**Step 1: Write cache tests**

Cover TTL, 24-hour stale usability, LRU, schema upgrades, node/account
isolation, concurrent readers and rejection of secrets.

**Step 2: Implement the cache**

Store validated response models, never bearer tokens, media tickets, signed
URLs or local file paths. Mark stale responses explicitly.

**Step 3: Verify and commit**

~~~text
ctest --test-dir build/vdj-headless --output-on-failure
git add tools/vdj-plugin
git commit -m "feat(vdj): cache catalog metadata safely"
~~~

## Phase 3 — B: Smart Mix Assistant

### Task 9: Consume Smart Mix profiles

**Files:**

- Create: tools/vdj-plugin/src/client/smart_mix_client.cpp
- Create: tools/vdj-plugin/src/mapping/mix_profile.cpp
- Create: tools/vdj-plugin/tests/client/smart_mix_client_test.cpp
- Create: tools/vdj-plugin/tests/fixtures/mix_profile_summary.json
- Reference: app/crate/api/smart_mix.py
- Reference: app/crate/api/schemas/smart_mix.py

**Step 1: Write schema-version tests**

Cover valid profile, unavailable profile, low confidence, missing optional
fields, unsupported profile version and planner mismatch.

**Step 2: Implement summary mapping**

Expose BPM, key, Camelot, energy, cues and confidence. Do not request or
persist full beat grids unless a later VirtualDJ capability explicitly needs
them.

**Step 3: Verify**

~~~text
cd app
pytest -q tests/test_smart_mix_api.py tests/test_smart_mix_models.py
cd ..
ctest --test-dir build/vdj-headless --output-on-failure
~~~

**Step 4: Commit**

~~~text
git add tools/vdj-plugin
git commit -m "feat(vdj): consume Smart Mix profiles"
~~~

### Task 10: Add compatible-track context actions

**Files:**

- Create: tools/vdj-plugin/src/online_source/compatible_tracks.cpp
- Create: tools/vdj-plugin/src/mapping/compatible_tracks.cpp
- Create: tools/vdj-plugin/tests/online_source/compatible_tracks_test.cpp

**Step 1: Write tests**

Assert scope=local, planner version, server order, score-breakdown display,
missing-profile fallback and cancellation of stale responses.

**Step 2: Implement context folder**

Map server-ranked results to a temporary VirtualDJ folder/action. Never
recompute scores in C++.

**Step 3: Commit**

~~~text
git add tools/vdj-plugin
git commit -m "feat(vdj): expose Smart Mix compatible tracks"
~~~

### Task 11: Consume and validate transition plans

**Files:**

- Create: tools/vdj-plugin/src/client/transition_plan_client.cpp
- Create: tools/vdj-plugin/src/automation/transition_plan_validator.cpp
- Create: tools/vdj-plugin/tests/automation/transition_plan_validator_test.cpp
- Reference: app/crate/api/smart_mix.py
- Reference: app/crate/api/schemas/smart_mix.py

**Step 1: Write validation tests**

Reject mismatched entity UIDs, profile revisions, planner versions, unsupported
transition modes, invalid duration/tempo bounds and stale queue revisions.

**Step 2: Implement plan validation**

Keep the backend plan immutable. Return a typed fallback reason rather than
silently modifying a plan.

**Step 3: Verify and commit**

~~~text
ctest --test-dir build/vdj-headless --output-on-failure
git add tools/vdj-plugin
git commit -m "feat(vdj): validate Smart Mix transition plans"
~~~

## Phase 4 — C: Smart Mix Automation

### Task 12: Add the VirtualDJ state and command ports

**Files:**

- Create: tools/vdj-plugin/include/crate_vdj/vdj_state.hpp
- Create: tools/vdj-plugin/include/crate_vdj/vdj_commands.hpp
- Create: tools/vdj-plugin/src/automation/vdj_state_reader.cpp
- Create: tools/vdj-plugin/src/automation/vdj_command_port.cpp
- Create: tools/vdj-plugin/tests/automation/vdj_state_reader_test.cpp
- Create: tools/vdj-plugin/tests/automation/vdj_command_port_test.cpp

**Step 1: Write deterministic port tests**

Cover query parsing for active deck, free deck, loaded entity, BPM, beat
position, elapsed time, readiness, crossfader and manual-control signals.

**Step 2: Implement the ports**

Translate core intents to a bounded allowlist of VDJScript commands. Do not
accept arbitrary commands from the server or remote input.

**Step 3: Add capability mapping**

Represent whether the current VirtualDJ instance supports the command needed
by a plan. Unsupported commands produce fallback, not retries.

**Step 4: Verify and commit**

~~~text
ctest --test-dir build/vdj-headless --output-on-failure
git add tools/vdj-plugin
git commit -m "feat(vdj): add deck state and command ports"
~~~

### Task 13: Implement automation state machine

**Files:**

- Create: tools/vdj-plugin/src/automation/automation_state_machine.cpp
- Create: tools/vdj-plugin/include/crate_vdj/automation_state_machine.hpp
- Create: tools/vdj-plugin/tests/automation/automation_state_machine_test.cpp

**Step 1: Write failing state tests**

Cover disabled, armed, assisted, automatic, cancelled and fallback states.
Include manual takeover during preload, sync and crossfade.

**Step 2: Implement transitions**

The state machine must:

- prepare only the free deck;
- verify incoming readiness;
- validate plan and profile revisions;
- send one bounded command at a time;
- observe acknowledgement through state queries;
- stop on user input or timeout;
- report a typed fallback reason.

**Step 3: Add deterministic clocks**

All timeout, retry and transition-duration logic uses the Clock interface.

**Step 4: Verify and commit**

~~~text
ctest --test-dir build/vdj-headless --output-on-failure
git add tools/vdj-plugin
git commit -m "feat(vdj): add guarded automation state machine"
~~~

### Task 14: Build the General Automation plugin target

**Files:**

- Create: tools/vdj-plugin/src/automation/general_automation_plugin.cpp
- Create: tools/vdj-plugin/tests/sdk/general_automation_lifecycle_test.cpp
- Modify: tools/vdj-plugin/CMakeLists.txt
- Modify: tools/vdj-plugin/README.md

**Step 1: Write lifecycle tests**

Cover load, unload, automation disabled by default, kill switch, cancellation,
late callbacks, VirtualDJ restart and clean handoff to manual mode.

**Step 2: Implement the plugin adapter**

Keep SDK callbacks thin. Delegate state, plans and transitions to the core.
Never perform network or blocking database work in the callback.

**Step 3: Verify with the SDK spike**

Repeat the manual two-deck test and verify that manual intervention always
stops automatic control.

**Step 4: Commit**

~~~text
git add tools/vdj-plugin
git commit -m "feat(vdj): add guarded automation plugin"
~~~

### Task 15: Add transition measurement and soak instrumentation

**Files:**

- Create: tools/vdj-plugin/src/automation/transition_metrics.cpp
- Create: tools/vdj-plugin/tests/automation/transition_metrics_test.cpp
- Create: docs/technical/vdj-automation-operations.md
- Modify: app/crate/metrics.py
- Create: app/tests/test_vdj_automation_metrics.py

**Step 1: Define measurements**

Record bounded-cardinality metrics for preload time, command latency, plan
fallback, manual takeover, transition completion and automation errors.

**Step 2: Add local diagnostics**

The plugin log includes plugin/contract/planner versions, request IDs and
normalized errors, but never credentials, signed URLs or file paths.

**Step 3: Run the measurement gate**

Test at least:

- two-deck normal operation;
- slow API;
- offline node;
- manual takeover at every state;
- unsupported VDJ command;
- four-hour soak.

**Step 4: Commit**

~~~text
git add app/crate/metrics.py app/tests docs/technical/vdj-automation-operations.md tools/vdj-plugin
git commit -m "feat(vdj): measure automation safety and latency"
~~~

## Phase 5 — Full extension set

### Task 16: Add radio session reuse

**Files:**

- Create: tools/vdj-plugin/src/client/radio_client.cpp
- Create: tools/vdj-plugin/src/online_source/radio_source.cpp
- Create: tools/vdj-plugin/tests/client/radio_client_test.cpp
- Modify: app/tests/test_radio_contracts.py

Cover start, next, feedback, expiry, local candidates, cancellation and manual
restart after an expired session.

Commit:

~~~text
git commit -m "feat(vdj): reuse Crate radio sessions"
~~~

### Task 17: Add private cue overrides

**Files:**

- Create: app/crate/db/migrations/versions/092_user_track_cue_points.py
- Create: app/crate/db/orm/cue_points.py
- Create: app/crate/db/repositories/cue_points.py
- Create: app/crate/api/dj.py
- Create: app/crate/api/schemas/dj.py
- Create: app/tests/test_dj_cue_points.py
- Create: tools/vdj-plugin/src/client/cue_client.cpp
- Create: tools/vdj-plugin/src/automation/cue_sync.cpp
- Create: tools/vdj-plugin/tests/client/cue_sync_test.cpp

Use private user overrides with revision-safe upserts. Keep Smart Mix automatic
cues global and user edits private. Test user isolation, conflicts, deletes,
offline reads and no deck-loading delay.

Commit:

~~~text
git commit -m "feat(vdj): synchronize private cue overrides"
~~~

### Task 18: Add now-playing and idempotent play events

**Files:**

- Modify: app/crate/api/dj.py
- Modify: app/crate/api/me.py
- Create: app/crate/services/dj_presence.py
- Create: app/tests/test_dj_now_playing.py
- Create: app/tests/test_dj_play_events.py
- Create: tools/vdj-plugin/src/client/now_playing_client.cpp
- Create: tools/vdj-plugin/src/client/play_event_client.cpp
- Create: tools/vdj-plugin/tests/client/telemetry_client_test.cpp

Heartbeat requirements:

- 30-second client interval;
- 90-second Redis TTL;
- bounded rate limit;
- deck isolation;
- best-effort failure behavior.

Play-event requirements:

- existing record_play_event repository path;
- idempotency key;
- minimum audible threshold;
- bounded retry spool;
- no media credentials in the spool.

Commit:

~~~text
git commit -m "feat(vdj): add presence and play-event telemetry"
~~~

### Task 19: Add optional audio cache and prefetch

**Files:**

- Create: tools/vdj-plugin/src/cache/audio_cache.cpp
- Create: tools/vdj-plugin/src/cache/prefetch_queue.cpp
- Create: tools/vdj-plugin/tests/cache/audio_cache_test.cpp
- Create: tools/vdj-plugin/tests/cache/offline_playback_test.cpp

Keep audio caching disabled until the operator and legal policy is documented.
Cover byte cap, LRU, integrity, active-deck pinning, next-three limit,
cancellation, encryption boundary and ticket absence.

Commit:

~~~text
git commit -m "feat(vdj): add bounded offline audio cache"
~~~

### Task 20: Add DJ search filters and cursor pagination

**Files:**

- Modify: app/crate/api/browse_media.py
- Modify: app/crate/api/schemas/media.py
- Modify: app/crate/db/queries/browse_media_search.py
- Create: app/crate/db/migrations/versions/093_vdj_search_indexes.py
- Create: app/tests/test_vdj_search_filters.py
- Create: app/tests/test_vdj_search_pagination.py
- Create: tools/vdj-plugin/src/client/search_filters.cpp
- Create: tools/vdj-plugin/tests/client/search_filters_test.cpp

Implement BPM, Camelot key, energy, analysis_required, stable cursor and
fields=dj as additive behavior. Keep existing Listen search unchanged when no
DJ filters are supplied. Page size remains capped at 50.

Commit:

~~~text
git commit -m "feat(search): add VirtualDJ Smart Mix filters"
~~~

### Task 21: Harden observability and abuse boundaries

**Files:**

- Modify: app/crate/metrics.py
- Modify: app/crate/api/access_tokens.py
- Modify: app/crate/api/dj.py
- Create: app/tests/test_vdj_security.py
- Create: app/tests/test_vdj_observability.py
- Create: tools/vdj-plugin/tests/security/
- Create: docs/technical/vdj-plugin-operations.md

Test and document:

- token abuse and revocation;
- SSRF and cross-origin redirect prevention;
- oversized metadata;
- cursor tampering;
- ticket expiry/reuse;
- cue ownership;
- cache corruption;
- TLS verification;
- bounded metric labels;
- secret/log scanning.

Commit:

~~~text
git commit -m "test(vdj): harden plugin boundaries"
~~~

## Phase 6 — Readplane decision and optional implementation

### Task 22: Measure whether readplane is needed

**Files:**

- Create: app/tests/test_vdj_fastapi_latency.py
- Modify: docs/technical/vdj-plugin-operations.md

Measure FastAPI-only p50, p95 and p99 for:

- local search;
- profile summary;
- compatible-track context;
- transition-plan batch;
- stream authorization.

Use production-scale catalog fixtures and realistic concurrent plugin clients.

Decision gate:

- If FastAPI meets the defined plugin startup and interaction SLOs, document
  readplane as unnecessary for the first release.
- If it does not, continue with Task 23.

Commit the measurement and decision separately:

~~~text
git commit -m "docs(vdj): record readplane decision"
~~~

### Task 23: Add readplane parity only if the gate requires it

**Files:**

- Create: app/readplane/internal/auth/access_token.go
- Create: app/readplane/internal/auth/access_token_test.go
- Modify: app/readplane/internal/routes/catalog.go
- Create: app/readplane/internal/catalog/vdj_search.go
- Create: app/readplane/internal/catalog/vdj_search_test.go
- Create: app/readplane/internal/contract/vdj_contract_test.go
- Modify: app/tests/test_readplane_catalog_routing.py

Only implement this task after Task 22 fails its SLO. Reuse the same golden
fixtures as FastAPI and require identical auth, ordering, cursor and error
shapes before routing any VDJ request to readplane.

Commit:

~~~text
git commit -m "feat(readplane): serve VirtualDJ catalog contracts"
~~~

## Phase 7 — Versioned CI, packaging and release

### Task 24: Add independent CI workflows

**Files:**

- Create: .github/workflows/vdj-plugin.yml
- Create: .github/workflows/vdj-plugin-release.yml
- Modify: .github/workflows/test-backend.yml
- Modify: Makefile
- Create: tools/vdj-plugin/packaging/manifest.json
- Create: tools/vdj-plugin/packaging/README.md

PR workflow:

- Python contract tests;
- Go tests if readplane is enabled;
- Linux C++ headless build;
- CTest;
- sanitizers;
- dependency/license report;
- no SDK or signing secrets required.

Plugin release workflow:

- trigger on vdj-v* tags;
- build Windows x64;
- build macOS Intel;
- build macOS Apple Silicon;
- use private SDK artifact and signing credentials;
- generate checksums and SBOM;
- validate packaging manifest;
- upload release artifacts.

Stack release workflow:

- continue on v* tags;
- run compatibility fixtures against the plugin contract;
- do not bump the plugin version;
- publish the supported compatibility range.

Add targets:

~~~text
make vdj-test
make vdj-build
make vdj-package
~~~

Commit:

~~~text
git commit -m "ci(vdj): build independently versioned plugin packages"
~~~

### Task 25: Execute manual compatibility and release soak

**Files:**

- Modify: docs/technical/vdj-plugin-operations.md
- Create: docs/releases/vdj-plugin-1.0.0.md

Matrix:

- Windows x64;
- macOS Intel and Apple Silicon;
- oldest and newest supported VirtualDJ;
- Crate stack at minimum and maximum declared contract;
- valid, expired, revoked and rotated token;
- normal, slow, interrupted and offline network;
- cached and uncached tracks;
- two-deck and four-deck layouts;
- manual takeover during every automation state;
- four-hour soak;
- VirtualDJ restart and plugin unload.

Record plugin version, Crate contract, planner version, request IDs, fallback
reasons, memory growth, callback duration and transition metrics.

Commit:

~~~text
git commit -m "docs(vdj): define plugin 1.0 release gate"
~~~

### Task 26: Staged rollout and rollback

**Files:**

- Modify: app/crate/config.py
- Modify: app/crate/api/capabilities.py
- Modify: docs/technical/vdj-plugin-operations.md
- Modify: docs/releases/vdj-plugin-1.0.0.md

Stages:

1. Internal Crate node and test accounts.
2. Opt-in beta with VDJ source enabled.
3. Opt-in automation beta after C soak passes.
4. Wider release after the compatibility window is clean.

Rollback:

- disable CRATE_VDJ_ENABLED;
- disable automation independently;
- revoke affected tokens if needed;
- stop VDJ routing to readplane if enabled;
- keep Listen, Android and Smart Mix backend available.

Commit:

~~~text
git commit -m "docs(vdj): define staged rollout and rollback"
~~~

## Final verification

~~~text
cd app
pytest -q \
  tests/test_vdj_contract_baseline.py \
  tests/test_vdj_capabilities.py \
  tests/test_access_token_repository.py \
  tests/test_access_token_api.py \
  tests/test_access_token_auth.py \
  tests/test_vdj_stream_scope.py \
  tests/test_smart_mix_api.py \
  tests/test_dj_cue_points.py \
  tests/test_dj_now_playing.py \
  tests/test_dj_play_events.py \
  tests/test_vdj_search_filters.py \
  tests/test_vdj_search_pagination.py \
  tests/test_vdj_security.py \
  tests/test_vdj_observability.py \
  tests/test_federation_migration_matrix.py

cd readplane
go test ./...

cd ../..
cmake -S tools/vdj-plugin -B build/vdj-headless -DCRATE_VDJ_BUILD_REAL_PLUGIN=OFF -DCRATE_VDJ_BUILD_TESTS=ON
cmake --build build/vdj-headless
ctest --test-dir build/vdj-headless --output-on-failure
pre-commit run --all-files
~~~

The signed cross-platform builds and manual VirtualDJ soak remain mandatory
before publishing a vdj-v1.0.0 package.

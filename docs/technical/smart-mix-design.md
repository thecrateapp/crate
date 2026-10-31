---
title: Smart Mix, native Android crossfade and VirtualDJ: unified design
summary: Contract and architecture for finishing Smart Mix, native Android crossfade and VirtualDJ from the existing WIP.
section: architecture
audience: [developer, operator]
status: canonical
order: 99
verified: 2026-09-09
sources:
  [
    app/crate/smart_mix,
    app/crate/api,
    app/crate/db,
    app/listen,
    app/readplane,
    tools/crate-cli,
    tools/vdj-plugin,
  ]
---

# Smart Mix, native Android crossfade and VirtualDJ: unified design

> **Implemented behavior and diagnosis:** see [Smart Mix: how it works and how to operate it](smart-mix-operations.md), checked against the release named on that page. This document keeps the continuation design/plan and its gates; a proposed task does not prove a deployed capability.

**Date and baseline:** 2026-09-09; branch `codex/feat-smart-mix-phase-1`, HEAD `140f9e347976eec0d27cb71919afd6f71bee4e86`, including its uncommitted working tree. **Status:** canonical continuation design; it describes the goal and does not prove that it is implemented or ready for production.

## 1. Authority, scope and starting point

This document and the [implementation plan](smart-mix-implementation-plan.md) are the **only normative sources for continuing and closing this feature**. The design defines behavior, contracts, limits and decisions; the plan defines order, tasks, tests and closing evidence. A later decision is incorporated here and updates the affected tasks: no other plan is created per phase, platform or agent.

They replace the earlier Smart Mix/Android/VDJ designs, plans and sequences, including the July documents, the VDJ documents of 16 August and the Android and VDJ UI/Control spikes. Their checklists and status claims are historical. The plugin README is an entry link; fixtures, code, CI, captures and package manifests are verifiable artifacts, not alternative guides. The Jam/Auto DJ roadmaps cannot redefine this feature or add Jam as a prerequisite either.

Crate's general documentation keeps its authority over repository conventions, operations and unrelated domains. If the code differs from this design, the code describes the existing state and the plan records the pending work; a future decision is never presented as a delivered capability.

### 1.1 What we want to deliver

A single Smart Mix domain analyzes audio, proposes cues, computes compatibility and produces transition plans. Two executors consume those plans:

- **Android:** native adaptive crossfade, full integration with the player and, after measuring it, tempo/phase and optional bass handoff.
- **VirtualDJ (Pro license):** A, local source; B, assistance with Crate's ranking; C, Crate Automix: Crate orders the queue and VirtualDJ's native automix mixes.

Releases R1–R4 include the tokens and their UI, a VDJ catalog with folders and filtered search, metadata cache, play events, observability, CI, packages and rollout/rollback. The encrypted audio cache with prefetch, private cues, radio and presence in VDJ, and federation summaries are in the plan's backlog: the design in this document remains their reference when they enter a release.

**Out of scope:** another ranking algorithm per client, Rekordbox, editing VirtualDJ's XML/internal database, a local daemon/IPC, a custom SideView UI, a transition engine of our own inside VirtualDJ, federated streaming in VDJ v1, Jam/collaborative queues and changing the web/iOS/desktop engines. Federated summaries serve interoperability and safe degradation; they do not enable full remote beatmatch.

### 1.2 Verified state

| Block          | Usable base                                                                                                                         | What prevents considering it finished                                                                                                                      |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Smart Mix core | Models, grid codec, Python/Rust, migration 104, persistence, backfill, planner, ranking, API/cache, Admin coverage and Go summaries | Measurement semantics, time limits, publication/revisions, reanalysis by generation, performance and musical validation                                    |
| Android        | Two Media3 decks, stable facade, MediaSession, controller, gain processor, bridge and tests                                         | Blocking network plan, standby cue/buffer, late trigger, envelope dependent on the main thread, settings and physical gates; tempo/phase/bass not executed |
| VirtualDJ A+B  | C++20 core, HTTP, OS stores, cache, clients, compatible folder and spike adapter                                                    | Handshake not integrated, lifecycle/cancellation, incomplete catalog, real media without acceptance, partial B presentation                                |
| VirtualDJ C    | Deck 1 command tests in the spike                                                                                                   | Redesigned as Crate Automix on top of the native automix (§6.7); pending gate VH01                                                                         |
| VDJ platform   | WIP PAT/API/migration 105, token-bound tickets, catalog/media routes                                                                | Write permissions, auth hot path, prod/home proxy, effective gates, user UI and extensions                                                                 |
| Delivery       | Some automated suites green                                                                                                         | No complete physical Android acceptance, Win/Intel/host matrices, signed packages or final soak                                                            |

The review observed 25 commits made on the branch itself and 7 commits from the local `origin/main` that were not incorporated; no fetch was done. There were 21 modified tracked files and untracked code, including `tools/vdj-plugin/` and the PAT/catalog modules. The working snapshot matters as much as HEAD: do not start from a clean checkout of that commit and assume it contains everything.

**Available evidence, not release certification:** 113 core tests passed with 16 PostgreSQL tests skipped; 60 platform tests passed with an ephemeral PostgreSQL; headless C++ on macOS arm64 passed 14/14 CTests. The ASan/UBSan build failed at link time. This review did not run the full Rust suite, the full Vitest suite, Gradle or the physical/host matrix. The plan requires regenerating evidence after the changes.

### 1.3 Product invariants

1. Pressing play does not wait for analysis, profiles, planning, presence or telemetry. The absence of musical intelligence still allows playback with a safe fallback.
2. Automatic sequential album playback stays gapless; Smart Mix applies to radio, shuffle, playlists and continuation when enabled. Manual next/seek/pause do not become a future transition based on the outro.
3. Android exposes a single stable `Player`, one `MediaSession` and one notification; the queue advances once. Silent preloading does not count as playback.
4. Each plan is validated against identity, source/profile/cues, context and current capabilities. It never contains a PAT, ticket, private path or signed URL.
5. Audio that is already loaded keeps playing through a network drop. This does not promise new access after revocation or the ability to withdraw bytes already delivered.
6. The user keeps control of the VDJ decks. C does not override a manual intervention or reset the fader/tempo to simulate cancellation.
7. The API does not write `/music`; analysis, preparation and file changes use existing workers. No work is added to `orchestrator.py`.

## 2. Architecture and shared contract

```text
Local source + identity/revision
  → analysis worker (Python/Rust, verified measurements)
  → persisted TrackMixProfile + summary without grid
  → ranking + pure planner ← authorized private cues + context + capabilities
  → immutable TransitionPlan
       → Listen bridge → Android executor → one OS session
       → PAT API → Online Source A+B / General C → VirtualDJ host decks
```

The separation is kept within the existing modules; it does not require introducing a domain framework or a second task queue. Musical policy lives in Python; Java and C++ validate and execute typed intents. The Rust analyzer produces the same profile meaning as the Python fallback.

### 2.1 Versions pinned for the continuation

| Identifier                 | Target                                                               | Compatibility                                                                            |
| -------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| API contract               | `2026-09`                                                            | Explicit negotiation of supported contracts; `2026-08` only through proven compatibility |
| `profileVersion`           | `1`                                                                  | Safe additive fields; no silent reinterpretation of structures/units                     |
| Grid                       | `delta-ms-v1`                                                        | Same golden fixtures across languages                                                    |
| Analyzer                   | `crate-python` / `crate-rust`, `analyzerVersion: smart-mix-audio-v2` | Real provenance; v1 keeps its legacy identity and requires reanalysis                    |
| Measurement                | `measurementVersion: bs1770-v1`                                      | Absent/unknown: does not prove LUFS/true peak and does not allow an optimistic boost     |
| Batch/capabilities planner | `plannerVersion: "smart-mix-v2"`                                     | Keeps the current string type; identifies the policy                                     |
| Per-plan/per-score planner | `plannerVersion: 2`                                                  | Keeps the current integer type and maps 1:1 to policy v2; it is not a schema             |
| Plugin                     | Its own SemVer, tag `vdj-v*`                                         | Binary, handshake and manifest take their version from a single source                   |

These versions are target decisions, still pending P01/SM01. The temporary wrapper for distributed v1 consumers applies the safe validator/policy and projects a representable response; a non-representable case degrades. The cache key includes the effective v2 policy even when the legacy response uses batch `smart-mix-v1` and integer plan `1`. In the new contract, the v2 string batch and each integer plan 2 are validated together; the bridge keeps both meanings. Changing int to string inside plans would break the current Java parser and is not part of this decision. Retiring the wrapper requires verifying which clients were distributed; an incompatibility is announced, not deduced from the WIP name.

The plan keeps the existing wire IDs/fields where possible. P01 pins explicit fixtures for source/profile/cue/context revisions and capabilities; the new fields are additive. Validation requires finite values, unambiguous units and duration/rate/gain limits. A client can show an unknown summary as basic metadata, but cannot execute a plan whose contract it does not support.

### 2.2 Effective capability and fallbacks

The effective capability is the intersection of server feature flags, the supported contract, user preferences/consent, data availability and the executor's measured capabilities. Having a `full` profile does not certify phase on the device. The tempo/bass fields do not automatically enable their execution.

Typed fallbacks distinguish missing data, a late/obsolete plan, insufficient buffer, an unsupported mode and an authorization failure. The earlier cases can produce conservative adaptive or gapless depending on context; a 401/403 error is not turned into new access from cache. No fallback issues out-of-range seek commands, repeats outgoing to gain time or increases the duration requested by the user.

### 2.3 VirtualDJ permissions

| Scope                    | Authorized operations                                                       |
| ------------------------ | --------------------------------------------------------------------------- |
| `vdj.catalog.read`       | Local search/browse and permitted metadata                                  |
| `vdj.media.read`         | Resolve playback and the corresponding tickets/streams                      |
| `vdj.smart_mix.read`     | Profiles, compatibles, plans and reading the user's own cues                |
| `vdj.play_events.write`  | The user's own play events and presence                                     |
| `vdj.automation.execute` | Use Crate Automix (add tracks to the VDJ automix queue)                     |
| `vdj.cues.write`         | Backlog; retired for VDJ (§6.8)                                             |
| `vdj.radio`              | Backlog: Crate's own radio as a Crate Automix source, with local candidates |

The WIP permission `vdj.automation` is not automatically interpreted as the new `.execute`. P01/P02 define a visible migration and explicit reissue/reassignment; they do not add scopes to existing tokens. `/api/auth/me` has an explicit, minimal PAT identity branch. Creating/rotating/revoking tokens still requires the user's own interactive session; a PAT does not acquire Admin powers through its user's role.

There is no automation lease: Crate Automix does not execute mixing commands, it only adds tracks to the VDJ queue, and it checks the flag and scope before each track (§6.3). A track already queued or a transition already started by VDJ remains under the control of VDJ and the user.

### 2.4 Initial limits and cache authorization

These are target defaults that P01 pins in fixtures/configuration; operational budgets can be adjusted with recorded measurements, without relaxing identity or scopes.

| Resource           | Initial limit                                                                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| HTTP plan          | 32 edges per batch; Android preloads 32 and waits up to 10s if the margin is short                                                                |
| Ranking/browse     | 500 eligible candidates; 50 results per search; 500 tracks per VDJ folder, with numbered parts for longer playlists                               |
| Native JSON        | 2MiB per catalog/plans/summary response, depth 32; full profile up to 8MiB only if explicitly requested; abort before growing the buffer          |
| Cursor             | Does not apply to VDJ: the SDK has no pagination                                                                                                  |
| Metadata cache     | 100MiB/50K entries, TTL 24h; stale only on transport/5xx errors and with visible state, never on 401/403/cancel                                   |
| Opt-in audio cache | Backlog; only if VH01 confirms local paths in `GetStreamUrl`. Reference: 5GiB, 7d, LRU, 2 downloads and 3 preloads, without evicting active decks |
| Offline permission | Backlog, tied to the audio cache: load from cache until `offlineEligibleUntil`, at most 24h and never after the PAT expires                       |
| Presence/spool     | Heartbeat 30s, TTL 90s; event spool ≤1000 entries/24h; no secrets, per account/node                                                               |

When the audio cache comes out of the backlog, P05 will add `offlineEligibleUntil` and token/source revision/user/node identity to authorized playback resolution. A network outage will allow manual loading of previously authorized audio within that window; an observed revocation/403 will block new loads and purge unpinned material. None of these situations cuts audio that is already loaded.

The physical budget of that cache will include ciphertext, partial downloads and temporary plaintext materialization, reserving space before downloading and without evicting active decks.

Retention does not imply playback permission. It is Crate access control and storage, not a DRM promise against the owner of the machine. Long-lived PATs are not put in URLs, and no local server is introduced to work around SDK restrictions.

## 3. Core: analysis, publication and musical decisions

### Responsibility and limits of the core

Smart Mix generates reproducible audio observations, decides transitions and orders candidates. Android executes `TransitionPlan` in its native engine; VirtualDJ executes its A+B+C capabilities using the same contract and its host restrictions. The engines do not incorporate alternative weight tables. The core does not incorporate authenticated streams or credentials into profiles, plans or snapshots.

`app/crate/smart_mix/{models,policy,planner,compatible,beat_grid,camelot}.py`, the existing repositories and the existing endpoints are kept. The design separates three identities: the revision of the analyzed bytes/source, the revision of the analysis implementation and the revision of the published profile. The planner revision is independent of those three. A change in any one of them invalidates only the corresponding derived result.

All the pending work is part of the same feature: contracts, backfill, Android, the A+B+C plugin, private cues, observability and real acceptance. Increments can be deployed behind capabilities; completing an increment is not the same as closing the feature. Failing the physical beatmatch gate allows shipping adaptive crossfade with beatmatch kept off, but it must be recorded as pending and not as removed work.

### Audio measurements with verifiable semantics

Two representations are used for different purposes. The mono/resampled downmix remains valid for onsets, tempo, energy and key. Loudness and true peak are computed over the source channels with a meter that conforms to the declared algorithm; never over the mono average. `introLufs` and `outroLufs` are the loudness of documented windows; `integratedLufs` is the measurement of the whole program if it could be computed. `truePeakDbfs` is the maximum true peak across channels and not the sample peak of the downmix. Silence, a signal that is too short, an unsupported layout or an interrupted analysis produce `null` for the measurement that could not be obtained, not an invented number.

Integrate an existing meter with PCM streaming instead of writing another BS.1770 approximation in each language. Proposal: an adapter over the libebur128 family/a compatible implementation in production; once build and license are verified in the current images, pin the implementation and version in both backends. FFmpeg `ebur128` can act as an independent acceptance oracle and as an explicit fallback if the native dependency is not available. The adapter interface must allow testing the analyzers with a fake meter, but acceptance runs the real one. The choice of binding is an implementation decision within SM02: it does not alter the units, fixtures or gates. Primary references: [ITU-R BS.1770-5](https://www.itu.int/rec/R-REC-BS.1770-5-202311-I/en), [FFmpeg's ebur128 implementation](https://ffmpeg.org/doxygen/8.0/f__ebur128_8c_source.html).

Historical profiles that hold RMS in LUFS fields and a mono sample peak are not renamed or marked valid through SQL. They keep their provenance; readers do not use those measurements to authorize positive gain. They are reanalyzed gradually. For missing/unreliable data the planner uses conservative staging, and the engine keeps the final protection of the mixed output. The backend's prediction does not replace the engine's output limiter/measurement, especially after EQ and bass handoff.

### Versions, additive migration and compatibility

Versions coordinated with P01:

| Identity                          | Proposed decision                                                                            | Reason                                                                                                                   |
| --------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| API contract                      | `2026-09`                                                                                    | Global contract of the consolidated feature, owned by P01                                                                |
| Profile schema / `profileVersion` | `1`, with optional additive changes                                                          | The corrections make LUFS/true peak meet the semantics already declared; they do not require another payload shape       |
| `beatGridFormat`                  | Keep `delta-ms-v1`                                                                           | The codec does not change; keep the cross-language golden fixtures                                                       |
| `analyzer`                        | Keep `crate-python` / `crate-rust` as the real identity                                      | Two different implementations are not a single idempotency identity                                                      |
| `analyzerVersion`                 | New identifier `smart-mix-audio-v2` in the corrected analyzers                               | Do not interpret old profiles as corrected analyses, and do not prevent their replacement                                |
| `measurementVersion`              | Optional field `bs1770-v1`; absent means the measurements are not proven under this contract | Readers distinguish real measurements from legacy and unknown producers                                                  |
| Planner                           | Batch/capabilities `plannerVersion: "smart-mix-v2"`; each plan/score `plannerVersion: 2`     | Both identify the same policy while keeping the current wire types; they are not a schema and the v1 cache is not reused |

Add a persisted `duration_ms` from the decoder to `track_mix_profiles`: it is currently discarded and rebuilt from `library_tracks.duration`. Add the active bounds `active_start_ms` / `active_end_ms`, `integrated_lufs` and `measurement_version` as optional columns with their additive wire fields. The migration is new; it does not rewrite 104 or 105 from this branch. The next free number is chosen when implementation starts and the Alembic chain is verified.

Do not invent an exact duration for historical profiles: use the legacy duration only as an identified fallback and prefer degradation if the bounds cannot be guaranteed. Do not store thousands of grids in ordinary catalogs/snapshots. Summary and full keep their differences; unknown payloads and producers are validated before planning.

Base compatibility: capabilities and requests use `plannerVersion: "smart-mix-v2"` as the preferred policy identifier. The adapters still recognize v1 data and its gaps, apply the same safety validator and drop unproven legacy measurements; a case that cannot be represented safely degrades to gapless/adaptive. The previous planner is not cloned. The cache always identifies the effective v2 policy, even when the origin is v1 data/context. P01 documents and tests the mapping between the batch's string `plannerVersion` and the integer of each plan/score. It keeps their types and does not add another `planVersion`; the Java/C++/TS parsers verify 2 for new plans and handle 1 only for explicit compatibility.

A wrapper that preserves responses exactly for a distributed v1 client is added only if P01 finds evidence of that consumer; it uses the same safe v2 computation and a bounded projection, never another algorithm. The matrices cover safe v1 reading, new client/old server and unknown version, and add the specific old client/new server case when it exists. Keeping only `smart-mix-v1` and modifying results without invalidating caches/offline plans is not a valid alternative.

### Capturing and publishing profiles

The job carries an explicit context with entity UID, track ID, expected path, captured source revision, analyzer identity/versioning, claim token and observed profile revision. It does not compute the source revision for the first time when saving the result. The capture must detect inode/path replacements and size/mtime changes; when a reliable content revision exists in the library, it is reused. The acoustic fingerprint is not treated as a hash of the bytes.

Minimum sequence: acquire the claim and capture identity; analyze outside a transaction; check that descriptor/source/path still represent what was captured; open a short transaction and verify track/entity/path, a current claim and the expected profile revision; publish via CAS; complete only the claim it owns; emit invalidation. Supported writers that replace audio must invalidate/reschedule their profile. A source that can be modified in place during the read needs a stable capture (descriptor plus pre/post checks and writer coordination, or an immutable temporary snapshot); an SQL CAS on its own does not make the filesystem immutable. Document which mechanism actually covers the existing writers before claiming the guarantee.

A file change during analysis discards the draft and re-enqueues a new revision: it never labels the old draft with the new revision. If another job published, the loser does not mark someone else's claim as done or overwrite the winning revision. Decoding failures keep the last valid profile as historical data; they do not serve it as current if its source no longer matches. Neither a table with every transition pair nor generic event sourcing is needed to solve this protocol.

Idempotency compares source, `analyzer`, `analyzerVersion` and the relevant configuration/semantics. An identical result is a no-op. For the same source and semantics, `partial → full` is an allowed promotion; a failed retry does not replace a valid full with unavailable. A change of source or semantics can publish partial if that is the correct result: keeping a full from another source as current would be wrong. The production preference for Rust does not hide a real improvement from the fallback; the rule must be deterministic and tested.

### Backfill that converges and can be operated

Keep the `smart_mix` pipeline, limits of 100 per batch, the priority of active/restored queues → offline → user library → listened → rest of local, `SKIP LOCKED` and the resource governor. Complete the protocol so that the analysis target is part of the checkpoint/dedup. Nullable target and claim metadata can be added to the existing state, isolated to `smart_mix`, if `claimed_by/claimed_at` are not enough to distinguish generations; do not introduce another scheduler.

A `done` row from a previous generation becomes eligible again. Attempts are counted per target, and abandoned claims are recoverable without a late worker completing the next worker's claims. Pause prevents new claims; the batch in progress reaches a defined checkpoint. Cancel does not delete profiles or turn active child tasks into orphaned work. Resume continues the target/checkpoint; it does not create a second race. The status distinguishes current, legacy/stale, in-flight, failed and exhausted profiles, instead of counting any non-unavailable profile of the nominal version as current coverage.

### Temporally valid cues and duration

The four-second cue detected by the analyzer is a suggested exit point, not permission to produce a twelve-second fade after that point. The planner first resolves the effective cues (automatic facts plus already authorized private overrides), preserves a minimum audible body and chooses an interval that fits in both tracks.

Validate `0 <= incomingCue < activeEndIncoming <= durationIncoming` and the outgoing equivalents when measurements are available. In output time units, the incoming reservation is `(activeEndIncoming - incomingCue) / incomingTempoRatio`; include any offset or tempo adjustment/recovery segment. The transition and its handoff must also fit in outgoing. Prefer moving the automatic cue to an earlier beat when audible body can be kept; explicit private cues are not moved silently: shorten the duration or degrade. If not even the minimum of a safe fade fits, return gapless or a short adaptive according to context, without instructions for a negative/out-of-track seek.

The phase is computed between the two effective positions and their grids after normalizing half/double tempo; not only relative to the incoming anchor. The frames/duration the engine applies are its final authority: if queue, duration, rate or availability change after planning, the engine rejects the obsolete plan or degrades it. Automatic album playback remains gapless. Manual keeps its short ramp and does not interpret the future outro as the moment of the button press.

Private cues belong to the user/VDJ and do not mutate `TrackMixProfile`. The API resolves their revisions and passes values to the pure planner; the cache incorporates owner scope, the revisions of both profiles, the revisions of the cues/context and the policy. The bare string `userCueProfile` does not authorize access or replace resolving the content.

### Federated summaries and read parity

SM06 extends the snapshot/manifest and the catalog delta with an optional, versioned summary: identity, provenance/revision, duration, BPM/key/Camelot, energy/confidence, quality and summarized automatic cues when they are publishable. No full grids, private cues, paths or credentials. Remote ingestion accepts the absence of the field in old peers and validates/ignores unknown versions conservatively. Remote profiles do not acquire full execution quality by receiving metadata.

Publishing a new `profileRevision` must generate a catalog change and its delta even if `library_tracks.updated_at` does not change. The peer invalidates the corresponding summary/plan when it applies that revision. Acceptance covers export→ingest→reanalysis→delta→new remote planning. Current federation does not implement this Smart Mix path yet: it is explicit work, not an assumed property of the Go summary.

Parity of the already existing Go summaries/routes for session/JWT is mandatory. Accelerating VDJ/PAT in Go remains conditional on the measured FastAPI SLO and on auth/ticket parity; closing the feature with PAT through FastAPI is valid if it meets its gates.

### Analysis budget and performance tests

Do not load a full concert arbitrarily into RAM. The decoder and meter must support windows and block processing. Set a configurable cap for the full onset scan and an intro/middle/outro policy plus scattered anchors for long files. A partial scan is not labeled as a full grid. Record time, bytes read and peak RSS; when the budget runs out, return partial with missing fields or a typed retryable failure, not a profile that looks complete.

The budgets from the previous plan are kept: cached plans p95 <50 ms; uncached p95 <150 ms; local ranking p95 <250 ms, with warm-up, hardware, version, dataset and concurrency declared. The query tests cover a representative scale of 48K tracks and many ineligible rows, not just 12K favorably distributed. PostgreSQL is not forced to use a specific index when another plan meets the budget; the tests check for the absence of N+1, bounded load and measured cost.

For DSP, set timeout/RSS/concurrency budgets according to the deployed analysis worker before the backfill; the report must compare against the real baseline of the same host. No invented regression percentage counts as evidence. The physical gates for phase, underruns, output peak, OS handoff and memory are part of the Android/VDJ block and are not replaced by these server benchmarks.

## 4. Platform: access, catalog and media

### Authorization and connection

- Deny PAT requests by default, checking both the HTTP method and the route. A future route must not become exposed because its string ends in `/stream` or `/compatible`. Resolve the authenticated identity only once; the authorization of each route will be explicit and covered by tests.
- Keep the current data/telemetry scopes `vdj.catalog.read`, `vdj.media.read`, `vdj.smart_mix.read` and `vdj.play_events.write`; the final `2026-09` contract uses `vdj.automation.execute` for Crate Automix. `vdj.radio` is added when radio comes out of the backlog; `vdj.cues.write` is retired for VDJ. Existing tokens do not receive new scopes implicitly. The WIP name `vdj.automation` is registered as an explicit legacy permission: it does not authorize Crate Automix and does not work as an alias that elevates permissions. The owner must reissue the token or make a new explicit assignment of `vdj.automation.execute`. The definitions, UI labels and negative tests share a single reviewed contract.
- Catalog reads require the catalog scope; playback/tickets/streams require the media scope; profiles/compatible tracks/plans and reading private cues require the Smart Mix read scope; play events and now-playing require the telemetry scope; radio start/next/feedback/end will require the radio scope. Crate Automix needs `vdj.automation.execute` in addition to the catalog, media and Smart Mix scopes it uses.
- Creating/listing/rotating/revoking tokens will still require a persisted interactive session, checking its owner. A PAT cannot create or rotate credentials, edit the user's profile or obtain Admin rights through its owner's role.
- Support `GET /api/auth/me` as an explicit PAT identity contract to validate the plugin login and show the account. Return the reviewed minimal identity and the effective VDJ permissions; keep the existing response for sessions/JWT. `GET /api/capabilities` remains the public server/versions contract. Do not solve the plugin login by opening all of `/api/auth/*`.
- Add self-service token management in Listen Settings, accessible to regular users. Admin Settings requires management permissions and `/profile` currently redirects; it cannot be the only way to connect VirtualDJ. The plugin's connection UI collects the server URL and token, validates identity/capabilities and stores the token only in the platform credential store. The existing browser and native client login/OAuth is kept.
- Store only the token's digest and prefix in PostgreSQL. Show the secret only after create/rotate; never persist it in the browser, logs, URLs, analytics, the metadata/audio cache or failure diagnostics. PATs authenticate through Authorization; the SDK's media requests use bounded tickets.
- Check token expiry/revocation and user state on every new authorized request without locking its row on every read. Use a conditional, limited update of `last_used_at`; keep the transactional lock for rotation/revocation where needed. Revocation affects subsequent authorization decisions; it does not retroactively cancel a response that was already authorized.

### Routing, flags and rollback

- Keep catalog/profile requests with an opaque PAT in FastAPI, in production, home and development, until a measurement-based decision justifies parity in Go. Apply the Authorization PAT bypass before the readplane's canonical routes, including `/api/search`, `/api/auth/me` and `/api/tracks/by-entity/.../mix-profile`. Keep the VDJ artwork/media aliases in FastAPI when they do not carry Authorization. Preserve the existing session/JWT routing.
- Do not use an authentication failure as an implicit retry against another backend: invalid/revoked credentials still produce 401, a missing scope produces 403 and a backend outage follows the explicit availability/fallback policy. The readplane only understands its supported credential contracts until parity is implemented. Do not send token-bound tickets to its session ticket parser.
- Apply the server flags to the new PAT operations. `CRATE_VDJ_ENABLED=false` prevents new VDJ catalog/media/assistant/automation work. The independent automation flag stops new automatic work while A+B remain available. Smart Mix availability and the required scopes further restrict the effective functions. Listing/revoking tokens and diagnosing the connection remain available for recovery.
- Crate Automix checks `vdj.automation.execute`, the automation flag and the capabilities before adding each track to the VDJ queue. Disabling it stops new additions; whatever VDJ already has queued or is mixing remains under the control of VDJ and the user.
- Server-side revocation cannot stop an offline process or recover bytes already delivered. When it observes a revocation or a disabled flag, the plugin stops resolving new streams and queuing tracks; it does not unload decks or send mixing commands.
- Keep stack releases, plugin releases, the API contract, the profile schema and the planner version independent. The final integrated contract is `2026-09`; the profile keeps schema `1` with additive duration/origin/measurement metadata and the `delta-ms-v1` beat-grid encoding; the analyzer is `smart-mix-audio-v2` plus its implementation identifier; the planner is identified as `smart-mix-v2`. The new optional fields are additive. Unknown required versions disable the dependent function instead of being parsed optimistically. Rollback disables new work and deploys the previous compatible binaries without automatically downgrading or deleting persisted profiles, plans, tokens or cues.

### Catalog, media and extensions

- One-level VDJ folders, because the SDK supports neither subfolders nor pagination: one folder per authorized playlist (ordered tracks, numbered parts if it exceeds 500), Genres, Moods, Recently Played and Compatible. Artists and albums are browsed through search (`artist:`, `album:`) and through context menu entries. Stable opaque IDs identify entities; playlist ownership/membership and the visibility of system playlists reuse the existing rules.
- Limit the first VDJ release to playable local content. A PAT search cannot silently widen its access to federated/global search by changing `scope`. Reuse the normalized taxonomy and metadata fallbacks consistently in SELECT and WHERE, including `album_genres` when track/album tags are empty.
- DJ search accepts filters as syntax inside the text (`bpm:120-128`, `key:8A`, `energy:`, `analyzed:no`) in addition to `fields=dj`, with at most 50 results. Listen's ordinary search keeps its behavior. VDJ does not use cursors.
- Resolve playback from the local identity just before using it. Respect the returned delivery policy and preparation state, without inventing a stream URL from an unparsed response. Keep the VDJ transport alias if routing/the SDK require it, backed by the same playback/media implementation and tested against the canonical route.
- Album covers are already public in Crate and VDJ persists the URL it receives: the plugin passes the absolute public URL, without a ticket. Media tickets keep the exact normalized path, audience and token identity, and the parent token's state and the media scope are checked on every request, including HEAD and Range.
- VDJ downloads the whole track when loading it, so the ticket TTL covers the initial download (initial value 15 minutes). If VH01 shows Range requests after the ticket expires, V04 implements the mechanism that the gate validates (re-resolution or local path) before closing A; no long-lived PAT is put in the URL. Audio already downloaded is not stopped by an outage or revocation; new unauthorized loads are denied.
- Reuse `POST /api/me/play-events` and `app/crate/db/repositories/user_library_playback_writes.py`, including the existing `(user, client_event_id)` idempotency. Retrying accepted events does not duplicate history, metrics, profile changes or scrobbles. VDJ supplies stable event IDs, audible duration and deck/session context; telemetry never blocks playback.
- Backlog (P06): private cue overrides with revision control for clients other than VDJ, which already persists its own cues; now-playing presence. Reference for when they come in: do not overwrite the global automatic cues. When an override takes part in planning, resolve it for the current user and bind the immutable plan to the cue revision in addition to the profile revisions; global/shared plan caches cannot expose or reuse another user's private cues. Add now-playing presence scoped per user/client/deck, with the already accepted 30-second heartbeat and 90-second expiry. Persist play events through the existing repository; presence is ephemeral.
- Backlog (P06): radio as a Crate Automix source. Reuse `/api/radio/start`, `/api/radio/next`, `/api/radio/feedback`, `/api/radio/can-discover` and `/api/radio/session/{session_id}`. Check session ownership on next/feedback/end in the API and the service, in addition to creation. VDJ candidates remain local; concurrent next calls, expiry, cancellation and feedback cannot mutate other users' sessions. Extend the current service instead of creating another VDJ radio engine.

## 5. Android: finish the existing native executor

### 5.1 Keep the integration and separate network from playback

Work continues with Media3 `1.10.1`, currently pinned in `app/listen/android/variables.gradle`, two `ExoPlayerNativePlaybackDeck`, `NativeMixController`, `NativeMixAudioProcessor` and `CrateMixPlayer`. A Media3 version bump is justified only by a verified need and regression; it is not an invented prerequisite.

`setQueue`/play have their media items available immediately. Planning is preloaded off the startup path, at most the next 32 edges (the batch limit) with dedup and one active request per queue generation, and the window slides on every track change. The deadline comes from the margin until the transition: margin − 5s, between 1s and 10s; with unknown duration or position, 1s. Exhausted → fallback and real cancellation. A fallback caused by a timeout or a down planner is not cached: the next replan requests it again, and it never replaces a server plan already installed for the same edge. Changing queue/account/origin/cues or aborting playback invalidates late requests and results. A response cannot reconfigure a transition that has already started.

Offline means **zero planning requests**. Local plans/profiles are accepted only if they exist and their identities/revisions/context match; otherwise the local fallback is used. The plan cache does not keep credentials or URLs, and its key is not just the pair of track IDs. The same contract works with downloaded files and authenticated streams, without making the network a requirement for basic crossfade.

### 5.2 Preparation, timing and queue ownership

Preparing standby means resolving the correct media item, seeking to the final cue and waiting for readiness **after that seek**, with enough buffer to start and a configurable/measured margin. `STATE_READY` before the seek, or having called `prepare()`, does not prove this. The timing plan uses the current duration of both decks, the active bounds and the effective ratio; it is validated again before starting.

The trigger uses `outgoingCueMs` and the deck's effective position, not only `duration - globalCrossfadeMs`. If the plan arrives late, it is shortened within the safe policy or discarded. Repeat-one is not forced on outgoing. Lack of readiness lets outgoing keep playing and applies a deterministic fallback; it does not start incoming silently with a queue that has already advanced.

An `executionId` and load/queue generations tie together events, timeouts and callbacks. Separate the metadata crossing/logical handoff from the audible end: they are different events, and neither can duplicate the advance or the play event. Pause, manual next/seek, queue change, repeat-one, focus, route disconnection and decoder error are resolved by the same state machine; there are no parallel transitions in bridge, service and controller.

### 5.3 Envelope in audio and output protection

The full ramp is scheduled per frame in the processor: start, duration, curve, gains and safe cancellation. A main-thread tick can observe it, but does not set the next points of the curve every 20ms. The test intentionally blocks the main thread and checks that the samples keep continuity. PCM processing does not allocate memory, do I/O or wait on network locks.

Equal-power alone does not prevent clipping of correlated signals. Staging uses recorded true peaks and the maximum EQ gain/boost; with unknown data it uses a conservative reserve. The combined output is measured, with a target true peak ≤−1 dBTP and zero clipped samples in the acceptance corpus. User gains, duck/focus and EQ are applied coherently to both decks; a second deck does not duplicate global DSP or lose audio-session effects.

Two Media3 outputs do not automatically provide a common PCM clock or a common limiter. For adaptive, the architecture is accepted if it meets the gates with conservative staging. For beatmatch, the error is measured on captured audio. If it does not meet them, adaptive is kept and the bounded shared PCM bus spike planned in A07 is run; it is not claimed that a Java timestamp fixes the hardware clock.

### 5.4 Tempo, phase and bass handoff

Beatmatch requires reliable profiles/grids, sufficient tempo stability, a compatible plan and a certified device/route. Default correction ≤4%, absolute limit 6%; pitch is preserved, and tempo restoration after the transition is defined without a jump. Alignment uses both grids/cues, after normalizing half/double tempo. The fields that are currently ignored start being executed only after A06/A07.

Bass handoff is opt-in and requires controls in the audio domain, filters that are stable per sample rate and a separate envelope that respects EQ/headroom. It is not applied because of a label in the JSON if the executor does not support it. Closing it requires an audible comparison, absence of clicks/boost/clipping and measurement with correlated signals and music; no general effects engine is added.

**Long phrase-based beatmatch (2026-10).** If the server advertises `android_long_beatmatch` and the client sends `allowLongBeatmatch`, a valid beatmatch stops using the slider duration (max. 12 s) and is measured in phrases: the planner tries 32, 16 and 8 bars and picks the longest one that fits entirely in the outgoing track's outro and the incoming track's intro, with a maximum of 48 s; at 128 BPM that is 16 bars (30 s). It applies only if the global tempo stability of both tracks is ≥0.9, because v5 measures drift only in the 12 s of each cue. Those plans use the `dj-blend` curve: the same equal-power pair, with the angle traversed in three segments (entry in the first 30%, a blend with both tracks at −3 dB from 30% to 70%, where the bass handoff falls, and exit in the last 30%). Power stays constant, so the planner's staging and true peak ceiling do not change. Adaptive crossfade, gapless and clients that do not send the flag keep exactly the previous plan and its cache key; the request schema is strict, so the client only sends the flag when the server advertises it.

### 5.5 Preferences and operating system

Native Android Settings shows the Smart Mix on/off toggle, maximum duration, and beatmatch/bass only when they are effective. It keeps a persistent opt-out; a new capability does not re-enable a preference that is off. Album playback and other engines keep their rules. Mobile web does not start mixing because it shares Settings.

The MediaSession/facade does not change identity when decks are swapped. The notification, lockscreen, Bluetooth, Android Auto, focus/duck, calls and EQ keep their semantics. The checkpoint persists queue, track/position and preference, never a half-finished fade that plays back after process death; restoring loads a single track and regenerates plans. Telemetry distinguishes buffer/plan/timing/cancellation, is bounded and does not record paths/tickets.

### 5.6 Background continuation

With the screen off, the WebView freezes after ~60 s (measured on a Xiaomi 13 on 2026-10-16: the console stops emitting 59 s after locking while the native service keeps mixing). From that moment, neither the `trackChanged` replan nor the radio/infinite refill (`use-playback-radio-refill.ts`) runs. The 32-edge window covers about two hours of a static queue; radio and infinite run out of queue. The native service has to be able to continue on its own.

**Single endpoint.** `POST /api/playback/continuation` receives `{continuationId, afterTrackEntityUid, recentEntityUids, limit, plannerVersion, edges?}` and returns, in one response, the new tracks already shaped as `NativeTrack` (stream with a media ticket scoped to the track), the plans for the new edges (including last-in-queue → first new) and whether the source can continue. With `edges` and without `afterTrackEntityUid` it works in plans-only mode for static queues longer than the window. It reuses the planner and its per-pair cache; a batch of 32 is the existing limit. A09 does not need that endpoint: for a static queue the service already knows the `entityUid` values and calls `POST /api/playback/transition-plans` with the continuation token. `/api/playback/continuation` and its descriptor arrive with A10, which is where radio and infinite need to be resolved.

**Server-side descriptor.** When loading a radio or infinite queue, Listen sends the descriptor when it requests the token, and the server stores it in the token's own row (`continuation_descriptor`, migration 116): `shaped_radio {sessionId}` or `seeded_radio {seedType, seedId}` (artist, track, album, playlist, home_playlist). One per session; it dies with the session. `POST /api/playback/continuation` resolves shaped radio with the logic of `/api/radio/next` (only if the session belongs to the user), and seeded radio and infinite with the same generators as their GETs, without the 5-minute cache. It excludes `recentEntityUids` and repeats, and returns the tracks with an id computed like `resolvePlayableTrackId` (global → entity → path → id), a by-entity URL, the original object so that Listen can adopt them, and the plans for their edges, including the joining edge.

**Scoped credential.** Listen requests a continuation token bound to the session `sid`, with a 12 h TTL and a scope limited to `/transition-plans`, `/continuation` and stream `GET`/`HEAD` (by-entity and catalog). It lives in the native service's memory, never on disk; Crate's own logs do not write it (in debug builds Capacitor's verbose log prints the plugin arguments, just as it already did with the `setQueue` bearer; in release it does not). Revoking or closing the session invalidates it. For streams, the native side uses Listen's JWT while it has more than 60 s left (it reads its `exp`) and then the continuation token, so the readplane fast path is kept for as long as possible: the readplane does not validate `crv_` tokens and delegates those streams to FastAPI. Listen renews the token when loading a queue and when returning to the foreground. The refresh token remains exclusive to Listen. If the token expires with the screen off (12 h), the native side stops requesting and the queue ends without an error.

**Ownership.** The native side uses the Activity lifecycle (`onStop`/`onStart`), not a notice from the frozen JS. In the foreground, Listen plans and refills as before. In the background, the service requests continuation on track change when ≤3 tracks or <3 planned edges remain; one active request, bounded backoff, nothing while offline or with Smart Mix disabled.

**Reconciliation.** The native side appends with the same `revision` and keeps a log with its own sequence; the plugin exposes it with `getAppendedTracks({revision, afterSequence})`. When returning to the foreground, Listen adopts those tracks into its queue (with the native id and without re-sending them) before reconciling the index, because `applyNativeState` ignores indexes outside its queue. On Android, Listen's refill does not act while the app is hidden, so that it does not duplicate the native refill. If the process dies, the checkpoint keeps neither the URL nor the `entityUid`: tracks added by the native side are not rebuilt, and Listen reloads the queue on reopening.

**iOS.** R5 reuses the endpoint, descriptor and token; only the trigger and the reconciliation on the Swift side change.

## 6. VirtualDJ: Online Source, Assistant and Crate Automix

### 6.1 What the SDK and the host allow

The current official SDK is the one dated 2021-10-03 (`vdjPlugin8.h`, `vdjDsp8.h`, `vdjVideo8.h`); `vdjOnlineSource.h` is only published on the [Online Source wiki](https://virtualdj.com/wiki/Plugins_SDKv8_OnlineSource.html). Third-party copies dated 2025 do not add members. This design fits that surface; any capability marked "to be verified" is closed by the plan's host gate VH01 before a task depends on it.

| Capability                   | Status                                                                                                                                 | Consequence for the design                                                                                      |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| License                      | Online Sources and AutoStart plugins only work with a Pro license ([Example7](https://virtualdj.com/wiki/Plugins_SDKv8_Example7.html)) | Explicit plugin requirement; Home users cannot use it                                                           |
| Search                       | Synchronous or asynchronous (`S_FALSE` + `finish()`), with `OnSearchCancel`                                                            | Asynchronous search with a generation coordinator                                                               |
| Folders                      | `GetFolderList` without a parent folder; `GetFolder` only returns tracks; no pagination                                                | One level of folders with a cap; artist/album navigation through search. `GetFolder` asynchrony: to be verified |
| Track metadata               | title, artist, remix, genre, label, comment, cover URL, duration, BPM, key 1–24, year                                                  | No album, energy, Camelot, cues or grid: they are presented in existing columns                                 |
| Stream                       | Synchronous `GetStreamUrl` per load; it only returns a URL, without headers                                                            | Authorization inside the URL through an exact-path ticket                                                       |
| Download                     | VDJ downloads the whole track when loading it; FLAC verified on the host                                                               | The ticket must cover the initial download; seek/Range with an expired ticket: to be verified                   |
| Local path in `GetStreamUrl` | Works in third-party plugins, undocumented                                                                                             | Precondition for the audio cache (backlog)                                                                      |
| Deck identity                | `netsearch://plugin-<NombrePlugin>/<uniqueId>`, verified in `database.xml`                                                             | The plugin name and `uniqueId` (entity UID) are a permanent contract                                            |
| VDJ's own analysis           | VDJ analyzes online tracks and persists BPM, phase, key and automix POIs per track                                                     | Inside VDJ, VDJ's grid and key take precedence                                                                  |
| Cover                        | VDJ persists the cover URL in `database.xml`                                                                                           | Only absolute URLs without credentials; Crate's album covers are already public                                 |
| Login                        | `IsLogged`/`OnLogin`/`OnLogout`; `IVdjOAuth` with a `redirect_uri` fixed to `live.virtualdj.com`                                       | Our own native dialog, opened from `OnLogin`, to paste the token; integrated OAuth stays out of v1              |
| VDJScript                    | `SendCommand`/`GetInfo`/`GetStringInfo` from any plugin, including the Online Source                                                   | No second binary is needed to read decks or queue tracks                                                        |
| Events and timers            | They do not exist; only polling from a thread of our own                                                                               | Bounded polling; safety of `SendCommand` off the host thread: to be verified                                    |
| Mixing engine                | `automix`, `automix_add_next`, `playlist_add`, `mix_next`, `mix_now`, `mix_and_load_next`, `goto_mixpoint`, `sync`, `is_using`         | C delegates mixing to the native automix                                                                        |

### 6.2 Responsibilities and binary

Crate is the authority over track identity, authentication, compatibility ranking and queue order. VirtualDJ controls decks, beatgrid/key analysis, transitions, audio processing and user controls. C++ does not copy analysis algorithms, ranking weights or planner policies, and it does not reproduce a transition engine that VDJ already has.

By default, a single Online Source binary, `Crate`, is distributed and implements A, B and C: the Online Source can launch its own thread and use VDJScript. A second AutoStart binary is added only if VH01 shows that the Online Source does not stay loaded while the user mixes. The plugin name (`Crate`) and the `uniqueId` (entity UID) never change: VDJ indexes its analysis, cues and history by them, and a change orphans those entries.

`spike/control_spike.cpp` remains a development tool, excluded from the distributable targets. The production adapters live in `src/sdk/` and `src/online_source/`; the C logic lives in `src/automix/`.

### 6.3 Connection, compatibility and authorization

The user creates a token from Listen Settings. `OnLogin` opens a small native dialog (NSWindow on macOS, a Win32 window on Windows) with origin and token; `IsLogged` reflects the verified state and `OnLogout` deletes the credential. Configuration without secrets is stored per normalized origin; the token is stored only in Keychain or Credential Manager. An unconfigured installation stays disconnected: there is no default origin. The SDK's integrated OAuth stays out of v1 because it requires an OAuth2 server in Crate and routes the code through Atomix's relay.

Before exposing private operations, the plugin negotiates capabilities: VDJ availability, the API contract range, profile and planner versions, and flags. Online Source remains available if the assistant or Crate Automix are not. The binary version, handshake and manifest come from a single value generated by the build. Capabilities are revalidated on connect, on credential changes and with a bounded periodic refresh. There is no lease: Crate Automix checks the automation flag and the scope before each track it adds to the VDJ queue; if it is disabled, it stops adding tracks and does not touch what VDJ is already mixing.

### 6.4 Native lifecycle, latency and cancellation

HTTP, JSON parsing, SQLite and diagnostics run outside the host callbacks. Search uses the SDK's asynchronous mode; if VH01 shows that `GetFolder` supports it, folders use it too, and if not, they are served from the metadata cache with a background refresh and a short deadline. `GetStreamUrl` is synchronous: the plugin pre-warms ticket resolution and sets a deadline.

Each request has a generation, a cancellation token and a completion state. A late response cannot add results, call `finish` twice, touch a freed list or publish a URL. All VDJScript calls from the Crate Automix thread go through a single serialized worker; if VH01 shows that the host does not accept `SendCommand` from that thread, they are routed through the mechanism that the gate validates. Unloading the plugin prevents new work, cancels active work and drains workers before `Release`.

A single maintained JSON parser, with depth, body and collection limits and typed validators, tolerates additive fields. libcurl limits the body before appending bytes. Diagnostics strip secrets at the boundary.

### 6.5 A: local Online Source

Routes: `/api/search?scope=local`, `/api/vdj/catalog/folders`, `/api/vdj/catalog/folders/{folder_id}`, `/api/vdj/tracks/by-entity/{uid}/playback`, `/api/auth/media-access` and `/api/vdj/tracks/by-entity/{uid}/stream`.

One-level folders: the user's Playlists (one folder per playlist), Genres, Moods, Recently Played and Compatible with the loaded track. Each folder returns at most 500 ordered tracks; a longer playlist is split into numbered parts. Artist or album navigation is done through search with a documented syntax (`artist:`, `album:`, `bpm:120-128`, `key:8A`), and through context menu entries ("More from this artist", "This album") that launch that search. No cursors are implemented for VDJ.

Stream resolution validates identity, locality, availability and format before issuing the ticket. The ticket goes in the URL, bound to the exact path and the token identity, and its TTL covers the initial download of the track (initial value 15 minutes, adjustable with the VH01 measurement). Every request checks revocation and scope; revocation prevents new loads and does not withdraw bytes already downloaded. If VH01 shows that VDJ makes Range requests after the ticket expires, the mechanism that the gate validates (re-resolution or local path) is added before closing A.

Covers use Crate's absolute public URL, without a ticket, because VDJ persists it. The metadata cache uses node/account scope, TTL, limits, corruption recovery and an explicit stale state; 401/403, cancellation and an incompatible contract never become a cache hit.

### 6.6 B: Assistant

The Compatible folder uses the backend ranking with the loaded track or an explicit seed from the context menu. There is a single ranking, and it adapts to context through a parameter, not per client: `context=auto` derives the beatmatch affinity from the genre and the rhythmic evidence of the pair; `beatmatch` and `smooth` fix it for electronic or smooth-entry sessions. Crate's BPM and key are passed in the SDK fields; Camelot, energy and confidence are shown in `comment`, with a fixed, localized format. When VDJ analyzes the track it shows its own values: the presentation does not compete with them. "Open in Crate" opens the browser from the context menu. The plugin does not consume `TransitionPlan`: inside VDJ, transitions are computed by VDJ's engine with its own grid.

### 6.7 C: Crate Automix

Crate Automix is opt-in and uses VDJ's native automix. The plugin gets from Crate the order of the next tracks (compatible tracks from the one playing; radio once it comes out of the backlog) and adds them to the automix queue with the verbs validated in VH01 (`automix_add_next`/`playlist_add` with `netsearch://plugin-Crate/<uid>` paths). VDJ decides the point and the shape of each transition with its automix POIs, its grid and its sync; manual intervention is whatever VDJ already handles.

The plugin keeps the queue a few tracks ahead (initial value 2), replaces them if the playing track changes and stops adding when the flag, the scope or the preference is disabled. It never sends crossfader, tempo, EQ or play commands: there are no execution states of its own to cancel and no takeover to detect. Play events are obtained through bounded polling of `get_filepath`, `is_audible` and `get_time` per deck.

### 6.8 Backlog extensions

The following remain in the plan's backlog, with this design as the reference when they enter a release: Crate radio as a Crate Automix source, now-playing presence, an encrypted audio cache with prefetch (only if VH01 confirms that `GetStreamUrl` accepts local paths) and integrated OAuth. Per-user private cues are retired for VDJ: VDJ already persists cues and POIs per online track in its own database.

## 7. Gates and feature closure

The following values are acceptance targets; the review has not measured them yet. The [plan](smart-mix-implementation-plan.md) holds the protocol, samples, devices, commands and results log.

| Gate              | Criterion                                                                                                                                          |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Planning          | p95 cached <50ms, uncached <150ms, compatibles <250ms with 48K tracks and declared concurrency                                                     |
| Correctness       | No cue/handoff beyond the duration; no double advance; no identity/scope leak; cross-language fixtures                                             |
| Adaptive audio    | Zero clipping in the corpus, combined true peak ≤−1dBTP; rate of transitions with underrun <0.5%; memory ≤1.5× the equivalent single-deck baseline |
| Android beatmatch | Absolute phase error p95 ≤20ms on an external capture ≥48kHz, certified routes, fixed/drift corpus; not inferred from timers                       |
| Android lifecycle | One session/notification and continuous controls; complete background/focus/offline/auth/route/process matrix                                      |
| VDJ C             | Crate Automix never sends mixing commands; disabling it stops new additions to the queue; correct queue with 2 and 4 decks                         |
| Distribution      | Signed Win x64 and macOS Intel/arm64 builds, declared version matrix, 4h soak and demonstrated rollback                                            |

Delivery is organized into releases R1–R4 of the [plan](smart-mix-implementation-plan.md) §1.1: correct Android adaptive, VDJ A on macOS arm64, VDJ B and platforms, and advanced execution. Each release closes with its gate and its evidence, without waiting for the following ones. The extensions that the plan leaves in the backlog (private cues, radio and presence in VDJ, encrypted audio cache, summary federation) do not block any closure. A failed gate keeps its release open; moving work between release and backlog requires editing the plan, not renaming incomplete work as optional.

Rollout keeps separate switches: Smart Mix backend, Android adaptive, beatmatch, bass, VDJ source and C. The affected mode is disabled first; a rollback of compatible binaries does not automatically run a destructive downgrade of profiles/tokens/cues. Users and operators must be able to disable it from Settings/flags and keep ordinary playback. The operational details and the decision changelog live in the plan.

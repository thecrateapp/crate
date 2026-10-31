---
title: Smart Mix - how it works and how to operate it
summary: Profiles, transitions, backfill, states and diagnostics for the shipped Smart Mix, with the observation limits that apply to Crate Agent.
section: operations
audience: [operator, developer]
status: canonical
order: 165
verified: 2026-10-21
sources:
  - app/crate/audio_analysis.py
  - app/crate/smart_mix/versions.py
  - app/crate/smart_mix/models.py
  - app/crate/smart_mix/analyzer.py
  - app/crate/smart_mix/planner.py
  - app/crate/smart_mix/policy.py
  - app/crate/smart_mix/source.py
  - app/crate/api/smart_mix.py
  - app/crate/api/smart_mix_admin.py
  - app/crate/api/capabilities.py
  - app/crate/api/schemas/smart_mix_admin.py
  - app/crate/db/jobs/analysis_storage.py
  - app/crate/db/jobs/smart_mix_backfill.py
  - app/crate/db/queries/smart_mix_admin_tracks.py
  - app/crate/db/queries/smart_mix_compatible.py
  - app/crate/db/repositories/smart_mix.py
  - app/crate/worker_handlers/analysis.py
  - app/crate/actors.py
  - app/crate/agent_observability.py
  - app/crate/db/queries/agent_observability.py
  - app/tests/test_mcp_observability.py
  - app/crate/agent_analysis.py
  - app/crate/agent_diagnostics.py
  - app/listen/src/lib/smart-mix.ts
  - app/listen/src/contexts/player-engine-adapter.ts
  - app/listen/android/app/src/main/java/app/cratemusic/crate/NativeMixAudioProcessor.java
  - app/listen/android/app/src/main/java/app/cratemusic/crate/NativeContinuationClient.java
  - app/listen/ios/App/App/CrateMediaSessionPlugin.swift
  - tools/vdj-plugin/src/core/contract_negotiator.cpp
  - tools/vdj-plugin/src/client/smart_mix_client.cpp
  - app/readplane/internal/routes/smart_mix.go
  - tools/crate-cli/src/mix_profile.rs
  - app/tests/test_smart_mix_versions.py
  - app/tests/test_smart_mix_planner.py
  - app/tests/test_smart_mix_publication.py
  - app/tests/test_smart_mix_backfill.py
  - app/tests/test_smart_mix_admin.py
---

# Smart Mix: how it works and how to operate it

This reference was checked against the code of release
`d3e6ef6b94ab233680f3d1a8d0c2c43b5a7d917c` on 21 October 2026.
The MCP observations described here belong to the additive 1.2.0 candidate; check
`get_operation_catalog` before assuming an instance already serves it.
It does not measure the coverage, flags or health of any instance. To continue development,
see the [design](smart-mix-design.md) and the [continuation plan](smart-mix-implementation-plan.md),
which also describe goals and gates that are still open.

## What it does and what data it uses

Smart Mix publishes one profile per track and computes compatibility and transition plans
between tracks. The profile holds tempo, confidence and stability, key and Camelot code, local
intro and outro cues and beats, energy, loudness and the provenance of the measurement. The
planner returns cues, duration, mode, tempo ratio, phase, gains and a fallback reason; the
player runs the plan. Receiving a plan does not prove that a transition was played.

General audio analysis and Bliss vectors remain separate subsystems. Their
`analysis_state`/`bliss_state` and their counters say nothing about whether
`track_mix_profiles` are current. Bliss can add a similarity dimension to compatibility,
but on its own it holds neither the temporal profile nor a crossfade plan.

```text
Analysis worker / daemon -> Rust draft or Python fallback
    -> source, revision and claim validation -> track_mix_profiles
    -> read by UID / compatible candidates / FastAPI planner
    -> versioned plan -> consuming player
Backfill campaign -> batch claims -> heavy tasks per track
    -> processing state + precomputed coverage for Admin
```

## Versions and provenance

These values come from the reviewed code; they were not discovered from a live instance.
`test_smart_mix_versions.py` checks that this table follows the implemented identifiers.

| Identifier                      | Value                | Meaning                                               |
| ------------------------------- | -------------------- | ----------------------------------------------------- |
| `API_CONTRACT_VERSION`          | `2026-08`            | Advertised integration and capabilities contract      |
| `PROFILE_SCHEMA_VERSION`        | `1`                  | Schema of the persisted and serialized profile        |
| `ANALYZER_VERSION`              | `smart-mix-audio-v5` | Target generation of profile analysis                 |
| `MEASUREMENT_VERSION`           | `bs1770-v1`          | Loudness and true peak provenance used by the planner |
| `BEAT_GRID_FORMAT`              | `delta-ms-v1`        | Beat grid format                                      |
| `PLANNER_IDENTIFIER`            | `smart-mix-v2`       | Identifier for plan batches and capabilities          |
| `PLANNER_POLICY_VERSION`        | `2`                  | Numeric version of each individual plan               |
| `PLANNER_POLICY.rules_revision` | `7`                  | Internal rules revision included in the cache key     |

Changing the rules does not necessarily change the public planner identifier: the cache key
includes both.

Each profile keeps `profileRevision`, `sourceRevision`, `analyzer`, `analyzerVersion`,
`profileVersion` and `analyzedAt`. `sourceRevision` is a hash of size, mtime in nanoseconds
and inode; it is not a hash of the audio content or a Git SHA. The release SHA identifies the
code; the source revision identifies the analyzed file.

## Producing and publishing profiles

`audio_analysis.analyze_mix_profile` tries to get `mix_profile` from the Rust analyzer in
`crate-cli`; when that fails it uses `crate.smart_mix.analyzer` in Python. Having Rust installed
does not mean its result is the one in use: check `analyzer` and quality.
The Python fallback limits analysis of long tracks to the head and tail, so its result can be
`partial`. A file that is too short can produce `unavailable`. Neither `full` nor `partial`
guarantees enough confidence for every transition.

Publication captures the source and the profile revision before the expensive work. Afterwards
it revalidates the source, the path, ownership of the claim and any concurrent revision. The
outcomes are:

| Worker outcome   | Meaning                                                       |
| ---------------- | ------------------------------------------------------------- |
| `published`      | This run persisted the profile                                |
| `unchanged`      | The result does not improve on or replace the current profile |
| `superseded`     | Another revision won the publication                          |
| `lost_claim`     | The run no longer owns the claim                              |
| `source_changed` | The file changed during analysis                              |
| `track_moved`    | The track's path changed                                      |

The policy allows a lower-quality profile to be promoted to a higher-quality one and, when
quality and generation/source are equal, prefers Rust. An old job must not degrade a current
profile. A task that finishes without publishing does not account for a new profile: check
`stored`, `outcome`, the profile and its provenance. Invalidation after a source change sets
`source_stale_at`; normal reads exclude that profile while it is regenerated.

## Quality, currency and processing are separate axes

`quality` accepts `full`, `partial`, `legacy` and `unavailable`. The Admin track table also
exposes this profile status, in the implemented order of precedence:

| Profile status   | Meaning                                                             |
| ---------------- | ------------------------------------------------------------------- |
| `missing`        | The track has no profile row                                        |
| `unavailable`    | A profile exists and its quality is `unavailable`                   |
| `source_changed` | Profile flagged by a source change                                  |
| `outdated`       | Analyzer or schema version differs from the target                  |
| `current`        | Profile not flagged stale, with current versions and usable quality |

`failed` is a filter on `processingState`, not a sixth profile status. A track can keep a
usable profile and still record a failed processing attempt. Read `processingAttempts`,
`processingError`, `analyzedAt` and `sourceStaleAt` as well.

Precomputed coverage uses `current_profiles` and `current_quality`. The `quality` totals can
include old profiles: the `full` total is not the same as `current_quality.full`.
`missing_profiles = total_tracks - current_profiles`: it counts everything still needed to
reach current coverage, including outdated and unusable profiles. It is not the same as the
per-track `status=missing` filter. Quarantined albums are excluded from this coverage.
If the snapshot is missing or belongs to another analyzer, the read returns the empty
structure; check `refreshedAt` before reading zeros as a library with nothing pending.

## Campaign, queues and backfill

| Task                          | Queue         | Responsibility                            |
| ----------------------------- | ------------- | ----------------------------------------- |
| `backfill_smart_mix_profiles` | `heavy`       | Coordinates batches and enqueues children |
| `compute_smart_mix_profile`   | `heavy`       | Analysis and publication per track        |
| `refresh_smart_mix_coverage`  | `maintenance` | Aggregates coverage outside the request   |

The backfill applies resource pressure and limits the work in flight. Its Admin settings
accept `batchSize` from 1 to 100 (25 by default) and `maxAttempts` from 1 to 10 (3 by default).
Claims use `SKIP LOCKED`, a token, `target_generation` and attempts; a new analyzer version
makes attempts from the previous generation eligible again. It prioritizes the play queue,
supplied offline IDs, favorites and collections, and listening history before everything else.
It can promote Python profiles when the Rust CLI is available.

The campaign is persisted under `smart_mix:backfill_campaign`, with the states `running`,
`paused`, `cancelled` and `completed`. `controlState=idle` also covers a missing campaign and
terminal campaigns; on its own it does not mean full coverage. Pausing or cancelling stops the
campaign from continuing; it does not forcibly interrupt child analyses that were already
accepted. Resuming reuses a running or paused campaign of the same generation. A campaign that
completes has exhausted the claimable work in that pass; it can still leave exhausted errors or
non-current profiles. Check coverage and `processing.exhausted` before treating the backlog as
resolved. A coordinating task in `done` does not mean all of its children have finished either.

## Planner, compatibility and cache

- An automatic album keeps `gapless`; a manual transition uses a short ramp.
- In automatic mode, missing profiles lead to fallback. `adaptive` allows a crossfade without
  claiming beatmatch. `beatmatch` requires permission from the context and valid beat
  references, a minimum BPM confidence, local stability, a compatible meter, an acceptable tempo
  adjustment and a long enough window. The policy defines the thresholds; the contract does not
  promise beatmatch.
- A `partial` profile with an explicit local cue beat can be eligible. Do not reduce the rule
  to `quality=full`. Local outro and intro tempos and beats take precedence over the global
  reference; half and double tempo normalization is allowed when comparing.
- If the window is too short, the planner shortens or downgrades the transition. Reasons such as
  `missing_profile`, `low_confidence`, `unstable_tempo`, `incompatible_tempo`,
  `incompatible_meter` and `insufficient_window` explain the result; the client adds timeout
  and offline reasons.
- Gains and headroom take the recorded loudness and true peak into account; the policy caps the
  expected sum. A planned value does not replace a physical capture of clipping and underruns.

Compatibility combines transition fit (75%) with Bliss (15%) and genre (10%). Transition fit
(`smart_mix/transition_fit.py`) blends two families of weights according to the beatmatch
affinity α:

- Beatmatch (α = 1): strict tempo (zero at 12%), Camelot harmony, beatmatch viability under the
  same rules as the planner, edge level, brightness, silence, and danceability/valence
  continuity.
- Smooth entry (α = 0): the level jump between the last 5 s and the first 5 s (recorded LUFS or,
  failing that, edge energy), with rises penalized more than drops; if the outgoing outro is a
  fade (more than 6 dB below its integrated loudness), the reference is that integrated
  loudness; edge spectral brightness; silence between tracks; loose pulse (zero at 25%, half
  and double included); lightly weighted harmony; danceability/valence continuity.

`context=auto` computes α as a genre prior (electronic families ≈ 0.9; rock, metal and folk
≈ 0.1–0.15; unknown 0.35) multiplied by the rhythmic evidence of the pair (BPM confidence and
outro/intro stability). `context=beatmatch` and `context=smooth` fix α at 1 and 0.
A rock set with steady drums and a low prior stays in smooth entry; an electronic track without
a reliable grid is not ranked as if it could be beatmatched.

The query makes a bounded preselection by signals, then filters candidates that can be played
locally before the final limit; the ranking deduplicates recordings and variants. The BPM window
for the preselection is ±12% (plus half and double) in beatmatch or with an electronic seed, and
±25% in smooth entry or with a low-prior seed. The endpoint accepts `scope=local`, up to 100
results, `context` and a bounded candidate window. The breakdown adds `transition`,
`beatmatchAffinity`, `beatmatchable`, `tempoFlow`, `level`, `brightness` and `silence` without
changing the existing fields. A high score does not mean the player will beatmatch, nor that
federated coverage exists.

Plan batches load profiles and cache in bulk. The key includes the UIDs of both tracks, their
`profileRevision`, the context, the planner identifier and the rules revision. A change of
profile or rules leads to a different cache identity; do not recommend flushing Redis as a
routine repair. A planning POST can write to the cache even though it does not modify music.

## HTTP, permissions and consumers

These routes describe the application. They are not tools automatically available to
Crate Agent; an MCP Bearer token is not an Admin session or a VirtualDJ PAT.

| Route                                                                        | Use and relevant effect                                                                                                 |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `GET /api/capabilities`                                                      | Effective flags and client contract; does not prove their implementation or physical readiness                          |
| `GET /api/tracks/by-entity/{uid}/mix-profile?detail=summary\|full`           | Profile by UID; `full` includes the beat grid; a 404 can mean missing or invalidated                                    |
| `GET /api/tracks/by-entity/{uid}/compatible?context=auto\|beatmatch\|smooth` | Local ranking of candidates; does not trigger analysis                                                                  |
| `POST /api/playback/transition-plans`                                        | Batch planning; uses the cache                                                                                          |
| `POST /api/playback/continuation-token` and `/api/playback/continuation`     | Contract for continuing planning and the queue in the native runtime                                                    |
| `GET /api/admin/smart-mix/status`                                            | Coverage, campaign and coordinating task; can enqueue `refresh_smart_mix_coverage` if it is missing or older than 600 s |
| `GET /api/admin/smart-mix/tracks` and `/activity`                            | Paginated profiles and processing, and task activity                                                                    |
| `POST /api/admin/smart-mix/backfill` and `/backfill/resume\|pause\|cancel`   | Change campaign control                                                                                                 |
| `POST /api/admin/smart-mix/tracks/{id}/reanalyze`                            | Enqueues analysis for one track, with deduplication                                                                     |

Admin requires `library.analysis.manage`, even for its reads. The public profile and compatible
endpoints use session authorization or the PAT scope `vdj.smart_mix.read`, depending on the
client type; do not swap those mechanisms for MCP OAuth or grants.
The Go read plane implements the validated profile summary; `detail=full` and the relevant
failures or staleness fall back to FastAPI depending on the route and configuration. Do not
assume Go implements the whole planner or PAT parity: the proxy picks the transport by
authentication.

| Consumer              | What the reviewed tree shows                                                            | What must be checked separately                                                                        |
| --------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Backend               | Profiles, ranking, planner, administration and native continuation                      | Flags, generations and instance health                                                                 |
| Native Listen Android | Plan adapter, two decks with native processing, and continuation outside the WebView    | Installed APK, flags and preferences, and real audio gates                                             |
| Listen web/desktop    | Crossfade and transition heuristics; the adapter's plan branch targets `android-native` | Do not claim plan executor parity because the TypeScript code is shared                                |
| Listen iOS            | Existing mobile and media-session client                                                | The continuation plan keeps native Smart Mix parity as R5; do not infer it from Android                |
| VirtualDJ             | Negotiation code, profile and compatible client, and the Online Source integration      | Pro host and license, installed build and gates R2/R3; do not infer that a Crate mixer runs inside VDJ |

`CRATE_SMART_MIX_ENABLED` controls the base capability. Native crossfade also depends on
`CRATE_ANDROID_NATIVE_CROSSFADE_ENABLED`; beatmatch depends on both and on
`CRATE_ANDROID_BEATMATCH_ENABLED`; bass handoff adds `CRATE_ANDROID_BASS_HANDOFF_ENABLED`.
The configuration helpers default to false. VirtualDJ also uses `CRATE_VDJ_ENABLED` and, for
automation, `CRATE_VDJ_AUTOMATION_ENABLED`. The client applies the user's preferences.
Do not infer deployed values from defaults or from the existence of the code.

The plan keeps an R1 physical gate that was deferred on 18 October: an external capture of the
output to check clipping and underruns. QoE logs and automated suites do not replace it. This
documentation review does not close that gate or the ones for future platforms.

## Diagnosis through Crate Agent (read-only)

1. Get `get_release_context` and tell apart the release SHA, the image `source_sha`,
   `analyzerVersion`, `profileRevision` and the planner version. Read this reference and the
   sources needed for that release with `search_crate_context`/`read_crate_context`.
2. Query `get_instance_status`, `get_runtime_policy`, `list_jobs`/`get_job` and
   `read_diagnostics` within their grants, limits and age. `list_jobs` can filter by the
   registered Smart Mix types. A paginated list does not represent the whole campaign;
   respect the cursor and truncation.
3. The MCP 1.2.0 candidate contract adds `get_smart_mix_status` with the
   `library.health.read` grant: it reads the stored coverage and campaign and, optionally,
   `track_uids`, up to 50 exact UUIDs. It returns independent timestamps, availability, age,
   implemented versions and the status of each profile; it keeps coverage from old analyzers
   as stale evidence instead of inventing zeros. It does not compute profiles, candidates or
   plans, does not refresh coverage and does not enqueue work. `get_analysis_status` still
   covers only `analysis` and `bliss`; it does not replace this read.
4. When that evidence or the grant is missing, report the data as unavailable and suggest the
   appropriate Admin check to the operator. The Admin status GET can enqueue work: do not use it
   as a transparent substitute for an MCP observation. Crate Agent does not change flags, pause,
   reanalyze or start campaigns in this phase.

| Symptom                           | Evidence and next check                                                                                                                                                                                          |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Coverage at zero or stalled       | Snapshot date and version, campaign and tasks per queue; tell a missing snapshot apart from a real zero. Query `get_smart_mix_status`; if evidence or the grant is missing, ask the operator for the Admin check |
| High `missing_profiles`           | Separate real absence, old generation, changed source and `unavailable` quality; check the per-track filters and `current_quality`                                                                               |
| Campaign running without progress | Resource pressure and window, heavy worker, claims and child tasks; check errors and exhausted items before restarting                                                                                           |
| Task finished but no new profile  | Read `outcome`, source/revision and claim: `superseded`/`unchanged` do not mean this task published                                                                                                              |
| Crossfade without beatmatch       | Capability, preference, cue quality and beat, confidence and stability, meter, window and `fallbackReason`                                                                                                       |
| Old mix after reanalysis          | Verify `profileRevision`, the rules and the plan installed by the client; do not confuse a new plan with the player adopting it                                                                                  |

The stored read has partial coverage. It does not expose live functional host probes,
physical acceptance per platform, plan adoption in each player or a new validation of the
audio. Those signals remain unavailable. An enqueue does not prove completion; a `current` profile only shows
stored versions compatible with the API code, and the age declared in its envelope still
applies. The release context and its `source_sha` stay in the context MCP; they are not derived
from an image tag or from `get_smart_mix_status`.

## Regression evidence and acceptance questions

The suites `test_smart_mix_versions`, `test_smart_mix_publication`,
`test_smart_mix_source_invalidation`, `test_smart_mix_backfill`, `test_smart_mix_admin`,
`test_smart_mix_planner`, `test_smart_mix_api` and `test_smart_mix_compatible_service`
cover identities, concurrent publication, states, campaign control and the planning contract.
Readplane, Listen and Rust tests cover their own surfaces; they do not replace a physical test
or a check of a distributed binary.

Crate Agent must be able to explain Smart Mix as distinct from Bliss; tell quality, currency
and error apart; follow a backfill without equating enqueue, completion and coverage; explain
local beat eligibility and fallbacks; and point out the per-platform limits and the limits of
MCP evidence. Every answer must cite the path and the context SHA. The correct answer about
real Smart Mix coverage can be that the current credential does not expose it, even when the
agent knows the algorithm.

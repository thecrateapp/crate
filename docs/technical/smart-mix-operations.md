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
  - app/crate/smart_mix/key_detection.py
  - app/crate/smart_mix/tempo_grid.py
  - app/crate/smart_mix/cue_detection.py
  - app/crate/smart_mix/planner.py
  - app/crate/smart_mix/evaluation.py
  - tools/smart-mix-eval/README.md
  - app/crate/smart_mix/policy.py
  - app/crate/smart_mix/source.py
  - app/crate/api/smart_mix.py
  - app/crate/api/smart_mix_admin.py
  - app/crate/api/capabilities.py
  - app/crate/api/schemas/smart_mix_admin.py
  - app/crate/db/jobs/analysis_storage.py
  - app/crate/db/jobs/smart_mix_backfill.py
  - app/crate/db/migrations/versions/147_smart_mix_structure.py
  - app/crate/db/queries/smart_mix_admin_tracks.py
  - app/crate/db/queries/smart_mix_compatible.py
  - app/crate/db/repositories/smart_mix.py
  - app/crate/worker_handlers/analysis.py
  - app/crate/actors.py
  - app/crate/ai/queues.py
  - app/crate/ai/requeue.py
  - app/crate/worker.py
  - app/crate/db/repositories/ai_usage.py
  - docker-compose.yaml
  - docker-compose.project.yaml
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
| `ANALYZER_VERSION`              | `smart-mix-audio-v7` | Target generation of profile analysis                 |
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

## Reading profile and plan fields

Some fields are easy to misread from their names. Clients that execute plans or inject a
profile into a deck (Android, Crate Decks) must follow these definitions.

| Field                      | Meaning                                                                                                                                                                                                                                                                                                                                 |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bpm`                      | Global tempo. A whole or half BPM when the track keeps a constant tempo that rounds to it within 25 ms over the track; otherwise the fitted tempo                                                                                                                                                                                       |
| `beatGridMs`               | Absolute beat positions in ms (`delta-ms-v1` is only the storage encoding). A constant grid at `bpm` when the track keeps one tempo, otherwise the tracked beats. Only `detail=full` returns it                                                                                                                                         |
| `activeStartMs`            | Musical start: the first 50 ms RMS frame within 35 dB of the loudest frame and above -55 dBFS                                                                                                                                                                                                                                           |
| `activeEndMs`              | Musical end, by the same rule (for long tracks, over the last 120 s). A fade or reverb tail continues after it, so it falls 1-6 s before a -60 dB end of sound such as Mixxx's. It is not a silence threshold                                                                                                                           |
| `introCueMs`, `outroCueMs` | Suggested mix points: the first beat at or after `activeStartMs` and the last beat 4 s before `activeEndMs`                                                                                                                                                                                                                             |
| `beatPhaseOffsetMs`        | Plan field, beatmatch only. In output time and below one outgoing beat: the incoming track starts this much after `incomingCueMs` when the outgoing reaches `outgoingCueMs`. In incoming track time, start at `incomingCueMs + beatPhaseOffsetMs * incomingTempoRatio` (`NativeTransitionPlan.startIncomingCueMs()`); never subtract it |

### Analyzer v7

`smart-mix-audio-v7` keeps every v6 measurement and adds the structure of Smart Mix 3
(SM3-D2): phrases of 8, 16 or 32 bars with a heuristic kind, one energy byte per bar
and `structureConfidence`. Readers accept v7, v6 and v5 profiles
(`READABLE_ANALYZER_VERSIONS`); writers, the backfill and Admin coverage target v7.

Migration 147 stores the structure in nullable `track_mix_profiles` columns: `phrases`
(JSON list of `start_beat`, `start_ms`, `bars`, `energy`, `delta_energy`, `kind`),
`energy_curve` (one byte per bar), `vocal_presence` (one byte per phrase, see "Voice per
phrase" below) and `structure_confidence` (REAL, four decimals). Profiles written
before v7 keep null structure. An empty phrase list with confidence 0 means the track could
not be segmented, which is different from null.

Profile reads leave the structure out unless the planner segments by phrase
(`planner_reads_structure`, only `smart-mix-v3`), so planning with `smart-mix-v2` reads the
same columns as before. The public profile endpoint and the plan responses do not include the
structure yet; Admin reads it through `GET /api/admin/smart-mix/tracks/{id}/structure` and,
for accounts with `library.analysis.manage`, draws it in a track's audio profile (album track
list, **Show audio profile**): a 1 px rule at each phrase boundary, the kind and length of each
phrase, a 1 px voice lane and the energy curve as a 1 px lane, on the track's time axis.

`PROFILE_SCHEMA_VERSION` stays `1`: the VirtualDJ plugin 1.0.0 refuses capabilities and
profiles of any other schema. Readers accept every schema up to the current one
(`READABLE_PROFILE_VERSIONS`), and the backfill, coverage and campaign target the analyzer
and the schema together, so a later schema bump needs no other server change.

### Beats and downbeats

Since SM3-D14 the beats and the bar come from a model, because the onset heuristic put the
downbeat on the wrong beat of the bar on more than half of the tracks checked at gate SG1.

- **Model.** Beat This! (CPJKU, ISMIR 2024; code and weights MIT), checkpoint `small0`,
  with its DBN post-processing: madmom's `DBNDownBeatTrackingProcessor` with 3 or 4 beats
  per bar. Without it, Beat This! picks peaks and leaves spurious beats 80-100 ms apart in
  about half the tracks; on 127 reference tracks the grid then slipped and 34 % of the
  phrase-genre tracks got no downbeat, against 9 % with the DBN, which also put more of
  them on the right beat (86 against 65). The analysis image fetches the checkpoint and
  the licence in its `beat-this-weights` stage, checks their sha256 and bakes them in as
  `/app/models/beat_this-small0.ckpt` and `/app/models/beat_this.LICENSE`; `beat-this` is
  installed next to torch against the installed version (`requirements-beat-this.txt`).
  `CRATE_BEAT_THIS_CHECKPOINT` names the checkpoint (`final0` needs the build arguments
  documented in the Dockerfile) and `CRATE_BEAT_THIS_WEIGHTS` overrides the path. Nothing is
  downloaded at run time.
- **madmom.** Its PyPI release (0.16.1) does not build on Python 3.13, so the `madmom-wheel`
  stage builds a wheel from a pinned commit of `CPJKU/madmom` against the analysis
  image's numpy, and the image installs only the wheel, under the same constraint that
  keeps torch and numpy where they were; there are no compilers in the image. madmom's code
  is BSD (`/app/models/madmom.LICENSE`); its package also ships model files under CC
  BY-NC-SA 4.0 that Crate does not use (the DBN needs none), which is acceptable for Crate
  as free and open-source software.
- **Where it runs.** `compute_smart_mix_profile` runs it before the analysis
  (`crate/smart_mix/beat_model.py`) and passes the beats to the Rust analyzer
  (`crate-cli analyze --file <track> --beats <json>`, a temporary file with `tracker`,
  `beats_ms` and `downbeats_ms`) or, without `crate-cli`, to the Python fallback. Both use
  them instead of their own tracker, still fit the constant grid, and anchor the bar on the
  grid phase (beat index mod 4) that collects the most model downbeats within 70 ms, if
  that phase holds at least 60 % of the model downbeats inside the grid. Otherwise the
  track has no downbeat and no phrases. The Rust cue downbeats (`introDownbeatMs`,
  `outroDownbeatMs`) take the same rule over the 32 beats around each cue. A `crate-cli`
  whose `analyze --help` does not list `--beats` would track its own beats after the model
  ran, so the worker logs a warning and the Python analyzer takes the beats instead.
- **Fallback.** Without torch, `beat_this`, madmom or the weights, when the model fails or
  finds no beats, and for tracks over 600 s, the analysis keeps its own tracker and
  heuristic and the worker logs it. Without madmom the model is off: it never runs
  without its DBN. Only an image without torch (`PANNS=off`) leaves the model out on
  purpose and logs it at info; with torch, a missing `beat_this`, madmom or weights mean a
  broken image and log a warning.
- **Storage.** Migration 149 adds `beat_tracker` (`beat-this-small0-dbn`: the checkpoint
  and the post-processing), null with the analyzer's own tracker. It is part of the
  profile revision. Beat This! ships inside `smart-mix-audio-v7`: a draft that brings a
  tracker the stored profile lacks, or another one (`beat-this-small0-dbn` over the
  `beat-this-small0` of the first, peak-picking builds), replaces it at the same quality,
  and a run without the model never replaces a profile whose beats came from it.
- **Cost.** About 15 s of CPU for a 240 s track with one thread (`TORCH_NUM_THREADS`), plus
  1-3 s for the DBN; `test_beat_model_overhead_within_budget` (run with `--benchmark`)
  fails above 25 s.

### Voice per phrase

Since SM3-D13 a profile with phrases also says how much of each phrase has an audible sung or
spoken voice, so a transition can avoid laying one voice over another.

- **Model.** YAMNet (Google, AudioSet, Apache-2.0), ported to PyTorch in
  `crate/smart_mix/voice_model.py` with Google's original weights. The analysis image builds
  them in its `yamnet-weights` stage: it downloads `yamnet.h5`, the class map and the licence,
  checks their sha256 and converts the weights with `scripts/convert_yamnet_weights.py` to
  `/app/models/yamnet.npz` (licence at `/app/models/yamnet.LICENSE`). Essentia's packaged
  YAMNet graph is not used: its models are licensed for non-commercial use only. The port
  matches Google's TensorFlow reference within 5e-6 (`test_smart_mix_voice_model.py`).
- **Byte.** YAMNet scores 0.975 s patches every 0.48 s; a patch's voice score is its highest
  AudioSet voice class (speech, narration, singing, choir, chant, rapping). A phrase's byte
  is the geometric mean of its patch scores on a log scale, from `LOG_FLOOR` (10^-4) or less
  (0) to 1 (255), and the phrase counts as voiced from `VOCAL_THRESHOLD`
  (`crate/smart_mix/vocals.py`). The byte stores no threshold, so the voiced cut can move
  without analysing the library again.
- **Calibration (gate SG1b, 2026-11-05).** Measured against synced lyrics instead of hand
  labels: 358 production tracks with LRCLIB synced lyrics from 20 genres, analysed with v7
  outside the database; a phrase is voiced when lyric lines cover a quarter of it and
  unvoiced when none touches it. 2,721 phrases of 275 tracks qualified (76 % voiced). The
  share of voiced patches, the arithmetic mean and the geometric mean separate equally well
  (AUC 0.79-0.80); the geometric mean was kept because it stores no threshold. At
  `VOCAL_THRESHOLD = 90` (a mean score of about 0.0026): precision 0.88, recall 0.78,
  specificity 0.66, which meets the design's precision 0.8 and recall 0.7. Lyrics miss
  backing vocals and ad-libs, so these figures are a lower bound. YAMNet is strong on
  alternative rock, post-punk, new wave, pop and hip-hop (AUC 0.86-1.0) and weak on black
  and death metal, industrial metal, post-hardcore, synthpop and trip-hop (0.64-0.67).
  v7 found no phrases on 66 of the 358 tracks, mostly extreme and industrial metal.
- **Where it runs.** `compute_smart_mix_profile` adds the voice after the analysis, from the
  Rust analyzer or the Python fallback, so both analyzers stay identical. Without torch or the
  weights (`PANNS=off`, or `CRATE_YAMNET_WEIGHTS` pointing nowhere), or when decoding or the
  model fails, the profile is published without voice and the worker logs a warning.
- **Cost.** About 0.7 s of CPU per minute of audio with the analysis worker's single native
  thread (`OMP_NUM_THREADS=1`); `test_voice_overhead_within_budget` (run with `--benchmark`)
  fails above 1.5 s.
- **Storage.** Migration 148 adds `vocal_detector` (`yamnet-2`; `yamnet-1` stored the share
  of patches above a fixed score and only ever existed in development), set together with
  `vocal_presence` or not at all. Voice ships inside `smart-mix-audio-v7`, so a draft that
  brings a detector the stored profile lacks replaces it at the same quality, and a run
  without the model never strips stored voice. Reanalyzing a v7 track from Admin therefore
  adds its voice; changing the detector name recomputes every profile through the backfill
  without a new analyzer version.

### Analyzer v6

`smart-mix-audio-v6` (Rust and Python fallback alike) changes three measurements.

- **Key.** v5 summed raw 2048-point FFT bins into pitch classes from 20 Hz. Below about
  180 Hz a bin is wider than a semitone and the low bins fell on the harmonic series of a
  flat F, so kick and bass read as F major, D minor or A minor: 81 % of the development
  profiles were 7B, 8A or 7A. v6 maps an 8192-point FFT onto semitone bands from A1 to G#6,
  each summing to one, and whitens them against their neighbours before matching the same
  Krumhansl-Kessler profiles.
- **Tempo and grid.** v5 published the tracked beats and took the tempo from a regression
  of beat index against time, so a beat the tracker inserted or dropped while following the
  off-beat through a break moved the BPM by about 1/N (128.346 for 128) and left that
  section half a beat out. v6 fits the strongest constant pulse at twice the beat rate,
  where an off-beat lines up with a beat. When the beats stay on it along most of the
  track it publishes a constant grid, snaps the tempo to a whole or half BPM if that keeps
  the grid within 25 ms over the track, and checks its phase against the bass: the
  majority of the tracked beats chooses between the two half-beat phases, real bass twice
  as strong on the other phase contests that choice, and four times as strong moves the
  grid onto the kick (the tracker follows broadband onsets, so quiet hats on the off-beat
  can outvote a kick without a click). A track whose tempo moves keeps its tracked beats.
  Local `intro*`/`outro*` tempo and beats follow the constant grid only where the tracked
  beats around the cue keep its tempo within 1 %; their stability always comes from the
  tracked beats.
- **Quality.** A profile is `full` only if its grid holds. On a constant grid: at least
  70 % of the tracked beats on the published phase, a phase the bass does not contest,
  both cues keeping its tempo, and no stretch of at least 28 tracked beats coherent at a
  tempo 2 % or more away from it (more than a quarter beat of drift). Without one: tracked
  beats that never slide half a beat and whose phase the bass does not contest.
  Other profiles stay `partial`; the planner can still beatmatch from their cue beats, but
  clients must not trust their whole grid.

#### What happens when v6 is deployed

- **Readers keep the v5 profiles.** `READABLE_ANALYZER_VERSIONS` (v6 and v5) decides what
  counts as current for rule-based playlists that require a full profile (preview,
  generation and scheduled `auto_refresh_enabled` regeneration), the
  `is_current_full_profile` flag, sonic neighbours and collection insights. A v5 profile
  keeps serving its v5 measurements, key bias and tracked grid included, until it is
  recomputed. The planner, compatible tracks and the profile endpoints never filtered on
  the version.
- **Writers, the backfill and Admin target v6.** Every new analysis writes v6 and replaces
  the v5 profile of its track. Admin coverage counts only v6 profiles as current, and the
  track table shows v5 ones as `outdated`: they measure backfill progress, not what
  readers can use.
- **Recomputing is a backfill campaign.** Deploying does not start one. Started from Admin,
  it claims every v5 profile (and missing ones) with target generation v6. Until v7, a
  campaign left `running` at deploy kept going under the new target; since v7 a campaign of
  another target stops claiming (see [Campaign, queues and backfill](#campaign-queues-and-backfill)).
- When the backfill has finished, remove v5 from `READABLE_ANALYZER_VERSIONS`.

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
Claims use `SKIP LOCKED`, a token, `target_generation` and attempts. A track is claimable
unless its profile is at the target analyzer and profile schema, current and usable; a
profile the backfill just wrote is never claimed again. `target_generation` is the analyzer
version (with `+schemaN` appended for schemas above 1), so a new analyzer version or schema
makes attempts from the previous generation eligible again. It prioritizes the play queue,
supplied offline IDs, favorites and collections, and listening history before everything else.
It can promote Python profiles when the Rust CLI is available, within `maxAttempts`.

The campaign is persisted under `smart_mix:backfill_campaign`, with the states `running`,
`paused`, `cancelled` and `completed`. `controlState=idle` also covers a missing campaign and
terminal campaigns; on its own it does not mean full coverage. Pausing or cancelling stops the
campaign from continuing; it does not forcibly interrupt child analyses that were already
accepted. A campaign records its target: `target` (analyzer version) and `profile_version`
(missing on campaigns saved before v7, which count as schema 1). Resuming reuses a running or
paused campaign of the same target with its counters. A campaign of another target never
claims for the deployed one: the coordinator stops it with `control: superseded`, Admin
reports `controlState=idle` while still showing the old campaign, and starting (or resuming)
creates a new campaign for the deployed target with zeroed counters. A campaign that
completes has exhausted the claimable work in that pass; it can still leave exhausted errors or
non-current profiles. Check coverage and `processing.exhausted` before treating the backlog as
resolved. A coordinating task in `done` does not mean all of its children have finished either.

### Running the v7 backfill (Smart Mix 3)

Production holds a `cancelled` campaign with `target` `smart-mix-audio-v6`. After the release
with v7 and migration 147 is deployed through the normal process, recompute the library like
this. The queues do not change: the coordinator and each analysis run on `heavy`.

1. **Check the starting point.** Open Admin, Analysis, Smart Mix, or call
   `GET /api/admin/smart-mix/status` with an account that has `library.analysis.manage`.
   Expect `analyzerVersion` `smart-mix-audio-v7`, `profileVersion` `1`, `controlState`
   `idle`, `campaign.target` `smart-mix-audio-v6` with `campaign.status` `cancelled`, and
   `activeTask` null. If `refreshedAt` is null or older than ten minutes, the call queues a
   coverage refresh: read it again a minute later. Coverage starts close to 0 % and `versions`
   lists the v6 and v5 profiles still being served. If `activeTask` is not null, wait for it
   to finish (it exits at once for a cancelled campaign) or cancel it from Tasks.
2. **Start the campaign.** Press **Start backfill** (batch size 25, 3 attempts), or call
   `POST /api/admin/smart-mix/backfill` with `{"batchSize": 25, "maxAttempts": 3}`. The answer
   is `{"status": "queued", "taskId": "…"}` and the campaign becomes `target`
   `smart-mix-audio-v7`, `profile_version` `1`, `status` `running`, `batches` and `claimed`
   `0`. Raise `batchSize` (up to 100) only if the heavy worker keeps up.
3. **Watch it.** `controlState` `running`; `campaign.batches` and `campaign.claimed` grow;
   `currentProfiles` and `coveragePercent` rise; `processing.active`, `failed` and `exhausted`
   show the work and its errors; `GET /api/admin/smart-mix/activity` gives
   `tracksPerMinute`. The campaign claims every profile that is not v7: the v6 profiles the
   cancelled campaign rewrote, v5 profiles, tracks without a profile, `unavailable` and
   source-changed profiles. Claims the v6 campaign left in `analyzing` become claimable two
   hours after they were taken. Each rewritten track is claimed once.
4. **Pause, resume or cancel.** **Pause backfill** or `POST /api/admin/smart-mix/backfill/pause`
   (only from `running`, 409 otherwise); **Resume backfill** or
   `POST /api/admin/smart-mix/backfill/resume` with the same body as the start, which keeps
   the counters; **Cancel backfill** or `POST /api/admin/smart-mix/backfill/cancel` (from
   `running` or `paused`). None of them interrupts analyses already handed to the heavy queue.
   Starting again after a cancel opens a new v7 campaign that only claims what is still not
   v7.
5. **Close it.** The campaign turns `completed` when a pass claims nothing and nothing is in
   flight. Then check `processing.exhausted` and the track list filters `outdated` and
   `failed`, and use **Reanalyze track** for the ones worth retrying. Once the backfill has
   finished, a later release can drop v6 and v5 from `READABLE_ANALYZER_VERSIONS`.

## AI worker lanes and sizing

No shipped Smart Mix task calls a model: profiles, plans and backfill keep the queues above.
Any Smart Mix work that calls a model has to run on the `ai` lane, like every other AI task
(see [Where model calls run](ai-agents.md#where-model-calls-run)), so its capacity is the
capacity described here.

`crate-worker` runs `worker --queues default,fast,ai,ai_bulk` (`default,ai,ai_bulk` in the home
profile). Next to its general pool it starts one Dramatiq process per AI lane, each with its
own threads. No other service consumes the AI lanes.

| Variable                       | Default | Lane      | Meaning                                    |
| ------------------------------ | ------: | --------- | ------------------------------------------ |
| `CRATE_AI_WORKER_THREADS`      |       2 | `ai`      | Interactive AI tasks that can run at once  |
| `CRATE_AI_BULK_WORKER_THREADS` |       1 | `ai_bulk` | AI batches (taxonomy) that can run at once |

Values are clamped to 1–16, and a value that is not an integer uses the default. They are read
when `crate-worker` starts, so a change needs a restart of that container. `docker-compose.yaml`
and the dev, home and federation-dev Compose files forward both; the home installer lists them as
tuning variables. A thread is held for the whole task, including the wait for the provider: up
to 300 s on `ai` and up to two hours for a taxonomy batch.

Size the lanes in this order:

1. **Provider slots.** Each provider connection admits at most `max_concurrent` calls at once
   (2 by default, 1–8, set per connection under AI models in Admin). An `ai` thread beyond the
   slots of the connection that serves the interactive actions only adds capacity requeues: the
   task waits 5–30 s per attempt and fails after ten. Keep `CRATE_AI_WORKER_THREADS` at or
   below that connection's `max_concurrent`, unless the actions are bound to different
   connections.
2. **Bulk shares those slots.** On a connection with more than one slot, a bulk reservation
   leaves one free, and a batch yields while `ai` has pending tasks. With the defaults (two
   slots, two `ai` threads, one bulk thread) a taxonomy batch uses at most one slot. A second
   bulk thread runs a second batch on the same slots; raise it only when the bulk actions are
   bound to a connection with slots to spare.
3. **Priority does not reorder a lane.** Dramatiq applies task priority only among the messages
   a pool process has already prefetched (twice its threads), so each lane runs close to first
   in, first out. Queued show extractions (priority 2) or i18n drafts (priority 3) delay an EQ
   or playlist proposal (priority 0) on the same lane. Add `ai` threads for that only when the
   provider has slots for them; otherwise raise the connection's `max_concurrent` first.
4. **Memory.** Measured in a container started from the worker image, with idle pools: 498 MiB
   of cgroup usage, of which the two idle AI pools take about 180 MiB (93 MB per AI worker
   process). Per running call, the transport child takes 44 MB (49 MB on the legacy path), an
   `ai` worker with its handler modules loaded 136 MB, and Tesseract on a 2400×3400 poster
   162 MB. At peak, with the default threads, the AI pools add about 0.7 GB (two show
   extractions with OCR and image decoding, plus a bulk batch). `crate-worker` therefore has `mem_limit: 2304m` in `docker-compose.yaml` and
   the dev and home files, and `2816m` in `docker-compose.project.yaml`. Each additional thread
   can add one more call with its transport child and its handler's working set, so raise the
   limit together with the threads.
5. **Database connections.** Every running task holds a handler session and a heartbeat
   session, so each AI pool process starts with `CRATE_SQLALCHEMY_POOL_SIZE` set to at least
   twice its threads (4 for `ai` and 2 for `ai_bulk` with the defaults), plus the configured
   overflow. Count them against PostgreSQL's `max_connections` when raising threads.
6. **Stopping.** Every pool runs with a 90 s shutdown timeout, the longest an AI call may last,
   and `crate-worker` has `stop_grace_period: 2m`, so a stop or a deploy lets in-flight calls
   finish. If one pool exits on its own, the other pools get one SIGTERM and 105 s to drain, and
   the container restarts with every lane.

To see whether the sizing fits, open the Admin Tasks page: it shows `ai` and `ai_bulk` with their
running and pending tasks and how long the oldest pending task has waited, and draws a task that
waits for provider capacity as deferred. The ops snapshot counts those tasks per lane, the
`ai.capacity.requeue` and `ai.capacity.wait` metrics count the requeues and bulk waits, and the
task's progress reads "Waiting for AI provider capacity". Steady requeues mean more threads than
provider slots; a growing wait with no requeues means too few threads.

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
| `GET /api/admin/smart-mix/tracks/{id}/structure`                             | Stored phrases (with end and voice byte), energy curve and bar starts of one profile, for review in Admin               |

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

## Offline plan evaluation

Smart Mix 3 measures every planner change offline before it reaches a client (see
`tools/smart-mix-eval/README.md`). `build_dataset.py` builds a fixed set
of real edges from the compatible-tracks service, stratified by root genre and tempo band;
`run_eval.py` plans it with a planner and scores each plan with the pure metrics of
`crate.smart_mix.evaluation`: policy violations, phrase alignment, bass overlap, harmonic
clash, energy step and vocal clash; `render_pair.py` and `blind_session.py` render pairs and run
the blind listening test.

- The tools read a development library through read-only PostgreSQL sessions and the pure
  planner; they write no rows and no plan cache. They are never run against production without
  Diego's authorization.
- Profiles without phrases (analyzer v5 and v6) get phrase alignment from an 8-bar grid and no
  vocal metric. Compare planners on the same profile generation.

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

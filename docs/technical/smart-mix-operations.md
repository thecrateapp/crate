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
  - app/crate/smart_mix/structure.py
  - app/crate/smart_mix/beat_model.py
  - app/crate/smart_mix/vocals.py
  - app/crate/smart_mix/planner.py
  - app/crate/smart_mix/candidates.py
  - app/crate/smart_mix/refinement.py
  - app/crate/smart_mix_ai.py
  - app/crate/worker_handlers/smart_mix_refinement.py
  - app/crate/smart_mix/evaluation.py
  - tools/smart-mix-eval/README.md
  - tools/smart-mix-eval/structure/README.md
  - app/crate/smart_mix/policy.py
  - app/crate/smart_mix/source.py
  - app/crate/api/smart_mix.py
  - app/crate/api/smart_mix_admin.py
  - app/crate/api/capabilities.py
  - app/crate/api/schemas/smart_mix_admin.py
  - app/crate/db/jobs/analysis_storage.py
  - app/crate/db/jobs/smart_mix_backfill.py
  - app/crate/db/migrations/versions/147_smart_mix_structure.py
  - app/crate/db/schema_sections/smart_mix_backfill_candidates_v155.py
  - app/crate/smart_mix/backfill_window.py
  - app/ui/src/components/SmartMixBackfillSettings.tsx
  - app/crate/db/queries/smart_mix_admin_tracks.py
  - app/crate/db/queries/smart_mix_compatible.py
  - app/crate/db/repositories/smart_mix.py
  - app/crate/db/repositories/smart_mix_signals.py
  - app/crate/smart_mix/stems.py
  - app/crate/db/repositories/smart_mix_stems.py
  - app/crate/db/schema_sections/smart_mix_stems_v156.py
  - app/crate/db/repositories/smart_mix_playlists.py
  - app/crate/smart_mix/separation.py
  - app/crate/smart_mix/stem_storage.py
  - app/crate/smart_mix/stem_files.py
  - app/crate/worker_handlers/smart_mix_stems.py
  - app/crate/db/jobs/smart_mix_stems.py
  - app/crate/db/repositories/smart_mix_stem_files.py
  - app/crate/db/schema_sections/smart_mix_stem_files_v158.py
  - app/Dockerfile
  - app/crate/db/schema_sections/smart_mix_playlists_v157.py
  - app/crate/api/smart_mix_playlists.py
  - app/crate/api/decks_stems.py
  - app/crate/api/settings.py
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
  - tools/crate-cli/src/tempo_grid.rs
  - tools/crate-cli/src/analyze.rs
  - app/tests/test_smart_mix_versions.py
  - app/tests/test_smart_mix_planner.py
  - app/tests/test_smart_mix_publication.py
  - app/tests/test_smart_mix_backfill.py
  - app/tests/test_smart_mix_backfill_window.py
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

| Identifier                         | Value                | Meaning                                               |
| ---------------------------------- | -------------------- | ----------------------------------------------------- |
| `API_CONTRACT_VERSION`             | `2026-08`            | Advertised integration and capabilities contract      |
| `PROFILE_SCHEMA_VERSION`           | `1`                  | Schema of the persisted and serialized profile        |
| `ANALYZER_VERSION`                 | `smart-mix-audio-v9` | Target generation of profile analysis                 |
| `MEASUREMENT_VERSION`              | `bs1770-v1`          | Loudness and true peak provenance used by the planner |
| `BEAT_GRID_FORMAT`                 | `delta-ms-v1`        | Beat grid format                                      |
| `PLANNER_IDENTIFIER`               | `smart-mix-v2`       | Identifier for plan batches and capabilities          |
| `PLANNER_POLICY_VERSION`           | `2`                  | Numeric version of each individual plan               |
| `PLANNER_POLICY.rules_revision`    | `7`                  | Internal rules revision included in the cache key     |
| `PLANNER_POLICY_V3.identifier`     | `smart-mix-v3`       | Planner on the stored phrases (SM3-D3)                |
| `PLANNER_POLICY_V3.rules_revision` | `2`                  | Rules revision of v3, in its cache key                |

Changing the rules does not necessarily change the public planner identifier: the cache key
includes both. `PLANNER_IDENTIFIER` is the default: plan batches without `plannerVersion`,
`smart_mix.planner_version` and the VirtualDJ contract. `smart_mix.planner_versions` lists every
planner the plan batch accepts. v3 plans keep plan version 2: they have v2's fields and meaning.
`API_CONTRACT_VERSION` stays `2026-08` although v3 extends the plan batch, because VirtualDJ
plugin 1.0.0 refuses any other contract and the extension is additive.

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

### Analyzer v9

`smart-mix-audio-v9` fixes two defects found while building the stems evaluation sets
(399 tracks: electronic, phrase, industrial, metal and punk) on the v8 profiles production
writes:

- **m4a at twice its length.** symphonia's MP4 demuxer sets the channel count only for PCM
  sample entries, so an AAC track in an `.m4a` has none in its codec parameters. `crate-cli`
  read its interleaved stereo frames as mono: the audio came out twice as long, at half speed
  and an octave down, and the profile had twice the real duration, a grid, cues and phrases
  on that timeline and no loudness. 2,207 of the 2,226 `.m4a` of the development copy of the
  library (every AAC one; the ALAC ones were right) had a profile of twice their duration,
  in every analyzer version. The library analysis (`analyze`: BPM, key, loudness, energy)
  and PANNs read the same slowed audio. Both decoders now mix to mono by the channel count
  of each decoded buffer. Beat This! never ran on them either: libsndfile cannot open AAC
  in MP4, and librosa reads files only through it; ffmpeg now decodes them (see
  [Beats and downbeats](#beats-and-downbeats)).
- **Tracks without bars.** The bar anchor required one grid phase to hold 60 % of every model
  downbeat inside the grid, the ones more than 70 ms from every beat included. Beat This!
  slides half a beat off the grid in some sections, so tracks whose on-grid downbeats all
  agreed lost their downbeat and every phrase. The winning phase now needs 60 % of the
  downbeats that land on the grid, and at least half the downbeats inside the grid must land
  on it.

| 399 tracks of the stems evaluation sets            | v8                 | v9                 |
| -------------------------------------------------- | ------------------ | ------------------ |
| Without phrases (electronic, phrase, ind., m/p)    | 45 (11, 5, 17, 12) | 30 (6, 2, 9, 13)   |
| Tracks with phrases whose profile changes          | -                  | 0 of 350 (non-m4a) |
| `.m4a` duration, Ministry "Fear (Is Big Business)" | 583,656 ms         | 291,828 ms         |

Every anchor of the old rule is the same anchor under the new one, so the 350 tracks that
had phrases and are not `.m4a` keep their profile byte for byte; the 16 tracks that gain a
bar change only `downbeatAnchorMs`, `timeSignature`, `phrases`, `energyCurve` and
`structureConfidence`. The 30 left without phrases are tracks the DBN hears in 3/4 (10,
SM3-D16) and tracks whose bar phase moves during the track (20): odd bars in the music, which
madmom confirms on two of the four it was checked on, or model slips. A fixed `.m4a` profile
matches the profile of a FLAC copy of the same file in grid, downbeat and phrases. Two
offsets remain between symphonia, which `crate-cli` decodes with, and players: it keeps the
encoder delay an MP4 edit list trims (about 46 ms on gapless AAC) and decodes HE-AAC without
its SBR band (about 22 ms). The grid comes from Beat This!'s beats, decoded by ffmpeg as
players decode, so only `crate-cli`'s own readings move: `bpmConfidence` was 0.78 on one
gapless AAC file against 0.90 on its FLAC copy.

Readers accept v9, v8, v7, v6 and v5 profiles (`READABLE_ANALYZER_VERSIONS`); writers, the
backfill and Admin coverage target v9. v9 keeps `beat-this-small0-dbn` and `yamnet-2`, so a
track analysed by v8 or v7 is recomputed from its stored signals, except the `.m4a` ones,
which have no stored beats (see [Running the v9 backfill](#running-the-v9-backfill)).

### Analyzer v8

`smart-mix-audio-v8` keeps every v7 measurement, the grid, the downbeats and the phrases,
and changes how both analyzers measure the steadiness of Beat This!'s beats, which v7 read as
if they came from the analyzers' own trackers. On the electronic set of the SM5 evaluation
(120 tracks of drum and bass, techno, house and other dance music), v7 marked 33 profiles
`full` where production's v5 and v6 profiles had 67, and the planners refused to beatmatch 73
of its 112 electronic edges. Most of that drop came from the v6 rules (`clear_phase`,
`grid_holds`) and was right: of the 80 `full` grids v5 gives these tracks, 25 match madmom's
beats and Beat This!'s at both cues, 24 miss them at a cue where the two agree, and the other
31 cannot be judged because the two disagree there. Three effects of v7's
measurement were not:

- **Cue jitter read onset peaks.** The Rust cue windows took the jitter of the onset frame
  next to each model beat (`model_beat_frames`), which follows the attacks. Attacks scatter
  around a steady pulse, and the model's beats are the pulse: with the analyzer's own tracker
  the cue jitter was 0 in 200 of 240 cue windows, with Beat This! in 87.
- **Half-tempo stretches.** Beat This!'s DBN can hold half the tempo through an intro or a
  break. Counted one after another, those beats halved the cue tempo, failed the 1 % grid
  check and drifted, and over the whole track they dropped `tempoStability` to 0 when the
  stretch covered the first third (several drum and bass tracks read 0.0-0.33).
- **20 ms frames.** Model beats sit on Beat This!'s 20 ms frames: a 470 ms pulse gives 460
  and 480 ms intervals, and a perfectly steady pulse read 0.89 in the Python analyzer, below
  the 0.9 the long beatmatch needs.

v8 measures model beats on the track's constant grid, in both analyzers alike
(`model_beat_stability` in `tempo_grid.py` and `tempo_grid.rs`): each beat counts by its grid
beat, so a skipped beat is not a tempo change; the tempo of the first and the last third is a
regression over their beats; and one 20 ms frame (`MODEL_BEAT_RESOLUTION_MS`) is forgiven of
the median interval jitter. The Rust cue windows take the mix window on the grid and the
jitter of the model beats themselves (`model_local_beat`). The limits do not change (0.25
drift and 0.20 jitter over the track, 0.10 and 0.20 at the cues), the analyzers' own tracker
is measured as before, and a track whose tempo really moves stays `partial`.

| 120 electronic tracks (SM5)                                             | v7                | v8                 |
| ----------------------------------------------------------------------- | ----------------- | ------------------ |
| `full` (drum and bass, techno, house, other dance)                      | 33 (8, 4, 11, 10) | 47 (13, 7, 13, 14) |
| Median `bpmConfidence` and `tempoStability`                             | 0.85 and 0.84     | 0.92 and 1.00      |
| SM5 electronic edges the planners beatmatch                             | 39 of 112         | 53 of 112          |
| `full` grids right and wrong at both cues (madmom and Beat This! agree) | 27 and 2          | 36 and 1           |

On the 145 tracks of the SMB.PR3 set, mostly rock and post-punk, `full` goes from 37 to 67;
where madmom and All-In-One agree, 44 of those grids are right at both cues and 2 are wrong
(v7: 32 and 1), and 21 cannot be judged because the two references disagree. The grid, the
downbeats and the phrases are v7's, so the structure figures of
[Measurement of the structure](#measurement-of-the-structure) hold, and `crate-cli` takes the
same CPU per track (about 2 s).

Readers accept v8, v7, v6 and v5 profiles (`READABLE_ANALYZER_VERSIONS`); writers, the
backfill and Admin coverage target v8. v8 keeps `beat-this-small0-dbn` and `yamnet-2`, so a
track analysed by v7 is recomputed from its stored signals (see
[Running the v8 backfill](#running-the-v8-backfill)).

### Analyzer v7

`smart-mix-audio-v7` keeps every v6 measurement and adds the structure of Smart Mix 3
(SM3-D2): phrases of 8, 16 or 32 bars with a heuristic kind, one energy byte per bar
and `structureConfidence`. v8 keeps that structure unchanged, and v7 profiles stay readable.

Phrases follow a novelty curve at bar boundaries (`structure.py`, mirrored by
`structure.rs`). Each bar gets its mean RMS level from the cue-detection RMS frames that lie
wholly inside it, and the balance of three mel bands, its mean chroma and the mean of 13
MFCC from the spectrogram frames centred inside it; both leave out 50 ms at each end of the
bar. In both analyzers the chroma frames lag the band frames by 1,024 samples (about 46 ms),
the onset envelope's alignment, which the downbeat features need. The novelty of a boundary
compares the four bars before it with the four after it, gap bars left out:

- level change plus half the balance change, less 0.5 dB and never below 0 (the v7 measure);
- plus harmony (SM3-D17): 2 dB (`HARMONY_WEIGHT`) per unit of cosine distance between the
  two mean chromas;
- plus timbre: 8 dB (`TIMBRE_WEIGHT`) per unit of distance between the two mean MFCC over
  √13, each coefficient standardised over the bars from the first to the last music bar:
  minus its mean, over its standard deviation or 1.0 (`MFCC_STD_FLOOR`, in the MFCC units
  of librosa's `mfcc` of the dB mel levels), whichever is larger. Without the floor, the
  bar-to-bar noise of a near-static loop grew to unit variance and split the loop every 8
  bars.

A dynamic programme keeps the 8-bar grid boundaries whose novelty pays 4 dB each
(`BOUNDARY_COST_DB`; boundaries on 16- and 32-bar multiples get 0.25 and 0.5 dB of bonus).
Harmony alone never pays that cost: it decides a boundary together with level, balance or
timbre. Chroma and MFCC are recomputed from the audio and not stored; the harmony and timbre
terms (SM3-D17) add about 6 ms per track in Python and 4 ms in Rust. The Rust chroma is not
librosa's, so Python–Rust parity on real audio keeps its tolerance; the shared fixtures
`structure_v1.json` (frames) and `structure_v2.json` (per-bar features with chroma and MFCC)
pin the algorithm. How the phrases compare with an automatic reference is in
[Measurement of the structure](#measurement-of-the-structure).

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

### Models, licences and cost

Since v7 the profile task runs two models next to the analyzer's own signal processing. Both
outputs carry the name of what produced them, so a reader or a later analyzer knows where
a stored beat or voice byte came from, and both are kept per track (see "Stored model
signals" below).

| Model                                                     | Licence                                            | Output and provenance                                                       | CPU per track, one thread                                                  |
| --------------------------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Beat This! `small0` with madmom's DBN (SM3-D14)           | Beat This! MIT (code and weights); madmom code BSD | Beats, downbeats and beats per bar; `beat_tracker` = `beat-this-small0-dbn` | 12.8 s on a 237 s track, 21.1 s on a 367 s one, plus 0.8-1.0 s for the DBN |
| YAMNet, Google's weights in a PyTorch port (SM3-D13)      | Apache-2.0                                         | Voice per 0.48 s patch and per phrase; `vocal_detector` = `yamnet-2`        | About 0.7 s per minute of audio                                            |
| None: harmony and timbre novelty of the phrases (SM3-D17) | —                                                  | Phrase boundaries, since `analyzerVersion` `smart-mix-audio-v7`             | About 6 ms (Python) and 4 ms (Rust)                                        |

Smart Mix playlists add a third model, run only on their tracks (see "Server separation"
below): `htdemucs-onnx-1`, Demucs v4 `htdemucs` exported to ONNX, on ONNX Runtime CPU.
Demucs' code is MIT; the weights state no licence of their own and were trained partly on
research-only data (MUSDB18-HQ), which Diego accepted at STEM-G0 for a free,
non-commercial project. The image ships them with `htdemucs-onnx-1.NOTICE`, the
attribution. A five-minute track takes about two to three minutes with four threads on a
development laptop, plus the drum beats.

Two more models serve only the offline measurement and never run in the worker: All-In-One
(MIT), the reference for sections and downbeats, and madmom's downbeat networks (CC
BY-NC-SA 4.0), the arbiter. madmom's package in the analysis image ships those network
files too, unused: the DBN needs none.

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
  downloaded at run time. `small0` stays: its raw downbeats agree with All-In-One as often
  as the larger `final0`'s (see [Measurement of the structure](#measurement-of-the-structure)).
- **madmom.** Its PyPI release (0.16.1) does not build on Python 3.13, so the
  `madmom-build` stage builds a wheel from a pinned commit of `CPJKU/madmom` against the
  analysis image's numpy, and the image installs only the wheel, under the same constraint
  that keeps torch and numpy where they were; there are no compilers in the image. The
  build reaches that stage through the `madmom-wheel` alias only when the image installs
  torch; without torch the alias points at the empty `madmom-skip` stage and the image
  gets neither madmom nor its licence. madmom's code is BSD (`/app/models/madmom.LICENSE`);
  its package also ships model files under CC BY-NC-SA 4.0 that Crate does not use (the
  DBN needs none), which is acceptable for Crate as free and open-source software.
- **Where it runs.** `compute_smart_mix_profile` runs it before the analysis
  (`crate/smart_mix/beat_model.py`), unless the beats of this file are stored (see "Stored
  model signals" below), and passes the beats to the Rust analyzer
  (`crate-cli analyze --file <track> --beats <json>`, a temporary file with `tracker`,
  `beats_ms`, `downbeats_ms` and `beats_per_bar`) or, without `crate-cli`, to the Python
  fallback. Both use
  them instead of their own tracker, still fit the constant grid, and anchor the bar on the
  grid phase (beat index mod 4) that collects the most model downbeats within 70 ms, if
  that phase holds at least 60 % of those votes and at least half the model downbeats
  inside the grid voted. A downbeat more than 70 ms from every grid beat (where Beat
  This! slides half a beat off the grid in a section) votes for no phase; before
  2026-11-09 it counted against the winning phase, and tracks whose downbeats all
  agreed on the grid lost their bars and phrases. Otherwise the
  track has no downbeat and no phrases. The Rust cue downbeats (`introDownbeatMs`,
  `outroDownbeatMs`) take the former rule over the 32 beats around each cue: 60 % of every
  model downbeat in the window, the ones off the grid included, since eight bars are too
  few to let those abstain. A `crate-cli`
  whose `analyze --help` does not list `--beats` would track its own beats after the model
  ran, so the worker logs a warning and the Python analyzer takes the beats instead. When
  that probe fails (a timeout on a loaded worker, for example), it logs a warning once and
  is not run again for 60 s (`PROBE_RETRY_SECONDS`); meanwhile each track logs at info that
  the probe is backing off and goes to the Python analyzer as well.
- **Decoding.** The model reads the file with libsndfile. What libsndfile cannot open,
  AAC in MP4 (the library's `.m4a`), ffmpeg decodes to mono at 22,050 Hz, as players
  decode it: it trims the encoder delay an MP4 edit list marks and decodes HE-AAC with
  its SBR band. Before, every `.m4a` lost the model and kept the analyzer's own tracker.
- **Meter.** The DBN keeps one bar length per track, 3 or 4 beats, and `beats_per_bar` is
  read from its downbeats: the beats from each downbeat to the next, when every bar has as
  many (otherwise null). Phrases, the planner and Crate Decks count bars of four, so with
  any other length (SM3-D16) both analyzers give the profile that `time_signature` and no
  downbeat, cue downbeats or phrases, and the track goes to crossfade. With 4, or without a
  constant bar, the bar is anchored as above and `time_signature` is 4 when the track has a
  downbeat. Before, a 3/4 track only lost its downbeat when its downbeats missed the 60 %
  share, and its profile never said it was in three. The DBN chose 3 beats for 5 of the
  145 tracks of the SMB.PR3 measurement; All-In-One hears three beats on 3 of them and on
  no other track.
- **Fallback.** Without torch, `beat_this`, madmom or the weights, when the model fails or
  finds no beats, and for tracks over 600 s, the analysis keeps its own tracker and
  heuristic and the worker logs it. Without madmom the model is off: it never runs
  without its DBN. Only an image without torch (`PANNS=off`) leaves the model out on
  purpose and logs it at info; with torch, a missing `beat_this`, madmom or weights mean a
  broken image and log a warning.
- **Storage.** Migration 149 adds `beat_tracker` (`beat-this-small0-dbn`: the checkpoint
  and the post-processing), null with the analyzer's own tracker. It is part of the
  profile revision. Beat This! ships inside the analyzer version (since
  `smart-mix-audio-v7`): a draft that brings a
  tracker the stored profile lacks, or another one (`beat-this-small0-dbn` over the
  `beat-this-small0` of the first, peak-picking builds), replaces it at the same quality,
  and a run without the model never replaces a profile whose beats came from it.
- **Cost.** With one thread (`TORCH_NUM_THREADS`) on the development machine, `small0`
  takes 12.8 s of CPU on a 237 s track and 21.1 s on a 367 s one, and the DBN 0.8-1.0 s;
  with decoding and resampling, the whole step takes 14.7 s and 25.4 s.
  `test_beat_model_overhead_within_budget` (run with `--benchmark`) fails above 25 s for a
  240 s track. Stored beats skip the step on later analyses (see "Stored model signals").

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
  without analysing the library again. Since SM3-D16 the patch scores are stored as one byte
  each on the same scale, and a phrase byte is the mean of its patch bytes (see "Stored
  model signals" below), within one of the geometric mean of the float scores.
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
  `vocal_presence` or not at all. Voice ships inside the analyzer version (since
  `smart-mix-audio-v7`), so a draft that brings a detector the stored profile lacks replaces
  it at the same quality, and a run without the model never strips stored voice.
  Reanalyzing a track of the current version from Admin therefore adds its voice; changing the detector name recomputes every profile through the backfill
  without a new analyzer version.

### Stored model signals

Since SM3-D16 the outputs of both models are kept per track, apart from the profile, so a
later analyzer version that only changes the Rust step (the grid, the downbeat rule, the
phrases) does not run them again. Beat This! is about three quarters of a profile's cost:
with its beats stored, a backfill of the library takes about 3 days instead of 12-13.

- **What.** Migration 150 adds `track_mix_signals`, one row per track that goes with it
  (`ON DELETE CASCADE`), written by `crate/db/repositories/smart_mix_signals.py`:
  `source_revision`; Beat This!'s `beat_tracker`, `beats_ms` and `downbeats_ms` after the
  DBN, and `beats_per_bar`; YAMNet's `vocal_detector`, `voice_hop_ms` (480) and
  `voice_scores`, one byte per 0.48 s patch on the scale of the phrase bytes. The model
  logits are not kept (about 13 GB for the library): they would only matter to change the
  post-processing itself.
- **When they are reused.** `compute_smart_mix_profile` reads the row once, for the source
  revision it captured (`smart_mix_source_revision`: size, mtime and inode, so a rename
  keeps it, and a retag or a replaced file does not). Stored beats are reused when
  `beat_tracker` is the current tracker name, without loading Beat This!; stored voice
  when `vocal_detector` is the current detector. Otherwise the model runs and its output
  is stored. Beats and voice of the same file share the row; either of a new revision
  replaces the row whole, since the other half described the old file. The voice is still
  computed only for a draft with phrases, so storing it adds no cost, and a track the model
  gives no beats stores none.
- **A file replaced during the task.** The models read the file after the task captured its
  revision, so the task reads the revision again before each store: if the file changed in
  between, it stores nothing and logs `the file changed during the task` (publication
  drops that draft too, as `source_changed`). Each row's `updated_at` is when its task read
  the file (with a time zone; the stores refuse one without), and signals of another
  revision replace the row only when they were read later, so a slow task that read the
  old file never overwrites the new file's signals. Such a store writes nothing and logs at
  info which signal of which revision it kept out.
- **A file rewritten in place.** The revision sees size, mtime and inode, not the audio: a
  file rewritten with the same size, mtime and inode (a tool that restores the mtime, for
  example) keeps its stored signals and its profile. Reanalysing the track does not
  change that: the task reuses the signals of that revision and publication finds nothing
  to replace (`unchanged`). To force a recompute, change the file's mtime (`touch` it on
  the host) and reanalyse the track: the new revision runs both models, replaces the row
  and publishes a new profile.
- **How a later version uses them.** A new analyzer version that keeps
  `beat-this-small0-dbn` and `yamnet-2` reanalyses the library through the backfill as
  usual, and every profile task finds the signals of its track: only decoding, the Rust
  analysis and the phrase voice from the stored bytes run. v8 is the first such version:
  the tracks v7 analysed keep their signals, while v6 and v5 profiles predate them. Changing the checkpoint, the
  post-processing or the detector changes the name, and each track runs that model again
  on its next profile.
- **Phrase voice.** A phrase byte is the mean of its patch bytes whether YAMNet ran or not,
  so a profile built from stored windows is the one the model would give. Each patch byte
  is rounded on its own, so the phrase byte can miss the geometric mean of the float scores
  that SG1b calibrated by one: 1,369 of 1,400 synthetic phrases and 14 of 15 phrases of a
  real track match it exactly (`test_phrase_bytes_from_window_bytes_match_float_scores`).
  On the SG1b calibration set at `VOCAL_THRESHOLD = 90`, the byte path gives precision
  0.8824 and recall 0.7832 against 0.8825 and 0.7837 from the float scores, so the
  calibration holds and the phrase byte is computed the same way in both cases.
- **Failures.** A failed read only means running the models again, and a failed write
  only means not keeping their output: the worker logs a warning and the profile goes on.
- **Size.** 3.4 KB for a 4:21 track and 4.8 KB for a 6:02 one (`pg_column_size` of the
  row; integer arrays are stored uncompressed), so about 0.5 GB for 140,000 tracks.

### Stem analyses

Smart Mix Stems separates a track into drums, bass, other and vocals and keeps what the
planner needs from the stems, never the audio. Two producers write the same format: the
server, for the tracks of Smart Mix playlists, and Crate Decks, which separates on the DJ's
machine and may upload its analysis. The design is
`docs/plans/2026-11-08-smart-mix-stems-design.md` in the Crate Decks repository (STEM-D1,
D4 and §5); the format and the layer live in `crate/smart_mix/stems.py`.

- **Format `stem-analysis/1`.** A JSON document (`StemAnalysis`, unknown fields rejected
  at every level):

  | Field            | Content                                                                                                                                                              |
  | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `schema`         | `stem-analysis/1`                                                                                                                                                    |
  | `producer`       | `crate-server/<version>` or `crate-decks/<version>`; the prefix is the producer kind                                                                                 |
  | `separator`      | `model` (`htdemucs` or `htdemucs_ft`), `version` (the separator identifier, such as `htdemucs-onnx-1`) and `sources`, exactly `["drums", "bass", "other", "vocals"]` |
  | `sourceRevision` | The profile's `sourceRevision` (64 hex characters) of the file the producer analysed                                                                                 |
  | `hopMs`          | 250                                                                                                                                                                  |
  | `levels`         | One base64 string per stem, one byte per 250 ms window: RMS in dBFS, linear from -60 dB (0) to 0 dB (255)                                                            |
  | `drumBeatsMs`    | Optional beats tracked on the drum stem, strictly increasing and within the analysed audio. Stored and measured; they change no grid                                 |
  | `durationMs`     | Duration of the analysed audio                                                                                                                                       |

  Every stem has the same number of windows, and they cover `durationMs` to within one
  window either way. Producers encode a level with `encode_levels`:
  `floor((dB + 60) × 255 / 60 + 0.5)` after clipping to [-60, 0], so -30 dB is 128,
  silence is 0 and the server and Decks write the same bytes.

- **Storage.** Migration 156 adds `track_stem_signals`, written by
  `crate/db/repositories/smart_mix_stems.py`: one row per track and `producer_kind`
  (`server` or `decks`), deleted with the track. It keeps the producer, the separator
  model and version, the source revision, `hop_ms`, one `bytea` per stem, `drum_beats_ms`,
  `duration_ms`, `created_at`, `updated_at` and, for Decks uploads only, `contributed_by`
  (the user, set to null if the user is deleted). Checks keep a Decks row from naming a
  `crate-server/` producer and keep the four curves the same length. A five-minute track
  is about 4.8 KB of levels.
- **Which rows replace which.** A store replaces the producer's row when the source revision
  changed, whatever the separator, or when the new separator is at least as strong. A weaker
  separator never overwrites a stronger analysis of the same file. A Decks upload is not
  kept when the server already has an analysis of the same file from an equal or stronger
  separator. The store says which happened: `stored`, `replaced` or `kept_stronger`.
- **Which analysis applies (`choose_analysis`).** Only analyses of the track's current source
  revision count: when a file changes, its old analyses stop applying at once, before
  anything is recomputed. Of those, the stronger separator wins (`htdemucs_ft` over
  `htdemucs`); on a tie, the server's.
- **Stems layer (`stem_phrase_layer`).** Derived on read, never stored. For each phrase of the
  profile, the mean level byte of each stem over the phrase, rounded half up. A window
  belongs to the phrase that holds its centre; the last phrase ends where the beat grid puts
  its last bar, capped at the profile's duration. There is no layer when the analysis is of
  another source revision, when its duration differs from the profile's by more than 2 %,
  when the profile has no phrases, or when a phrase gets no window.
- **Presence per phrase** (`vocalPresent`, `bassPresent`, `drumsPresent`). A phrase has a
  stem when its mean byte is at least the stem's floor and within the stem's drop of the
  track's loudest phrase of that stem (`STEM_PRESENCE_CUTS` in `crate/smart_mix/stems.py`,
  4.25 bytes per dB). The floor rejects separation leakage in tracks without the stem; the
  drop follows the level each track mixes the stem at, which the absolute -35 dB cut of the
  ST0 spike could not. ST3 calibrated them (`tools/smart-mix-eval/calibrate_stems.py`): vocals
  -45 dBFS and 18 dB against the SG1b lyrics labels (balanced accuracy 0.82 on folds by
  track, YAMNet's byte 0.74 on the same phrases); bass -40 dBFS and 17 dB, drums -40 dBFS and
  14 dB, from the valley of each phrase's level below its track's loudest phrase, which has no
  labels to check it against (the evaluation report in the Crate Decks repository,
  `docs/plans/2026-11-09-smart-mix-stems-evaluation.md`, has the figures). The vocal
  presence is detector `stem-vocals-1` (`vocalDetector`), which replaces YAMNet's voice where
  both tracks of an edge have a layer (STEM-D4). Changing a cut changes plans: it bumps
  `PLANNER_POLICY_V3.rules_revision`.
- **API.** `GET /api/tracks/by-entity/{uid}/mix-profile?detail=full` carries the layer as
  an optional `stems` object (`producer`, `separatorModel`, `separatorVersion`,
  `vocalDetector` and `phrases` with `startMs`, `endMs`, `drums`, `bass`, `other`, `vocals`,
  `vocalPresent`, `bassPresent` and `drumsPresent`); the summary never does. Crate Decks reads and uploads analyses through
  `GET` and `PUT /api/decks/tracks/{uid}/stem-analysis`
  (`docs/technical/crate-decks.md`, section "Stem analyses"). An upload needs
  `smart_mix.stems.contribute` (owner and admin roles by default), at most 64 KiB, a
  `crate-decks/` producer, the track's current source revision (409 otherwise) and its
  duration within 2 %.
- **Turning uploads off.** `PUT /api/settings/smart-mix` with
  `{"stem_uploads_enabled": false}` (setting `smart_mix_stem_uploads_enabled`, on by
  default) makes uploads answer 403 and drops `stem_upload` from `decks.features`.
  Stored analyses and reads stay as they are. There is no Admin switch yet.
- **Capability.** `smart_mix.stems` is `{available, playlists, storage}`. `available`
  and `playlists` (Smart Mix playlists, next section) follow `smart_mix.available`;
  `storage` says the server keeps stem files for Decks: on with `smart_mix.available`,
  a stems directory in the API (`CRATE_STEMS_DIR`) and a stem quota above 0 (see
  "Separation task and stem files").
- **What does not change.** The v8 grid, downbeats, phrases and the YAMNet voice bytes stay
  as they are. `smart-mix-v3` scores with the layer (see "Planner smart-mix-v3"); v2 never
  reads it.

### Smart Mix playlists

A Smart Mix playlist is a playlist its owner marks for Smart Mix (STEM-D2). While it is
on, the server separates its local tracks into stems, and Crate Decks keeps it as an
offline set; every client lists all playlists and marks the Smart Mix ones. The routes
and the Decks sync are in `docs/technical/crate-decks.md` (section "Smart Mix
playlists"); the code is in `crate/db/repositories/smart_mix_playlists.py`.

- **Storage.** Migration 157 adds three tables:
  - `smart_mix_playlists`: one row per playlist ever turned on, deleted with the
    playlist, with the owner, `enabled`, `enabled_at` (last turned on), `disabled_at`
    (set only while off), `last_used_at`, `revision` and `updated_at`. Turning it off
    keeps the row, so clients and the stem-file LRU see the change.
  - `smart_mix_playlist_revisions`: one counter per user. Every change of one of the
    user's Smart Mix playlists takes its next value: turned on or off, or tracks added,
    removed or replaced while on. Decks lists "changes since revision N". The counter
    row is locked until the change commits, so a user's changes are serial and the
    per-user limit holds under concurrent requests.
  - `track_stem_jobs`: one row per track (`pending`, `analyzing`, `ready` or `failed`,
    `attempts`, `last_error`, `requested_at`, `started_at`, `finished_at` and the
    `source_revision` it was asked for), deleted with the track. A track in two Smart
    Mix playlists has one job.
- **Who.** Only the owner turns a playlist on or off; system playlists have no owner.
  Admins read any playlist's status but cannot toggle it.
- **Limits.** Admin settings of each instance, in `PUT /api/settings/smart-mix`:

  | Key                            | Setting                                  | Default  |
  | ------------------------------ | ---------------------------------------- | -------- |
  | `stem_max_tracks_per_playlist` | `smart_mix_stem_max_tracks_per_playlist` | 300      |
  | `stem_max_tracks_per_user`     | `smart_mix_stem_max_tracks_per_user`     | no limit |

  Both count distinct local tracks: a track twice in a playlist, or in two of a user's
  playlists, counts once, and tracks from other instances do not count. Turning a
  playlist on, and adding tracks to it while on (Listen, the web app, smart playlist
  generation, OpenSubsonic), is refused with 409 when the playlist or the user's Smart
  Mix playlists together would go over; nothing is stored. `null` turns the per-user
  limit off; the per-playlist limit is always on (at least 1). Lowering a limit leaves
  playlists that are on as they are, but they cannot grow.

- **Queueing.** A track gets a pending job when one of its Smart Mix playlists turns on
  or receives it and it has no server analysis of its current file (the profile's
  source revision). A Decks upload does not count, because the server's separation
  also produces the stem files (STEM-D6). An existing job:

  - `pending` keeps its place unless the file changed;
  - `ready` whose analysis no longer applies goes back to `pending`;
  - `failed` goes back to `pending` only when the file changed since;
  - `analyzing` is left to the worker.

  Turning a playlist off and removing tracks leave jobs and analyses alone, so the
  separation task (ST2.PR3) claims a job only while one of the track's Smart Mix
  playlists is on. `queue_smart_mix_stem_jobs()` queues for every Smart Mix playlist
  that is on, for that task to run before it claims and catch tracks whose file
  changed.

- **Status.** A track is `ready` when it has a server analysis of its current file;
  otherwise it has its job's state, and `pending` with no job. The estimate is the
  playlist's pending and analysing tracks times the mean time of the latest 20
  separations (four minutes per track until there is one, from the ST2.PR2
  measurements below), without other queued work.
- **Playlist responses.** `GET /api/playlists`, its detail (owner and collaborators)
  and `playlists` in `GET /api/me/playlists-page` carry `smartMix`, which is
  `{enabled, ready, total}`, computed for all of them in one query; `ready` and `total`
  are 0 while off. The toggle invalidates the `playlists` and `playlist:{id}` client
  caches.
- **Work.** The task `analyze_playlist_stems` separates the queued tracks; the
  separation is in "Server separation" and the task in "Separation task and stem
  files". `last_used_at` is set when a playlist is turned on and when its owner
  downloads one of its stem files.

### Server separation

The analysis worker separates the tracks of Smart Mix playlists with `htdemucs-onnx-1`:
Demucs v4 `htdemucs` exported to ONNX by Crate Decks, the network only, run on ONNX
Runtime CPU (STEM-D3). There is no PyTorch in the separation. The code is
`crate/smart_mix/separation.py`; where its audio goes is `crate/smart_mix/stem_storage.py`.

- **One separator for both producers.** The DSP around the graph is numpy, ported from
  Crate Decks' reference (`tools/crate-stems/stems_dsp.py`) with the parameters of the
  ST0 spike report (section 5): normalisation of the whole track by its mono mix,
  segments of 343,980 samples every 257,985, STFT and iSTFT with n_fft 4096 and hop 1024
  (periodic Hann, normalised, reflect padding, centred), triangular overlap-add,
  `shifts=0`. `tests/test_smart_mix_separation_dsp.py` checks it against Crate Decks'
  fixtures within 1e-5, and `tests/test_smart_mix_separation_onnx.py` checks the whole
  separation against the golden stems PyTorch computed (at least 60 dB SDR per stem).
  The server's analyses say `producer` `crate-server/stems-1` and `separator`
  `{model: htdemucs, version: htdemucs-onnx-1}`, the identifier Decks uses for the same
  graph.
- **The graph in the image.** The analysis image downloads `htdemucs-onnx-1.onnx`
  (174 MB) at build time from the Crate Decks release asset
  `models-htdemucs-onnx-1/htdemucs-onnx-1.onnx` and checks its SHA-256
  (`808790c0…6d08`), like the Beat This! checkpoint; the worker never downloads it. It
  lands in `/app/models` with `htdemucs-onnx-1.NOTICE`, the attribution and the note on
  the training data (design section 7). **That release asset does not exist yet: it must
  be published before any image builds from the default.** Until then, and for local
  and dev builds, the file comes from a named build context with the same check:

  ```bash
  docker build --target worker-analysis --build-arg PANNS=on \
    --build-arg HTDEMUCS_ONNX_SOURCE=context \
    --build-context htdemucs-onnx=<directory holding htdemucs-onnx-1.onnx> app
  ```

  `HTDEMUCS_ONNX_URL` points the download elsewhere, and `CRATE_HTDEMUCS_ONNX` the
  worker at another file. Images built with `PANNS=off` separate too; they only lack
  the drum beats.

- **Disk.** Separation writes only to `CRATE_STEMS_DIR` (`/stems` in the Compose files,
  `${MEDIA_DIR}/smart-mix-stems` on the host), and only after checking that it is on the
  library's filesystem: the music volume, never `/tmp`, a `tmpfs` or the container's
  disk. Create the host directory, owned by `PUID:PGID`, before deploying: Docker
  would create a missing one owned by root. Scratch goes to `.scratch` inside it: ffmpeg
  decodes the track to float32 (about 106 MB for five minutes), the overlap-add writes
  one float32 file per stem (four times that), and the directory is removed when the
  stems are no longer needed, on success and on failure.
- **Memory.** Nothing holds a whole track: the normalisation reads the decoded file in
  blocks, and the overlap-add streams, writing each segment's final samples as soon as no
  later segment can touch them. What stays in memory is ONNX Runtime with the graph and a
  few segments of arrays, whatever the track's length. ONNX Runtime's default
  (sequential) executor reuses buffers across the encoder and the decoder and held
  3.8-3.9 GB, above the 1.5 GB at which the worker recycles a process and the 2 GB of the
  default analysis container. The worker runs it without that reuse
  (`SESSION_CONFIG` in `separation.py`, `enable_mem_reuse=False`). Measured in the
  analysis image with 4 threads on a development laptop (Core Ultra 9 185H, shared with
  other work):

  | Session                           | Peak RSS   | Graph per segment | CPU per segment |
  | --------------------------------- | ---------- | ----------------- | --------------- |
  | Sequential (ONNX Runtime default) | 3.8-3.9 GB | 3.0-3.4 s         | 9.7-11.2 s      |
  | Parallel, 2 inter-op threads      | 0.8 GB     | 3.3-4.0 s         | 13.6-16.6 s     |
  | No memory reuse (used)            | 1.0 GB     | 2.4-3.0 s         | 8.0-10.0 s      |

  The three give the same stems: 87.7-101.3 dB SDR against PyTorch on the golden track.
  The parallel executor peaks lowest but spends 40-60 % more CPU per segment, the
  scarcer resource on the server. Once the stems are written the session is dropped and
  the freed heap goes back to the system (`malloc_trim`), so Beat This! afterwards adds
  nothing to the peak: 1.0 GB for the whole separation of three tracks of 300-314 s, each
  in a container limited to 2 GB (its cgroup, page cache included, peaked at 1.4-2.0 GB).

- **Threads.** `CRATE_STEMS_THREADS` (4 by default, 1-64) sets ONNX Runtime's intra-op
  threads and ffmpeg's. Idle threads sleep instead of spinning, so a waiting separation
  does not raise the load the resource governor reads. On the same laptop, with 4
  threads and a one-minute load of 3.6-9, a five-minute track took 122-173 s to separate
  (54 segments, nine tenths of it in the graph), 15-20 s for the drum beats and 2 s for
  the levels: 380-560 s of CPU. One segment of the graph by threads, at a load of about 3:

  | Threads                 | 1   | 2   | 4   | 8   |
  | ----------------------- | --- | --- | --- | --- |
  | Seconds per segment     | 4.4 | 2.7 | 2.2 | 1.7 |
  | CPU seconds per segment | 4.4 | 5.1 | 7.4 | 9.7 |

  Threads past two buy less and less. On the default analysis container
  (`cpus: "0.75"`) set `CRATE_STEMS_THREADS=1`; on the project server (`cpus: "7.0"`)
  the default 4 leaves CPUs to Postgres and the API. The i7-7700 is slower per thread
  than this laptop: **timing a 50-track Smart Mix playlist on the server is still to do
  after the deploy** (ST2.PR2), and its result belongs here.

- **Levels.** The level of a stem is the RMS of its mono mix (the mean of both channels)
  over windows of 11,025 samples (250 ms at 44.1 kHz) from the start of the track; the
  last window may be short and covers the samples it has. `durationMs` is the decoded
  length, rounded to the millisecond. Crate Decks must compute them the same way (ST5).
- **Drum beats.** Beat This! with its DBN, the profiles' beat tracker, runs on the drum
  stem's mono mix at 22,050 Hz and fills `drumBeatsMs`. They are stored and measured,
  never used for the grid (STEM-D4). Tracks over ten minutes, images without torch and
  a model failure leave them out.

### Separation task and stem files

`analyze_playlist_stems` (`crate/worker_handlers/smart_mix_stems.py`) separates the
tracks of Smart Mix playlists in `crate-analysis-worker`. Its queries are in
`crate/db/jobs/smart_mix_stems.py`; the stem files in `crate/smart_mix/stem_files.py`.

- **Queue and order.** `heavy`, priority 2: above the backfill coordinator (3), below
  interactive work. One runs at a time: turning a Smart Mix playlist on, adding tracks
  that need stems and the backfill all queue it with the scheduler's dedup key
  (`schedule:analyze_playlist_stems`), and the scheduler queues it every 30 minutes, which
  picks up retries and changed files. The resource governor applies; the night window
  does not. Its time limit is two hours, for one track.
- **A run.** It fails jobs a dead separation left `analyzing` for over two hours (the
  attempt counts), queues the tracks whose file changed (`queue_smart_mix_stem_jobs()`),
  asks for the profiles of up to ten waiting tracks that have none (the analysis is
  stored under the profile's source revision, so a track waits for its profile), then
  claims one job and separates its track. It runs again a second later while there is
  more to claim, two minutes later while tracks wait for profiles, and otherwise ends
  (`{"status": "idle"}`) after sweeping the stems directory. Without onnxruntime, the
  graph or a stems directory on the music volume it ends as `skipped` with the reason,
  and jobs stay `pending`.
- **Claims.** A job is claimed while one of its track's Smart Mix playlists is on and its
  track has a current profile of the job's revision: `pending` jobs, oldest request
  first, then `failed` ones with attempts left once 15 minutes times their attempts have
  passed. `FOR UPDATE SKIP LOCKED`, like the other claims.
- **Outcome.** The task checks the file's revision when separation starts and again
  before storing: a file that changed in between stores nothing. The `stem-analysis/1`
  (`crate-server/stems-1`), the stem file's row and `ready` are written in one
  transaction. Any failure ends `failed` with one more attempt and `last_error`; a track
  gets three attempts, and one over 20 minutes fails for good at once.
- **The backfill waits.** While a job can be claimed, the backfill coordinator claims
  nothing, queues the task and comes back a minute later with the progress `Waiting for
the stems of Smart Mix playlists`; analyses it already queued finish. Once the
  playlists' work is done (nothing claimable, which includes failed tracks waiting to
  retry), it resumes where it was. A playlist of 300 tracks therefore holds the backfill
  for as long as it takes to separate them, about 20 hours at four minutes per track.
- **Stem files** (STEM-D6). One MP4 per track with three AAC streams at 256 kbps:
  drums, bass and vocals, in that order, each named in its handler (`handler_name`).
  `other` is not stored: Decks rebuilds it as the residual against its own decode. A
  five-minute track is about 29 MB. They live in `CRATE_STEMS_DIR` at
  `<track id mod 256, hex>/<track id>-<revision prefix>.mp4`; ffmpeg writes each one in
  the separation's scratch and it is renamed into place, and the writer refuses any
  path outside that directory or inside its scratch. Migration 158 adds
  `track_stem_files`: one row per track (deleted with it) with the relative `path`,
  `bytes`, the separator, the `source_revision` and `last_used_at`. A new separation of
  the track replaces its file.
- **Quota.** `PUT /api/settings/smart-mix` with `stem_quota_gib` (setting
  `smart_mix_stem_quota_gib`, 50 by default, 0 to 100,000): the total size of the stem
  files, in GiB. After each separation the task evicts until the files fit: first the
  files of tracks in no Smart Mix playlist that is on, then the rest, each least recently
  used first. A file's last use is the later of its last download and the last use of the
  Smart Mix playlists that hold it. 0 keeps no stem files; separation and analyses go
  on. Evicting a file does not queue the track again: its analysis stays, and Decks
  separates the track itself.
- **Sweep.** When it has nothing to claim, the task deletes files of the directory no row
  refers to and scratch left by a separation that died, once they are over two hours
  old.
- **Download.** `GET /api/decks/tracks/{uid}/stems` serves the file with Range support
  (`audio/mp4`), only while it was separated from the track's current file; 404
  otherwise, and when the API has no stems directory. The API mounts it read-only. A
  download marks the file, and the downloader's Smart Mix playlists that are on and hold
  the track, as used now (at most once an hour each): that is the use the LRU reads.
  Details for clients are in `docs/technical/crate-decks.md` ("Stem files").
- **Cost per track.** On the laptop of "Server separation", with 4 threads at a load of
  3.7, the whole task for a 312 s track took 163 s: 131 s to separate, 15 s for the drum
  beats, 1 s for the levels and 16 s for the stem file (30 MB). The status estimate uses
  four minutes per track until real separations exist, since the i7-7700 is slower per
  thread.
- **After the deploy.** Before integration, the Crate Decks release asset
  `models-htdemucs-onnx-1/htdemucs-onnx-1.onnx` must exist (the analysis image downloads
  it), and `${MEDIA_DIR}/smart-mix-stems` must exist on the host, owned by `PUID:PGID`.
  Then time a 50-track Smart Mix playlist on the server and record it here.

### Measurement of the structure

SMB.PR3 measured the v7 bar and phrase structure offline with
`tools/smart-mix-eval/structure/` (its README has the scripts, images and commands) on 145
tracks from the SG1b calibration set and the Crate Decks spike set, analysed outside the
database. 144 are in genres mixed by phrase; the one extreme-metal track is mixed by crossfade
and left out of the table. The analysis ran the branch's final `crate-cli` on Beat This!
beats with the DBN, as the worker does.

- **Reference.** All-In-One (MIT): its sections, edge silence left out, and its downbeats.
- **Arbiter.** madmom's RNN and DBN downbeats (CC BY-NC-SA 4.0 networks, offline only). A
  track has an arbiter when All-In-One and madmom share at least 90 % of their downbeats
  within 70 ms: 96 of the 144.
- **Downbeat right.** The grid's bars hit at least 90 % of All-In-One's downbeats inside the
  grid within 70 ms, counted among the tracks that got a downbeat: the analyzer may
  abstain, but must not anchor the wrong beat.
- **Phrase boundaries on downbeats.** At least 90 % of a track's phrase boundaries lie
  within 120 ms of an All-In-One downbeat.
- **Sections.** `mir_eval.segment.detection` between the phrase boundaries and All-In-One's
  section boundaries (one-to-one matching, first and last boundary trimmed) at ±0.5 s, ±3
  s and ±1 bar; precision, recall and F1 averaged per track. Phrases (8, 16 and 32 bars)
  are finer than sections, which keeps precision low by construction.

| Phrase-mixed genres (144 tracks)                  | Old v7 heuristic   | v7 with Beat This! and its DBN (SMB.PR2c)                  | Plus the SM3-D17 novelty |
| ------------------------------------------------- | ------------------ | ---------------------------------------------------------- | ------------------------ |
| Tracks with phrases                               | 119                | 131                                                        | 131                      |
| Downbeat right among the anchored tracks          | —                  | 97 of 131 against All-In-One; 84 of 92 with arbiter (91 %) | Same                     |
| Phrase boundaries on All-In-One downbeats (≥90 %) | 32 of 119          | 61 of 131                                                  | 66 of 131                |
| Sections ±0.5 s: precision / recall / F1          | 0.28 / 0.23 / 0.25 | 0.36 / 0.32 / 0.33                                         | 0.38 / 0.38 / 0.36       |
| Sections ±3 s: precision / recall / F1            | 0.51 / 0.43 / 0.45 | 0.54 / 0.49 / 0.49                                         | 0.55 / 0.55 / 0.53       |
| Sections ±1 bar: precision / recall / F1          | 0.42 / 0.35 / 0.38 | 0.47 / 0.43 / 0.43                                         | 0.49 / 0.48 / 0.47       |

- **Arbiter subset.** Section F1 at ±3 s goes 0.43, 0.50 and 0.54 in the same three
  columns.
- **SM3-D17 acceptance.** F1 at ±3 s of at least 0.52 with precision not below SMB.PR2c's
  and at most 0.5 s more per track: 0.53, precision 0.55 against 0.54, and milliseconds.
- **MFCC deviation floor.** Rerun on the same beats with the `crate-cli` that adds the
  floor, the 145 profiles are identical, so the table stands.
- **Meter.** The DBN reads 3 beats per bar on 5 of the 145 tracks; All-In-One agrees on 3
  of them and hears three beats nowhere else. Those tracks get no phrases (SM3-D16).
- **Checkpoint.** `small0` against `final0`: their raw downbeats agree with All-In-One on 38
  and 37 of 56 tracks, and on 31 and 30 of the arbiter tracks.
- **Cost.** See "Models, licences and cost" above; the novelty stays far under the 0.5 s
  that SM3-D17 allowed.
- **Caveats.** All-In-One is an automatic reference: the numbers measure agreement with it,
  not correctness, and the arbiter subset is selected by agreement, so it is the easier
  part of the set.

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
| `analyze_playlist_stems`      | `heavy`       | Stems of Smart Mix playlists, one at once |

The backfill applies resource pressure and limits the work in flight to the limit of the
[night window](#night-window): 8 at night and 4 by day by default. Its Admin settings accept
`batchSize` from 1 to 100 (25 by default) and `maxAttempts` from 1 to 10 (3 by default).
`batchSize` caps how many tracks one pass claims, `min(batchSize, limit - in flight)`; it no
longer bounds the work in flight, which it did, at 25, before the night window.
Claims use `SKIP LOCKED`, a token, `target_generation` and attempts. A track is claimable
unless its profile is at the target analyzer and profile schema, current and usable; a
profile the backfill just wrote is never claimed again. `target_generation` is the analyzer
version (with `+schemaN` appended for schemas above 1), so a new analyzer version or schema
makes attempts from the previous generation eligible again. It prioritizes the play queue,
supplied offline IDs, favorites and collections, and listening history before everything else,
from a stored ranking (see [How a pass claims](#how-a-pass-claims)). It can promote Python
profiles when the Rust CLI is available, within `maxAttempts`.

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

### How a pass claims

Ranking the whole library is expensive, and since the night window a pass only claims its free
slots, often one to four tracks. The claim used to rank every track on every pass: on a copy of
the production library (about 136K tracks) that took 4 to 8 s on a development machine, and
about 13 s in production, holding the claim lock. The claim now keeps the ranking in
`smart_mix_backfill_candidates` (migration 155), one row per claimable track with its priority
and whether it is a Python promotion:

| Step  | When it runs                                                                         | Cost (dev machine, ~136K tracks) |
| ----- | ------------------------------------------------------------------------------------ | -------------------------------- |
| Rank  | First claim, inputs changed, ranking older than 10 minutes, or it cannot fill a pass | About 1 s                        |
| Claim | Every pass                                                                           | About 5 ms                       |

- **Order.** The same as before: Python promotions last, then priority, then track id. The
  priorities are 1 the play queue (the current track and the queued items of every device), 2
  supplied offline IDs, 3 favorites and collections (liked tracks, saved albums, playlists and
  followed artists), 4 listening history and 5 the rest. The ranking stores 3 to 5. Every pass
  looks up 1 and 2 again and claims them first, among the tracks still in the ranking.
- **Checks.** Each row a pass takes is checked against the claim rules above (target analyzer
  and schema, quality, `target_generation`, attempts, claims in flight, quarantined albums),
  under `FOR UPDATE SKIP LOCKED`, and leaves the ranking once claimed. A row that is no longer
  claimable, for example because a manual reanalysis wrote a current profile, is skipped.
- **Refresh.** The ranking is rebuilt when its inputs change (analyzer version, schema,
  `maxAttempts` or Python promotion), when it is older than 10 minutes and when it cannot fill a
  pass. Because of the last rule, a pass that claims nothing, which completes the campaign if
  nothing is in flight, always comes from a fresh ranking.
- **What waits for the next ranking.** A track that becomes claimable between rankings (a failed
  attempt with retries left, a dead claim settled as failed, an import, a changed source) or
  changes tier (a new like or play) waits up to 10 minutes, or until the ranking runs out. Before,
  a failed attempt was retried on the next pass.
- **Locking.** Counting, ranking and claiming run under the claim lock that every coordinator
  takes, so two coordinators never rank at once or exceed the window. A claim without a limit,
  which only tests use, ranks the library inline when another transaction holds the lock.
- **Crashes.** The table is an unlogged cache of about 130K small rows: a crash empties it and the
  next claim ranks again.
- **Long play queues.** Every pass reads the play queues: a pass costs about 25 ms with 1,500
  queued items and 120 ms with 10,000.
- **Coverage.** A pass that claims refreshes the coverage at most once a minute, because the
  refresh aggregates the whole library (about a second). Finished analyses also refresh it, and
  the pass that completes the campaign always does.

### Night window

Nobody listens at night, so the backfill keeps more analyses in flight inside a night window
(SM3-D15). Admin edits it in the Smart Mix panel of Analysis, next to the batch size and the
attempts, and the start and resume calls take it in the same body:

| Setting            | Default                             | Accepted values                                               |
| ------------------ | ----------------------------------- | ------------------------------------------------------------- |
| `nightWindow`      | `01:00` to `08:00`, `Europe/Madrid` | `{start, end, timezone}`: `HH:MM`, different times, IANA name |
| `nightConcurrency` | 8                                   | 1 to 32                                                       |
| `dayConcurrency`   | 4                                   | 1 to 32                                                       |

- The window uses the local clock of its timezone, so it follows DST changes. It can cross
  midnight; the start belongs to the window and the end does not.
- In flight means claims of this backfill: `smart_mix` rows in `analyzing` for the current
  target whose child task (`compute_smart_mix_profile` with that claim token) is `pending` or
  `running`, however long it has waited. A claim whose child has not been queued yet counts for
  five minutes, the time the coordinator takes between claiming and queuing. Imports claim the
  `analysis` and `bliss` pipelines and **Reanalyze track** takes no claim, so neither counts.
- A child that ends without settling its claim (retries exhausted, cancelled, or failed by the
  zombie cleanup after its worker died) stops counting at once. The next claim, and the service
  loop after each zombie cleanup, mark such claims `failed` with the error "The analysis task
  ended without settling its claim". The attempt still counts, so a track that keeps killing its
  worker ends up exhausted instead of being retried forever.
- A pass claims at most `batchSize` tracks and never more than the limit of the current window
  minus what is in flight. The claim counts again inside its transaction, under a lock that every
  coordinator takes, so two coordinators can never exceed the limit together. The window, not
  `batchSize`, bounds the work in flight.
- When the limit is reached, the coordinator's task goes back to `pending` with the progress
  `Waiting for a free slot: 4 of 4 in flight (day)` and runs again later. It holds no worker
  process while it waits. It does the same when nothing is left to claim while analyses are
  still running (`Waiting for the 2 analyses in flight to finish`), and completes the campaign
  once nothing is in flight.
- The wait follows how long the slots have stayed as they are, measured from the last change to
  a `smart_mix` processing row (a claim, a finished or failed analysis): 3 s right after one,
  then about double each time while nothing changes, up to 30 s. A freed slot is therefore
  refilled within 30 s at worst and within a few seconds while analyses finish often.
- If the resource governor denies the coordinator after the actor admitted it, the coordinator
  goes back to the queue the same way, for the governor's delay and at most five minutes, with
  the progress `Deferred by resource governor: <reason>`. It never sleeps in a worker process.
- A change of window, or of the settings, applies to the next claim and cancels nothing. At
  08:00 with eight analyses accepted, they finish and the coordinator claims again once fewer
  than four are left.
- The settings are stored in the campaign. A campaign saved before the window existed reads the
  defaults. A start or resume that omits a setting keeps the stored one, even across a new
  campaign after a cancel. **Apply settings**, shown while the backfill runs, sends them to the
  running campaign through `POST /api/admin/smart-mix/backfill`, which answers
  `already_running`.
- `GET /api/admin/smart-mix/status` returns `backfillSettings` (those of the stored campaign, or
  what a new one would use) and `backfillLimit` (`window` `night` or `day`, and `limit`). Admin
  shows it next to the coverage as `Night window · 8 in flight` or `Day · 4 in flight`. A pass
  that claims returns the same `window` and `limit`.

The limit counts children; the analyses run in the processes of `crate-analysis-worker`, so
`ANALYSIS_WORKER_PROCESSES` is the night maximum. Set it to the night limit: the window then needs
no restart or outside scaling, which Crate could not do anyway without the Docker socket. With
fewer processes the extra children wait in `heavy`. The coordinator needs no process of its own:
it runs for a moment every few seconds and waits in the queue, so with eight processes and a night
limit of eight, eight analyses run. By day the processes the backfill leaves free serve other
`heavy` work.

The cap on the work in flight used to be `batchSize`, 25 by default, so a deploy ran as many
backfill analyses as `crate-analysis-worker` had processes. Now the window caps it, so by day the
backfill runs at most four however many processes there are, and on a deploy with more than four
it runs fewer analyses by day than before. That is intended (SM3-D15): the day keeps capacity for
imports, reanalyses and listeners, and the night makes up for it. To run more by day, raise
`dayConcurrency` in Admin; adding processes does not.

On the project server (i7-7700, 4 cores and 8 threads) set `ANALYSIS_WORKER_PROCESSES=8` in
`.env` and recreate the service with `docker compose up -d crate-analysis-worker`.
`docker-compose.project.yaml` gives it `cpus: "7.0"`, which leaves a logical CPU for Postgres and
the API at night, and `mem_limit: 14g`, which covers the 1.5 GB at which each process recycles
itself plus the parent with the import analysis daemons. Watch its memory during the first night
with `docker stats crate-analysis-worker`. Eight analyses on four cores share them through
Hyper-Threading, so the night gains less than double the day's throughput.

The resource governor still applies on top of the window. With its default `max_load_ratio` of
0.85, a child that starts while the one-minute load is above 6.8 on eight logical CPUs waits five
minutes, so a night with eight analyses settles at six or seven. A deferred child stays `pending`
and keeps its claim, so it still counts as in flight and the coordinator does not claim another
track in its place: its slot stays empty until it runs. The real concurrency at night is
therefore often below the night limit, and by day listeners can hold it below the day limit for
as long as they listen. To run all eight at night, raise `max_load_ratio` in the runtime policy;
the same threshold also applies by day.

### Running the v9 backfill

Production holds a `paused` campaign with `target` `smart-mix-audio-v8`, paused on
2026-11-09 after 4,779 batches and 12,505 claims, with 12,717 v8 profiles; the rest of the
library still holds v7, v6 and v5 profiles. v9 replaces that target, so after the release
with v9 is deployed through the normal process, a new v9 campaign recomputes the library.
The queues do not change: the coordinator and each analysis run on `heavy`.

1. **Check the starting point.** Open Admin, Analysis, Smart Mix, or call
   `GET /api/admin/smart-mix/status` with an account that has `library.analysis.manage`.
   Expect `analyzerVersion` `smart-mix-audio-v9`, `profileVersion` `1`, `controlState`
   `idle` (a campaign of another target claims nothing), `campaign.target`
   `smart-mix-audio-v8` with `campaign.status` `paused`, and `activeTask` null. If
   `refreshedAt` is null or older than ten minutes, the call queues a coverage refresh: read
   it again a minute later. Coverage starts at 0 %, and `versions` lists the v8, v7, v6 and
   v5 profiles still being served. If `activeTask` is not null, wait for it to finish (a
   coordinator of the v8 campaign exits as `superseded` without claiming) or cancel it from
   Tasks.
2. **Keep the night limit.** `ANALYSIS_WORKER_PROCESSES=8` in `.env` since the v7 backfill
   (see [Night window](#night-window)); the governor's `max_load_ratio` is 1.5 in the runtime
   policy since 2026-11-07.
3. **Start the campaign.** Press **Start backfill** (batch size 25, 3 attempts), or call
   `POST /api/admin/smart-mix/backfill` with `{"batchSize": 25, "maxAttempts": 3}`. The answer
   is `{"status": "queued", "taskId": "…"}`. The paused v8 campaign is not resumed:
   starting, or resuming, opens a campaign with `target` `smart-mix-audio-v9`,
   `profile_version` `1`, `status` `running` and `batches` and `claimed` `0`, whose `sequence`
   continues the v8 campaign's so no batch reuses a v8 dedup key.
4. **Watch it.** `controlState` `running`; `campaign.batches` and `campaign.claimed` grow;
   `currentProfiles` and `coveragePercent` rise; `processing.active`, `failed` and `exhausted`
   show the work and its errors; `GET /api/admin/smart-mix/activity` gives
   `tracksPerMinute`. The campaign claims every profile that is not v9, in the same order as
   the v8 one, so the 12,717 v8 profiles come first. v9 is another generation, so a track the
   v8 campaign finished or gave up on starts a new retry budget. Each rewritten track is
   claimed once.
5. **The v8 and v7 rows are cheap; the `.m4a` ones are not.** v9 keeps
   `beat-this-small0-dbn` and `yamnet-2`, so a track whose file has not changed since its v8
   or v7 analysis finds its beats and voice in `track_mix_signals` (see
   [Stored model signals](#stored-model-signals)): neither Beat This! nor YAMNet runs, only
   decoding, `crate-cli` (about 2 s of CPU) and the phrase voice from the stored bytes. The
   12,717 v8 rows take about seven hours of CPU in all. Beat This! never ran on an `.m4a`
   (libsndfile cannot open it), so those tracks have voice but no stored beats: about 2,280
   in production (1.6 % of the library) run Beat This! now, 14.7-25.4 s each, about 13 hours
   of CPU in all. v6 and v5 profiles predate the stored signals and cost a whole profile, as
   they would have under v8.
6. **Pause, resume or cancel.** **Pause backfill** or `POST /api/admin/smart-mix/backfill/pause`
   (only from `running`, 409 otherwise); **Resume backfill** or
   `POST /api/admin/smart-mix/backfill/resume` with the same body as the start, which keeps
   the counters; **Cancel backfill** or `POST /api/admin/smart-mix/backfill/cancel` (from
   `running` or `paused`). None of them interrupts analyses already handed to the heavy queue.
   Starting again after a cancel opens a new v9 campaign that only claims what is still not
   v9.
7. **Close it.** The campaign turns `completed` when a pass claims nothing and nothing is in
   flight. Then check `processing.exhausted` and the track list filters `outdated` and
   `failed`, and use **Reanalyze track** for the ones worth retrying. Once the backfill has
   finished, a later release can drop v8, v7, v6 and v5 from `READABLE_ANALYZER_VERSIONS`.
8. **The library analysis of the `.m4a`.** The v9 profiles fix the Smart Mix side only. The
   BPM, key, loudness and mood the library analysis stored for the AAC `.m4a` came from the
   same slowed audio; their reanalysis runs apart, on the library analysis tasks.

### Running the v8 backfill

Superseded by [Running the v9 backfill](#running-the-v9-backfill) on 2026-11-09; kept for
reference.

Production held a `paused` campaign with `target` `smart-mix-audio-v7`, which had written
about 2,710 v7 profiles; the rest of the library still holds v6 and v5 profiles. v8 replaces
that target, so after the release with v8 is deployed through the normal process, a new v8
campaign recomputes the library. The queues do not change: the coordinator and each analysis
run on `heavy`.

1. **Check the starting point.** Open Admin, Analysis, Smart Mix, or call
   `GET /api/admin/smart-mix/status` with an account that has `library.analysis.manage`.
   Expect `analyzerVersion` `smart-mix-audio-v8`, `profileVersion` `1`, `controlState`
   `idle` (a campaign of another target claims nothing), `campaign.target`
   `smart-mix-audio-v7` with `campaign.status` `paused`, and `activeTask` null. If
   `refreshedAt` is null or older than ten minutes, the call queues a coverage refresh: read
   it again a minute later. Coverage starts at 0 %, and `versions` lists the v7, v6 and v5
   profiles still being served. If `activeTask` is not null, wait for it to finish (a
   coordinator of the v7 campaign exits as `superseded` without claiming) or cancel it from
   Tasks.
2. **Set the night limit.** On the project server set `ANALYSIS_WORKER_PROCESSES=8` in `.env`
   and recreate `crate-analysis-worker` (see [Night window](#night-window)).
3. **Start the campaign.** Press **Start backfill** (batch size 25, 3 attempts), or call
   `POST /api/admin/smart-mix/backfill` with `{"batchSize": 25, "maxAttempts": 3}`. The answer
   is `{"status": "queued", "taskId": "…"}`. The paused v7 campaign is not resumed:
   starting, or resuming, opens a campaign with `target` `smart-mix-audio-v8`,
   `profile_version` `1`, `status` `running` and `batches` and `claimed` `0`, whose `sequence`
   continues the v7 campaign's so no batch reuses a v7 dedup key. Raise `batchSize` (up to 100) only if the heavy worker keeps up.
4. **Watch it.** `controlState` `running`; `campaign.batches` and `campaign.claimed` grow;
   `currentProfiles` and `coveragePercent` rise; `processing.active`, `failed` and `exhausted`
   show the work and its errors; `GET /api/admin/smart-mix/activity` gives
   `tracksPerMinute`. The campaign claims every profile that is not v8: the v7 profiles, v6
   and v5 profiles, tracks without a profile, `unavailable` and source-changed profiles. v8 is
   another generation, so a track the v7 campaign finished or gave up on starts a new retry
   budget. Each rewritten track is claimed once.
5. **The v7 rows are cheap.** v8 keeps `beat-this-small0-dbn` and `yamnet-2`, so a track whose
   file has not changed since its v7 analysis finds its beats and voice in
   `track_mix_signals` (see [Stored model signals](#stored-model-signals)): neither Beat
   This! nor YAMNet runs, only decoding, `crate-cli` (about 2 s of CPU) and the phrase voice
   from the stored bytes. The 2,710 v7 rows take about two hours of CPU in all, where
   running Beat This! again would add 11-19 hours (14.7-25.4 s each). v6 and v5 profiles
   predate the stored signals and cost a whole profile, as they would have under v7.
6. **Pause, resume or cancel.** **Pause backfill** or `POST /api/admin/smart-mix/backfill/pause`
   (only from `running`, 409 otherwise); **Resume backfill** or
   `POST /api/admin/smart-mix/backfill/resume` with the same body as the start, which keeps
   the counters; **Cancel backfill** or `POST /api/admin/smart-mix/backfill/cancel` (from
   `running` or `paused`). None of them interrupts analyses already handed to the heavy queue.
   Starting again after a cancel opens a new v8 campaign that only claims what is still not
   v8.
7. **Close it.** The campaign turns `completed` when a pass claims nothing and nothing is in
   flight. Then check `processing.exhausted` and the track list filters `outdated` and
   `failed`, and use **Reanalyze track** for the ones worth retrying. Once the backfill has
   finished, a later release can drop v7, v6 and v5 from `READABLE_ANALYZER_VERSIONS`.

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
`profileRevision`, the context, the requested planner's identifier and its rules revision. A
change of profile or rules leads to a different cache identity; do not recommend flushing Redis
as a routine repair. A planning POST can write to the cache even though it does not modify music.
`context.setHistory` (the last three transitions as mode, bars and energy step) is validated but
left out of the key: no deterministic planner reads it; the AI refinement will.

### Planner smart-mix-v3

`plannerVersion: "smart-mix-v3"` plans on the analyzer v7 structure (SM3-D3,
`smart_mix/candidates.py`). For each edge it builds a menu of up to eight valid plans, best
first, and serves the first; the AI refinement (below) picks from the same menu by index.

- **With phrases on both tracks**, a candidate mixes from the start of one of the last four
  outgoing phrases that admit a mix into the start of one of the first three incoming phrases,
  for 8, 16 or 32 outgoing bars or the context's preferred duration, with the bass handoff on
  and off and with both curves when either is allowed. Phrase lengths over the preferred
  duration need a long blend, as in v2. Pairs v2 would crossfade keep the preferred duration.
  v2's own plan joins the menu, scored the same way: it reaches the tail after the last phrase
  and the incoming lead-in.
- **Score**: phrase alignment of the four mix boundaries (0.25), energy step at the handoff
  (0.20), harmony (0.15: longer blends with compatible keys, less full-level overlap with
  incompatible ones), tempo stability (0.10), bass handoff (0.15) and music left out (0.15,
  outros and intros cut for free), minus 6 × the voice-over-voice time at full level over 48 s
  when both profiles carry the voice per phrase (SM3-D13, cut `VOCAL_THRESHOLD`). The weights
  are `PLANNER_POLICY_V3.candidate_weights`; changing them bumps the rules revision.
- **Without phrases on both tracks** (v5 and v6 profiles, unsegmented tracks, 3/4) the menu is
  v2's bar heuristic with v2's plan first, so v3 plans exactly as v2. Album, manual and missing
  profile transitions keep v2's single plan.
- **Safety**: every candidate goes through `TransitionPlan` and the planner policy
  (`evaluation.policy_violations`); v3 copies v2's limits on tempo, gain, true peak and
  durations.
- **Stems layer** (Smart Mix Stems ST3, rules revision 2, STEM-D5). When both tracks have a
  stem analysis of their current file (Smart Mix playlists, or a Crate Decks upload) and the
  policy's `stems_layer` is on, the phrase menu is scored with the stems layer: the vocal
  penalty counts the phrases the vocal stem has instead of YAMNet's; the bass component is
  one minus the share of the mix with both basses at full level (crossfade and handoff shelf)
  while both phrases have a bassline, so a mix where one side has none scores like a handoff;
  and two bonuses are added, 0.05 × the share of the mix before the handoff with the incoming
  on drums without bass or vocals, and 0.05 × the share of the mix with the outgoing on a
  phrase without vocals. The terms are in the breakdown's `stems`. Without stems on both
  tracks every candidate and score is revision 1's (golden test
  `app/tests/fixtures/smart_mix/candidates_v3_rules1.json`). Gate STEM-G1 decides whether the
  layer stays on by default (`PLANNER_POLICY_V3.stems_layer`).
- **Response**: each v3 plan adds `structureUsed`, whether the menu came from the phrases, and
  `stemsUsed: true` when the stems layer scored it (absent otherwise). The batch reads
  profiles without structure and the stem analyses of its tracks (one bounded `ANY` query) to
  build the cache keys: an edge with an analysis on both tracks keys on both analyses too. It
  reads the structure only for the edges it has to plan, with the beat grid when a layer
  applies (the grid places the end of the outro for the layer; the planner does not read it).
- **Crate Decks** (`context.source = "decks"` with `localRefinement`) also gets the menu and
  the policy limits; see `docs/technical/crate-decks.md`, "Local refinement".
- **Capability**: `smart_mix.structure` is true when at least half the library's tracks have a
  current profile with phrases, read from the coverage snapshot (`structure_percent`, counted by
  `refresh_smart_mix_coverage`). It is never computed in the request.

### AI refinement (SM4)

**Status: evaluated and left off.** The SM5 evaluation (2026-11-07) ran Gemini 3.8 Flash and
3.1 Pro on 184 phrase edges and 112 electronic edges, with automatic listening metrics on the
rendered transitions. Once the bass handoff menu was fixed (prompt `sm3-refine-2`: each candidate
lists the bass handoffs it accepts), rejections fell to 0–3 %. The refined plans still improved
none of the evaluation criteria, and made the electronic transitions measurably worse (5 better,
16 worse). Gate SG3 closed as no-go:

- `smart_mix_ai_enabled` stays off;
- the capability reports `ai_assisted` unavailable;
- no admin panel is built for it.

The action, the prompt and `tools/smart-mix-eval --refine` stay in the tree, so a later
experiment can rerun the same evaluation.

A model may choose another plan from the v3 menu (SM3-D1). It never writes times, ratios or
gains: it answers a candidate index, a shift of the outgoing or incoming phrase (-1, 0, 1), a
step to the previous or next phrase length, the bass handoff, a reason, a confidence and up to
four notes. `smart_mix/refinement.py::apply_refinement` rebuilds the plan with the generator's
own code and validates it again with `TransitionPlan` and the planner policy; anything else is
a closed rejection code (`unknown_candidate`, `low_confidence` below 0.55,
`shift_out_of_range`, `length_not_allowed`, `bass_handoff_not_allowed`, `plan_invalid`,
`policy_violation`, `response_invalid`, `single_candidate`) and the client keeps the
deterministic plan.

- **Activation, three levels (SM3-D10).** The Settings switch `smart_mix_ai_enabled` (off by
  default; `PUT /api/settings/smart-mix`) and a model bound to `smart_mix.transition.refine`
  in AI models; the client's option; and `context.aiRefinement: true` on a v3 edge. Sessions
  need `smart_mix.ai` (every role with `library.view`); access tokens also need the scope
  `vdj.smart_mix.ai`. A missing grant is `unavailable` with `permission_denied` or
  `scope_missing`, never a 403.
- **What leaves the server (SM3-D6).** `llm/prompts/smart_mix_transition.py`
  (`sm3-refine-3`) sends tempo, Camelot key, energy, danceability, valence, loudness, the last
  outgoing and first incoming phrases with their energy per bar and voice, the set history,
  the context rules and the candidates, each with the bass handoff answers it accepts
  (`balanced` only on a beatmatch candidate when the context allows it). The genre slug goes only while
  `smart_mix_ai_send_genre` is on (default). Never titles, artists, paths, track or profile
  IDs, the user or an address. The prompt and the answer are neither stored nor logged.
- **Response.** v3 plans of flagged edges add `refinement`: `ready` with the refined `plan`,
  `source: "ai"`, `modelLabel`, `reason`, `confidence`, `promptVersion` and `candidateIndex`;
  `pending`; or `unavailable` with `reasonCode` (`disabled`, `no_model`, `budget`,
  `missing_profile`, `single_candidate`, `permission_denied`, `scope_missing`,
  `rate_limited`, `rejected`, `failed`). Clients poll the same edge at most every 5 s.
  smart-mix-v2 ignores the flag, and the flag does not change the deterministic plan or its
  cache key.
- **Keys and storage (SM3-D5).** The refinement key hashes the planner and rules revision,
  both tracks and profile revisions, the normalized context with the set history, the prompt
  version and schema, the accepted AI configuration and the genre switch.
  `smart_mix_refined_plans` (migration 152) is the source of truth: `ready`, `rejected` or
  `failed` with `outcome_code`, the choice, reason, confidence, latency and tokens.
  `cache:smart-mix:refined-plan:v1:<key>` is read in the same `mget` as the plans; a Redis
  miss reads the table once with `ANY(:keys)`. A cached refinement costs no PostgreSQL query
  beyond the plan's own profile read; a Redis miss costs one.
- **Queueing.** Missing keys are accepted with `accept_action` and queued with
  `create_task_dedup` (one task per key; priority 0 for the first two edges of the batch, 1
  for the rest), at most 64 per user and minute (`rate_limited` above). A `pending` marker
  (150 s) keeps polls from queueing again.
- **Task.** `smart_mix_refine_transition` (`ai`, priority 0, 120 s, no retries) rebuilds the
  menu from the same profile revisions (`stale` otherwise), resumes the accepted
  configuration, makes one call and stores the outcome. A menu with one candidate is not sent.
  A refusal before anything is sent stores nothing; a daily budget refusal sets a budget
  marker until UTC midnight and the API answers `budget` without queueing.
- **Retention.** A published profile deletes the refinements of its old revision.
  `cleanup_smart_mix_refinements` (maintenance, daily) records the reads the API queued in
  Redis, then deletes refinements unread for 180 days.
- **Capability (SM3-D9).** `smart_mix.ai_assisted` reports `available`, `provider_kind`
  (`local` for Ollama, otherwise `cloud`), `model_label`, `prompt_version`,
  `typical_latency_ms` (median of the last 24 h, from the coverage snapshot) and `reason`
  (`smart_mix_unavailable`, `disabled`, `no_model`, `budget`). It reads the cached gate,
  never the configuration tables or an aggregate per request.

## HTTP, permissions and consumers

These routes describe the application. They are not tools automatically available to
Crate Agent; an MCP Bearer token is not an Admin session or a VirtualDJ PAT.

| Route                                                                        | Use and relevant effect                                                                                                               |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/capabilities`                                                      | Effective flags and client contract; does not prove their implementation or physical readiness                                        |
| `GET /api/tracks/by-entity/{uid}/mix-profile?detail=summary\|full`           | Profile by UID; `full` includes the beat grid and, when an analysis applies, the `stems` layer; a 404 can mean missing or invalidated |
| `GET` and `PUT /api/decks/tracks/{uid}/stem-analysis`                        | Crate Decks reads the stem analysis that applies and uploads its own; `PUT` needs `smart_mix.stems.contribute`                        |
| `GET /api/smart-mix/playlists` and `GET`, `PUT /{id}`                        | Smart Mix playlists: changes since a revision, stem progress of one, turn on or off (owner only, within the limits)                   |
| `GET /api/tracks/by-entity/{uid}/compatible?context=auto\|beatmatch\|smooth` | Local ranking of candidates; does not trigger analysis                                                                                |
| `POST /api/playback/transition-plans`                                        | Batch planning; uses the cache                                                                                                        |
| `POST /api/playback/continuation-token` and `/api/playback/continuation`     | Contract for continuing planning and the queue in the native runtime                                                                  |
| `GET /api/admin/smart-mix/status`                                            | Coverage, campaign and coordinating task; can enqueue `refresh_smart_mix_coverage` if it is missing or older than 600 s               |
| `GET /api/admin/smart-mix/tracks` and `/activity`                            | Paginated profiles and processing, and task activity                                                                                  |
| `POST /api/admin/smart-mix/backfill` and `/backfill/resume\|pause\|cancel`   | Change campaign control and settings                                                                                                  |
| `POST /api/admin/smart-mix/tracks/{id}/reanalyze`                            | Enqueues analysis for one track, with deduplication                                                                                   |
| `GET /api/admin/smart-mix/tracks/{id}/structure`                             | Stored phrases (with end and voice byte), energy curve and bar starts of one profile, for review in Admin                             |

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
- `--planner smart-mix-v3` plans as the API does. On edges without phrases it equals v2, so
  measure it on an edge set with v7 profiles: `build_pool_dataset.py` pairs a pool of tracks
  (the development library's spike tracks) with itself.
- `music_left_out` reports the outgoing music after the mix and the incoming music before it,
  without a target: v3 often ends the mix at a phrase boundary before the outgoing music ends.
- Stems (ST3): `separate_pool.py` separates a pool of local files with the server's own
  separation code (CPU, or the same graph on ONNX Runtime CUDA) and writes one
  `stem-analysis/1` per track; `run_eval.py --stems` attaches their layer to the profiles and
  reports the stem vocal and bass clashes, `--planner smart-mix-v3-nostems` plans the same
  profiles without the layer; `calibrate_stems.py` calibrates the presence cuts; and
  `listen_metrics.py` adds `bassOnBassMs`, low end on both decks at full level in the rendered
  audio.

The analyzer's structure is measured apart, on audio files rather than plans:
`tools/smart-mix-eval/structure/` scores beats, downbeats and phrases against All-In-One
with madmom as arbiter (see [Measurement of the structure](#measurement-of-the-structure)).
It reads no database.

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

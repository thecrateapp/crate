# Smart Mix evaluation harness

Offline tools that measure Smart Mix transition plans on a fixed set of real edges, so every
Smart Mix 3 phase (structure, planner `smart-mix-v3`, AI refinement) is compared against the
same baseline (Smart Mix 3 plan, SM0; design decision SM3-D12).

> **Never run these tools against production, or with production credentials, without Diego's
> explicit authorization.** They are meant for a development library. `build_dataset.py` and
> `run_eval.py` refuse a database that is not on this machine unless you pass
> `--allow-remote-database`, and that flag is not an authorization.

Store results by `entity_uid`, edge id or index, never by title or artist. The output folder
`out/` is ignored by git.

| Path                                           | What it is                                                                 |
| ---------------------------------------------- | -------------------------------------------------------------------------- |
| `build_dataset.py`                             | Builds the edge set (`dataset.jsonl`) from the compatible-tracks service   |
| `build_pool_dataset.py`                        | Builds an edge set inside a fixed pool of tracks (the spike tracks)        |
| `analyze_pool.py`                              | Computes v7 profiles for a list of tracks with the worker's own handler    |
| `run_eval.py`                                  | Plans the edge set with a planner and writes `report.json` and `report.md` |
| `refine.py`                                    | AI refinement of each v3 edge with a real model, cached and budgeted (SM5) |
| `app/crate/smart_mix/evaluation.py`            | The metrics: pure functions over a plan and two profiles                   |
| `app/crate/db/queries/smart_mix_evaluation.py` | Read-only session guard and seed sampling used by the tools                |
| `render_pair.py`                               | Renders a plan and its two audio files to a WAV for listening              |
| `blind_session.py`                             | Blind A/B rating of rendered pairs into `ratings.csv`                      |
| `listen_metrics.py`                            | Beat, voice, bass and loudness measurements of rendered transitions (SM5)  |
| `separate_pool.py`                             | Stem analyses of a pool of audio files with the server's separation (ST3)  |
| `calibrate_stems.py`                           | Calibrates the stems layer's presence cuts (Smart Mix Stems ST3)           |
| `reference/`                                   | Analyzer reference tools (Queen Mary, KeyFinder, kick) used to measure v6  |
| `structure/`                                   | Beats, downbeats and phrases against All-In-One and madmom (SMB.PR3)       |
| `tests/`                                       | Unit tests of the tools                                                    |

`tools/smart-mix-lab/` is the other lab: device captures, engine benchmarks and release
gates. This harness only looks at plans.

## Database access is read-only

Both database tools call `open_read_only_database` before the first query. It makes every
connection of Crate's SQLAlchemy engine run `SET SESSION CHARACTERISTICS AS TRANSACTION READ
ONLY` and checks `SHOW transaction_read_only`, so PostgreSQL rejects any write. Planning uses
the pure `crate.smart_mix.planner.plan_transition`, never the HTTP endpoint, so no plan cache
is written either. The genre taxonomy may read its revision from Redis when `REDIS_CACHE_URL`
or `REDIS_URL` points to one; point them at a closed port to keep Redis out.

## Running

The tools need Crate's Python dependencies. Either use the repository virtualenv or the
analysis worker image, which also has FFmpeg for the renderer. From the repository root, with
the development stack's PostgreSQL on `localhost:5433`:

```bash
export SMART_MIX_EVAL_DSN=postgresql://crate:crate@localhost:5433/crate

# 1. Edge set: 300 edges by default
PYTHONPATH=app .venv/bin/python tools/smart-mix-eval/build_dataset.py \
  --output tools/smart-mix-eval/out/dev

# 2. Baseline
PYTHONPATH=app .venv/bin/python tools/smart-mix-eval/run_eval.py \
  --dataset tools/smart-mix-eval/out/dev/dataset.jsonl \
  --planner smart-mix-v2 --output tools/smart-mix-eval/out/dev/smart-mix-v2

# 3. A later planner against that baseline
PYTHONPATH=app .venv/bin/python tools/smart-mix-eval/run_eval.py \
  --dataset tools/smart-mix-eval/out/dev/dataset.jsonl \
  --planner smart-mix-v3 --output tools/smart-mix-eval/out/dev/smart-mix-v3 \
  --compare tools/smart-mix-eval/out/dev/smart-mix-v2/report.json
```

The same commands through Docker, without a local virtualenv:

```bash
docker run --rm --network host -u "$(id -u):$(id -g)" -e HOME=/tmp \
  -v "$PWD:/workspace" -w /workspace/app -e PYTHONPATH=/workspace/app \
  -e SMART_MIX_EVAL_DSN -e REDIS_CACHE_URL=redis://127.0.0.1:9/0 \
  -e SMART_MIX_EVAL_GIT_COMMIT="$(git rev-parse HEAD)" \
  --entrypoint python crate-analysis-worker:latest \
  ../tools/smart-mix-eval/run_eval.py --dataset ../tools/smart-mix-eval/out/dev/dataset.jsonl \
  --planner smart-mix-v2 --output ../tools/smart-mix-eval/out/dev/smart-mix-v2
```

Tests:

```bash
cd app && ../.venv/bin/python -m pytest tests/test_smart_mix_evaluation.py \
  tests/test_smart_mix_evaluation_queries.py ../tools/smart-mix-eval/tests -q
```

The render tests need FFmpeg; they skip without it unless `CRATE_REQUIRE_FFMPEG=1`.

## The edge set

`build_dataset.py` samples tracks with a fresh, usable mix profile in a deterministic order
(`--seed`), asks the compatible-tracks service for each one's ranked candidates (the list a DJ
sees, `--candidates-per-seed`, default 50) and keeps each seed's best-ranked candidate in each
tempo band. Edges are stratified by:

- **Root genre** of the outgoing track: its genre tag, else the album's, else the album's or
  artist's strongest genre, resolved to a top-level genre with the library's genre taxonomy.
  Tracks without any genre form `unknown`; genres that resolve to no top-level genre form
  `other`.
- **Tempo band**: the tempo adjustment the incoming track needs, `|ratio - 1|` with half and
  double time folded, using the cue tempos the planner uses: `0-2`, `2-4` and `4-6` %. Edges
  above 6 % are left out.

Every stratum gets the same number of edges while the library has them; shortfalls are
refilled from the other strata and a remainder goes to the first strata in sorted order. An
incoming track is never used twice.

`dataset.jsonl` has one edge per line:

```json
{
  "edgeId": "e0001",
  "stratum": "electronic/0-2",
  "rootGenre": "electronic",
  "tempoBand": "0-2",
  "tempoDelta": 0.0123,
  "outgoingTrackEntityUid": "…",
  "incomingTrackEntityUid": "…",
  "outgoingProfileRevision": "…",
  "incomingProfileRevision": "…",
  "outgoingAnalyzerVersion": "smart-mix-audio-v5",
  "incomingAnalyzerVersion": "…",
  "outgoingQuality": "full",
  "incomingQuality": "partial",
  "incomingRootGenre": "electronic",
  "compatibleRank": 3,
  "compatibleScore": 0.81
}
```

`dataset.meta.json` records the parameters, the source database (host, port and name, no
credentials), the commit and the counts per stratum.

`run_eval.py` always plans with the profiles current in the database. Each edge in
`report.json` says whether a profile is `current`, `drifted` (its revision changed since the
dataset was built, for example after a reanalysis) or `missing`. To compare two planners
fairly, run both on the same profiles: after the analyzer v7 backfill, rerun `smart-mix-v2`
too instead of comparing against a report computed on v5 or v6 profiles.

## Committed baseline

`baselines/dev-2026-11-04/` keeps the SM0 baseline: the 300-edge `dataset.jsonl` built from the
development library on 2026-11-04 (all profiles `smart-mix-audio-v5`), its
`dataset.meta.json`, and `smart-mix-v2.report.md`, the `smart-mix-v2` report with the `dj`
context. Later phases plan this same file: rebuilding the set after a reanalysis would give
different edges, because the compatible-tracks ranking reads the profiles.

`baselines/dev-2026-11-06-sm2/` keeps the SM2 evaluation of `smart-mix-v3`: `sm0/` plans the
SM0 set with v2 and v3 (identical plans: its v5 profiles have no phrases) and `spike/` holds the
spike track UIDs, the 184-edge pool set built from the 64 with phrases and the v2 and v3 reports
for the `dj` and `listen` contexts.

## Pool edge sets

The SM0 set has no phrases (v5 profiles), so it cannot tell `smart-mix-v3` from v2: without
phrases on both tracks v3 plans as v2. `build_pool_dataset.py --uids <file>` pairs a pool of
tracks with itself: each seed keeps its best partner in each tempo band, ranked by the
planner's pure `score_compatibility`, and by default both tracks need phrases. Use it for the
tracks with audio and analyzer v7 profiles (the spike tracks), whose edges can also be rendered
for listening. Rows keep the `dataset.jsonl` format with the root genre `pool`.

### A new edge set from audio files

How SM5 built its electronic set (120 tracks in four genre buckets, 112 edges). The tracks
need `library_tracks` rows whose `path` the container can read; a copy of the development
database migrated to head already has the library's rows.

1. **Database.** Build or refresh a local copy at the branch's head (see "AI refinement");
   never write to the shared development database. `analyze_pool.py` refuses it.
2. **Audio.** Put the files where the rows' paths point once mounted, for example
   `out/<set>/audio/<path without /music/>` mounted read-only at `/music`. Keep audio in `out/`
   (ignored by git) and never commit audio or profiles.
3. **Profiles.** A TSV with the track ID in the first column and the group (genre bucket) in
   the second, then, in the analysis worker image with the audio mounted:

   ```bash
   python tools/smart-mix-eval/analyze_pool.py --tracks out/<set>/picks.tsv \
     --output out/<set>/pool --jobs 6
   ```

   It runs `compute_smart_mix_profile` on each track that is not ready (Beat This!, YAMNet,
   `crate-cli`), with Redis pointed at a local instance, and writes `pool_uids.txt`,
   `groups.tsv` and `analysis.json`. Rerun it to retry failures; ready tracks are skipped.

4. **Edges.** Pair the pool like a DJ: each seed's best partner inside its group with a tempo
   band, the best per group, and a few across groups (`cross`):

   ```bash
   python tools/smart-mix-eval/build_pool_dataset.py --uids out/<set>/pool/pool_uids.txt \
     --groups out/<set>/pool/groups.tsv --per-group 25 --cross-group 12 \
     --output out/<set>/dataset
   ```

5. **Evaluate** with `run_eval.py` (v2, v3, `--refine`) and `listen_metrics.py` as for any set.

## Planners and contexts

`--planner` picks an entry of `PLANNERS` in `run_eval.py`: `smart-mix-v2` or `smart-mix-v3`
(SM2). A new planner registers a function `(outgoing, incoming, context, outgoing_uid,
incoming_uid) -> TransitionPlan`, or a `PlannedTransition` like v3's; each v3 edge in
`report.json` also says whether it was planned on the stored phrases (`structureUsed`) and how
many candidates its menu had. `--context` picks the transition context:

- `dj` (default): playlist, automatic, 12 s preferred, beatmatch with tempo adjustment, long
  beatmatch and bass handoff allowed. What Crate Decks asks for, and what exercises all of v2.
- `listen`: Listen's defaults: 6 s, beatmatch with tempo adjustment, no long blend or bass
  handoff.

## Metrics

All metrics come from the plan and the two profiles, never from audio
(`crate.smart_mix.evaluation`). The deck envelopes follow the Android engine, the reference
implementation of a plan: equal power or DJ blend crossfade, loudness staging, and the bass
handoff as a 150 Hz low shelf at −24 dB swapped with a raised cosine over 12.5 % of the mix
around `handoffProgress`. DJ blend and the bass handoff only apply in beatmatch, and only a
beatmatch plays the incoming track at `incomingTempoRatio`; its start includes
`beatPhaseOffsetMs × incomingTempoRatio`.

"Full level" means at least half the deck's normal amplitude (−6.02 dB of crossfade gain,
staging excluded). Equal power keeps both decks there for the middle third of a mix. Time a
track spends outside its active range (`activeStartMs`–`activeEndMs`) does not count as
overlap. The timeline is sampled every 10 ms.

| Metric              | Unit and definition                                                                                                                                                                                                   | Without phrases (v5/v6 profiles)                                                                                  |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `policy_violations` | Closed codes for every planner rule the plan breaks (duration, long beatmatch eligibility, tempo adjustment, gain, combined true peak, playable windows and minimum bodies, what the context allows). `()` when valid | Same                                                                                                              |
| `phrase_alignment`  | Of the four mix boundaries (outgoing cue, outgoing cue + duration, incoming start, incoming end) how many lie within ⅛ beat of a phrase boundary; reported as the share of plans with all four and the mean count     | 8-bar phrases from the downbeat anchor, along the stored beat grid; `basis: "grid"`. `None` without BPM or anchor |
| `bass_overlap_ms`   | ms with both decks' bass at full level (crossfade gain plus handoff shelf cut)                                                                                                                                        | Same                                                                                                              |
| `harmonic_clash_ms` | ms with both decks at full level when Camelot calls the keys incompatible; 0 for same, relative and adjacent keys                                                                                                     | Same; `None` when a key is unknown                                                                                |
| `energy_step`       | Absolute energy change (0–1 profile scale) between the phrase each track plays at the handoff; `signed` is incoming minus outgoing                                                                                    | Outgoing outro energy against incoming intro energy; `basis: "intro_outro"`                                       |
| `vocal_clash_ms`    | ms with both decks at full level while both play phrases with voice: a presence byte of at least 90, the cut of gate SG1b (`VOCAL_THRESHOLD`)                                                                         | `None` (needs phrases and the optional vocal detector on both profiles)                                           |
| `music_left_out`    | Informative: ms of outgoing music after the mix (to `activeEndMs`) and of incoming music before it starts (from `activeStartMs`). Cutting an outro or an intro is part of mixing, so it has no target                 | Same                                                                                                              |

Policy details worth knowing:

- Gains: loudness matching stays within ±6 dB (boosts up to 0 dB unless both decks have an
  accredited `bs1770-v1` measurement). v2 attenuates further when a hot master needs it for the
  −1 dBFS combined true peak (`ceiling − 3.01 dB − peak`); that is not a violation, any other
  attenuation beyond 6 dB is.
- The planner's short cut (adaptive, `insufficient_window`, at most the 350 ms manual ramp) is
  exempt from the duration, true peak and body rules.

`report.md` gives, overall and by tempo band, root genre and stratum: beatmatch share,
violations, phrase alignment, bass overlap, key clashes, energy step and duration, with mean,
p50 and p95 (linear interpolation) where they apply. With `--compare`, it adds current minus
baseline overall and per stratum; `report.json` keeps every plan and metric per edge for paired
analysis.

## AI refinement (SM5)

`run_eval.py --planner smart-mix-v3 --refine <provider>/<model>` refines every edge's v3
candidate menu with a real model through the SM4 pieces, unchanged: the prompt, system prompt
and response schema of `crate.llm.prompts.smart_mix_transition`, the native request of
`crate.ai.transport`, the runtime's JSON parsing and `apply_refinement` with its closed
rejection codes. Menus with a single candidate are not sent, as in the task. Nothing is written
to the database: the binding, the invocation ledger, Redis and the refinement table stay out.

```bash
PYTHONPATH=app .venv/bin/python tools/smart-mix-eval/run_eval.py \
  --dataset tools/smart-mix-eval/out/dev/dataset.jsonl --planner smart-mix-v3 \
  --refine gemini/gemini-3.8-flash --refine-connection <ai_provider_connections.id> \
  --output tools/smart-mix-eval/out/dev/v3-gemini-3.8-flash --max-usd 5 --concurrency 2
```

- **Model and profile.** With `--refine-connection` the model's capabilities come from that
  connection's catalog and the profile is the one the admin's default-model flow would bind to
  `smart_mix.transition.refine` (45 s, 1,024 output tokens, low reasoning where the model has
  levels). A model Crate has not validated needs `--refine-reasoning` (`low`, `medium`, `high`,
  `minimal`, `off`, `on`, `default` or `budget:N`) and the report marks its profile as not
  validated: the admin could not bind it as is.
- **Key.** Only connections whose key comes from the environment: the tool reads the server's
  variable (`GEMINI_API_KEY`, `AUDIOMUSE_GEMINI_API_KEY`, `DEEPSEEK_API_KEY`) and hands it to
  the transport only. Run it where that variable exists, for example a container that receives
  it on stdin, and never print it.
- **Spend.** Every answer and every failure is cached in `--refine-cache` (default
  `out/refine-cache/`) by the hash of the whole request, so a rerun pays nothing. A failed call
  is not retried unless `--retry-failed`. `--ledger` (default `ledger.jsonl` in the cache) keeps
  what every run spent; a call whose worst case (the input's byte count as tokens plus every
  output token) would take it over `--max-usd` is not made, the remaining edges are reported as
  `unavailable` (`budget`) and the tool exits with 3. `--min-interval` spaces call starts.
- **Prices** live in `refine.PRICES` with their source and date; update them when they change.

The report serves the model's plan where it was accepted and the deterministic plan otherwise
(what a client plays), keeps the deterministic plan and metrics of every edge under
`deterministic`, and adds an `## AI refinement` section: statuses and rejection codes, the
rejection rate over answers, the failure rate over calls, plans changed, latency p50/p95, tokens
and cost per transition, the SG3 criteria of design §10 and served-minus-deterministic tables by
tempo band, genre and stratum. Pool edges are grouped by the root of the genre the prompt sent
for the outgoing track.

The development database can lag behind the migrations of the branch under test (the ORM then
selects columns it does not have). Run the tools against a copy migrated to `head` instead of
migrating the shared development database.

## Stems (Smart Mix Stems ST3)

The stems layer is evaluated on the same edge sets. Three tools add it:

1. **Separation.** `separate_pool.py separate --tracks pool.tsv --output out/<set>/stems
--scratch out/scratch [--music-root /music=out/<set>/audio]` runs each track through
   `crate.smart_mix.separation` unchanged (decode, normalisation, segments, STFT, the
   `htdemucs-onnx-1` graph, iSTFT, overlap-add) and `analyze_stems`, and writes one
   `stem-analysis/1` per entity UID. `pool.tsv` is `<entity_uid>\t<path>`. `--provider cuda`
   runs the same graph on ONNX Runtime's CUDA provider (it needs `onnxruntime-gpu` and the CUDA
   and cuDNN libraries on `LD_LIBRARY_PATH`; sessions use two inter-op threads to stay under
   about 750 MiB of VRAM); everything around the graph is the same numpy. `parity` separates a
   few tracks on both providers and reports the SDR of CUDA against CPU per stem and how many
   level bytes differ. Scratch audio (about 425 MB per five minutes of music) must be on disk:
   the tool refuses `/tmp`, `/dev/shm` and `/run`. Existing analyses are skipped, so a rerun
   resumes. Never commit the analyses or the audio.
2. **Calibration.** `calibrate_stems.py --stems <folder> --labels labels.csv [--yamnet
phrase_windows.csv] [--dataset <set>/dataset.jsonl --groups <set>/groups.tsv] --output
out/<dir>` measures where the presence cuts go: vocals against the SG1b lyrics labels (5
   folds by track, balanced accuracy, compared per genre with YAMNet's stored byte), and each
   vocal floor against YAMNet on the evaluation sets, since songs with synced lyrics are rarely
   instrumental; bass and drums from the distribution of each phrase's level below its track's
   loudest phrase (its valley and a two-component mixture cut, each with a bootstrap over
   tracks and per set, both also tried on the labelled vocals) and the share of phrases marked
   present by phrase kind.
3. **Planning.** `run_eval.py --stems <folder> [--stems <folder>]` attaches the layer of
   those analyses to the profiles (by entity UID and duration within 2 %: the analysis was made
   from a local copy, so its source revision is that file's) and adds, per edge, `stemsUsed`
   and the stem vocal and bass clashes, and a `## Stems layer` section to `report.md`.
   `--planner smart-mix-v3` plans with the layer where it applies (the beatmatch family: the
   tracks' genre beatmatch priors come from their album genres, read like the API reads them,
   and each record says `stemsGate`), `--planner smart-mix-v3-nostems` plans the same profiles
   without it (rules revision 1's menus), so the two reports pair edge by edge.
   `listen_metrics.py` then measures both, with `bassOnBassMs` (low end below 150 Hz on both
   decks at full level, crossfade and bass handoff applied) next to the other metrics.

## Listening: renders and blind sessions

Numbers cannot hear a transition, so SG3 also asks for a blind listening test. Both tools only
read local audio files; they never touch a database.

`render_pair.py` renders 30–60 s around a transition with FFmpeg, as the Android engine plays
the plan: 12 s of context each side of the mix (more after it when the outgoing cue is too early
for the pre-roll), the outgoing track from `outgoingCueMs` until the end of the mix, the incoming
track from its start position and time-stretched with `atempo` in beatmatch, `volume`
expressions for the crossfade and loudness staging (the formulas of
`crate.smart_mix.evaluation`), a 150 Hz `lowshelf` at −24 dB swapped through `asendcmd` for the
bass handoff, and 50 ms `afade` at both ends. Output: 16-bit stereo WAV, 44.1 kHz by default.

```bash
python tools/smart-mix-eval/render_pair.py \
  --report tools/smart-mix-eval/out/dev/smart-mix-v2/report.json --edge e0001 \
  --outgoing <outgoing audio> --incoming <incoming audio> \
  --output tools/smart-mix-eval/out/renders/e0001-v2.wav
```

`--plan plan.json` takes a plan in its API form instead of a report edge, and `--seconds` sets
the excerpt length. The renderer leaves out one engine behaviour: after the mix Android ramps
the incoming tempo back to 1.0 over 4 s, while the render keeps the mix tempo until the end of
the excerpt.

`blind_session.py` takes a manifest of pairs with two renders each, shuffles the pairs and the
A/B sides with `--seed`, plays A then B with `ffplay` (`--player` changes it; `r` replays), asks
for a 1–5 rating of each and appends them to `ratings.csv` without labels. An interrupted
session resumes with the same seed. At the end it writes the labels into the CSV and prints,
per label, the mean rating, wins, ties, losses, the share of pairs won or tied and the worst
rating (SG3: the AI wins or ties in at least 60 % of the pairs and no render is rated below 2).
Do not open `ratings.csv` before the end.

```json
{
  "pairs": [
    {
      "pair": "e0001",
      "renders": {
        "smart-mix-v3": "v3/e0001.wav",
        "smart-mix-v3-ai": "ai/e0001.wav"
      }
    }
  ]
}
```

## Automatic listening metrics

`listen_metrics.py` measures rendered transitions when nobody listens to them. Each plan is
rendered with `render_pair.py`, once as the mix and once per deck (`stem`: the deck alone, at
unity gain, on the mix's clock), and the audio around the transition is measured:

| Metric                    | How                                                                                                                                                                          |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `beatClashMs`             | Beat This! on each stem; full-level time (crossfade gain of half or more) while the nearest beats disagree by more than 25 ms                                                |
| `phaseErrorMsMedian`      | Median phase error of the outgoing beats in the mix against the nearest incoming beat, folded into one beat                                                                  |
| `lockedShare`             | Share of those beats within 25 ms                                                                                                                                            |
| `mixIbiCv`                | Beat This! on the mix: variation of the beat intervals inside the mix (flams make them irregular)                                                                            |
| `voiceOnVoiceMs`          | YAMNet on each stem: full-level time with a voiced patch (byte from `VOCAL_THRESHOLD`) on both decks                                                                         |
| `bassOnBassMs`            | Level below 150 Hz of each stem with the crossfade gain and bass shelf applied: both decks at full level while each plays its low end (within 12 dB of its own loud low end) |
| `levelStepLuAbs`          | EBU R128 short-term loudness of the mix, median over 6 s after the mix minus 6 s before it                                                                                   |
| `bumpLu`, `dipLu`         | Momentary loudness during the mix above the louder side, and below the quieter side                                                                                          |
| `maxShortTermSlopeLuPerS` | Steepest change of short-term loudness over one second, from 3 s before to 3 s after the mix                                                                                 |

```bash
python tools/smart-mix-eval/listen_metrics.py \
  --plans smart-mix-v2=out/dev/v2/report.json \
  --plans smart-mix-v3=out/dev/v3-ai/report.json:deterministic \
  --plans smart-mix-v3+ai=out/dev/v3-ai/report.json \
  --compare smart-mix-v3+ai:smart-mix-v3 --compare smart-mix-v3:smart-mix-v2 \
  --output out/dev/listen --jobs 8
```

`NAME=report.json` takes each edge's served plan; `:deterministic` takes the planner's own plan
of a refined report. Audio paths come from the database (read-only), `--music-root` maps their
prefix. It needs FFmpeg, torch and the Beat This! and YAMNet weights: run it in the analysis
worker image. Identical plans are measured once and cached in `<output>/plans/`; the renders are
deleted unless `--keep-audio`. `listen.md` gives each variant's metrics (all edges and beatmatch
only) and, per `--compare`, the mean difference and how many paired edges got better, stayed the
same (within a per-metric noise floor, `SAME_WITHIN`) or got worse.

These numbers are proxies for a listener, not a replacement: they hear rhythm, voice and level,
not taste. Beat This! resolves beats to about 20 ms, so the 25 ms tolerance is about one frame.

## Limits

- Today's profiles have no phrases, so phrase alignment uses the grid heuristic and vocal clash
  is unavailable. Those numbers become comparable across planners once the analyzer v7 profiles
  carry phrases (SM1).
- Overlap metrics model gain, not content: a breakdown without bass still counts as bass at full
  level. The blind listening session (SM0.PR2) covers what numbers cannot.
- The hand-labelled analyzer set of SM0.PR0 (`labels/`) is not part of this harness yet: it needs
  Diego's labels first.

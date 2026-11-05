# Structure evaluation: beats, downbeats and phrases

Offline tools that measure the Smart Mix analyzer's bar and phrase structure against an
automatic reference. They produced the SMB.PR3 measurement of Smart Mix 3 (SM3-D14 Beat
This! with its DBN, SM3-D16 meter, SM3-D17 harmony and timbre novelty); the results are in
[smart-mix-operations.md](../../../docs/technical/smart-mix-operations.md#measurement-of-the-structure).

> These tools never run in production and nothing in Crate imports them. They read local
> audio files only: no database, no API. Run them on a development library or on copies
> of the files, and store results by file stem or entity UID, never by title. Outputs go
> to a folder outside the repository (or to `tools/smart-mix-eval/out/`, ignored by Git).

## What each script does and where it runs

| Script                  | What it does                                                                                                           | Runs in                                         |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `run_allin1.py`         | All-In-One over a track list: sections with labels, beats, beat positions and downbeats (the reference)                | `sg1-allin1:local`                              |
| `madmom_downbeats.py`   | madmom's RNN and DBN downbeats (3 or 4 beats per bar), the second opinion that makes the arbiter                       | `sg1-allin1:local`                              |
| `beat_this_beats.py`    | Beat This! alone, any checkpoint, with or without the DBN, one torch thread; to compare checkpoints                    | `sg1-beatthis:local`                            |
| `analyze_with_beats.py` | What the worker does: Beat This! with its DBN through `crate.smart_mix.beat_model`, then the Python and Rust analyzers | Analysis worker image                           |
| `rerun_crate_cli.py`    | Feeds saved model beats to another `crate-cli`, to measure a Rust-only change without running the model again          | Analysis worker image                           |
| `evaluate_structure.py` | The metrics below; writes a Markdown report and per-track rows                                                         | Any Python with `numpy` and `mir_eval`          |
| `diagnose_downbeats.py` | Per-track diagnosis: bar length and phase against All-In-One, chance level, votes of All-In-One, madmom, Beat This!    | Any Python with `numpy`                         |
| `novelty_prototype.py`  | The SM3-D17 prototype: `extract` per-bar features, `evaluate` novelty variants, weights and boundary costs             | Analysis worker image (`evaluate` + `mir_eval`) |
| `structure_eval.py`     | Shared readers and metrics, pure functions                                                                             | (imported)                                      |

Every runner takes a list file (one audio path per line, as the container sees it) and an
output folder, writes one `<stem>.json` per track and skips tracks already done, so an
interrupted run resumes and a list can be split into shards run in parallel containers.
Record shapes are documented at the top of `structure_eval.py`.

## Images

**`sg1-allin1:local` and `sg1-beatthis:local`** are throwaway images for the reference
models, built from this folder. They never become the base of a Crate image:

```bash
cd tools/smart-mix-eval/structure
docker build -f Dockerfile.allin1 -t sg1-allin1:local .      # All-In-One 1.1.0 and madmom
docker build -f Dockerfile.beatthis -t sg1-beatthis:local .  # adds Beat This! 1.1.0
```

`Dockerfile.allin1` pins torch 2.0.1 (CPU), NATTEN 0.14.6, `numpy<1.24` (`constraints.txt`)
and madmom at the commit the analysis worker image builds. NATTEN compiles for a while.
The models download on first use into `$HOME/.cache`: mount a folder as `HOME` to keep them.

**The analysis worker image** is the production one, so `analyze_with_beats.py` runs the
same torch, `beat_this`, madmom, checkpoint and `crate-cli` as the worker. Build it from the
branch under test, and mount the repository's `app/` on `PYTHONPATH` to run its Python code:

```bash
docker build --target worker-analysis -t crate-analysis-worker:eval app
```

**The evaluation** needs only `numpy` and `mir_eval` 0.8.2:

```bash
python3 -m venv "$OUT/venv" && "$OUT/venv/bin/pip" install numpy mir_eval==0.8.2
```

## Licences

| Model or library         | Licence                                   | Use here                                  |
| ------------------------ | ----------------------------------------- | ----------------------------------------- |
| All-In-One (`allin1`)    | MIT                                       | Reference sections and downbeats, offline |
| madmom                   | Code BSD; its model files CC BY-NC-SA 4.0 | Downbeat arbiter, offline only            |
| Beat This! (`beat_this`) | MIT, code and weights                     | The production beat model (SM3-D14)       |
| `mir_eval`               | MIT                                       | Boundary detection metric                 |

madmom's network weights are non-commercial: here they are only an offline arbiter. The
analysis worker image installs madmom for its DBN, which uses no model file; the files the
package ships stay unused there (see the operations doc).

## Measurement protocol

- **Tracks.** A fixed list of real tracks with their files; SMB.PR3 used 145 (the SG1b
  calibration tracks plus the Crate Decks spike set). Tracks of crossfade genres (extreme
  metal: `--crossfade-genres`, one track in SMB.PR3) are reported apart: Smart Mix does not
  mix them by phrase.
- **Reference.** All-In-One's sections (edge silence left out) and downbeats.
- **Arbiter.** All-In-One is a model too. A track has an arbiter when All-In-One and madmom
  share at least 90 % of their downbeats within 70 ms; there the reference downbeats are
  more likely right. The arbiter subset is selected by agreement, so it is easier than the
  whole set.
- **Downbeat.** The grid's bars (the anchor and every fourth grid beat) are right when they
  hit at least 90 % of All-In-One's downbeats inside the grid within 70 ms. Reported as
  coverage (tracks with a downbeat) and accuracy among the anchored tracks, since the
  analyzer may abstain but must not anchor the wrong beat. The model's own downbeats are
  scored the same way against All-In-One.
- **Phrase boundaries on downbeats.** At least 90 % of the phrase boundaries within 120 ms
  of an All-In-One downbeat.
- **Sections.** `mir_eval.segment.detection` between phrase boundaries and All-In-One's
  section boundaries (one-to-one matching, first and last boundary trimmed) at ±0.5 s,
  ±3 s and ±1 bar of the track; precision, recall and F1 averaged per track. Phrases are
  finer than sections (8, 16 and 32 bars), so precision is low by construction.
- **Meter.** Tracks the DBN reads in three (`timeSignature` 3) and whether All-In-One's
  highest beat position is 3 too.
- **Baseline.** The analyzer being replaced, from CSV exports of its phrases
  (`--baseline`, with `--tracks` for genre and path): `entity_uid`, `start_ms`, `end_ms`,
  `bars`, `kind`, optionally `genre`, `path`, `phrase_index` (-1: no phrases) and
  `structure_confidence`. Tracks are matched by audio file stem.

## Running

`$MUSIC` holds the audio, mounted read-only at `/music`; `$OUT` is the output folder with
`tracks.txt` listing `/music/...` paths. From the repository root:

```bash
T=/repo/tools/smart-mix-eval/structure
RUN="docker run --rm -u $(id -u):$(id -g) -v $PWD:/repo:ro -v $MUSIC:/music:ro -v $OUT:/out"

# 1. Reference and arbiter (one container per shard if you split tracks.txt)
$RUN -e HOME=/out/cache sg1-allin1:local python $T/run_allin1.py \
  --list /out/tracks.txt --output /out/allin1
$RUN -e HOME=/out/cache sg1-allin1:local python $T/madmom_downbeats.py \
  --list /out/tracks.txt --output /out/madmom

# 2. The analyzer under test: model beats and the Rust profile
$RUN -e HOME=/tmp -e NUMBA_CACHE_DIR=/tmp/numba -e TORCH_NUM_THREADS=1 \
  -e PYTHONPATH=/repo/app --entrypoint python crate-analysis-worker:eval \
  $T/analyze_with_beats.py --list /out/tracks.txt --output /out/analysis \
  --crate-cli /usr/local/bin/crate-cli --no-python

# 3. Optional: a later crate-cli on the same beats (here the branch's committed binary)
$RUN -e HOME=/tmp -e PYTHONPATH=/repo/app --entrypoint python crate-analysis-worker:eval \
  $T/rerun_crate_cli.py --input /out/analysis --output /out/rerun \
  --crate-cli /repo/app/bin/crate-cli-linux-amd64 --meter

# 4. Metrics
"$OUT/venv/bin/python" tools/smart-mix-eval/structure/evaluate_structure.py \
  --analysis "$OUT/analysis" --allin1 "$OUT/allin1" --madmom "$OUT/madmom" \
  --baseline phrases.csv --tracks tracks.tsv \
  --report "$OUT/report.md" --rows "$OUT/rows.json"
```

Comparing Beat This! checkpoints or post-processing without an image rebuild:

```bash
$RUN -e HOME=/out/cache sg1-beatthis:local python $T/beat_this_beats.py \
  --list /out/tracks.txt --output /out/final0 --checkpoint final0 --dbn
"$OUT/venv/bin/python" tools/smart-mix-eval/structure/evaluate_structure.py \
  --analysis "$OUT/final0" --allin1 "$OUT/allin1" --madmom "$OUT/madmom" \
  --report "$OUT/final0.md"
```

Records without a `rust` profile score only the model's downbeats ("Model downbeats on
All-In-One's").

The novelty prototype, on the analysis records of step 2:

```bash
$RUN -e HOME=/tmp -e NUMBA_CACHE_DIR=/tmp/numba -e PYTHONPATH=/repo/app \
  --entrypoint python crate-analysis-worker:eval \
  $T/novelty_prototype.py extract /out/analysis /out/features
$RUN -e HOME=/tmp --entrypoint sh crate-analysis-worker:eval -c \
  "pip install -q --no-deps --target /tmp/mir mir_eval==0.8.2 decorator && \
   PYTHONPATH=/repo/app:/tmp/mir python $T/novelty_prototype.py evaluate \
   /out/features /out/allin1 /out/novelty.json"
```

`evaluate` splits the tracks into `tune` (even positions in stem order) and `held` (odd),
and prints the variants whose tuning precision at ±3 s is not below the base's, best F1
first. SM3-D17 kept variant A with weights 2 (harmony) and 8 (timbre) and a 4 dB cost.

`diagnose_downbeats.py` takes the same `--allin1`, `--madmom`, `--baseline` and `--tracks`,
plus `--beat-this` for Beat This! records and `--analysis` to diagnose analyzer records
instead of the baseline.

## Tests

```bash
cd app && ../.venv/bin/python -m pytest ../tools/smart-mix-eval/tests/test_structure_eval.py -q
```

They cover the pure helpers and the record conventions, with no audio and no model. The
two `mir_eval` tests skip when it is not installed.

## Limits

- All-In-One is an automatic reference: the numbers measure agreement with it, not
  correctness, and its sections are coarser than phrases.
- CPU seconds in the records are process CPU on the machine of the run, all threads
  counted; measure cost on an idle machine with one thread before quoting it.

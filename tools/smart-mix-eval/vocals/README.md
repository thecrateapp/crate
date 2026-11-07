# Voice labels for the Smart Mix phrase detector

`app/crate/smart_mix/vocals.py` scores each phrase for voice with a cheap spectral
heuristic (Smart Mix 3, SM3-D2). It stays off, and profiles keep `vocal_presence` null,
until it reaches precision 0.8 and recall 0.7 on 100 phrases labelled by hand (design §10,
gate SG1). `export_phrases.py` prepares those labels.

> Run it only against a development database. It refuses any host that is not this machine
> unless you pass `--allow-remote-database`, which needs Diego's explicit authorization, and
> it opens every database session read-only.

## Steps

1. Analyze the tracks with v7 so their phrases are stored (Admin, Analysis, Smart Mix,
   **Reanalyze track**, or the backfill). Pick varied tracks: vocal and instrumental, with
   and without a regular meter.
2. Export their phrases. Titles print to the console; the CSV holds entity UIDs and times:

   ```bash
   export SMART_MIX_EVAL_DSN=postgresql://crate:crate@localhost:5433/crate
   PYTHONPATH=app .venv/bin/python tools/smart-mix-eval/vocals/export_phrases.py \
     --tracks-file tracks.txt
   ```

   `tracks.txt` holds one entity UID per line (`#` starts a comment). Exporting again keeps
   the labels of phrases that did not move.

3. Listen to each phrase from `start_ms` to `end_ms` and fill the `vocal` column of
   `tools/smart-mix-eval/vocals_labels.csv` with `1` (voice) or `0` (no voice) until at
   least 100 phrases are labelled.
4. Score them. This decodes every exported track; `--music-root` maps the stored
   `/music/...` paths to a local folder:

   ```bash
   PYTHONPATH=app .venv/bin/python tools/smart-mix-eval/vocals/export_phrases.py \
     --tracks-file tracks.txt --score --music-root test-music
   ```

   The detector bytes go to `tools/smart-mix-eval/vocals_scores.csv`, separate from the
   labels so they do not influence them.

5. Check the thresholds:

   ```bash
   cd app && ../.venv/bin/python -m pytest tests/test_smart_mix_vocals.py -q
   ```

   `test_precision_recall_on_labelled_set` skips until both files exist and every phrase
   is labelled, and fails when the scores come from another detector version.

Without a local virtualenv, run the same commands in the analysis worker image:

```bash
docker run --rm --network host -u "$(id -u):$(id -g)" -e HOME=/tmp \
  -v "$PWD:/workspace" -w /workspace -e SMART_MIX_EVAL_DSN \
  --entrypoint python crate-analysis-worker:latest \
  tools/smart-mix-eval/vocals/export_phrases.py --tracks-file tracks.txt
```

## Comparing voice models (SMV.PR1)

SG1 left the heuristic off, and voice per phrase moved to a small audio model (SM3-D13):
YAMNet, chosen after a trial against PANNs CNN14 and Essentia's voice/instrumental
classifier. `compare_models.py` keeps that comparison reproducible and calibrates
YAMNet's thresholds for gate SG1b. It is a measurement tool, outside the production
path, and like `export_phrases.py` it reads a local database only, read-only.

- `score` loads the stored v7 phrases of the given tracks, decodes each track once per
  sample rate, runs every backend over short windows and writes the window scores of
  each phrase.
- `evaluate` compares those scores with the hand labels of `vocals_labels.csv` and
  writes `report.md` and `report.json`. It needs neither the database nor the models.

### Backends

| Backend           | Model                                                 | Rate   | Windows             | Window score                 |
| ----------------- | ----------------------------------------------------- | ------ | ------------------- | ---------------------------- |
| `yamnet-essentia` | YAMNet (AudioSet), Essentia's TensorFlow graph        | 16 kHz | 0.96 s every 0.48 s | Highest of the voice classes |
| `effnet`          | Essentia voice/instrumental head on Discogs-EffNet    | 16 kHz | 2.05 s every 0.99 s | P(voice) from the classifier |
| `panns`           | PANNs CNN14 (AudioSet), the analysis image's own copy | 32 kHz | 2 s every 1 s       | Highest of the voice classes |

The AudioSet voice classes are Speech (male, female and child too), Narration,
Singing (male, female, child and synthetic too), Choir, Chant and Rapping. Each model
uses the ones its label list has: YAMNet has 9 of them, PANNs all 13. A phrase gets the
windows whose centre falls inside it. The registry is `BACKENDS` in `compare_models.py`;
a new backend is a loader that returns window centres and scores for decoded audio.

### Getting the models

PANNs CNN14 (`Cnn14_mAP=0.431.pth`, Zenodo record 3987831, CC BY 4.0) and AudioSet's
`class_labels_indices.csv` already ship in the analysis worker image under
`/app/panns_data` (`app/scripts/download_models.sh`). The Essentia models are
downloaded by hand into a folder outside the repository:

```bash
mkdir -p ~/crate-voice-models && cd ~/crate-voice-models
base=https://essentia.upf.edu/models
curl -fLO "$base/audio-event-recognition/yamnet/audioset-yamnet-1.pb"
curl -fLO "$base/audio-event-recognition/yamnet/audioset-yamnet-1.json"
curl -fLO "$base/feature-extractors/discogs-effnet/discogs-effnet-bs64-1.pb"
curl -fLO "$base/classification-heads/voice_instrumental/voice_instrumental-discogs-effnet-1.pb"
curl -fLO "$base/classification-heads/voice_instrumental/voice_instrumental-discogs-effnet-1.json"
sha256sum -c <<'SUMS'
604dbd73c8552c4762b2e652ef69a45a46218c42c5fb3c292b16fd7940c2ca7f  audioset-yamnet-1.pb
0c0499e4cedf01ba3012a1d0649e8fb9498106fb12fa74f0ea824d06f5e64f07  audioset-yamnet-1.json
3ed9af50d5367c0b9c795b294b00e7599e4943244f4cbd376869f3bfc87721b1  discogs-effnet-bs64-1.pb
c8033548e17c292874265db62e82a051247768d10375a35a769e7bf695f16acf  voice_instrumental-discogs-effnet-1.pb
43ac2c3b055dfaed20f6232e0f10636c287f1c5a6e5bd02c5585860031964c8f  voice_instrumental-discogs-effnet-1.json
SUMS
```

`yamnet-essentia` needs the first two files; `effnet` the other three.

> **Licence: local evaluation only.** The `LICENSE` of `https://essentia.upf.edu/models/`
> covers every model hosted there: copyright Universitat Pompeu Fabra, Creative Commons
> Attribution-NonCommercial-NoDerivatives 4.0 (its link points to the BY-NC-SA 4.0 legal
> code instead; non-commercial either way). That includes the YAMNet and VGGish graphs,
> although they derive from Google's Apache-2.0 AudioSet models. Never commit these files
> or put them in an image. Production YAMNet (SMV.PR2) has to come from Google's original
> Apache-2.0 weights, checked to score the same.

### Running

`score` needs Essentia with TensorFlow, PyTorch and `panns_inference`: the analysis
worker image on x86_64 has them. With the development stack's PostgreSQL on
`localhost:5433`, from the repository root:

```bash
OUT=/tmp/voice-models   # any folder outside the repository
mkdir -p "$OUT" && cp tracks.txt "$OUT/"
docker run --rm --network host -u "$(id -u):$(id -g)" \
  -e HOME=/app -e NUMBA_CACHE_DIR=/tmp/numba \
  -e TF_CPP_MIN_LOG_LEVEL=2 -e PYTHONDONTWRITEBYTECODE=1 \
  -e REDIS_CACHE_URL=redis://127.0.0.1:9/0 -e REDIS_URL=redis://127.0.0.1:9/0 \
  -e SMART_MIX_EVAL_DSN=postgresql://crate:crate@localhost:5433/crate \
  -v "$PWD:/workspace:ro" -w /workspace -e PYTHONPATH=/workspace/app \
  -v "$PWD/test-music:/music:ro" -v ~/crate-voice-models:/models:ro -v "$OUT:/out" \
  --entrypoint python crate-analysis-worker:latest \
  tools/smart-mix-eval/vocals/compare_models.py score \
  --tracks-file /out/tracks.txt --backends yamnet-essentia,effnet,panns \
  --models-dir /models --output /out
```

- `HOME=/app`: `panns_inference` reads `~/panns_data` when it is imported.
- `NUMBA_CACHE_DIR`: librosa's numba cache inside the image is not writable for your user.
- The Redis variables point at a closed port to keep Redis out.
- `/music` is where the database's paths live; `--library-root` and `--music-root`
  remap them as in `export_phrases.py`.

For each backend, `score` writes to `--output`:

- `vocals_windows_<backend>.csv`: `entity_uid,phrase_index,start_ms,end_ms`, the keys
  of `vocals_labels.csv`, then `n_windows`, `mean` and `windows`, the space-separated
  window scores (6 decimals: YAMNet's sit around 0.0001 in music).
- `vocals_cpu_<backend>.csv`: `entity_uid,seconds,decode_cpu,model_cpu`, in process CPU
  seconds with every thread counted. Decoding happens once per sample rate, so backends
  with the same rate report the same decode time.
- `vocals_meta_<backend>.json`: model files and size, and the run's peak RSS. That peak
  covers every backend of the run: score one backend per run to measure its memory.

PANNs costs about 30 times YAMNet's CPU (around 2 minutes per track).

`evaluate` uses the standard library only, so it runs with any Python 3.10 or newer:

```bash
python3 tools/smart-mix-eval/vocals/compare_models.py evaluate \
  --labels tools/smart-mix-eval/vocals_labels.csv \
  --windows "$OUT" --output "$OUT/report"
```

- **Phrases:** those labelled `0` or `1` that have windows in every backend evaluated,
  so all of them are measured on the same set. The report counts the ones left out:
  not scored, moved since labelling (another `start_ms`) or without windows.
- **AUC:** ranks the phrases by their mean window score, with no threshold.
- **Phrase byte:** 255 times the fraction of the phrase's windows scoring at or above
  the window threshold. A phrase has voice when its byte reaches the byte threshold.
- **Thresholds:** 5-fold cross-validation grouped by track. Tracks are sorted by
  `entity_uid` and dealt to the folds in turn, so the split is the same on every run.
  On the training folds it picks the pair with the best F1: window thresholds from a
  fixed grid (`WINDOW_THRESHOLDS`, 0.0001 to 0.9), byte thresholds from 1 to 255.
  Ties keep the lowest of both.
- **Metrics:** precision, recall, F1, specificity and NPV pool the held-out folds,
  next to an "always voice" baseline. `report.json` recommends, per backend, one pair
  fitted on every label (not held out, so its own metrics would be optimistic) and
  lists the pair each fold chose, to show how stable the choice is.
- **Cost:** CPU per track (mean, p50 and p95) and per minute of audio, model size and
  the run's peak RSS, when `score`'s files are in `--windows`.

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

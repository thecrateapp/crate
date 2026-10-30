# Radio transition fit

Checkpoint for ranking seeded radio by how the next track enters, using the Smart Mix edge
signals already stored in `track_mix_profiles`.

## Reproduce

From `app/`:

```bash
CRATE_RADIO_ROTATION_ENABLED=true CRATE_TRANSITION_FIT_ENABLED=false ../.venv/bin/python -m tests.recommendation_evaluation --mix-edges
CRATE_RADIO_ROTATION_ENABLED=true CRATE_TRANSITION_FIT_ENABLED=true ../.venv/bin/python -m tests.recommendation_evaluation --mix-edges
../.venv/bin/python -m pytest tests/test_radio_transition_fit.py -q
```

The candidate pools are the frozen [baselines](baselines.md). Edge signals were captured
read-only from production on 2026-10-30 and matched to 237 of the 240 candidates; the other
three have a stale or missing profile and rank with a neutral seam.

## Seam metrics

Each session has 20 tracks and 19 seams. The level jump is the incoming intro loudness (first
5 s, BS.1770) minus the outgoing outro loudness (last 5 s). Brightness is the edge spectral
density gap. Values are means over the measured seams of sessions A/B/C. With the fit on,
Concubine measures 16 of 19 seams because two late picks have no current profile.

| Seed                 | Fit | Mean level jump | Rises over 6 dB | Brightness gap | Gap between tracks | Seed genre overlap | Artists |
| -------------------- | --- | --------------: | --------------: | -------------: | -----------------: | -----------------: | ------: |
| Citizen              | off |         7.67 dB |               6 |          0.072 |             1.99 s |              0.400 |      11 |
| Citizen              | on  |         2.45 dB |               0 |          0.041 |             2.52 s |              0.419 |      12 |
| Concubine — Converge | off |         3.52 dB |             0.7 |          0.025 |             1.75 s |              0.459 |      20 |
| Concubine — Converge | on  |         2.24 dB |               0 |          0.022 |             1.60 s |              0.489 |      20 |

The fit removes every loud cold open after a quiet ending in both seeds, without reducing
genre coherence or artist diversity. Citizen gains half a second of silence between tracks
because the silence term has a low weight next to level and brightness.

## Limits

- Both seeds are guitar music, so they exercise the smooth-entry family (beatmatch affinity
  around 0.15). The beatmatch family is covered by unit tests, not by a captured electronic
  pool.
- The replay covers the first batch of a fixed pool. It does not measure endpoint latency or
  full-catalog retrieval.
- Seam metrics describe the signal edges; they are not a listening verdict.

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

## Fade-aware reference (rules revision 7)

48% of current production profiles end at least 6 dB below their integrated
loudness, and the median outro is 5.5 dB under the body. Comparing the next intro
with that fade counted a normal entry after a fade-out as a loud jump. Revision 7
compares the next intro with the outgoing integrated loudness when its outro is a
fade (more than 6 dB below the body), and with the outro otherwise. Seam metrics now
report this perceived jump next to the raw edge jump.

Captured pools, first batch, means over sessions A/B/C:

| Seed                 | Fit  | Perceived jump | Perceived rises over 6 dB | Raw edge jump | Seed genre overlap | Artists |
| -------------------- | ---- | -------------: | ------------------------: | ------------: | -----------------: | ------: |
| Citizen              | off  |        6.75 dB |                         1 |       7.67 dB |              0.400 |      11 |
| Citizen              | rev7 |        3.75 dB |                         0 |       5.27 dB |              0.395 |      11 |
| Concubine — Converge | off  |        3.71 dB |                         0 |       3.52 dB |              0.459 |      20 |
| Concubine — Converge | rev7 |        1.95 dB |                         0 |       2.23 dB |              0.489 |      20 |

Live catalog, Citizen artist radio, four generation seeds (76 seams), replayed in
memory in the production API container on 2026-10-30:

| Fit          | Perceived jump | Raw edge jump | Raw rises over 6 dB | Artists | Seed genre overlap |
| ------------ | -------------: | ------------: | ------------------: | ------: | -----------------: |
| off          |        5.17 dB |       6.80 dB |                  38 |    11.0 |              0.304 |
| rev6 (3.0.2) |        6.66 dB |       6.01 dB |                  21 |    12.2 |              0.308 |
| rev7         |        3.71 dB |       8.29 dB |                  43 |    11.5 |              0.304 |

Revision 6 lowered raw rises by preferring quiet intros after loud endings, which
made the perceived seam worse than no fit at all. Revision 7 cuts the perceived jump
by 28% against no fit and 44% against revision 6; raw rises grow because a normal
entry after a fade-out is no longer penalised.

## Limits

- Both seeds are guitar music, so they exercise the smooth-entry family (beatmatch affinity
  around 0.15). The beatmatch family is covered by unit tests, not by a captured electronic
  pool.
- The replay covers the first batch of a fixed pool. It does not measure endpoint latency or
  full-catalog retrieval.
- Seam metrics describe the signal edges; they are not a listening verdict.

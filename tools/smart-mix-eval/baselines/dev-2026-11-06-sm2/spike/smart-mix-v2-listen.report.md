# Smart Mix evaluation: smart-mix-v2

- Planner: `smart-mix-v2` (rules revision 7), context `listen`
- Dataset: `tools/smart-mix-eval/out/sm2/spike/dataset.jsonl`, 184 edges, sha256 `7fe60505e176`
- Profiles read from `localhost:5432/crate_eval` in read-only transactions
- Profiles: current 368; analyzers: smart-mix-audio-v7 368
- Modes: adaptive 99, beatmatch 85; fallbacks: incompatible_tempo 40, low_confidence 5, none 85, unstable_tempo 54; curves: equal-power 184; bass handoffs: 0
- Run 2026-11-06T09:32:36.140080+00:00 at commit `c9301fe78a0d`

## Overall

| Metric                                                  |   n |      mean |   p50 |    p95 |
| ------------------------------------------------------- | --: | --------: | ----: | -----: |
| Policy violations (plans)                               | 184 | 0 (0.0 %) |       |        |
| Phrase alignment, start and end on a boundary (phrases) | 184 |     0.0 % |       |        |
| Phrase alignment, mix start on a boundary (phrases)     | 184 |     0.0 % |       |        |
| Phrase alignment, boundaries aligned of 4 (phrases)     | 184 |      0.29 |  0.00 |   1.00 |
| Bass overlap (ms)                                       | 184 |     2,000 | 2,000 |  2,000 |
| Harmonic clash (ms)                                     | 184 |     1,424 | 2,000 |  2,000 |
| Harmonic clash, plans with a clash                      | 184 |    71.2 % |       |        |
| Energy step, 0-1 (intro_outro)                          | 167 |     0.107 | 0.072 |  0.303 |
| Energy step, 0-1 (phrases)                              |  17 |     0.072 | 0.043 |  0.190 |
| Vocal clash (ms)                                        | 184 |         9 |     0 |      0 |
| Transition duration (ms)                                | 184 |     6,000 | 6,000 |  6,000 |
| Outgoing music after the mix (ms)                       | 184 |     2,697 |    51 | 21,350 |
| Incoming music before the mix (ms)                      | 184 |     1,080 |    87 |  6,942 |

Phrase metrics use stored phrases when a profile has them and an 8-bar grid
from the downbeat otherwise (basis `grid`). Overlaps count time with both
decks at half amplitude or more; bass counts the handoff shelf cut too.

## By tempo band

| Group | Edges | Beatmatch | Violations | Start+end on phrase | Boundaries aligned | Bass overlap ms | Key clash | Key clash ms | Energy step | Duration ms | Unplayed ms | Skipped ms |
| ----- | ----: | --------: | ---------: | ------------------: | -----------------: | --------------: | --------: | -----------: | ----------: | ----------: | ----------: | ---------: |
| 0-2   |    63 |    66.7 % |      0.0 % |               0.0 % |              6.3 % |           2,000 |    76.2 % |        1,524 |       0.085 |       6,000 |       2,662 |      1,301 |
| 2-4   |    59 |    72.9 % |      0.0 % |               0.0 % |              8.1 % |           2,000 |    74.6 % |        1,492 |       0.108 |       6,000 |       2,845 |        548 |
| 4-6   |    62 |     0.0 % |      0.0 % |               0.0 % |              7.7 % |           2,000 |    62.9 % |        1,258 |       0.120 |       6,000 |       2,592 |      1,361 |

## By root genre

| Group | Edges | Beatmatch | Violations | Start+end on phrase | Boundaries aligned | Bass overlap ms | Key clash | Key clash ms | Energy step | Duration ms | Unplayed ms | Skipped ms |
| ----- | ----: | --------: | ---------: | ------------------: | -----------------: | --------------: | --------: | -----------: | ----------: | ----------: | ----------: | ---------: |
| pool  |   184 |    46.2 % |      0.0 % |               0.0 % |              7.3 % |           2,000 |    71.2 % |        1,424 |       0.104 |       6,000 |       2,697 |      1,080 |

## By stratum

| Group    | Edges | Beatmatch | Violations | Start+end on phrase | Boundaries aligned | Bass overlap ms | Key clash | Key clash ms | Energy step | Duration ms | Unplayed ms | Skipped ms |
| -------- | ----: | --------: | ---------: | ------------------: | -----------------: | --------------: | --------: | -----------: | ----------: | ----------: | ----------: | ---------: |
| pool/0-2 |    63 |    66.7 % |      0.0 % |               0.0 % |              6.3 % |           2,000 |    76.2 % |        1,524 |       0.085 |       6,000 |       2,662 |      1,301 |
| pool/2-4 |    59 |    72.9 % |      0.0 % |               0.0 % |              8.1 % |           2,000 |    74.6 % |        1,492 |       0.108 |       6,000 |       2,845 |        548 |
| pool/4-6 |    62 |     0.0 % |      0.0 % |               0.0 % |              7.7 % |           2,000 |    62.9 % |        1,258 |       0.120 |       6,000 |       2,592 |      1,361 |

## Comparison

None: this report is a baseline.

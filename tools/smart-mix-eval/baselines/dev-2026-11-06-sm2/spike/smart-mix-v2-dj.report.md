# Smart Mix evaluation: smart-mix-v2

- Planner: `smart-mix-v2` (rules revision 7), context `dj`
- Dataset: `tools/smart-mix-eval/out/sm2/spike/dataset.jsonl`, 184 edges, sha256 `7fe60505e176`
- Profiles read from `localhost:5432/crate_eval` in read-only transactions
- Profiles: current 368; analyzers: smart-mix-audio-v7 368
- Modes: adaptive 99, beatmatch 85; fallbacks: incompatible_tempo 40, low_confidence 5, none 85, unstable_tempo 54; curves: dj-blend 56, equal-power 128; bass handoffs: 85
- Run 2026-11-06T09:32:30.377994+00:00 at commit `c9301fe78a0d`

## Overall

| Metric                                                  |   n |      mean |    p50 |    p95 |
| ------------------------------------------------------- | --: | --------: | -----: | -----: |
| Policy violations (plans)                               | 184 | 0 (0.0 %) |        |        |
| Phrase alignment, start and end on a boundary (phrases) | 184 |     0.0 % |        |        |
| Phrase alignment, mix start on a boundary (phrases)     | 184 |     0.5 % |        |        |
| Phrase alignment, boundaries aligned of 4 (phrases)     | 184 |      0.32 |   0.00 |   1.00 |
| Bass overlap (ms)                                       | 184 |     2,152 |  4,000 |  4,000 |
| Harmonic clash (ms)                                     | 184 |     7,557 |  4,000 | 27,940 |
| Harmonic clash, plans with a clash                      | 184 |    71.2 % |        |        |
| Energy step, 0-1 (intro_outro)                          | 112 |     0.117 |  0.074 |  0.316 |
| Energy step, 0-1 (phrases)                              |  72 |     0.053 |  0.040 |  0.153 |
| Vocal clash (ms)                                        | 184 |     2,481 |      0 | 21,227 |
| Transition duration (ms)                                | 184 |    19,549 | 12,000 | 45,324 |
| Outgoing music after the mix (ms)                       | 184 |     1,395 |     40 | 12,896 |
| Incoming music before the mix (ms)                      | 184 |     1,100 |    137 |  6,942 |

Phrase metrics use stored phrases when a profile has them and an 8-bar grid
from the downbeat otherwise (basis `grid`). Overlaps count time with both
decks at half amplitude or more; bass counts the handoff shelf cut too.

## By tempo band

| Group | Edges | Beatmatch | Violations | Start+end on phrase | Boundaries aligned | Bass overlap ms | Key clash | Key clash ms | Energy step | Duration ms | Unplayed ms | Skipped ms |
| ----- | ----: | --------: | ---------: | ------------------: | -----------------: | --------------: | --------: | -----------: | ----------: | ----------: | ----------: | ---------: |
| 0-2   |    63 |    66.7 % |      0.0 % |               0.0 % |              9.5 % |           1,333 |    76.2 % |        9,223 |       0.078 |      22,918 |         717 |      1,292 |
| 2-4   |    59 |    72.9 % |      0.0 % |               0.0 % |              7.2 % |           1,085 |    74.6 % |       11,075 |       0.087 |      23,883 |       1,762 |        620 |
| 4-6   |    62 |     0.0 % |      0.0 % |               0.0 % |              7.3 % |           4,000 |    62.9 % |        2,516 |       0.112 |      12,000 |       1,734 |      1,361 |

## By root genre

| Group | Edges | Beatmatch | Violations | Start+end on phrase | Boundaries aligned | Bass overlap ms | Key clash | Key clash ms | Energy step | Duration ms | Unplayed ms | Skipped ms |
| ----- | ----: | --------: | ---------: | ------------------: | -----------------: | --------------: | --------: | -----------: | ----------: | ----------: | ----------: | ---------: |
| pool  |   184 |    46.2 % |      0.0 % |               0.0 % |              8.0 % |           2,152 |    71.2 % |        7,557 |       0.092 |      19,549 |       1,395 |      1,100 |

## By stratum

| Group    | Edges | Beatmatch | Violations | Start+end on phrase | Boundaries aligned | Bass overlap ms | Key clash | Key clash ms | Energy step | Duration ms | Unplayed ms | Skipped ms |
| -------- | ----: | --------: | ---------: | ------------------: | -----------------: | --------------: | --------: | -----------: | ----------: | ----------: | ----------: | ---------: |
| pool/0-2 |    63 |    66.7 % |      0.0 % |               0.0 % |              9.5 % |           1,333 |    76.2 % |        9,223 |       0.078 |      22,918 |         717 |      1,292 |
| pool/2-4 |    59 |    72.9 % |      0.0 % |               0.0 % |              7.2 % |           1,085 |    74.6 % |       11,075 |       0.087 |      23,883 |       1,762 |        620 |
| pool/4-6 |    62 |     0.0 % |      0.0 % |               0.0 % |              7.3 % |           4,000 |    62.9 % |        2,516 |       0.112 |      12,000 |       1,734 |      1,361 |

## Comparison

None: this report is a baseline.

# Smart Mix evaluation: smart-mix-v3

- Planner: `smart-mix-v3` (rules revision 1), context `listen`
- Dataset: `tools/smart-mix-eval/out/sm2/spike/dataset.jsonl`, 184 edges, sha256 `7fe60505e176`
- Profiles read from `localhost:5432/crate_eval` in read-only transactions
- Profiles: current 368; analyzers: smart-mix-audio-v7 368
- Modes: adaptive 99, beatmatch 85; fallbacks: incompatible_tempo 40, low_confidence 5, none 85, unstable_tempo 54; curves: equal-power 184; bass handoffs: 0
- Planned on stored phrases: 184 of 184 edges (100.0 %); the rest used v2's bar heuristic
- Run 2026-11-06T09:32:38.732121+00:00 at commit `c9301fe78a0d`

## Overall

| Metric                                                  |   n |      mean |    p50 |    p95 |
| ------------------------------------------------------- | --: | --------: | -----: | -----: |
| Policy violations (plans)                               | 184 | 0 (0.0 %) |        |        |
| Phrase alignment, start and end on a boundary (phrases) | 184 |     0.0 % |        |        |
| Phrase alignment, mix start on a boundary (phrases)     | 184 |    67.9 % |        |        |
| Phrase alignment, boundaries aligned of 4 (phrases)     | 184 |      1.55 |   2.00 |   2.00 |
| Bass overlap (ms)                                       | 184 |     2,000 |  2,000 |  2,000 |
| Harmonic clash (ms)                                     | 184 |     1,424 |  2,000 |  2,000 |
| Harmonic clash, plans with a clash                      | 184 |    71.2 % |        |        |
| Energy step, 0-1 (intro_outro)                          |  40 |     0.054 |  0.031 |  0.211 |
| Energy step, 0-1 (phrases)                              | 144 |     0.041 |  0.034 |  0.101 |
| Vocal clash (ms)                                        | 184 |         0 |      0 |      0 |
| Transition duration (ms)                                | 184 |     6,000 |  6,000 |  6,000 |
| Outgoing music after the mix (ms)                       | 184 |    24,691 | 21,015 | 65,790 |
| Incoming music before the mix (ms)                      | 184 |    13,261 |  7,577 | 51,411 |

Phrase metrics use stored phrases when a profile has them and an 8-bar grid
from the downbeat otherwise (basis `grid`). Overlaps count time with both
decks at half amplitude or more; bass counts the handoff shelf cut too.

## By tempo band

| Group | Edges | Beatmatch | Violations | Start+end on phrase | Boundaries aligned | Bass overlap ms | Key clash | Key clash ms | Energy step | Duration ms | Unplayed ms | Skipped ms |
| ----- | ----: | --------: | ---------: | ------------------: | -----------------: | --------------: | --------: | -----------: | ----------: | ----------: | ----------: | ---------: |
| 0-2   |    63 |    66.7 % |      0.0 % |               0.0 % |             36.5 % |           2,000 |    76.2 % |        1,524 |       0.042 |       6,000 |      25,394 |     11,552 |
| 2-4   |    59 |    72.9 % |      0.0 % |               0.0 % |             38.1 % |           2,000 |    74.6 % |        1,492 |       0.046 |       6,000 |      23,775 |     12,151 |
| 4-6   |    62 |     0.0 % |      0.0 % |               0.0 % |             41.9 % |           2,000 |    62.9 % |        1,258 |       0.044 |       6,000 |      24,848 |     16,052 |

## By root genre

| Group | Edges | Beatmatch | Violations | Start+end on phrase | Boundaries aligned | Bass overlap ms | Key clash | Key clash ms | Energy step | Duration ms | Unplayed ms | Skipped ms |
| ----- | ----: | --------: | ---------: | ------------------: | -----------------: | --------------: | --------: | -----------: | ----------: | ----------: | ----------: | ---------: |
| pool  |   184 |    46.2 % |      0.0 % |               0.0 % |             38.9 % |           2,000 |    71.2 % |        1,424 |       0.044 |       6,000 |      24,691 |     13,261 |

## By stratum

| Group    | Edges | Beatmatch | Violations | Start+end on phrase | Boundaries aligned | Bass overlap ms | Key clash | Key clash ms | Energy step | Duration ms | Unplayed ms | Skipped ms |
| -------- | ----: | --------: | ---------: | ------------------: | -----------------: | --------------: | --------: | -----------: | ----------: | ----------: | ----------: | ---------: |
| pool/0-2 |    63 |    66.7 % |      0.0 % |               0.0 % |             36.5 % |           2,000 |    76.2 % |        1,524 |       0.042 |       6,000 |      25,394 |     11,552 |
| pool/2-4 |    59 |    72.9 % |      0.0 % |               0.0 % |             38.1 % |           2,000 |    74.6 % |        1,492 |       0.046 |       6,000 |      23,775 |     12,151 |
| pool/4-6 |    62 |     0.0 % |      0.0 % |               0.0 % |             41.9 % |           2,000 |    62.9 % |        1,258 |       0.044 |       6,000 |      24,848 |     16,052 |

## Comparison

Current minus `smart-mix-v2` (context `listen`), 184 paired edges.

| Group   | Edges | Beatmatch | Violations | Start+end on phrase | Boundaries aligned | Bass overlap ms | Key clash | Key clash ms | Energy step | Duration ms | Unplayed ms | Skipped ms |
| ------- | ----: | --------: | ---------: | ------------------: | -----------------: | --------------: | --------: | -----------: | ----------: | ----------: | ----------: | ---------: |
| overall |     0 |     0.0 % |      0.0 % |               0.0 % |            +31.5 % |               0 |     0.0 % |            0 |      -0.060 |           0 |     +21,994 |    +12,181 |

| Group    | Edges | Beatmatch | Violations | Start+end on phrase | Boundaries aligned | Bass overlap ms | Key clash | Key clash ms | Energy step | Duration ms | Unplayed ms | Skipped ms |
| -------- | ----: | --------: | ---------: | ------------------: | -----------------: | --------------: | --------: | -----------: | ----------: | ----------: | ----------: | ---------: |
| pool/0-2 |     0 |     0.0 % |      0.0 % |               0.0 % |            +30.2 % |               0 |     0.0 % |            0 |      -0.044 |           0 |     +22,732 |    +10,252 |
| pool/2-4 |     0 |     0.0 % |      0.0 % |               0.0 % |            +30.1 % |               0 |     0.0 % |            0 |      -0.062 |           0 |     +20,929 |    +11,603 |
| pool/4-6 |     0 |     0.0 % |      0.0 % |               0.0 % |            +34.3 % |               0 |     0.0 % |            0 |      -0.076 |           0 |     +22,256 |    +14,692 |

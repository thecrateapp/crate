# Smart Mix evaluation: smart-mix-v3

- Planner: `smart-mix-v3` (rules revision 1), context `dj`
- Dataset: `tools/smart-mix-eval/out/sm2/spike/dataset.jsonl`, 184 edges, sha256 `7fe60505e176`
- Profiles read from `localhost:5432/crate_eval` in read-only transactions
- Profiles: current 368; analyzers: smart-mix-audio-v7 368
- Modes: adaptive 99, beatmatch 85; fallbacks: incompatible_tempo 40, low_confidence 5, none 85, unstable_tempo 54; curves: dj-blend 40, equal-power 144; bass handoffs: 85
- Planned on stored phrases: 184 of 184 edges (100.0 %); the rest used v2's bar heuristic
- Run 2026-11-06T09:32:33.512641+00:00 at commit `c9301fe78a0d`

## Overall

| Metric                                                  |   n |      mean |    p50 |    p95 |
| ------------------------------------------------------- | --: | --------: | -----: | -----: |
| Policy violations (plans)                               | 184 | 0 (0.0 %) |        |        |
| Phrase alignment, start and end on a boundary (phrases) | 184 |    15.8 % |        |        |
| Phrase alignment, mix start on a boundary (phrases)     | 184 |    78.3 % |        |        |
| Phrase alignment, boundaries aligned of 4 (phrases)     | 184 |      2.10 |   2.00 |   4.00 |
| Bass overlap (ms)                                       | 184 |     2,152 |  4,000 |  4,000 |
| Harmonic clash (ms)                                     | 184 |     4,470 |  4,000 | 14,322 |
| Harmonic clash, plans with a clash                      | 184 |    71.2 % |        |        |
| Energy step, 0-1 (intro_outro)                          |  25 |     0.070 |  0.045 |  0.222 |
| Energy step, 0-1 (phrases)                              | 159 |     0.044 |  0.037 |  0.108 |
| Vocal clash (ms)                                        | 184 |        70 |      0 |      0 |
| Transition duration (ms)                                | 184 |    14,144 | 12,000 | 29,931 |
| Outgoing music after the mix (ms)                       | 184 |    24,168 | 17,796 | 62,326 |
| Incoming music before the mix (ms)                      | 184 |    15,097 |  9,082 | 51,412 |

Phrase metrics use stored phrases when a profile has them and an 8-bar grid
from the downbeat otherwise (basis `grid`). Overlaps count time with both
decks at half amplitude or more; bass counts the handoff shelf cut too.

## By tempo band

| Group | Edges | Beatmatch | Violations | Start+end on phrase | Boundaries aligned | Bass overlap ms | Key clash | Key clash ms | Energy step | Duration ms | Unplayed ms | Skipped ms |
| ----- | ----: | --------: | ---------: | ------------------: | -----------------: | --------------: | --------: | -----------: | ----------: | ----------: | ----------: | ---------: |
| 0-2   |    63 |    66.7 % |      0.0 % |              23.8 % |             57.1 % |           1,333 |    76.2 % |        5,951 |       0.048 |      16,219 |      24,924 |     17,406 |
| 2-4   |    59 |    72.9 % |      0.0 % |              23.7 % |             56.8 % |           1,085 |    74.6 % |        4,943 |       0.049 |      14,182 |      26,505 |     11,488 |
| 4-6   |    62 |     0.0 % |      0.0 % |               0.0 % |             43.5 % |           4,000 |    62.9 % |        2,516 |       0.046 |      12,000 |      21,176 |     16,186 |

## By root genre

| Group | Edges | Beatmatch | Violations | Start+end on phrase | Boundaries aligned | Bass overlap ms | Key clash | Key clash ms | Energy step | Duration ms | Unplayed ms | Skipped ms |
| ----- | ----: | --------: | ---------: | ------------------: | -----------------: | --------------: | --------: | -----------: | ----------: | ----------: | ----------: | ---------: |
| pool  |   184 |    46.2 % |      0.0 % |              15.8 % |             52.4 % |           2,152 |    71.2 % |        4,470 |       0.048 |      14,144 |      24,168 |     15,097 |

## By stratum

| Group    | Edges | Beatmatch | Violations | Start+end on phrase | Boundaries aligned | Bass overlap ms | Key clash | Key clash ms | Energy step | Duration ms | Unplayed ms | Skipped ms |
| -------- | ----: | --------: | ---------: | ------------------: | -----------------: | --------------: | --------: | -----------: | ----------: | ----------: | ----------: | ---------: |
| pool/0-2 |    63 |    66.7 % |      0.0 % |              23.8 % |             57.1 % |           1,333 |    76.2 % |        5,951 |       0.048 |      16,219 |      24,924 |     17,406 |
| pool/2-4 |    59 |    72.9 % |      0.0 % |              23.7 % |             56.8 % |           1,085 |    74.6 % |        4,943 |       0.049 |      14,182 |      26,505 |     11,488 |
| pool/4-6 |    62 |     0.0 % |      0.0 % |               0.0 % |             43.5 % |           4,000 |    62.9 % |        2,516 |       0.046 |      12,000 |      21,176 |     16,186 |

## Comparison

Current minus `smart-mix-v2` (context `dj`), 184 paired edges.

| Group   | Edges | Beatmatch | Violations | Start+end on phrase | Boundaries aligned | Bass overlap ms | Key clash | Key clash ms | Energy step | Duration ms | Unplayed ms | Skipped ms |
| ------- | ----: | --------: | ---------: | ------------------: | -----------------: | --------------: | --------: | -----------: | ----------: | ----------: | ----------: | ---------: |
| overall |     0 |     0.0 % |      0.0 % |             +15.8 % |            +44.4 % |               0 |     0.0 % |       -3,087 |      -0.045 |      -5,405 |     +22,774 |    +13,997 |

| Group    | Edges | Beatmatch | Violations | Start+end on phrase | Boundaries aligned | Bass overlap ms | Key clash | Key clash ms | Energy step | Duration ms | Unplayed ms | Skipped ms |
| -------- | ----: | --------: | ---------: | ------------------: | -----------------: | --------------: | --------: | -----------: | ----------: | ----------: | ----------: | ---------: |
| pool/0-2 |     0 |     0.0 % |      0.0 % |             +23.8 % |            +47.6 % |               0 |     0.0 % |       -3,272 |      -0.029 |      -6,700 |     +24,208 |    +16,113 |
| pool/2-4 |     0 |     0.0 % |      0.0 % |             +23.7 % |            +49.6 % |               0 |     0.0 % |       -6,132 |      -0.039 |      -9,701 |     +24,744 |    +10,868 |
| pool/4-6 |     0 |     0.0 % |      0.0 % |               0.0 % |            +36.3 % |               0 |     0.0 % |            0 |      -0.066 |           0 |     +19,442 |    +14,825 |

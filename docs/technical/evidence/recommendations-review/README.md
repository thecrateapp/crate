# Recommendation review measurements

Measured on 2026-10-30 against an isolated logical replica of approximately
138K tracks, with 100K synthetic listening events. No real listening history
was copied. The database container was limited to two CPUs and 2 GiB RAM.
Revision 139 was installed; these are stack measurements, not standalone
PR301 results without that index. See [captured summaries](benchmarks.json).

## Radio and continuation

Each endpoint has 25 measured requests after two warmups, alternating Citizen
and Concubine sessions. Every response returned 20 tracks. Native requests
also planned all 20 transition edges using 21 stored synthetic legacy profiles.

| Route                   |        p50 |        p95 |    Maximum | Data reads | Total SQL round trips |
| ----------------------- | ---------: | ---------: | ---------: | ---------: | --------------------: |
| Radio NEXT              | 100.826 ms | 153.919 ms | 154.745 ms |          3 |                     4 |
| Native continuation     | 100.775 ms | 168.158 ms | 197.899 ms |          4 |                     5 |
| History, 300 references |  14.399 ms |  16.128 ms |  16.803 ms |          1 |                     1 |

The router, recommendation engine, SQL, Redis and transition planner execute
normally. Only authentication/descriptor resolution is substituted. The ASGI
boundary excludes TCP, TLS, reverse proxies and startup. Profiles use legacy
audio metadata and synthetic cues; full beat-grid profile costs are not covered.
Natural caches remain enabled. History uses one query and one round trip.

Native continuation meets the four-data-read budget. It also executes one
`SET LOCAL jit = off`, so it has five total SQL round trips and does **not**
meet a four-total-round-trip interpretation. The JSON preserves that separate
failed check instead of treating the setting as a data read or hiding it.

Setwise catalog resolution reduced the isolated history p95 from 52.694 ms
to 15.325 ms; the final endpoint run measured 16.128 ms with the same 32 matched
song identities. SQL and canonical-family counters remain unchanged in tests.

## Music Paths

Each row has 25 measured generation seeds after one separate warmup. These
are service/planner measurements, including history, with external AI disabled;
they do not include HTTP. Budgets are 2 seconds for 20 and 6 seconds for 100.

| Journey                          | Requested | Returned |     p50 |     p95 | Maximum |
| -------------------------------- | --------: | -------: | ------: | ------: | ------: |
| citizen-to-converge              |        20 |    20–20 | 0.442 s | 0.607 s | 0.640 s |
| citizen-to-converge              |       100 |  100–100 | 1.251 s | 1.596 s | 1.812 s |
| punk-to-electronic               |        20 |    20–20 | 0.641 s | 0.955 s | 1.636 s |
| punk-to-electronic               |       100 |    97–97 | 1.215 s | 1.590 s | 2.460 s |
| concubine-to-botch               |        20 |    20–20 | 0.136 s | 0.199 s | 0.251 s |
| concubine-to-botch               |       100 |  100–100 | 0.521 s | 1.301 s | 1.741 s |
| jane-doe-to-romans-via-dillinger |        20 |    20–20 | 0.140 s | 0.182 s | 0.187 s |
| jane-doe-to-romans-via-dillinger |       100 |  100–100 | 0.405 s | 1.119 s | 1.189 s |

The 100-step Punk → Electronic case consistently returns 97 tracks with
`insufficient_tracks`; it remains structurally partial instead of inventing
songs. Other cases return the requested count. All endpoints and generation
metadata remain consistent. The JSON records partial samples, duplicate checks
and any songs without a canonical identity; missing identities limit family
verification rather than proving uniqueness.

Path statement counts include SELECT/WITH controls separately from all SQL
statements. Acoustic planning shares one read transaction; setting/restoration
calls remain visible. These are local observations, not production guarantees.

## Migration and release checks

A fresh build of the actual migration 139 took 20.325 seconds, producing a
47.84 MiB valid/ready index with 256 MB maintenance memory and parallel
maintenance disabled. The first API startup builds it if it is absent; local
timing does not establish production startup duration.

The earlier captures in [historical Music Paths evidence](../music-paths/README.md)
predate these review fixes. This report does not replace physical Xiaomi
(crossfade on/off, screen off, network interruptions), Cast receiver or web/Tauri
playback checks. No production index build, merge, release or deploy was done.

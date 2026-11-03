# C0 authenticated web journey — 2026-10-31

**Journey performed; C0 acceptance remains open.** Production shadow stayed on
source `248636d511d7356b732b908bc07ba0b50fdb9b97`. This cut changes evidence and
proposed instrumentation semantics only.

The client journey ran from **12:10:29 to the pause request at 12:36:42 CET**
(Europe/Madrid), about 26 minutes. Pause was subsequently confirmed at 12:38:05.
The server dataset contains 26 one-minute samples spanning 25 minutes,
12:10:52–12:35:52 CET. UTC timestamps are retained in the JSON artifacts.

## Actions and outcomes

| Check                         | Observed result                                                                                                                                                                                                                                              |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Authentication and navigation | Authenticated session; Music, Settings, album pages, Explore and Radar opened during the journey.                                                                                                                                                            |
| Ordinary playback             | Player progress advanced and the initial queue moved to the next track without a manual Next action.                                                                                                                                                         |
| Preferences                   | Infinite was already enabled; repeat and shuffle were off. Persistent playback preferences were not changed.                                                                                                                                                 |
| Published album continuation  | Playing its last track triggered a radio response with HTTP 200 in 1.279 s to response headers. The UI changed from 5 original tracks to 35 total, with 30 Next Up items. The player subsequently advanced naturally into a recommendation.                  |
| Partial pre-release album     | Its last available track ended paused with an empty queue, despite Infinite enabled. No radio request was observed for that source; the setting was reconfirmed afterward. See the source-support finding below.                                             |
| Client network fault          | Network emulation was restricted to the Listen tab. Requested hold: 15 s; measured start-to-restore interval: 16.061 s. Selecting another queued track still yielded 14.412 s of rendered progress during the cut. A forced audio stall was not established. |
| Recovery                      | After network restoration, navigation/API traffic and Sentry transport again returned successful responses. Playback continued and later tracks advanced without pressing Play again.                                                                        |
| QoE transport                 | Three observed batches received HTTP 204. This does not establish complete event delivery, storage semantics or a success-rate denominator.                                                                                                                  |
| Sentry web transport          | HTTP 200 envelopes were observed before the fault and after restoration. Envelope type, project ingestion and symbolication were not verified.                                                                                                               |
| Background services           | At one checkpoint, six worker/projector services passed their role-readiness checks; all 26 original application containers retained their IDs/start times. No representative enrichment workload was submitted.                                             |
| Cleanup                       | Playback pause was verified, network emulation reset to online/unlimited and playback preferences left as found.                                                                                                                                             |

The proof is rendered engine/UI progress and network observations. It does not
verify physical audio output, seamless audible transitions or stall recovery.
Listen history/queue changed through the authorized playback journey; personal
library payloads and account identifiers are not included in the artifacts.

## Functional finding: Infinite and partial pre-releases

The published-album contrast filled and continued successfully. The partial
pre-release path did not construct a supported continuation source:

- `app/listen/src/pages/album-data-model.ts:59` removes `albumRadioSeed` when
  `isPreRelease` is true.
- `app/listen/src/pages/use-album-playback-actions.ts:38` creates the album source
  without `radio` when that seed is null. Row playback uses the same path.
- `app/listen/src/contexts/use-playback-refill-runtime.ts:156` requires
  `source.radio` for support, including when Infinite is enabled.

The stop therefore occurs before requesting recommendations. Track this as a
functional coverage gap for a separate fix/product decision. Instrumentation must
expose the unsupported reason rather than quietly omit user-requested Infinite
continuation from eligibility. The [dictionary](event-dictionary.md) now includes
that distinction. No player, source-policy or ranking code was changed here.

## Infrastructure measurements

All six targets were up in all 26 samples; PostgreSQL and both Redis dependency
checks were also up. Monitoring had zero observed restarts/OOM kills.

| Signal                                  | Observation                                                                                                        |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Aggregate monitoring working set        | 349.6–384.2 MiB; mean 367.8 MiB, against 944 MiB admission limit                                                   |
| Aggregate CPU, 5-minute rate            | 0.0354–0.0433 cores; mean 0.0384 cores                                                                             |
| CPU/throttle coverage, 5-minute rate    | 8/8 monitoring services at every queried step; this is the window already used by the runtime dashboard            |
| CPU/throttle coverage, 2-minute samples | 6–8/8 services depending on sample; these shorter-window sums remain partial                                       |
| Grafana individual working set          | Peak 252.4/256 MiB, 98.6%; review the allocation before C0 sign-off                                                |
| TSDB head series                        | 6,312–6,314                                                                                                        |
| Prometheus store                        | 3,424–5,580 KiB during this window; no retention forecast                                                          |
| Maximum scrape duration                 | Prometheus 0.017 s; node 0.286 s; cAdvisor 0.580 s; PostgreSQL 0.265 s; cache Redis 2.173 s; durable Redis 1.458 s |
| Exported service groups                 | 30/34: nginx, slskd, tidarr and traefik remain outside the Crate-prefix filter                                     |
| Filesystem IO coverage                  | 3/8 monitoring services; absent series are unknown, not zero                                                       |

Use the complete 5-minute CPU samples for this window. The shorter 2-minute
sampling calculation has holes; this evidence does not assign an unverified
root cause to them. The Grafana dashboard already uses 5 minutes. Throttled-time
rates are recorded separately and are not CPU-utilization percentages.

A pre-flow spot check also found Grafana near its cap: roughly 225 MiB anonymous
memory, 16 MiB file cache and 11.5 MiB kernel memory, with a 256 MiB cgroup limit.
`memory.events.max` was nonzero while OOM counters were zero. That counter is
cumulative since container start and is not attributed solely to this journey.
Aggregate headroom does not guarantee sufficient headroom for each service.

## Capture limits and outstanding checks

- The browser network buffer overflowed twice. Normalized observations already
  captured were retained, but request/error counts are incomplete and may contain
  duplicate observations. No total failure ratio is calculated.
- One HTTP 404 was observed for normalized category `other`, starting at
  12:26:31 CET during the Radar segment. Its original URL/body was not retained
  and the historical reread was truncated. Resource, cause and impact remain
  unverified; do not label the whole journey error-free.
- Observed non-cancelled network failures used `ERR_INTERNET_DISCONNECTED` during
  the deliberate fault; no other non-cancelled failure code was retained.
  Cancelled/aborted requests are kept separate.
- Sentry transport acceptance does not prove error ingestion, grouping or
  symbolication, including for the other runtimes.
- This journey covers the production web client. Android/iOS/Tauri/Cast and
  physical audio QA remain separate coverage work.
- Review Grafana allocation, the four companion-container exclusions, the
  pre-release source-support gap and the unclassified 404 before signing off C0.
  The independent external-probe host remains deferred by Diego. PR1A has not
  started.

## Artifacts

- [Normalized client observations](functional-client.json): timestamps, aliased
  playback states and capture limitations; no raw URLs/headers/bodies.
- [Server samples](functional-samples.jsonl): 26 point observations.
- [Range-query evidence](functional-rate-coverage.json): coverage and totals using
  the dashboard's 5-minute CPU window, plus 2-minute comparison and sample age.
- [Computed server summary](functional-summary.json).

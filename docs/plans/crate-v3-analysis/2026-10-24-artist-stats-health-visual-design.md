# Artist Stats and System Health: analytical instruments

Date: 2026-10-24. Status: implemented and verified; top-band expansion remains a proposal.

## Decisions from Diego

- Artist Stats becomes an analytical console for the catalogue and its sound profile.
- Its charts and System Health charts follow the visual language of the genre wheel.
- Listen and the approved V3 identity remain the visual reference. Reuse existing primitives.
- The genre wheel itself is outside this change.
- Latest explicit adjustments: select albums directly from graph nodes, with the most recent
  initially active. Remove the redundant album pickers and final Genre Profile, which duplicates the artist hero.
  Inspectors show cover/title and place
  all compact metadata below the title, even for short names.

## Approach

The alternatives were an analytical console and a smaller editorial summary. Diego selected the
console: it supports comparing releases and investigating differences rather than only presenting
highlights.

Builder recommendation: retain Nivo for statistical scales and geometry, with custom marks,
layers and a common Admin theme. This follows the renderer rule in the design system, section
3.5. The visual result comes from the wheel's drawing rules: fine strokes, hollow and active
nodes, subdued context, mono annotations and one accent. Circular layout is reserved for data
whose relationships benefit from it; time stays chronological and BPM/energy retain their axes.

This is an Admin-only composition built from shared primitives and tokens. No new shared
foundation component, chart dependency or backend aggregate is needed for this phase.

## Common visual grammar

| Element      | Proposed treatment                                                                                                                                               |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Surface      | Open plot on the page surface. Peer plots separated by a single hairline.                                                                                        |
| Header       | Shared MonoLabel in accent; unit, interval and provenance in supporting mono text. Preserve Artist tab header geometry.                                          |
| Context      | Fine neutral strokes and sparse scale marks; no heavy domain box or filled chart area.                                                                           |
| Marks        | Hollow small nodes; selected point filled with accent and a restrained halo, following the wheel.                                                                |
| Series       | Accent for the primary series; foreground tones and dash patterns for comparison. Amber only for an actual warning/error meaning.                                |
| Focus        | Highlight the inspected point/series and attenuate unrelated marks while retaining readable labels.                                                              |
| Readout      | Compact title/value/unit/source using shared typography. Pointer hover, keyboard focus and touch selection expose the same information; no native title tooltip. |
| Motion       | Short transitions on selection/data changes. Static when idle; honor reduced motion.                                                                             |
| Missing data | A gap or an explicit unavailable reading. Preserve measured zero; never interpolate absent observations as zero.                                                 |

Reuse `MonoLabel`, `StatNumber`, `Meter`, `HairlineList`, `Select`, `Tooltip` and
shared loading/error/empty states. Consolidate chart theme/readout composition locally in Admin
so Stats and Health consume one recipe. Inspect equivalent Listen instrument styles before
implementation; do not copy wheel CSS or introduce local foundation variants.

## Artist Stats layout

The first Stats header retains the same 44 px minimum height and 12 px body gap as every Artist
tab. Below it, the content follows this order:

1. **Catalogue readout.** Publication range and available duration. Avoid repeating album/track
   totals already present in the hero. Show dates/duration only from valid observations.
2. **Release timeline.** A true year axis with a fine chronological rail and release nodes.
   Selecting a node reveals album, year, tracks and available duration in an adjacent inspector.
   Coincident years use separate marks rather than inventing a sequence. Undated releases form
   a labelled group. The inspector stacks underneath at narrow widths.
3. **Sonic map.** BPM horizontally and energy vertically, one hollow point per returned audio observation.
   Selection illuminates the point and displays BPM, energy, danceability, valence and
   acousticness with shared meters/readouts. Nodes support pointer, keyboard and touch selection.
   Only observations with valid BPM and energy enter the statistical plot; incomplete observations
   retain compact selectable nodes in a secondary rail, without inventing coordinates.
4. **Catalogue rankings.** Two adjacent hairline lists on wide screens, stacked on mobile.
   Tracks use consolidated popularity on a 0–100 scale; Last.fm listeners are a separate secondary
   value. Albums have a shared unit selector for popularity versus Last.fm listeners. Each list
   uses one unit at a time, with a fine full-scale reference rail and accent value stem/endpoint.
   Both popularity scores read `value/100`; listener mode states its observed maximum separately.
5. **Formats.** Secondary compact band: proportional hairline format rail with counts and a mono
   legend. The final Genre Profile was removed because the artist hero already contains it.

Both graphs start with the newest dated observation selected and illuminated. Unknown dates cannot
outrank a known date. Nodes provide hover, click and keyboard inspection; undated releases and
incomplete audio observations have a small secondary rail within the relevant graph. There are
no album pickers. Keep the separate album-ranking unit control because it changes the statistic.

Each selected inspector has a cover beside its reading. Its accent caption is separated from the
metadata. Album title occupies a complete row; year, track count, available duration and BPM
always follow below. Audio trait meters and the existing loudness estimate in dB appear when the observation can be matched uniquely.
Rankings show small covers, year and useful available metadata, with aligned peer headers.
Use catalogue artwork only for unique name/year identity. The audio response includes its
already-grouped year; this adds no query or aggregation. Ambiguous identities keep a fallback
cover and do not borrow another edition's audio profile.

Remove the radar, pie and the Artist Network duplicated from Similar Artists.

### Data boundaries

- `albums_timeline.total_duration` is already returned in seconds; declare it in TypeScript.
- Formats percentages use only tracks with a known format as their denominator and say so.
- Audio values are means of the available analyzed samples with BPM present, grouped by album
  name/year. This BPM filter applies to all returned traits, not only tempo. The endpoint does
  not provide sample counts, so do not claim complete coverage or a weighted artist profile.
- `null` means unavailable. Genuine numeric zero remains a measured value.
- The top-track endpoint returns ten tracks selected by popularity. Reordering that subset by
  listeners would not produce a valid Last.fm ranking, so no track listeners ranking is offered.
- Audio rows have no stable album ID and can contain duplicate names. Give observations local
  keys valid within that payload; never combine or overwrite same-name rows. Link to an album only when identity can
  be resolved uniquely from the already-loaded catalogue; otherwise retain the read-only inspector.
- `avg_loudness` already exists in the response. Display it as Loudness estimate in dB, preserving
  null and zero. It is an average among available BPM samples and depends on the analyzer;
  it is not integrated album LUFS or dBFS. Exact Smart Mix/Bliss coverage and local listening
  history need a richer precomputed contract and are outside this UI phase.
- Do not add request-time aggregates over library tracks. Existing data access is retained.

## System Health layout

Keep the current metric streams and use their actual aggregation semantics. Apply the common drawing recipe to all 13
plots: open surface, mono captions, 1–1.25 px strokes, no area fill, sparse neutral guides and
an active node/readout during inspection. Keep actual timestamp positions on the horizontal
axis, even when labels repeat within the same minute.

Average and maximum remain distinct, with labelled legend entries and different stroke styles.
Units stay visible in the header/readout. Error series may use the warning token because the
colour carries operational meaning. No decorative live glow or arbitrary multicolour palette.

Counters use one event-count series per bucket: Request Volume and Stream Activity currently
plot average/maximum even though their recorded event value is always 1. Correct them to `count`.
The current Error Rate plot also contains counts; label it Errors with an errors-per-interval
unit. Do not derive a rate by dividing sparse buckets. Preserve average/maximum for measured
durations, queue depth and resource-load gauges.

Call Stream Activity **Stream Requests**: it counts stream-target requests, including SSE, rather
than concurrent playback. Label resource load **Load Ratio at Deferral**: those samples are
recorded when the governor defers work and do not describe continuous system load.

The metric API omits missing buckets. Position marks by real timestamp and insert null gaps
using the response's bucket resolution (60 s or 3600 s), or segment paths at discontinuities.
No missing bucket is filled with zero: this contract cannot distinguish inactivity from a gap
in metric collection.

| Plot                   | Fields       | Unit                                    |
| ---------------------- | ------------ | --------------------------------------- |
| API Latency            | `avg`, `max` | ms                                      |
| Request Volume         | `count`      | requests per interval                   |
| Errors (5xx)           | `count`      | errors per interval                     |
| Slow Requests          | `count`      | requests at least 1,000 ms per interval |
| Stream Requests        | `count`      | requests per interval, including SSE    |
| Transcode Duration     | `avg`, `max` | seconds                                 |
| Home Core Compute      | `avg`, `max` | ms                                      |
| Home Endpoint Compute  | `avg`, `max` | ms                                      |
| Task Duration          | `avg`, `max` | seconds                                 |
| Queue Wait Time        | `avg`, `max` | seconds                                 |
| Queue Depth            | `avg`, `max` | observed tasks                          |
| Resource Deferrals     | `count`      | deferrals per interval                  |
| Load Ratio at Deferral | `avg`, `max` | ratio observed when work is deferred    |

Expose interval granularity and the full timestamp/time zone in the readout; the current bucket
may be incomplete. Say **no samples** for missing buckets. The page's separate error percentage
summary keeps its existing meaning.

Use the existing time-window controls and data ownership. This change adds no stream, polling,
snapshot rebuild or backend query. Keep the global page structure, resource controls and actions.

At narrow widths plots stack; labels/readouts wrap and units remain legible. A keyboard/touch
sample selection provides the same values as pointer inspection. Loading, empty and error states
keep the expected plot geometry without converting failures into zero-valued series.

## Acceptance and delivery

1. Implement Artist Stats with the above semantics and wheel-derived marks.
2. Reuse the common Admin chart recipe for System Health metric streams.
3. Cover year positioning, coincident/undated releases, duplicate album names, null versus zero,
   ranking units, format denominator, selection and keyboard/touch behavior in focused tests.
4. Validate contrast/tokens, reduced motion, states, and label/point clipping in actual desktop
   and narrow-browser renders. Preserve the existing Artist tab layout checks.
5. Run relevant component suites, typecheck, lint and production build at the stable phase end.

Builder choices remain internal component boundaries, responsive breakpoints and tick density,
using existing shared recipes and the available container width.

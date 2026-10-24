# Artist Stats and System Health resolution

Date: 2026-10-24. Worktree: `crate-v3-1q`, branch `feat/crate_v3`.

## Result

Artist Stats and all 13 System Health metric plots use one Admin-local instrument recipe:
open surfaces, fine token-resolved traces, hollow contextual nodes, accent selected nodes,
quiet guides and mono captions/readings. Statistical scales remain Nivo; no dependency added.

Artist Stats includes a real chronological release timeline, BPM/energy map, separate popularity
rankings and known-format shares. The final Genre Profile was removed as redundant with the artist hero. Both graphs initially select the
most recent valid dated observation and support hover, pointer/touch and keyboard selection.
The album selectors were removed following Diego's final refinement. Compact node rails retain
undated, incomplete and coincident observations without fabricating graph coordinates.

Selected inspectors show cover and metadata, separated accent captions, and available audio
trait meters and the already-available loudness estimate in dB. Album title always occupies a complete row before year, tracks, duration and BPM.
Track and album ranking rows include small covers, year and available contextual metadata;
peer headers align. Both popularity units use value/100 and a visible full-scale reference rail; listener mode labels its observed maximum. Ranking metadata wraps without shared-row truncation. Artwork and audio associations require unambiguous edition identity.

System Health uses actual timestamps and response-owned bucket intervals, distinct average/max
traces and count series for counters. Missing buckets remain gaps and measured zero remains zero.
Labels distinguish stream requests from concurrent playback and load at resource deferral from
continuous host load. Stale selections reconcile when accepted data/resolution changes.

The existing audio aggregate now projects its already-grouped album year. No extra query,
request-time aggregation, endpoint, stream, migration or library mutation was introduced.

## Review and verification

- Final independent review: PASS, no pending findings. Resolved actual pixel hit testing,
  mobile timeline sizing, accepted-response resolution, stale selections, Nivo node accessibility,
  coincident-node access and ambiguous legacy audio-to-edition matching.
- Focused Artist/model: 39 tests passed. Common instrument recipe: 7 tests passed.
- Focused System Health: 25 tests passed. PostgreSQL audio-by-album contract: 4 tests passed.
- Final production build and Admin lint passed; typecheck is included in the build.
- Playwright: 4 tests passed, at desktop and narrow touch widths. Covers all Artist tab header
  geometry, node selection, full-width titles, aligned ranking headers, absence of redundant Genre Profile, sparse metric
  gaps, zero readings, nearest-point hit targets, no native title tooltips and no page overflow.
- Final full Admin suite: 207 suites, 2,105 tests passed against the final ranking/loudness refinement.
- Actual local Holywater Stats checked with catalogue data and keyboard node selection; both
  inspectors initially show Arboreal (2019). Proof: `/tmp/crate-artist-stats-refined-oct24.png`.

## Data limits

Audio traits are means of available analyzed samples with BPM present, grouped by name/year.
The contract does not provide complete coverage/sample counts, full Smart Mix profiles or Bliss
vectors. Loudness estimate is not integrated album LUFS; source analyzers use different loudness estimators. Absent or ambiguous values stay unavailable. The track ranking is the endpoint's top ten by consolidated popularity;
Last.fm listeners remain contextual, rather than an invented alternative ranking of the catalogue.

Earlier pending Artist/API fixes were preserved. Genres and production were not modified.
No commit or push was requested or performed for this phase.

## Approved summary extension

Use the empty top-band space for eight responsive readings: local albums, tracks, available
duration, publication range, predominant genre, mean BPM, current Full Smart Mix profile
coverage and stored Bliss vector coverage. Counts come from local timeline/stored artist totals,
not the displayed catalogue that can include upcoming releases. Genre is the strongest tag,
not a claim about listening share.

Mean BPM must use positive finite per-track tempo with measured-track coverage. The existing
`/analysis-data` read can be loaded lazily when Stats opens; no extra SQL aggregate is needed.
Current Full Smart Mix coverage needs an authoritative per-row current flag applying the schema,
analyzer-version and unchanged-source rules. An available stored profile alone does not prove
it is current. Bliss availability reports a stored nonempty vector; it does not imply freshness.
Feature-disabled Smart Mix must not appear as zero coverage. Diego approved this extension and
it is implemented in [Artist summary metrics](./2026-10-24-artist-summary-metrics.md).

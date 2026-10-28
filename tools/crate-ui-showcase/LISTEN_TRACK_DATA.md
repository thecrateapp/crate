# Listen track data and Stats drift — review checkpoint

21 October 2026. Worktree `crate-v3-1q/crate`, branch `feat/crate_v3`, based on
Claude's Stats merge `f90151ed`. Approved by Diego for commit and push. No deployment.
Native chrome work remains parked while this web correction is reviewed.

- Listen: <http://127.0.0.1:5174/>, using <https://api.lespedants.org>.
- Track data preview: <http://127.0.0.1:5186/review-1be-track-data.html>.
- Storybook: <http://127.0.0.1:6006/?path=/story/reviews-1be-track-data--complete>.
- Stats preview: <http://127.0.0.1:5186/review-1be-stats-drift.html>.
- Stats Storybook: <http://127.0.0.1:6006/?path=/story/reviews-1be-stats-drift--complete>.

## Contract

Every track-list source preserves format, bitrate, sample rate, bit depth, duration,
BPM, key and scale. `TrackMediaMetadata` documents the nullable wire fields;
`toPlayableTrack` and `toTrackRowData` own their normalization into player and row data.
`TrackMediaFieldsMixin` declares the API fields rather than depending on permissive extras.
Unknown values remain unknown. Quality is never inferred from an album or another track.
Legacy bps and catalog kbps normalize to kbps at the app boundary; the common quality
formatter also accepts both so pure views cannot diverge.

TrackRowContent retains the approved Caspian order: quality → BPM/key → duration → like
→ menu. Missing values reserve the same slots. Content-container thresholds protect the
identity: quality at 640 px, analysis at 800 px. Responsive visibility does not discard
data, and duration remains available on narrow rows. No runtime consumer suppresses the
duration. Offline's pure row uses the same quality and analysis formatters.

## Source audit

| Source / consumers                                | Data boundary and correction                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Album and artist track lists                      | Album row/player adapters already preserve the technical fields. Selected-album actions now preserve them too. Artist canonical mapper remains in use. Go Top tracks now selects and serializes depth/rate/bitrate.                                                                                                                                                               |
| Home recommendations, DNA, sections and playlists | Existing canonical mapper preserves the full Home payload. Replay's SQL now includes source quality/duration, and Replay no longer hides duration.                                                                                                                                                                                                                                |
| Search, Explore, global search and CatalogSearch  | Local SQL includes rate/depth and its final serializer retains quality and analysis. Explore uses the canonical mapper. Go's local search no longer overwrites real analysis with nulls. Global documents retain local or preferred healthy-source metadata; compatibility SQL and Go match that contract. CatalogSearch retains the original typed result as its selection data. |
| User and curated playlists                        | Existing row/player mapping spreads full source data. Detail SQL now selects quality and resolves a global-only entry through its canonical local track, with preferred-source fallback.                                                                                                                                                                                          |
| Liked tracks                                      | Both union branches retain quality. Canonical entries can read available source metadata when there is no local file.                                                                                                                                                                                                                                                             |
| Crates                                            | Playback query returns technical metadata; app adapters preserve it when placing tracks into the player queue.                                                                                                                                                                                                                                                                    |
| Paths                                             | Canonical row mapper replaces the hand-picked object. Candidate queries and both path builders preserve quality/duration. Saved-path SQL reads current metadata in one statement without recomputing or reordering the route. The acoustic-distance debug value under the artist is removed.                                                                                      |
| Radio and similar/suggested tracks                | Existing reference batch lookup now carries technical metadata. Radio engine payloads and shaped-radio player mapping retain it. Suggested rows use the same canonical controller.                                                                                                                                                                                                |
| Player queue, restored queue and Jam              | Queue uses the row mapper and displays duration. Full metadata survives persistence and Jam normalization; regression tests cover both.                                                                                                                                                                                                                                           |
| Offline                                           | Manifest, local snapshot type, player conversion and pure row preserve BPM/key alongside quality/duration. Cached source data works without a network lookup.                                                                                                                                                                                                                     |
| Stats overview, rankings and explorer             | Period, month, instance and range SQL retain source quality/duration. Dashboard/range rows use the common mapper/controller; orphaned historical entries keep their count but cannot play a deleted ID.                                                                                                                                                                           |

All changes use existing bounded queries/joins or the existing reference batch lookup;
there is no metadata request per row, no HTTP snapshot rebuild and no library write.
Preferred-source fields describe the track's source, not a delivery/transcode variant.

## Stats presentation and compatibility

Top tracks and Top artists use full-width panels. The artist ranking includes #1 even
when repeated in the hero, as Diego requested, and retains the two-column card grid.
Movement counts use actual uppercase MonoLabel. Explorer rows use the canonical controller
for playable tracks and the same pure composition for non-playable historical entries.

A server lacking the range endpoint shows an explicit unavailable message. Capability is
scoped to account/server and is not retried for every stretch; authentication/network
errors remain distinct. The seven locales contain the new message.

## Verification and deployment boundary

The local source is verified, but Listen's live instance still uses the existing production
API. On `/paths/30` the distance readout is already absent; that server still omits quality
and duration from the saved path response. The missing fields cannot appear live until the
backend/readplane changes are deployed. Existing global search documents and Home/Stats
snapshots acquire the added fields on their normal projector refresh/rebuild. This change
does not deploy or trigger a production rebuild. Existing offline snapshots without analysis
remain unknown until their manifests are synchronized again.

The standalone/Storybook data scene uses explicit fixtures and local callbacks. It proves
row presentation, not that production has received the new API contract. The live check
preserved playback, queue, account and library state.

Validation for this checkpoint:

- Backend: 274 passing PostgreSQL/contract tests, including local and preferred-source-only
  track round trips, saved paths, playlist/global resolution, Crates, Stats periods and schemas.
- Listen: 143 focused metadata/player cases and 279 Stats/consumer/policy cases passing
  in separate runs (overlapping suites are not an additive total).
- Desktop: 54 passing tests; no active native-source changes in this cut.
- Go catalog/contract tests and catalog vet pass.
- Listen, Desktop and Storybook typechecks, Listen ESLint and pinned Ruff pass.
- Browser: all 28 unique review cases pass across the two runs (23 initially; the four
  new metadata cases and four Paths cases pass after correcting a test selector and a
  cold Storybook module fetch). Covers 375/640/760/900/1200 px, fixed columns, long titles,
  local actions, unknown data and existing Paths motion/keyboard behavior.
- Listen and Storybook builds pass; initial JS is 219,959 gzip bytes against 307,200.
- Catalogue remains 78 documented / 93 entries. Only the documented fundamentals entry
  was refreshed for the shared container thresholds; pending fingerprints are untouched.

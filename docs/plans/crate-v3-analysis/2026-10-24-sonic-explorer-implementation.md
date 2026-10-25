# Sonic Explorer Implementation Plan

> **For agentic workers:** use superpowers:subagent-driven-development for the bounded backend,
> frontend and integration tasks below. The user approved the preceding collection/listening map
> proposal and explicitly requested implementation. No further approval checkpoint is needed.

**Goal:** extend Insights with exact sonic regions for tempo/energy and tempo/LUFS, persistent
track readings, and actual Bliss neighbors.

**Architecture:** extend the existing worker-built Collection Insights snapshot additively with a
bounded `sonic` report. Reuse its population, UID/ID/path resolution, listening window, cache,
refresh task, projector and stale/error handling. A separate bounded Admin query reads neighbors
through the existing pgvector cosine index; it never aggregates the catalogue in HTTP.

**Tech stack:** existing FastAPI/Pydantic, PostgreSQL/pgvector, React, Nivo and Crate instruments.
**Spec:** Diego's approved proposal in this chat, 2026-10-24: two sonic planes; collection versus
listening; Full and Partial by valid fields; persistent reading and Bliss neighbors; no 2D Bliss
projection, reanalysis of audio, new dependencies or unrelated pane changes.

## Global constraints

- Work only in this worktree (`feat/crate_v3`), local stack Admin5175, no production access.
- No commits/push unless separately requested; previous Stack Git request is complete.
- Use the same eligible non-quarantined indexed local population as Collection Insights.
- Never coalesce legacy energy/loudness into Smart Mix energy or measured LUFS.
- Current profiles: profile_version=PROFILE_SCHEMA_VERSION, analyzer_version=ANALYZER_VERSION,
  source_stale_at IS NULL; Full and Partial allowed. Field values must be finite and in range.
- Tempo >0 and <1000, energy0..1; LUFS only with measurement_version=MEASUREMENT_VERSION.
- Do not gate sonic exploration by Smart Mix server capability; these are stored measurements.
- Counts refer to unique tracks; listening shares use unique heard tracks, not plays/minutes.
- Both planes use the same catalogue-derived tempo domain across all periods. No jitter or
  period-dependent scaling. All finite valid values fit; domains are explicitly supplied.
- Unknown measurements remain null and uncovered; no zero imputation. Provide pair-specific
  catalogue and heard coverage with the complete denominators from the collection report.
- Exact population counts per region; deterministic bounded examples, never first500 scatter.
- UI uses existing InstrumentPanel, MonoLabel, InstrumentChart theme/point/readout/legend,
  MediaCover, Meter and controls. No shared foundation edits or decorative icons/native titles.
- Grey catalogue context, accent heard cohort and stronger pinned selection; no warning palette
  for normal taste differences. Hover previews, click/tap pins, keyboard selects; mobile stacks.

## Binding contract

Existing `GET /api/admin/collection-insights` response gains optional `sonic: SonicReport|null`.
Older warm snapshots without sonic remain readable; a visible refresh affordance handles them.

```
SonicReport = {
  version: 1,
  source: {analyzer_version: string, profile_version: number, measurement_version: string},
  planes: SonicPlane[]
}
SonicPlane = {
  key: 'tempo_energy'|'tempo_lufs',
  x: {label:string, unit:string, min:number, max:number, bins:number},
  y: {label:string, unit:string, min:number, max:number, bins:number},
  coverage: {catalogue_tracks:number, paired_tracks:number,
             heard_tracks:number, paired_heard_tracks:number},
  cells: SonicCell[]
}
SonicCell = {
  id:string, column:number, row:number,
  x_min:number, x_max:number, y_min:number, y_max:number,
  tracks:number, albums:number, heard_tracks:number, heard_albums:number,
  plays:number, minutes:number, catalogue_share:number, listening_share:number,
  examples:SonicTrack[]
}
SonicTrack = {
  id:number, entity_uid:string|null, title:string,
  album_id:number, album_entity_uid:string|null, album:string, album_slug:string|null,
  artist:string, artist_slug:string|null, year:string|null, has_cover:boolean,
  heard:boolean, plays:number, minutes:number,
  bpm:number|null, bpm_confidence:number|null, energy:number|null,
  integrated_lufs:number|null, true_peak_dbfs:number|null,
  key_camelot:string|null, key_confidence:number|null, tempo_stability:number|null,
  quality:string|null, has_bliss:boolean,
  acousticness:number|null, instrumentalness:number|null, valence:number|null
}
```

Plane bounds: tempo starts0, max is at least200 and rounded up to a multiple20 for all valid
current-profile tempos; energy0..1; LUFS minimum rounded down to a multiple5 and at most-10,
maximum rounded up to a multiple5 and at least0. bins=10 horizontally and8 vertically. Clamp
exact maximum into last bin. Only occupied cells emitted, sorted by column/row. Shares are
0..100 within each plane's paired populations. All cells together reconcile with coverage.

Examples: up to6 per cell, deterministic by IDs, preferring a mix of heard and not-heard tracks
and different albums. State explicitly that these are examples of the full counted region.
Legacy acousticness/instrumentalness/valence may appear only as estimated secondary traits,
not as alternate map coordinates and never as measured probability.

New bounded read:
`GET /api/admin/collection-insights/sonic-neighbors/{track_id}?window=30d&limit=6`
guard library.view; track_id>0, window30d|90d|365d, limit1..12. Noneligible seed returns404.
Missing/invalid Bliss returns available=false, not an empty successful similarity claim.

```
SonicNeighbors = {
  seed_track_id:number, available:boolean,
  items: [{track:SonicTrack, distance:number}]
}
```

Distances are finite cosine distances, not compatibility percentages. Exclude seed/quarantine,
limit before projected-listening lookup, no filesystem checks. One composed read transaction;
no catalogue COUNT/SUM/AVG or N+1. Identity resolution of the bounded neighbor set follows the
same UID/ID/path precedence as the snapshot. Allow cancel/retry and reject obsolete responses.

## Review focus

1. Missing/stale/legacy profiles and Partial values never silently change the plane's source.
2. Coincident/max-boundary values count once; cells/shares/coverage reconcile, including no listens.
3. Window changes cannot show old selected-track neighbors or mix period denominators.
4. Zero/invalid vectors, quarantine, homonymous tracks and remote events keep identity correct.
5. Touch/keyboard selection and bounded region examples remain useful at320px; no hover-only data.

## Task 1: Worker report and data tests — backend implementer

Files: modify `db/queries/collection_insights_sql.py`, `collection_insights.py`; create focused
`db/queries/sonic_insights.py` aggregation helper and `tests/test_sonic_insights.py`.
Own only these paths. Extend the existing SELECT with only necessary scalar fields (never
beat_grid_data/vector bytes), reusing resolved track rows and normalized listening values.
Public helper `build_sonic_insights(tracks: list[dict]) -> dict`; collection builder emits sonic.

- [x] Write failing pure and PostgreSQL tests for valid Partial/current/stale/version/unit
      boundaries, LUFS provenance, null/NaN/Infinity, exact bins/coverage/shares, stable examples.
- [x] Implement exact planes and bounded diverse track readings; retain existing report fields.
- [x] Run focused new tests plus existing collection builder tests, Ruff; no full suite.

## Task 2: Admin sonic view — frontend implementer

Files: create `components/insights/InsightSonicExplorer.tsx`, focused child/model/hook files and
tests as needed; extend `insights-model.ts`, `pages/Insights.tsx` and its test only as needed.
Own only these paths. Consume the exact payload above. Root owns source-policy additions.

- [x] Write failing tests for plane/pair coverage, catalogue/heard/contrast controls, persistent
      region and sample-track selection, empty/missing report, source labels, real entity links.
- [x] Implement the section at the end of current Insights using shared instruments and Nivo
      statistical geometry. Cell measures are exact; size encodes shares with explicit legend.
      Supply one keyboard map control or accessible cell controls plus touch-safe pointer mapping.
- [x] Add neighbor loading/empty/unavailable/error/retry with period-scoped response ownership.
- [x] Run focused Vitest and typecheck/lint with at most2workers. No full suite or shared changes.

## Task 3: Schemas, bounded neighbors and integration — controller

Files: new API schema and query `sonic_insights.py`/`sonic_neighbors.py`, analytics route,
schemas exports, `test_sonic_neighbors.py`, source policy and browser fixture test.

- [x] Add additive typed response schemas and authenticated bounded endpoint with tests for
      auth, OpenAPI, seed availability, identity, null traits, cosine ordering and no aggregation.
- [x] Build one-query indexed neighbor retrieval plus bounded current-period listening lookup.
- [x] Verify cached older collection response remains usable and new report schema validates.
- [x] Add response-level/browser checks at1440/390/320px; no real playback/worker mutation.

## Task 4: Independent review and real local proof — controller/reviewer

- [x] Review complete contract, identity, units, geometry and async flows independently.
- [x] Resolve findings, run focused checks; then full Admin suite once after source stable,
      integrated backend boundary/runtime checks, production build and lint.
- [x] Restart only local API/needed worker; warm the updated report via its worker handler and
      inspect local real data, both planes, region/track selection and Bliss neighbors.
- [x] Save screenshot and final evidence. No commit/push unless user requests it.

## Verification and review record

- Backend: 150 focused and architecture tests pass in the worker container. The five local
  catalogue/auth boundary tests also pass on the host in a clean process. This includes
  22 new sonic aggregation tests and six neighbor/API/schema tests.
- Frontend: 53 focused Vitest tests and five browser checks pass. Browser coverage includes
  1440, 390 and 320px layouts, real Nivo geometry, keyboard/pointer/touch selection,
  plane/cohort controls, neighbor retry, missing vectors, obsolete responses and entity links.
- Independent review found two P2 issues: fractional bin labels lost precision and ghost
  plane/cohort controls lacked a visible active state. Both are corrected and rereviewed:
  exact three-decimal boundaries and the shared SegmentedControl. A final review also confirms
  that the default region prioritizes heard tracks, explicit selections survive refreshes and
  small positive shares display <0.1% instead of zero.
- The real local 30d report validates against SonicReport and CollectionInsightsResponse:
  136,462 catalogue tracks, 10,814 albums and 948 heard tracks. Tempo/energy has 135,637 paired
  tracks (934 heard) in 44 regions. Tempo/LUFS has 133,429 (927 heard) in 37 regions. Counts and
  shares reconcile. Domains are 0–320 BPM and -70–5 LUFS.
- Real worker build: 27.56s. The response is 334,554 bytes, including 285,320 bytes of bounded
  sonic data. This work stays outside HTTP; no vector blobs or beat grids enter the report.
- The local dump lacked the library cosine HNSW index from shipped migration 027. Restored that
  exact index CONCURRENTLY: 47 MB, valid and ready. Actual plans use it and materialize at most
  six/twelve candidates before period attribution. Normal reads take 9–11ms (30d) and 19–38ms
  (365d). No new migration or governor threshold changes. Index results are approximate;
  the UI claims sound similarity, not mixing compatibility.
- Local API and maintenance worker restarted. All three periods were warmed through the
  existing worker handler. Actual 30d/90d UI checks verified plane switching, region selection,
  track readings and populated Bliss neighbors. No audio reanalysis or production access.
- A combined container guard run exposed two test-environment issues: frontend sources are
  not mounted in that worker, and an existing auth cache test is order sensitive. Host checks
  pass; the final 150-test container run places auth checks first. No unrelated auth or Browse
  implementation changed.
- One full Admin run overlapped the last UI polish and mixed pre-edit module transforms with
  updated regression assertions. All 209 unrelated suites passed. Focused final tests pass;
  the final frozen-source run passes all 210 suites and 2,173 tests.
- TypeScript, ESLint, Ruff and production build pass. The build retains the existing large
  chunk warning. Generated tsconfig.tsbuildinfo was restored.
- Proof: `/tmp/crate-sonic-real-final-oct24.png`; responsive fixtures:
  `/tmp/crate-sonic-insights-{1440,390,320}-oct24.png`. Performance plans and the validated
  report are saved under `/tmp/crate-sonic-perf-*.json` and `/tmp/sonic-real-report.json`.

No commit or push is included in this feature request.

Final validation: 210 Admin suites / 2,173 tests, 150 backend guards and feature tests,
five host boundary checks and five responsive browser tests pass. Production build,
TypeScript, ESLint, Ruff and git diff checks pass. Independent review has no open findings.

## Follow-up: Insights spacing and tabs

User requested canonical spacing for Track reading / Sound nearby, secondary navigation
buttons, a related drift pass and tabs to reduce the long Insights page.

- Reused the existing shared Tabs composition from Listen Settings. Listening contains the
  summary, pulse and artist changes; Collection contains the comparison and opportunities;
  Sonic explorer contains the sonic maps and readings. Period, provenance and refresh remain
  common. Inactive panes are hidden, lazily mounted on first visit and retained afterward so
  selections survive tab switches. Hidden sonic panes cancel neighbor requests.
- Fixed the spacing cause locally: MonoLabel's explicit m-0 overrode margin-based space-y
  stacks. Shared InstrumentPanel headers/descriptions and flex/grid gap now own spacing in
  readings, source metadata, examples, summary and common provenance. First tab sections
  omit the extra top rule, avoiding a duplicate divider under the shared tab list.
- Open album / artist / Discovery / Analysis and Explore genre now use secondary Button
  compositions with native router-link semantics. The comparison dimension uses the shared
  SegmentedControl. Rich entity and example rows use HairlineRow asChild without duplicated
  row padding or title truncation.
- Independent review's remaining row-composition finding was fixed and rereviewed. No open
  findings remain. Focused verification: 101 Vitest tests and eight browser tests pass.
  Browser coverage includes 1440/390/320px, actual heading-to-content gaps of at least 16px,
  secondary variants, tab selection retention, keyboard/touch selection, lazy neighbor reads,
  obsolete responses, recovery states and overflow. TypeScript, ESLint, build and diff checks
  pass; no new backend behavior or shared foundation variants were introduced.
- Real local data was checked again after warming the 30d snapshot through the existing worker
  handler. Final proof: /tmp/crate-insights-tabs-final-oct24.png. Logs:
  /tmp/crate-insights-tabs-unit-final.log, /tmp/crate-insights-tabs-browser-final.log,
  /tmp/crate-insights-tabs-lint-final.log and /tmp/crate-insights-tabs-build-final.log.

No commit or push was requested for this follow-up.

# Collection Insights implementation plan

Goal: implement the approved collection-versus-listening approach, deferring the sonic explorer.
Spec: `2026-10-24-insights-reanalysis.md`, approved by Diego on 2026-10-24.
Architecture: a versioned stale-first snapshot built on the maintenance worker from local catalogue
and instance daily projections; HTTP reads only the snapshot. React consumes the report with the
same instrument language as Artist Stats/System Health. Existing `/api/insights` remains compatible
for Discovery. No production access, dependency, migration, shared foundation or Genres changes.

## Contract (binding for backend and UI)

`GET /api/admin/collection-insights?window=30d` (`30d|90d|365d`, library.view).
`fresh=true` schedules a deduplicated refresh and still returns cached/cold data.
Snapshot scope `admin:collection-insights`, subject `v1:{window}`. Cold response: ready=false,
empty arrays, nullable period/history/readings, snapshot.missing=true. Freshness five minutes;
retain stale reports beyond a day while refresh is unavailable. No automatic polling loop.

Builder `build_collection_insights(window='30d', *, today=None, session=None) -> dict` in
`app/crate/db/queries/collection_insights.py`. Only worker calls the builder. All reads use one
read_scope with session passed down. Session can be supplied by tests.

Payload keys (numbers finite, counts nonnegative):

```
ready: boolean
window: '30d'|'90d'|'365d'
period: {start,end,previous_start,previous_end,history_start:null|string,
         calendar:'listener_local_days',previous_complete:boolean,history_complete:boolean}
catalogue: {tracks:number, albums:number}
current: {plays,minutes,tracks,albums,concentration_pct:null|number}
previous: same as current
excluded: {plays,minutes} // unmatched/remote/ineligible plays in selected period
timeline: [{day:string,minutes:number,previous_minutes:number}]
genres: Comparison[]
decades: Comparison[]
rising: ArtistChange[]
falling: ArtistChange[]
unheard: {total:number,items:Album[]}
rediscover: {total:number,items:Album[]}
improvements: [{key:'full'|'bliss',tracks:number,minutes:number,albums:Album[]}]
snapshot: standard decorated snapshot metadata + optional task_id:string|null
          (surface adds it, builder does not)

Album={id:number,entity_uid:null|string,slug:null|string,title:string,artist:string,
       artist_slug:null|string,year:null|string,has_cover:boolean,
       tracks:number,played_tracks:number,minutes:number,last_day:null|string}
ArtistChange={id:number,entity_uid:null|string,slug:null|string,name:string,has_photo:boolean,
              current_minutes:number,previous_minutes:number,delta_minutes:number}
Comparison={key:string,label:string,genre_slug:null|string,tracks:number,albums:number,
            played_tracks:number,plays:number,minutes:number,catalogue_share:number,
            listening_share:number,previous_listening_share:number,examples:Album[]}
```

## Global constraints / semantic rulings

- Population: indexed local tracks with indexed non-quarantined albums and artist; resolve daily
  identity by UID first, then local ID, then exact path only when no stronger matching identity.
  Never merge by artist/title/album strings. Do not fall back from a mismatching non-null UID to ID.
- All-time last-listened and unheard derive from the complete projection history, not only window.
- If known instance backfill is missing, history_complete=false suppresses unheard/rediscover
  claims independently of previous_complete. A short complete history still supports those lists.
- End day=today, start=today-(days-1), previous end=start-1. Calendar remains listener-local
  reported days, visibly labelled; do not claim a UTC listening calendar. All daily series filled.
- Hours are registered time, not proof of completion. Local current inventory is denominator for
  both periods. No prior comparison if full previous window predates recorded history.
- Per canonical genre assign each track equally across its distinct mapped canonical genres;
  exclude facets, fall back album_genres then artist_genres if needed, unknown separate.
  Do not multiply counts or minutes due to taxonomy joins. Decades unknown separately.
- Shares 0..100 use effective fractional catalogue/plays counts; raw track/album counts remain
  distinct membership counts. Denominators and fractional attribution described beside chart.
- Concentration is top ten artists ordered by minutes / all matched minutes; null if zero time.
- Full eligibility uses current schema/analyzer/version/source-stale predicate already used in
  Artist Stats. Bliss is stored nonempty vector, not a freshness promise. Improvement albums only
  include affected listened tracks. UI hides Full opportunity if Smart Mix is disabled/unknown.
- Server availability is the existing capabilities.smart_mix.available===true contract.
- Changes sorted by absolute delta; new activity not +infinity. Lists max6, comparison categories
  bounded to24+unknown, samples max3, movers max6 per side. No endpoint from tooltip-only data.
- No new automatic mutations or audio/library writes. Enrichment/repair actions remain elsewhere.
- Shared primitives and instrument theme, open layout, 4/2 summary grid, sparse meaningful icons.
- Focus/tap persistent readings; preserve selection across refresh, reset coherently across window.
- Missing/cold/error/stale/empty/zero have distinct states and no invented data.

## Review focus

1. Identity aliases, homonymous albums, quarantine and remote/unmatched events stay correct.
2. Multi-genre joins do not multiply time/counts; unknown metadata remains visible.
3. Prior window with incomplete history never produces misleading deltas.
4. HTTP cold/stale/fresh reads never execute catalogue aggregates; refresh is truly worker-routed.
5. Narrow layout, touch/keyboard selection, overlapping chart points and refresh recovery work.

## Tasks

### 1. Read model and behavioral tests — backend implementer

Files: new `db/queries/collection_insights.py` (+ focused helper modules if needed),
`tests/test_collection_insights.py`. Own only these paths. Use existing schema/projections,
taxonomy mappings, canonical smart-mix constants. No new migration. Test PostgreSQL fixtures for
identity, shares, quarantine, current/previous, unheard/rediscover, Full/Bliss eligibility.

- [x] Write meaningful failing fixture tests.
- [x] Build bounded report in one composed read transaction using batched/CTE reads.
- [x] Run focused tests and lint; report exact commands/results.

### 2. Snapshot/API/runtime integration — controller

Files: new `db/collection_insights_surface.py`, `api/schemas/collection_insights.py`,
analytics router, worker analysis handler/registry/actor config, task registry, projector,
focused API/surface/runtime tests and OpenAPI registration. Snapshot getter schedules missing,
stale and explicit refresh; returns current stale/cold report immediately. Worker builds/saves.
Projector debounces refresh on relevant catalogue/listening/analysis changes; demand refresh
guarantees eventual freshness. No full API rebuild or new periodic poll.

- [x] Test cache-only reads, cold/stale/error scheduling, validation, auth and worker routing.
- [x] Implement surface, schema, route and task integration.
- [x] Run scoped tests/boundary checks.

### 3. UI — frontend implementer

Files: `pages/Insights.tsx/.test.tsx`, new `components/insights/*` TS model/charts/components/tests.
Own only these paths; no shared/source-policy edits without asking controller to integrate.
Consume exact contract above. Header common, period Select, shared refresh icon+tooltip.
4-number open band; main genre/decade comparison thin rails/endpoints; persistent reading with
album covers and real routes; time trace with prior and keyboard/touch day reading; aligned
artist changes lists; unheard/rediscover and readiness opportunities with canonical entity links.
No sonic explorer or irrelevant categorical header pills. Preserve old InsightsData export as
Discover imports it until migrated separately. Use instrument theme/primitives, no duplicate
foundation styles. Root registers any actual SVG/action sites in existing policy if needed.

- [x] Write loading/cold/zero/error/stale/window/selection/metadata/route behavior tests.
- [x] Implement responsive view with current shared controls/theme and no native title tooltips.
- [x] Run focused Vitest/typecheck/lint, cap workers to2. Do not run full suite independently.

### 4. Integrated review and local proof — controller + independent reviewer

- [x] Review backend semantics, frontend contract and exact cache/task flow independently.
- [x] Resolve findings and verify focused checks; run full Admin suite only after source is stable.
- [x] Restart only necessary local API/workers, build the snapshot locally through worker task.
- [x] Inspect actual report/Insights in browser desktop/mobile; fix any runtime/layout issues.
- [x] Record final evidence and screenshot; no commit/push unless requested.

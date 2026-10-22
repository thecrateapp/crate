# Crate v3: Admin app audit (`app/ui`)

Date: 2026-10-14
Status: historical analysis for `feat/crate_v3`, not a current implementation status or backlog.
The current route reconciliation is in [`coverage.md` §10](coverage.md#10-admin-inventory-reconciliation--2026-10-21)
and the [Admin continuation plan](../2026-10-21-crate-v3-admin-continuation.md). Visual reference
for the original pass was the new site only (`worktrees/website/app/web`). Paths were relative to
the `crate-v3` worktree unless prefixed with `site:`. Companion docs in this folder:
`site-language.md` (tokens, SVG recipes, motion), `genres.md` (wheel and EQ inheritance in depth),
`v3-state.md` (what the branch already ships).

---

## 0. TL;DR

- The admin has 34 routes (32 inside the Shell) over 32 page files. Two page files are orphans
  (`pages/Shows.tsx`, `pages/Profile.tsx`: not imported anywhere). `artists/:artistId/:slug`
  (Artist) has the same shape as `artists/:artistSlug/:albumSlug` (Album), so it is most likely
  shadowed. Verify.
- No page looks like the site yet. The only v3 surface in admin is `GenreEqEditor` (EqBands,
  `MonoLabel`, `StatusDot`). Across `app/ui/src` there are 0 uses of `font-display`,
  `accent-action-hi`, `ease-snap` or spring tokens, and 0 `motion-reduce` variants. There are 100
  arbitrary `shadow-[…]`, 42 `backdrop-blur`, 466 `rounded-md`, 398 emerald/green/red/rose
  classes, 284 amber/yellow/orange, 63 violet/fuchsia/blue/sky and 91 hand-rolled
  `tracking-[0.xxem]` values.
- The site's seven /admin chapters map onto existing pages, but not one to one. Health, Genres,
  Analysis & Insights and Operations have a page and enough real data for the site visual today
  (Operations needs one backend addition for the governor). Acquisition needs a data link between
  `new_releases` and the task, album and analysis. Imports and Enrichment have no page:
  `/api/imports/*` has no UI at all, and per-source enrichment freshness is not exposed.
- Realtime is solid at the core (`OpsSnapshotContext` keeps one `ops-stream` SSE per tab, and
  health, tasks, logs and stack each have their own snapshot+SSE pair). There are four problems
  to fix before adding "live instruments":
  1. `/tasks` opens one `EventSource` per running **and pending** task (`ActiveTaskCard` →
     `useTaskEvents(task.id)`).
  2. `?fresh=1` rebuilds a snapshot inside the HTTP request (`get_or_build_ui_snapshot`). The
     admin fires it on every window focus, `visibilitychange` and `online` event. For `ops` that
     runs `COUNT/SUM/AVG` over `library_tracks`.
  3. `/system` (`SystemHealth`) is a one-shot fetch with no live updates. `/users` presence has
     no live updates either.
  4. Every page re-implements the EventSource reconnect loop (6 copies).
- Backend preconditions that break repo rules today: `/api/insights` runs 10+ separate
  `read_scope()` queries with `COUNT`/`SUM` over `library_tracks` per request, and `/discover`
  calls it too. `/api/genres/taxonomy/tree` aggregates per request. `/api/admin/metrics/dashboard`
  evaluates the resource governor inline (50 ms `time.sleep` plus two DB counts) and does not
  return its thresholds.
- Charts: Nivo is used on 3 pages and 3 components (bar, pie, line, radar, scatterplot), each
  with its own inline theme. `@nivo/bump|chord|geo|heatmap|network` and `gl-matrix` are installed
  but unused in admin. Non-Nivo visuals: `react-force-graph-2d` (genre and artist networks),
  `react-leaflet` (user map) and `react-konva` (hero composition).
- Before the per-screen work, decide two things (section 12): where the bespoke SVG instruments
  live (admin-only or `@crate/ui`), and whether they count as "charts" under the Nivo-only rule.

---

## 1. What "looks like the site" means for an admin screen

Distilled from `site:src/components/viz/*.astro`, `site:src/styles/base.css` and
`site:src/scripts/viz/*`. Full recipes are in `site-language.md`.

| Site trait | Recipe | Admin today |
| --- | --- | --- |
| Instrument panel | `<figure>` with a 1 px `--line` top border and no fill. A `viz-bar` header has a mono label (cyan-hi key word plus metadata) on the left and a status line on the right (`aria-live`). | `OpsPanel`/`Card`: filled `bg-panel-surface/90`, a 2-layer shadow, `backdrop-blur-xl`, a 40 px icon tile and a sentence-case `h2` |
| Big numerals | Cabinet Grotesk 800, `clamp(2.8rem,5.6vw,5.4rem)`, `line-height .85`, `-0.05em`, tabular | `OpsStatTile`: `text-xl font-semibold` plus a coloured icon tile |
| Numbered hairline rows | `01`… mono index, row divider `rgba(241,245,249,.06)`, `9px 0` padding, name in sans 14/500, meta in mono 10.5 | Bordered rounded boxes (`border-white/8 bg-white/[0.04] px-3 py-3`) nested in cards |
| Chips | Pill, hairline border, mono 11, `aria-pressed` active = solid cyan-hi with dark text, spring scale on press | `CratePill`/`CrateChip` (already restyled in v3), raw shadcn `Badge`, many ad-hoc tone pills |
| Status colour | Cyan-hi = done/ok/auto. Amber = waiting/confirm/governed. No green or red. | Emerald/green = ok, red = error/destructive, orange/yellow = severity, violet/fuchsia = scope |
| Risk | 3-segment meter (`l1..l3`) plus a mono label | Coloured badge per risk (emerald, amber or red fill) |
| Motion | rAF loop only while visible (`visibleLoop`, IntersectionObserver plus `visibilitychange`), springs (`stepSpring`, `--spring-snappy`), `ease-snap` transitions. Reduced motion renders the final state. | `animate-page-in`, `transition-colors`, 169 `animate-spin|pulse`. No reduced-motion handling. |
| Section heading | `eyebrow` (`01 / Health`, mono 11.5, `.16em`) plus `display` title (Cabinet 800, `-0.045em`, `.9`) | `OpsPageHero` (icon tile with a cyan glow, `text-2xl font-semibold`), or raw `h1` with 6 different recipes |

The site's instruments are driven by data attributes and tested pure-TS math
(`taxonomy-math.ts`, `pool-math.ts`, `governor-math.ts`, `eq-math.ts`, `heatmap-math.ts`). For the
product, port the math as is and swap the synthetic inputs (`site:src/content/admin/viz.ts`) for API
payloads.

---

## 2. Layout shell

Files: `src/App.tsx`, `src/components/layout/{Shell,Sidebar,SearchBar,CommandPalette}.tsx`,
`src/contexts/{AuthContext,OpsSnapshotContext}.tsx`, `src/hooks/use-notifications.ts`,
`src/index.css`, `index.html` (`data-surface="glass"`).

**Today**

- Route tree: `BrowserRouter > AuthProvider > TooltipProvider > SetupGuard > Suspense > Routes`.
  The protected tree is `ProtectedRoute > LLMStatusProvider > OpsSnapshotProvider > Shell`. Every
  route is lazy, with a `CapabilityRoute` per route. `AdminIndex` sends the user to Dashboard or
  to the first surface their capabilities allow (`/tasks`, `/stack`, `/logs`, `/system`,
  `/browse`). `SetupGuard` calls `/api/setup/status` on boot.
- Sidebar (`Sidebar.tsx`, 558 lines): fixed, 240 px or 72 px collapsed (persisted in
  localStorage plus a custom event). Sections:
  - (none): Dashboard, Browse, Discovery
  - **Tools**: Library Health (`issue_count` badge), Library Trash, Contributions
  - **Music**: Upcoming, New Releases, Bandcamp, System Playlists, Acquisition
  - **Insights**: Insights, Genres, Timeline
  - **System**: System Health, Analysis, Tasks (`running_tasks` badge), Logs, Stack, Users,
    Roles, Translations, Settings, Federation, Global Catalog

  Section labels are `text-[10px] font-bold uppercase tracking-[0.18em] text-white/25`. The
  active item is `bg-white/10 text-primary`. Badges come from `useOpsSnapshot().status`. The
  footer holds a "Preview as" role switcher (`AdminSelect`) and the user card.
- Header: fixed, `h-16`, `bg-app-surface/68 backdrop-blur-xl`. Back and forward buttons are
  `bg-black/30` with a shadow. `SearchBar` is on the right. There is no page title or breadcrumb.
  Mobile gets a separate top bar plus a `Sheet` sidebar.
- Main: `max-w-[1880px]`. A `key={pathname}` wrapper with `animate-page-in` gives each page a
  transition. Artist and album routes use an overlay header (no top padding).
- Global: `CommandPalette` (Cmd+K: search plus capability-gated pages and task actions from
  `/api/admin/task-catalog`), keyboard help dialog, `Toaster` (sonner, bottom-right, richColors).
  `useNotifications` asks for browser Notification permission through a toast after 3 s, then
  opens `/api/events` SSE.
- Auth: `/api/auth/me`, a 60 s heartbeat `setInterval` (`/api/auth/heartbeat`,
  `app_id: "admin-web"`), plus refresh on visibility and online events.

**Gap to the site**

- Chrome is "glass" (blur, translucent fills, shadows). The site is flat near-black with
  hairlines. The header has no title, so the page identity lives in each page's hero card.
  Proposal: hairline header with a mono breadcrumb (`ADMIN · 03 / HEALTH`, key word in cyan-hi),
  search kept, back and forward buttons as ghost icons without shadow.
- Sidebar labels should be `MonoLabel`. Active state: a 2 px cyan-hi bar (the site's
  `.scan-list li::before`) instead of a filled pill. Badges: mono tabular count with `StatusDot`
  (`warn` for issues, `on` for running) instead of shadcn `Badge`.
- The sidebar grouping does not follow the site's product story. Optional regrouping, to decide
  with Diego: Library (Browse, Discovery, Timeline) · Health (Health, Trash) · Imports (new
  Imports page, Contributions) · Acquisition (Acquisition, New releases, Upcoming, Bandcamp) ·
  Genres · Analysis & Insights (Analysis, Insights) · Operations (Tasks, System, Stack, Logs) ·
  Access (Users, Roles) · Federation (Federation, Global catalog) · Curation (System playlists,
  Translations) · Settings.
- `animate-page-in` should move to the v3 `ease-snap` / `ease-out-expo` and respect
  `data-crate-motion="reduced"`.

---

## 3. Realtime inventory

No React Query. Data goes through `useApi` (`shared/web/use-api.ts`: fetch on mount, `refetch()`,
abort, and a 503 `catalog_warming` retry) plus imperative `api()`.

| Mechanism | Where | Notes |
| --- | --- | --- |
| `/api/admin/ops-stream` SSE (full snapshot replacement on Redis pubsub `ops:dashboard`, 30 s heartbeat) | `OpsSnapshotContext`, one per tab, mounted for every Shell page when the user has any `ops.*` capability | Read by Sidebar badges, Dashboard, Analysis, Settings. **Backbone for live instruments.** |
| `/api/admin/ops-snapshot?fresh=1` | `OpsSnapshotContext.refresh(true)` on `focus`, `visibilitychange`, `online` (throttled 1.5 s per tab) | `fresh=1` skips the cache and calls `build_ops_snapshot_payload()` **inside the request**, including `COUNT/SUM/AVG` over `library_tracks` (`analytics_overview_distributions.py`). This breaks "never rebuild snapshots in a request". |
| `/api/admin/health-stream` + `/api/admin/health-snapshot` | `Health.tsx` | Reconnects 3 s. Also opens `tasks-stream?limit=40` and `useTaskEvents(activeTaskId)`. Up to 5 concurrent SSE on this page with ops-stream and notifications. |
| `/api/admin/tasks-stream?limit=100` + `tasks-snapshot` | `Tasks.tsx` | Plus **one `/api/events/task/{id}` per active task card** (running and pending), plus `setInterval(15 s)` polling `/api/admin/playback-delivery`. |
| `/api/admin/logs-stream?limit=100` | `Logs.tsx` | 5 s reconnect. |
| `/api/admin/stack-stream` | `Stack.tsx` | 3 s reconnect. |
| `/api/acquisition/stream` + `/api/acquisition/search/soulseek/{id}/stream` | `Download.tsx` | One more SSE per Soulseek search. |
| `/api/acquisition/new-releases/stream` | `NewReleases.tsx` | |
| `/api/admin/system-playlists/{id}/stream` | `PlaylistEditor.tsx` | No reconnect logic (relies on native EventSource retry). |
| `/api/events/task/{id}` via `useTaskEvents` / `waitForTask` (`lib/tasks.ts`) | Album (lyrics), Health, Tasks, Genres, Discover (`useTaskPoll`, which despite its name waits over SSE) | |
| `/api/events` via `useSse` | `useNotifications` (only when Notification permission is granted) | |
| `setInterval` | `AuthContext` heartbeat 60 s, `ScanProgress` 1 s clock, Tasks playback delivery 15 s | |
| None (one-shot) | SystemHealth, Insights, Timeline, Users, Roles, Federation, GlobalCatalog, Upcoming, Bandcamp, Browse, Genres | |

**Problems to fix before the v3 live visuals**

1. Per-task SSE fan-out on `/tasks`: with N pending tasks the tab holds N+2 streams. On HTTP/1.1
   the browser cap is 6 per origin, so the page stalls. QueueLanes must read from the ops
   snapshot (it already carries `live.running_tasks`, `pending_tasks` and `recent_tasks` with
   `pool`). Per-task streams should open only for the expanded task.
2. `fresh=1` must stop rebuilding in-request. Enqueue a deduplicated projector refresh and return
   the cached surface, or drop `fresh` from focus refreshes; ops-stream already pushes. Note that
   `get_or_build_ui_snapshot` also rebuilds in-request when the cached row is older than
   `max_age` (60 s for ops), including from the SSE generator. Several admin tabs on a cold
   projector produce a thundering herd.
3. Six copies of the same EventSource reconnect effect (OpsSnapshotContext, Health ×2, Tasks,
   Logs, Stack). Extract one `useSnapshotStream(url, onPayload)` hook (admin-local).
4. `/system` and `/users` presence need a push channel if they are to look like instruments. For
   the governor, see section 7.7.

---

## 4. Visual pattern inventory

- **Page hero**: `OpsPageHero` (`components/admin/ops-surfaces.tsx`), used by Dashboard,
  Analysis, Discover, Genres, Insights, Logs, NewReleases, Stack, SystemHealth and Tasks. It is
  re-implemented inline with the same markup in Health, Download and Settings. Other pages roll
  their own `h1`: Federation `text-xl font-semibold`, Roles `text-2xl font-semibold`, Timeline
  `text-2xl font-bold`, Contributions and Trash `text-3xl font-bold`, GlobalCatalog
  `text-3xl font-bold tracking-tight`, Bandcamp `text-4xl font-black`, PlaylistEditor
  `text-3xl font-semibold`.
- **Panels**: `OpsPanel` (icon tile plus title plus description plus border-b header). shadcn
  `Card` with `border-white/10 bg-black/20` (Dashboard has 12 `Card`s).
- **Stat tiles**: `OpsStatTile` with five tones (default, primary, success, warning, danger),
  each tone a coloured icon tile with a coloured glow shadow. Settings has its own `StatTile`,
  `Section`, `PanelCard` and a local `StatusDot` that collides by name with
  `@crate/ui/primitives/StatusDot`.
- **Dead duplicates**: `app/shared/ui/domain/stats/{OpsPageHero,OpsPanel,OpsStatTile}.tsx` are
  imported only by their own test. Admin uses its local copies. Delete the shared ones or make
  them the single v3 implementation. They are admin-only, so by the repo rule they should not
  live in `@crate/ui`.
- **Lists**: nested bordered boxes (`rounded-md border border-white/8 bg-white/[0.04] px-3 py-3`)
  inside cards inside panels. Three levels of fill is the main "card soup" gap against the
  site's single hairline list.
- **Empty states**: dashed boxes `border-dashed border-white/10 bg-white/[0.03]`.
- **Colour**: see TL;DR counts. The worst pages by non-cyan colour classes are Tasks (105),
  Health (79), Download (50), SystemHealth (44), Genres (43), Dashboard (41), Analysis (33),
  Users (33) and I18nReview (33).
- **Icons**: `lucide-react` in 77 files (the correct admin convention). The site uses no icons
  inside instruments; labels carry meaning. v3 should drop the icon tiles from panel and stat
  headers and keep icons on actions and navigation only.
- **v3 primitive adoption**: `MonoLabel` and `StatusDot` in `GenreEqEditor` only. `StatNumber`
  and `HairlineList` are not used. `CratePill` and `CrateChip` are used (already restyled).

---

## 5. Charts

| Where | Nivo | Data | Theme |
| --- | --- | --- | --- |
| `pages/Dashboard.tsx` (Advanced diagnostics) | `ResponsivePie` (formats), `ResponsiveBar` ×2 (decades, top genres) | ops snapshot `analytics`, `stats.top_genres` (precomputed) | Inline per chart |
| `pages/Insights.tsx` | `ResponsiveBar` ×9, `ResponsiveScatterPlot` ×2 (energy × danceability, depth × popularity) | `/api/insights` (per-request, see 9.1) | Local `NIVO_THEME`; colours `#06b6d4`, `#22d3ee`, `#67e8f9` |
| `pages/SystemHealth.tsx` | `ResponsiveLine` ×14 (`MetricChart`) | `/api/admin/metrics/dashboard` timeseries | Inline. Cyan plus amber series. |
| `components/artist/ArtistStats.tsx` | Pie, Bar, Radar | artist stats | Local `NIVO_THEME` |
| `components/album/AudioProfileCard.tsx` | Radar, Bar | album analysis | Local theme with grey `#6b7280` ticks |
| `components/album/TrackTable.tsx` | Radar per track | track features | |

Non-Nivo: `GenreNetworkGraph` and `ArtistNetworkGraph` use `react-force-graph-2d` with canvas
drawing. Its constants use sky `rgba(56,189,248)` and slate, not the cyan tokens. `UserMap` and
the orphan `Shows.tsx` use `react-leaflet` with a Carto basemap. `HeroCompositionCanvas` uses
`react-konva`.

**Gap / actions**

- Add one `nivoTheme` built from tokens (hairline grid `--color-border`, mono 10-11 px ticks in
  fg-3, cyan-hi crosshair, tooltip as a hairline card, no fill areas or a 0.08 area at most).
  Use it in all 6 files.
- The site uses no pies and no radars. Proposals: formats pie → a proportional hairline bar with
  mono legend. Radar per track → the TrackReadout feature bars (section 7.6). Keep Nivo for
  real distributions (BPM histogram, decades, scatter, line timeseries).
- Remove the unused deps `@nivo/bump`, `@nivo/chord`, `@nivo/geo`, `@nivo/heatmap`,
  `@nivo/network` and `gl-matrix` from `app/ui/package.json` after confirming with a build.
  `@solar-icons/react-perf` stays, because `@crate/ui/icons` needs it.
- The bespoke instruments (wheel, orbit, rails, lanes, gauges, risk meters) are SVG and DOM
  diagrams, not statistical charts. See open question 1.

---

## 6. Route inventory

Capability gates come from `App.tsx`. "Tests" means a page-level `*.test.tsx` exists. "Site
chapter" is the /admin chapter the page backs (blank means none).

| Route | Page | Capability | Purpose | Main components | Data (API) | Live | Tests | Site chapter |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/login` | `Login` | public | Password plus OAuth login | `OAuthButtons`, `CrateLogo` | `/api/auth/config`, `/api/auth/login` | none | yes | |
| `/setup` | `Setup` | public | First-run admin, keys, first scan | | `/api/setup/{admin,keys,scan}` | none | no | |
| `/` | `Dashboard` via `AdminIndex` | `admin.access` (else redirect) | First-glance state | `OpsPageHero`, `OpsStatTile`, `OpsPanel`, `Card`, Nivo pie/bar | ops snapshot; `POST /api/tasks/sync-library`, `/api/manage/rebuild`, `/api/manage/wipe` | ops-stream | **no** | Operations (summary) |
| `/browse` | `Browse` | `library.view` | Artist grid with filters | `ArtistCard`/`ArtistRow`, grid skeletons | `/api/artists?…`, `/api/browse/filters` | none | yes | |
| `/artists/:artistSlug` | `Artist` | `library.view` | Artist hub: tabs overview, top-tracks, discography, setlist, shows, similar, stats, artwork, about | `ArtistHeroSection`, `ArtistNetworkGraph` (force graph), `ArtistStats` (Nivo), `ArtistRepairDialog`, `ArtistHeroArtworkEditor` (Konva), `ArtistBioResearchDialog` (LLM) | `/api/artists/{id|by-entity}/…`, `/api/artists/{id}/enrichment`, `/api/network/external-artist`, `/api/artwork/artists/*`, `/api/manage/artists/*`, `/api/tidal/missing/*` | task waits | yes | Enrichment (no orbit) |
| `/artists/:artistSlug/:albumSlug`, `/albums/:albumId/:slug` | `Album` | `library.view` | Album detail, tags, match, lyrics, portable metadata | `AlbumHeader`, `TrackTable` (radar), `AudioProfileCard`, `TagEditor`, `RelatedAlbums`, `MatchCard` | `/api/albums/*`, `/api/manage/albums/*`, `/api/match/*`, `/api/manage/sync-lyrics`, `/api/manage/portable-metadata[/export-rich]` | `useTaskEvents` (lyrics) | yes | Imports (sidecar action), Analysis (readout candidate) |
| `/artists/:artistId/:slug` | `Artist` | `library.view` | Legacy id route | | | | | Likely shadowed by the album route above |
| `/health` | `Health` | `library.repair.run` | Repair catalog, open issues by check and artist, fix and dismiss | `ConfirmDialog`, `IssueList`/`IssueRow`, `ArtistGroupHeader` | `/api/admin/health-snapshot`, `/api/manage/repair-catalog`, `/api/manage/health-check`, `/api/manage/health-issues/*`, `/api/manage/repair-duplicate-tracks`, `/api/admin/tasks-snapshot` | health-stream, tasks-stream, task events | yes | **Health** |
| `/trash` | `Trash` | `library.track.remove` | Quarantined tracks: restore, hard delete, empty | `Card` | `/api/manage/tracks/quarantine*` | none | yes | Health (Library Trash) |
| `/contributions` | `Contributions` | `library.import.manage` | Review user uploads | `Card` | `/api/manage/contributions?limit=150` | none | **no** | Imports |
| `/download` | `DownloadPage` | `library.import.manage` or `library.tidal.manage` | Acquisition workspace: Tidal and Soulseek search, upload, queue, wishlist, history, artist suggestions | `Tabs`, `QueueRow`, `TidalArtistBrowser`, `TidalAlbumCard`, `SlskResultCard` | `/api/acquisition/{snapshot,download,upload,queue/*,search/soulseek,artist-suggestions}`, `/api/tidal/*`, Last.fm `album.getinfo` **from the browser** | acquisition-stream, Soulseek search streams | **no** | **Acquisition** |
| `/new-releases` | `NewReleases` | `curation.releases.write` or `library.tidal.manage` | Detected releases: download or dismiss, grid and timeline rows | `ReleaseTimelineRow`, `ReleaseGridCard` | `/api/acquisition/new-releases/{snapshot,check,{id}/download,{id}/dismiss}` | new-releases stream | **no** | **Acquisition** |
| `/upcoming` | `Upcoming` | shows, releases or tidal curation | Calendar of upcoming shows and releases | `ShowCard` (local copy), popover filters | `/api/upcoming`, `/api/tasks/sync-shows` | none | filters only | Acquisition (pre-releases) |
| `/bandcamp` | `Bandcamp` | `library.bandcamp.manage` | Bandcamp account sync, collection, wishlist, radar, admin matches | | `/api/bandcamp/me/*`, `/api/bandcamp/admin/*` | none | **no** | Imports / Enrichment (Bandcamp) |
| `/discover` | `Discover` | `library.view` | Completeness, release radar, genres to expand, momentum | `OpsPanel` ×6 | `/api/discover/completeness[/refresh]`, `/api/acquisition/new-releases*`, **`/api/insights`** | task wait | yes | Acquisition (monitoring) |
| `/insights` | `Insights` | `library.view` | Library charts | Nivo bar ×9, scatter ×2 | **`/api/insights`** | none | **no** | **Analysis & Insights** |
| `/analysis` | `Analysis` | `library.analysis.manage` | Coverage of features, bliss, fingerprints, lyrics, portable metadata, plus backfill actions | `OpsStatTile` ×5, `PipelineCoverage`, `RecentTrackCard` | ops snapshot `analysis`; `POST /api/manage/{analyze-all,compute-bliss,compute-popularity,sync-lyrics,portable-metadata*}`, `/api/tasks/backfill-track-fingerprints` | ops-stream | **no** | **Analysis & Insights** (+ Imports sidecar counts) |
| `/genres`, `/genres/:slug` | `Genres` (`GenreList` / `GenreView`) | `library.view` (curation gated by `curation.genres.write`) | Taxonomy curation, grid or tree, unmapped and invalid nodes, detail with graph and EQ | `GenreTaxonomyTree`, `GenreNetworkGraph` (force graph), `GenreEqEditor` (v3) | `/api/genres`, `/api/genres/{slug}`, `/api/genres/{slug}/graph`, `/api/genres/taxonomy/*`, `/api/genres/{index,infer,musicbrainz/sync,descriptions/enrich,sound-intelligence/health}`, `/api/genres/{slug}/eq-preset` | task waits | yes | **Genres** |
| `/timeline` | `Timeline` | `library.view` | Albums per year bar list, expandable | local `StatCard`, CSS bars | `/api/timeline` (all albums grouped by year) | none | **no** | |
| `/system` | `SystemHealth` | `ops.health.view` | Score, API latency, resources, governor, 14 metric streams, route latency, transcoding | `OpsStatTile`, `ResourceCard`, `MetricChart` (Nivo line) | `/api/admin/metrics/dashboard?period&minutes` | **none** (manual refresh) | **no** | **Operations** (System, Governor) |
| `/logs` | `Logs` | `ops.logs.view` | Live worker log console with filters and worker roster | `OpsPanel` | `/api/admin/logs-snapshot`, `logs-stream` | logs-stream | **no** | Operations |
| `/tasks` | `Tasks` | `ops.tasks.manage` | Task stats, filters, worker control (slots, restart, cancel all), playback delivery, active and queued, needs attention, repair runs, history | `WorkerControlPanel`, `ActiveTaskCard`, `HistoryTaskRow`, `PlaybackDeliveryPanel`, `TaskEventLog` | `/api/admin/tasks-snapshot`, `tasks-stream`, `/api/tasks/*`, `/api/worker/{slots,restart,cancel-all}`, `/api/admin/playback-delivery`, `/api/stack/container/crate-worker/logs` | tasks-stream, per-task SSE, 15 s poll | **no** | **Operations** (QueueLanes) |
| `/stack` | `Stack` | `ops.runtime.manage` | Docker services, restart, logs | `OpsPanel`, service cards | `/api/admin/stack-snapshot`, `stack-stream`, `/api/stack/container/*` | stack-stream | **no** | Operations (System) |
| `/playlists` | `Playlists` | `curation.playlists.write` | System playlists list, create static or smart | `PlaylistArtwork`, `Card` | `/api/admin/system-playlists*`, `/api/playlists/filter-options` | none | **no** | |
| `/playlists/:playlistId` | `PlaylistEditor` | `curation.playlists.write` | Smart rules, preview, generate, AI description and refine, track ordering | `Card` ×6 | `/api/admin/system-playlists/{id}/*` (editor-snapshot, preview, generate, refine, tracks, reorder, track-search, ai-description, duplicate) | playlist stream | yes | |
| `/users` | `Users` | `users.view` | Users, presence, current track, sessions, invites, role editing, user map | `UserMap` (Leaflet), `UserDetailDialog`, `InviteUserDialog`, `AddUserDialog` | `/api/auth/users*`, `/api/admin/auth/invites` | **none** | yes | Operations (Invites and sessions) |
| `/roles` | `Roles` | `roles.view` | Role presets and capabilities (read-only) | `Card` | `/api/auth/roles` | none | yes | Operations (Roles and capabilities) |
| `/i18n` | `I18nReview` | `admin.access` | Listen translation bundles: locale health, bundles, editor, import and export | `Card` | `/api/admin/i18n/listen/*` | none | yes | |
| `/settings` | `Settings` | `settings.manage` | General, downloads (Tidal, Soulseek, policy), schedules, enrichment and LLM, Telegram, storage, audit log | local `Section`/`StatTile`/`PanelCard`/`StatusDot` | `/api/settings/*`, `/api/tidal/auth/*`, `/api/admin/download-policy`, `/api/worker/schedules/{t}/run`, `/api/manage/audit-log` | ops snapshot (read) | yes | Operations (Telegram, LLM) |
| `/profile` | `ProfileRedirect` | auth | Redirects to `/users?inspect=…` or `/browse` | | | | | |
| `/federation` | `Federation` | `federation.nodes.view` | Tabs overview, peers (pairing, directories), policies, streams, imports, security, audit | `pages/federation/*` panels, `Card` | `/api/admin/federation/*` | none | yes | (site Federation viz lives on /listen) |
| `/global-catalog` | `GlobalCatalog` | `federation.nodes.view` | Global catalog status, reconcile runs, duplicates | `Card` | `/api/admin/global-catalog/*` | none | yes | |
| (orphan) | `Shows.tsx`, `Profile.tsx` | | Unrouted. `Shows` duplicates show cards and a Leaflet map. | | `/api/shows/cached`, `/api/auth/profile` | | no | Delete or route |

Pages with no page-level test: Dashboard, Tasks, SystemHealth, Stack, Logs, Insights, Analysis,
Download, NewReleases, Upcoming, Bandcamp, Timeline, Playlists, Contributions, Setup. Every v3
screen touched there needs a new `*.test.tsx` (repo rule: "if you touch it, you test it").

---

## 7. Site /admin chapters vs the product

Each subsection covers four things: what the site shows, what admin shows today, what real data
exists, and what is missing (frontend and backend).

### 7.1 Health → `HealthScan` · `/health` (+ `/trash`)

- **Site**: one instrument. Bar: `HEALTH example scan` | `N issues · N fixed · N waiting`
  (aria-live). Three display numerals: Checks 17, Fix on their own, Ask first. A numbered
  hairline list of all 17 checks with name, description, scope, 3-bar risk meter plus label,
  `auto` (cyan) or `confirm` (amber) pill, and a result column (`clean`, `N fixed` in cyan,
  `N waiting` in amber). A 2 px cyan-hi bar sweeps the rows while scanning. Footer: files go to
  Library Trash.
- **Today** (`pages/Health.tsx`, 1362 lines): a hero with Stethoscope icon and actions. A "repair
  catalog" panel listing entries with emerald/amber/red risk badges and cyan/fuchsia/violet scope
  badges. Open issues grouped by check type, then by artist, with critical/high/medium/low
  severity colours (red, orange, yellow). Bulk "fix type" and "dismiss type" actions, "fix all
  artists" confirm, and a latest repair task summary. Trash is a separate page with its own
  `h1`.
- **Real data available**:
  - `/api/manage/repair-catalog` gives `risk`, `scope`, `requires_confirmation`,
    `auto_fixable`, `support`, `supports_*_scope` for 17 entries (`crate/repair_catalog.py`).
  - health-snapshot/health-stream give `counts` per check and `runs` per check (`last_run_at`,
    `duration_ms`, `issue_count`).
  - The `health_check` task emits progress with the current `check` (`health_check.py`
    `progress_callback({"check", "artist", "done", "total"})`), so the scanning sweep can be
    driven by `/api/events/task/{id}`.
  - Fixed counts come from the latest repair task `result`.
- **Missing**:
  - Labels and descriptions are hardcoded in the client (`CHECK_LABELS`, `CHECK_DESCRIPTIONS`).
    Add `label` and `description` to `RepairCatalogEntry` so the instrument is catalog-driven.
  - Collapse colour to cyan and amber plus fg steps. Severity becomes the meter.
  - Drop to two streams on this page (see 3.1).
  - Keep the per-artist issue drill-down below the instrument as a `HairlineList`.

### 7.2 Imports → `AlbumSidecar` · no page today

- **Site**: folder tree (`/music/Artist/Album/` files, `cover.jpg`, `.crate/album.json`
  highlighted). Identity tags in every file (`crate_artist_uid`, `crate_album_uid`,
  `crate_track_uid`, `crate_audio_fingerprint`). A JSON viewer of `album.json` (syntax tokens,
  line count, auto-scroll that stops on user input). Two-step flow `01 write_portable_metadata` →
  `02 rehydrate_portable_metadata`. The chapter copy also promises staged imports, watcher and
  scans.
- **Today**, scattered:
  - Dashboard "Imports waiting" tile (ops `pending_imports`)
  - `/contributions` (user uploads)
  - `/download` Upload tab
  - `/bandcamp` imports
  - Federation → Imports tab
  - `/analysis` "Portable library state" (sidecar albums, tag albums and tracks, tag errors,
    rich export)
  - Album header actions "portable metadata" and "export rich"

  **`/api/imports/pending|import|import-all|remove` has no UI** (staged filesystem imports cannot
  be seen or approved one by one).
- **Real data available**:
  - `import_queue` read model (`crate/db/import_queue_read_models.py`)
  - `album_portable_metadata` table (`sidecar_written_at`, tag state); counts are already in the
    ops `analysis` block
  - `crate/portable_metadata.py` builds the sidecar payload from the album payload
    (`_sidecar_payload`, `schema_version`)
  - `process_new_content` emits phase progress (8 phases) and `result.steps`
- **Missing**:
  - A new `/imports` page: staging list (pending → importing → imported) with task events, plus
    the sidecar instrument for a selected album.
  - A read endpoint for one album's portable metadata, e.g. `GET
    /api/manage/albums/{id}/portable-metadata`, returning the DB-derived sidecar payload plus
    `sidecar_written_at` and tag status. Build it from DB rows, not by reading `/music` in the
    request: the API mount is read-only, but stat and read calls on the slow library disk do
    not belong in a request.
  - The JSON viewer and tree are admin-only components.

### 7.3 Acquisition → `ReleaseTimeline` · `/download`, `/new-releases`, `/upcoming`, `/discover`

- **Site**: one release on a 5-stage rail: `01 Detected` (`check_new_releases`), `02 Release day`
  (`promote_due_releases`), `03 Fetched` (`tidal_download`: queued → downloading → processing →
  completed), `04 Imported` (`process_new_content`: folders, artist, genres, MBIDs, Bandcamp,
  lyrics), `05 Analysed` (features, bliss). Header: "Release clock Day N" and "Now: stage +
  task".
- **Today**: `Download.tsx` (2034 lines) is a search and queue workspace with tabs and the most
  off-spec styling: 50 non-cyan colour classes, an inline copy of the hero, shadcn `Tabs`/`Select`.
  `NewReleases.tsx` already has a `ReleaseTimelineRow` but only `detected|downloading|downloaded`
  status chips.
- **Real data available**: `new_releases` (`status`, `detected_at`, `release_date`,
  `downloaded_at`, `quality`, `tracklist_json`). Tidal and Soulseek queue state comes through the
  acquisition snapshot and stream. `process_new_content` phases come from task events. Album
  analysis state is precomputable.
- **Missing**:
  - `new_releases` has no link to the download task, the imported album (id or entity uid) or
    its analysis coverage, so stages 03-05 cannot be derived per release. Add `task_id` and
    `album_entity_uid` (set by the download and import handlers), and precompute per-release
    stage in the new-releases snapshot. Do not join on `(artist, title)` at request time.
  - A "pre-release" flag is implicit (`release_date > today`). Expose it.
  - Security: `Download.tsx` fetches `/api/auth/scrobble/lastfm/auth-url` to read the Last.fm
    **API key** and calls `ws.audioscrobbler.com` from the browser for covers. Move cover lookup
    server-side (an enrichment cache) before restyling.
  - Fake FLAC and quality badges should become mono meta, not coloured badges.

### 7.4 Enrichment → `EnrichmentOrbit` · no page today

- **Site**: the artist at the core. The inner ring has 6 artist sources with cache lifetimes
  (Last.fm 7 d, Spotify 3 d, MusicBrainz 30 d, Setlist.fm 1 d, Fanart.tv 30 d, Discogs 30 d). The
  outer ring has 7 more sources with roles. Packets travel to the core. A thread pool shows
  "3 workers" lanes scheduling the sources.
- **Today**:
  - The Artist page reads `/api/artists/{id}/enrichment` (consolidated lastfm, spotify,
    musicbrainz, setlist, fanart blobs) and has an "enrich" action plus
    `ArtistBioResearchDialog` (LLM).
  - Settings → Enrichment toggles sources and LLM refinement.
  - Command palette: enrich MBIDs.
  - There is no view of freshness or coverage.
- **Real data available**: `crate/enrichment.py` has `_SOURCE_TTLS_SECONDS` (matches the site),
  `_PROVIDER_MIN_INTERVAL_SECONDS`, `enrichment_parallelism` (default 3) and per-source cache
  keys `enrichment:source:{source}:{artist}`.
- **Missing**:
  - The enrichment response should include `sources: [{id, label, fetched_at, ttl_seconds,
    status}]`, read from the cache store in one batched lookup.
  - `enrich_artist` task events per source (start and end) to drive the pool lanes live.
  - Library-wide per-source coverage, precomputed into the ops or analysis snapshot, for a
    global view.
  - Placement: an "Enrichment" panel on the Artist page (orbit), plus an optional coverage row
    on `/analysis`.

### 7.5 Genres → `GenreWheel` + EQ inheritance · `/genres`, `/genres/:slug`

Full analysis is in `genres.md`. Admin-specific points:

- **Site**: radial wheel. Families ring, subgenres ring, parent edges as curves, related edges as
  quadratic arcs, rotated labels, centre numeral "61 genres". Header: "crate-core 1.0.0 ·
  ed25519" plus digest. Side panel: EQ inherited from the nearest preset with the walk path
  (`powerviolence → hardcore punk → punk`), preset name, "inherited from X", mini EQ bars, walk
  chips, legend numerals (families, parent links, related links, relation types).
- **Today**:
  - `GenreList` is an `OpsPageHero` with 5 task buttons (MusicBrainz sync, enrich descriptions,
    infer, cleanup invalid, rebuild proposal), an amber gradient "needs taxonomy mapping" box, an
    invalid-nodes list, and a grid or tree toggle.
  - `GenreTaxonomyTree` (1138 lines) is a collapsible tree plus `NodeDetailPanel` (relations,
    aliases, proposals, cover, EQ).
  - `GenreView` holds the context panel, `GenreNetworkGraph` (force graph, sky palette) and
    `GenreEqEditor` (already v3).
- **Real data available**: `/api/genres/taxonomy/tree` already returns `top_level`, `parent_slugs`,
  `children_slugs`, `related_slugs`, `influenced_by_slugs`, `fusion_of_slugs`, `alias_names`,
  counts, `eq_gains`, `eq_preset_source` and `eq_preset_inherited_from`. The release descriptor
  comes from `get_core_taxonomy_descriptor()` and `taxonomy_release_health()` (id, version,
  digest, signature, key_id, status). Edges carry `source`, `confidence` and `locked`.
- **Missing**:
  - Release metadata is not on any genres admin endpoint.
  - No inheritance path (derivable client-side from parents).
  - No core-vs-local override flags per node or edge.
  - The tree endpoint aggregates per request (`get_all_genres`: `COUNT DISTINCT` over
    `artist_genres`/`album_genres`, O(N²) children loops, an EQ resolve per node). It should be
    a projector-warmed `ui_snapshot` keyed by `genre_taxonomy:revision`.
  - Layout: the wheel becomes the default `/genres` view. Grid and tree stay as secondary
    modes. Click → `/genres/:slug`. Editing stays in the detail panel.

### 7.6 Analysis & Insights → `TrackReadout` + bliss vector · `/analysis`, `/insights`

- **Site**:
  - Track title in display type.
  - Four figures as big numerals with spring count: BPM, Key (Camelot plus key), Loudness LUFS,
    Dynamic range dB.
  - Five feature bars (energy, danceability, valence, acousticness, instrumentalness).
  - A bliss 20-bar diverging strip ("nearest neighbours in pgvector").
  - Track chips with a spring transition.
  - Chapter copy: coverage for features, bliss, fingerprints, Smart Mix profiles; a pausable
    Smart Mix backfill; Insights charts.
- **Today**:
  - `/analysis` shows 5 `OpsStatTile`s, `PipelineCoverage` panels (Done/Pending/Active/Failed
    mini metrics), portable state, a "last analyzed track" card (title, bpm, key, energy,
    danceability) and operator notes, all from the ops snapshot (precomputed, live).
  - `/insights` shows 11 Nivo charts from `/api/insights`.
  - Album: `AudioProfileCard` (radar plus bar) and a radar per track in `TrackTable`.
- **Real data available**:
  - `/api/tracks/{id}/info` returns bpm, key and scale, loudness, dynamic range, the five
    features and mood, but **pops `bliss_vector`** into a derived `bliss_signature`.
  - The album detail payload includes `bliss_vector` per track.
  - The Camelot mapping exists server-side (`crate/bliss.py`) but is not exposed.
- **Missing**:
  - Readout inputs:
    - Extend the ops `analysis.last_analyzed` with loudness, DR, the five features, Camelot
      and the 20-dim vector (one row, built by the projector). This gives a live "last
      analysed" readout.
    - Add `camelot` to track info.
    - Use the readout for the per-track radar on Album.
  - Smart Mix coverage and backfill pause, resume and cancel exist only on
    `smart-mix-phase-1` (`SmartMixCoverage.tsx`, `/api/admin/smart-mix/{status,backfill,
    backfill/resume,backfill/pause,backfill/cancel}`). v3 `/analysis` must be designed to absorb
    it after merge.
  - Insights is blocked by 9.1.

### 7.7 Operations → `QueueLanes` + `GovernorGauges` · `/tasks`, `/system`, `/stack`, `/logs`, `/users`, `/roles`, `/settings`

- **Site QueueLanes**: 5 lanes (maintenance, default, fast, heavy, playback). Each has a mono
  queue name in cyan-hi, a display count of task types, worker container names, and a track with
  `queued | running | done` zones and task chips moving across. Governed tasks get a dashed amber
  outline.
- **Site GovernorGauges**: load ratio (max 0.85), iowait (25 %), swap (30 %), listeners (10),
  streams (10). Each gauge has a value, a limit tick and "max X". Status line
  `Allowed · background work runs`. Heaviest maintenance runs 02:00–07:00.
- **Today**:
  - `/tasks`: `WorkerControlPanel` (chips engine, running, pending, slots; slot stepper;
    restart; cancel all; worker logs; DB-heavy gate sentence), `ActiveTaskCard` list, history.
  - `/system`: a "Resource Governor" `ResourceCard` plus `worker.resource.load_ratio` and
    `worker.resource.deferred` line charts. One-shot fetch.
- **Real data available**:
  - The ops snapshot (`live.queue_breakdown.running|pending` per queue, `running_tasks` and
    `pending_tasks` with `pool`, `recent_tasks`, `worker_slots`, `db_heavy_gate`,
    `runtime.active_users_5m`, `runtime.streams_3m`), already streamed. Lanes need no new
    endpoint.
  - `crate/resource_governor.py` has the snapshot fields and `DEFAULT_*` limits matching the
    site. `is_governed_task()` and `get_queue_for_task()` exist.
- **Missing**:
  - `/api/admin/task-catalog` types lack `queue` and `governed`. Add them, additive.
  - Governor state is only computed inline per request in `/api/admin/metrics/dashboard`
    (`_sample_iowait_percent` sleeps 50 ms; two DB counts), and thresholds are not returned.
    Have the worker service loop sample it on a schedule, store it (cache store, as
    `resource_pressure` already is), and add `governor: {snapshot, limits, allowed, reason,
    window, last_defer}` to the ops snapshot.
  - `/system` should consume ops-stream for the gauges. The Nivo timeseries can stay
    fetch-on-demand.

---

## 8. Other pages: gap notes

- **Dashboard**:
  - Becomes the "Operations summary" instrument page:
    - Hero chips (Postgres, watcher, health) → `StatusDot` row.
    - 4 `OpsStatTile`s → `StatNumber` (Health open, Running/Queued, Users/Streams, Slots).
    - "Needs attention" and "Running now" / "Recently finished" → `HairlineList`.
    - A compact QueueLanes plus governor strip.
    - Recent albums → cover row with mono meta.
  - Advanced diagnostics (event bus and SSE, formats pie, decades, top genres) moves to the v3
    Nivo theme or hairline bars.
  - The danger zone (rebuild, wipe) needs a decision on destructive colour (open question 4).
- **SystemHealth**:
  - The score card becomes one display numeral plus a mono summary.
  - Resources become gauges (same component as the governor).
  - 14 `MetricChart` cards in a 2-column grid of filled cards → hairline small multiples with
    the shared Nivo theme.
  - Add live via ops-stream for current values.
  - Route latency table → `HairlineList` with mono p95 and p99.
- **Stack**: service cards → hairline rows (`StatusDot` running/exited, mono image:port, uptime).
  Inline logs → mono console block.
- **Logs**: already a console. Restyle the level colours to fg steps plus amber for warn. Errors
  need a decision (amber vs a red exception). Worker roster → `HairlineList`.
- **Tasks**: QueueLanes on top. The stat tile row (Today, Completed, Failed, Needs attention,
  Success rate, Avg duration) → `StatNumber` strip. History → `HairlineList` with mono duration
  and status dots. 105 non-cyan colour classes to collapse.
- **Users / Roles**:
  - Users presence list → `HairlineList` with `StatusDot` (online, idle, offline) and mono
    session meta. `UserMap` (Leaflet + Carto) gets a darker, desaturated basemap and cyan
    markers. The dialogs stay.
  - Roles → capability matrix as a hairline table with mono capability ids. The site sells
    "Invites and sessions" and "Roles and capabilities, enforced by Casbin"; both are already
    there.
- **Settings**: 1931 lines. Local `Section`/`StatTile`/`PanelCard`/`StatusDot` → v3 primitives
  (the `StatusDot` name collision must go). Telegram, LLM and schedules map to the site's
  Operations bullets. Schedules → `HairlineList` with mono interval and a "run now" chip.
- **Discover**: 6 `OpsPanel`s → instrument sections with `MonoLabel` headers. Blocked by
  `/api/insights` (9.1).
- **Download**: see 7.3. The heaviest restyle. Tabs → pill chip group (site
  `aria-pressed` chips). The quality select → chips.
- **Timeline**: already close to the site (mono years, proportional bars). Needs the v3 heading,
  `StatNumber` for span, total and peak year, hairline bars with cyan-hi fill, and an expanded
  year as a cover row. `/api/timeline` returns every dated album on each request. Fine at 4.4K
  but should be a snapshot if it becomes a landing view.
- **Artist network** (`ArtistNetworkGraph`, Similar and Stats tabs): force graph with
  sky/slate canvas colours. Retint to cyan/cyan-hi and fg steps, mono labels on canvas, hairline
  tooltip. It fetches `/api/shows/artists-with-shows` on every centre change; cache it once per
  page.
- **Federation**: plain tabs in local state (no URL param) and `Card` panels. The site's
  Federation viz (node graph: peers → your node → listener relay, signed descriptor packets) is
  on /listen. `FederationOverview` could adopt it with real `/api/admin/federation/status` peers
  (`trust_state`, `last_health_at`) and `/streaming-stats` (`active_streams`, `daily_bytes`).
  Tabs → chips with a `?tab=` param.
- **Global catalog**: `Card` overview, runs and duplicates tabs → `StatNumber` plus
  `HairlineList`.
- **Translation review (`/i18n`)**: 4-pane workspace (locale health, bundles, editor,
  import/export). Locale health → coverage bars like the site's feature bars. Bundles →
  hairline rows.
- **Playlist editor**: rules builder plus preview plus track list in `Card`s. Track list →
  `HairlineRow` with mono index and duration. The rule builder chips → v3 chips. The live stream
  has no reconnect handling.
- **Playlists, Upcoming, Bandcamp, Contributions, Trash, Browse, Artist, Album**: covered by the
  spec's "library tables" and "shows" passes (`Upcoming` uses a local `ShowCard` that the spec
  wants replaced with the shared one). Bandcamp has the heaviest custom display type
  (`text-4xl font-black`).
- **Login / Setup**: logo plus form. Needs the display headline and mono labels.

---

## 9. Backend preconditions and performance risks

These come before the restyle, because the live instruments would amplify each one.

1. **`GET /api/insights`** (`crate/api/analytics.py`): 10+ query functions, each opening its
   own `read_scope()`. Several run `COUNT`/`SUM` over `library_tracks` per request:
   `get_insights_bpm_distribution` (`GROUP BY` bucket), `get_insights_feature_coverage` (`COUNT(*)`
   plus 9 `SUM(CASE…)`), and the scatter samples. Used by `/insights` and `/discover`. Breaks
   "never COUNT/SUM/AVG on library_tracks during HTTP" and "consolidate into CTEs". Fix: an
   `insights` ui_snapshot warmed by the projector or a deduplicated task. The endpoint serves the
   snapshot only.
2. **`?fresh=1` on snapshot endpoints** (`get_or_build_ui_snapshot`): synchronous rebuild in the
   request. Callers: `OpsSnapshotContext` (on focus, visibility and online, plus `refresh(true)`
   after actions in Dashboard, Analysis and Tasks), and the page loaders in Health
   (health and tasks snapshots), Tasks, Logs and Stack. The ops build aggregates
   `library_tracks`. A cache older than `max_age` also triggers an in-request rebuild,
   including from the SSE generators.
3. **`/api/genres/taxonomy/tree`**: per-request aggregation and O(N²) loops (see 7.5 and
   `genres.md`).
4. **`/api/admin/metrics/dashboard`**: governor evaluation inline (50 ms sleep plus active
   users and streams counts) plus timeseries plus route latency. Acceptable for an on-demand
   page, wrong for gauges that should tick.
5. **`/tasks` per-task SSE fan-out** (section 3).
6. **Last.fm API key and third-party calls from the admin browser** (`Download.tsx`).
7. `react-hooks/exhaustive-deps` is OFF in `app/ui/eslint.config.mjs`. Every new live effect
   needs manual review of deps. Per-frame values (instrument springs, rAF clocks) must live in
   refs, never in effect deps.

---

## 10. Proposed admin component set (no code)

Admin-only unless Listen also needs it (repo rule). Each needs tests.

| Component | Replaces | Built on | Live source |
| --- | --- | --- | --- |
| `InstrumentPanel` (figure, `VizBar` header: `MonoLabel` key word plus meta on the left, aria-live status on the right, hairline top) | `OpsPanel`, `Card` panels, inline heroes | `MonoLabel` | — |
| `PageHeading` (eyebrow `NN / Chapter` plus display title plus lede) | `OpsPageHero`, 7 ad-hoc `h1` recipes | `font-display`, `MonoLabel` | — |
| `StatStrip` (2-6 `StatNumber`s with spring count-up) | `OpsStatTile`, Settings `StatTile`, Timeline `StatCard` | `StatNumber` | ops-stream |
| `RiskMeter` (3 segments plus label) | risk badges | — | repair catalog |
| `ScanList` (numbered hairline rows, sweep bar, result column) | Health catalog and issue panels | `HairlineList` | health-stream plus task events |
| `QueueLanes` | `WorkerControlPanel` chips plus active task cards | port of `site:queue-view.ts` | ops-stream |
| `Gauge` / `GovernorGauges` | `ResourceCard`, progress bars | port of `site:governor-math.ts` | ops-stream (after 7.7) |
| `GenreWheel` | grid as the default `/genres` view | port of `site:taxonomy-math.ts` | taxonomy snapshot |
| `TrackReadout` | `RecentTrackCard`, track radar | port of `site:analysis-view.ts` springs | ops `analysis.last_analyzed`, track info |
| `ReleaseRail` | `ReleaseTimelineRow` status chips | port of `site:release-view.ts` | new-releases stream plus task events |
| `SidecarViewer` (tree plus JSON lines) | none | port of `site:json-lines.ts` | portable-metadata read |
| `EnrichmentOrbit` | none | port of `site:pool-math.ts` | artist enrichment plus task events |
| `useSnapshotStream(url, onPayload)` | 6 copies of the reconnect effect | `OpsSnapshotContext` pattern | — |
| `nivoTheme` (tokens) | 6 inline themes | — | — |

The motion rules from the site carry over. Loops run only while visible (IntersectionObserver)
and the tab is visible. Data changes animate with springs. Reduced motion
(`data-crate-motion="reduced"`) renders the final state. Animation state lives in refs, never in
SSE effect deps.

---

## 11. Suggested rollout (admin)

The spec's admin order is: genre EQ editor (done), dashboard, health and tasks, library tables,
shows, then settings, users and federation. Adjusted so that each real-data instrument lands
after its backend precondition:

1. Shell and shared pieces: `PageHeading`, `InstrumentPanel`, `StatStrip`, `nivoTheme`,
   `useSnapshotStream`, sidebar restyle, header breadcrumb. Delete the dead
   `shared/ui/domain/stats/Ops*` copies (or promote them, see open question 2). Orphan pages
   decision.
2. Backend hygiene: stop the in-request `fresh=1` rebuild, add the `insights` snapshot, add
   `queue` and `governed` to the task catalog, include the governor in the ops snapshot, add
   `label`/`description` to the repair catalog.
3. Health (`ScanList`, `RiskMeter`) plus Trash.
4. Operations: Dashboard summary, then Tasks (`QueueLanes`, fan-out fix), then System
   (`GovernorGauges`, live), then Stack and Logs.
5. Genres wheel (after the taxonomy snapshot and the fixes in `genres.md`).
6. Analysis readout plus Insights restyle (after the insights snapshot; plan around the Smart
   Mix merge).
7. Acquisition: Download restyle and server-side covers, then `ReleaseRail` (after the
   `new_releases` linkage).
8. New Imports page (staging queue plus `SidecarViewer`; needs the read endpoint).
9. Enrichment orbit on the Artist page (needs the per-source status API and task events).
10. Remaining pages: settings, users and roles, federation, global catalog, i18n, playlists,
    library tables, shows.

Tests: each step adds or updates the page `*.test.tsx` (15 pages have none today), pure-math
unit tests for the ported layout, spring and pool modules, and backend pytest for every endpoint
or snapshot field added.

---

## 12. Open questions for Diego

1. Are the bespoke SVG instruments (wheel, orbit, lanes, rails, gauges, meters) allowed outside
   Nivo? The site builds them by hand. Nivo has no radial taxonomy, pool or lane primitives.
   Proposal: Nivo for statistical charts only, hand-built SVG for instruments.
2. Do the instruments live in `app/ui/src/components/viz` (admin-only), or does `GenreWheel` /
   taxonomy math go to `@crate/ui` because Listen (Paths, Genre rooms) will use it too? Same
   question for the dead `shared/ui/domain/stats/Ops*`.
3. Should the sidebar be regrouped by the site's chapters (section 2), or keep today's
   Tools / Music / Insights / System?
4. Status colour beyond cyan and amber: the site has no red or green. What do destructive
   actions (wipe, hard delete, destructive repair), failed tasks and offline services use?
   Proposal: amber for anything needing attention, fg-3 plus a strike or outline dot for
   off/failed, and a single semantic `danger` token reserved for destructive confirm buttons
   only.
5. Imports: a new top-level `/imports` page, or fold staging into `/download` and the sidecar
   into Album?
6. Enrichment: Artist-page panel only, or also a library-wide enrichment coverage view?
7. Admin pill radius: the spec says `CratePill` renders pills in Admin. Do all admin controls
   (buttons, selects) move to pills, or only chips?

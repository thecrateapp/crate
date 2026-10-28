# Crate v3 analysis: Listen app audit against the site's `/listen` visuals

Status: analysis only (read-only audit, 2026-10-14). No source code was changed, no tests or builds
were run. Branch `feat/crate_v3` at `d91d2c1a` (spec `bce7dd92`, tokens/fonts `38c7576c`, primitives +
Radar ticket `50854a6e`, EQ curve chart `d91d2c1a`).

Scope: `app/listen` (web PWA + Capacitor iOS/Android), the desktop shell `app/listen-desktop` (Tauri 2),
the shared `@crate/ui` pieces Listen consumes, and the backend endpoints that feed them
(`app/crate`). The only visual reference is the new site at
`worktrees/website/app/web` (`src/pages/listen.astro`, `src/components/viz/*`,
`src/components/listen/*`, `src/scripts/viz/*`, `src/scripts/listen/*`, `src/styles/tokens.css`,
`src/styles/base.css`). Smart Mix code was read from `worktrees/smart-mix-phase-1` (not merged).

Spec drift noted while reading: `docs/plans/2026-10-14-crate-v3-design-system.md` points to
`components/lab/viz/*.astro`; the site keeps them in `app/web/src/components/viz/*.astro`.

---

## 1. Executive summary

- The token layer already moved (neutral fg steps, rgba hairlines, `#0d0e14` card, `accent-action-hi`,
  Cabinet Grotesk, JetBrains Mono, spring easings). Screen work has only touched two surfaces: the Radar
  ticket (`components/upcoming/*`, `pages/ShowsContent.tsx`) and the EQ panel
  (`components/player/EqualizerPanelSections.tsx`, `EqualizerSmartReadout.tsx`, shared `EqBands`).
  The v3 primitives (`MonoLabel`, `StatusDot`, `StatNumber`, `HairlineList`, `CratePill`) are used in
  6 Listen files. Everything else still renders the v2 look: glass panels (`backdrop-blur` in 43
  files), lifted rounded cards (`rounded-xl` in 71 files, `shadow-*` in 70), hand-rolled caps labels
  (`uppercase tracking*` in 57 files), multicolour state tints used decoratively.
- Of the eight `/listen` visuals, three already have real data in the Listen payloads with the same shape
  the site fakes: the listening heatmap (`/api/me/stats/dashboard` -> `heatmap {cells 7x24, peak,
  night_share}`), the EQ (`EqBands` + Smart EQ chain resolved through `/api/tracks/by-entity/{uid}/eq`
  and `/api/tracks/{id}/eq-preset`) and the
  probable setlist (`/api/me/upcoming` -> `probable_setlist`). They are front-end work only, except
  the setlist "in library / missing" flag, which needs a precomputed field.
- Smart Mix (MixViz) cannot be real on `feat/crate_v3`: the server planner, mix profiles, transition
  plans and the Android two-deck engine live only on `smart-mix-phase-1`. `crate_v3` only has the
  client "smart transition" crossfade (2/4/6 s from BPM/key/energy) and a `CrossfadeTransition`
  `{startedAt, durationMs}` in player state.
- The mood map, Radio field and Paths field need new precomputed artefacts (energy x valence density
  grid; a PCA basis + sampled 3D coordinates of bliss vectors). Both must be built by worker tasks into
  `ui_snapshots`/artefacts, never in a request. Today the mood counts are computed with
  `COUNT(*) FILTER` over `global_catalog_tracks` joined to `library_tracks` on every cache miss of
  `/api/browse/moods` (10 min TTL) - a hot-path rule violation that the MoodMap work should remove.
- Federation and Devices are not first-class Listen surfaces. Federation is an operator concept (Admin);
  the Listen analogue is track provenance (remote `nodeName`, relayed playback). Devices map to Crate
  Connect (`/api/me/devices`, connect WS/SSE) and the playback target menu.
- Platform constraints dominate the player visuals: on iOS/Android the stable audio pipeline has no
  WebAudio graph (`canUseWebAudioEffects` false), so anything driven by a live `AnalyserNode` (spectrum
  ribbon, waveform, sphere visualizer, live EQ overlay) does not exist on mobile by default. Mobile
  visuals must be data-driven (analysis fields, the worker-made cast spectrum artefact), not FFT-driven.
- Issues found during the audit (details in section 10): hardcoded English Smart EQ chain labels now
  rendered six at a time; `useAudioVisualizer` pushes two 1024-float arrays into React state at 20 fps
  and re-renders the player bar controller and the sidebar; the Radio seed search fires
  `/api/catalog/search` + full `/api/genres` per keystroke; Linux desktop overrides
  `--color-primary` with the GTK accent while `accent-action-hi` stays cyan (mixed accents);
  `leaflet`/`react-leaflet` and the `.upcoming-map` CSS are dead.

---

## 2. The site's `/listen` page as a specification

`app/web/src/pages/listen.astro` renders `listen.chapters` from `content/listen/en.ts`. Each chapter is a
`Chapter` with a mono index, a display title and a lede; visuals sit in `viz-band` (full width) or
`VizSplit` (feature list + sticky visual).

| # | Chapter | Visual | Files | Rendering | Data on the site |
| --- | --- | --- | --- | --- | --- |
| 01 | Play | MixViz (Smart Mix strip) | `viz/MixViz.astro`, `scripts/viz/mix-view.ts`, `mix-math.ts` | SVG built once per resize; playhead, clip rect, gain meters updated per frame via `visibleLoop` | `MIX` constant: 124 BPM, 4 bars, 8A->9A, -9.1/-10.4 LUFS, outro/intro cues, seeded fake waveforms |
| 01 | Play | EqViz | `viz/EqViz.astro`, `eq-view.ts`, `eq-math.ts` | SVG curve + bars; spring physics per band (stiffness 170, damping 18); preset trail prev -> current -> next; Smart EQ chain | `EQ_PRESETS` (21, same values as the product), `SMART_EQ_CHAIN` |
| 02 | Radio | RadioDive | `listen/RadioDive.astro`, `scripts/listen/radio.ts`, `dive.ts`, `field/renderer.ts` | WebGL2 point cloud (14K desktop / 6K mobile) + SVG overlay; GSAP ScrollTrigger scrubs 5 steps (seed, neighbours, score, queue, feedback) | Real library cloud: `public/data/library-cloud.{json,bin}` (PCA of bliss vectors, exported offline by `app/scripts/export_site_library.py` in the website worktree); weights 0.34/0.22/0.16/0.09/0.08/0.05/0.03; fake picks |
| 03 | Paths | PathsDive | `listen/PathsDive.astro`, `scripts/listen/paths.ts` | Same field; glowing polyline through 6 nodes with "START / 02 / ... / END · BPM · key" labels | Fake readouts (BPM ramp, Camelot walk) on the real cloud |
| 04 | Discover | MoodMap | `viz/MoodMap.astro`, `mood-view.ts`, `mood-math.ts` | Canvas 2D with radial sprites, additive blending, dust layer, dashed region box for the active mood; DOM buttons as labels; auto-cycles moods | `MOODS` = the product's `MOOD_PRESETS` thresholds; synthetic point clouds |
| 05 | Yours | Heatmap + counters | `viz/Heatmap.astro`, `heatmap-view.ts`, `heatmap-math.ts`, `architecture/counters.ts` | CSS grid of 168 cells (cyan-hi alpha ramp + glow), night band overlay, peak marker, hover readout, display counters (count-up) and scrambled top genre | Synthetic listener; interface `{cells, peak, night_share}` mirrors the product payload |
| 06 | Together | Federation | `viz/Federation.astro`, `federation-view.ts` | Fixed SVG (600x600): three peers, your node, listener; descriptor -> signed -> approved -> grant -> relay phases on a 9.2 s loop | `FEDERATION` constant (keys, peers, steps) |
| 07 | Everywhere | Devices | `viz/Devices.astro` | Line-art SVG devices (desktop, Android, PWA, Cast, Subsonic), stroke draw-in, synchronised progress lines while `data-playing` is in view | `DEVICES` constant |
| 08 | Live | Setlist ticket | `viz/Setlist.astro` | Static HTML/CSS: notched ticket (`mask` radial gradients), dashed perforation, display artist, mono date/venue, numbered rows with "in library / missing", footer "N of M playable" | `SETLIST` constant |
| 09 | Decks | none (coming soon) | - | - | - |

Shared recipes the product needs to reproduce (from `styles/base.css`, `tokens.css`, `scripts/viz/loop.ts`,
`scripts/motion/*`):

- `viz-bar`: one row, two mono labels (`viz-label`: JetBrains Mono 11 px, `.14em`, uppercase, fg-3,
  tabular), first `<b>` in `cyan-hi` as the key word. The product equivalent is `MonoLabel accent=...`.
- Figure framing: `padding-top: 22px; border-top: 1px solid var(--line)`; no card, no fill.
- Display numerals: Cabinet Grotesk 800, `line-height .9`, `letter-spacing -.045em`, up to 8.4 rem on
  the heatmap counters. The product has `StatNumber` (max `text-5xl`).
- Motion: `enter-up` (opacity + translateY 22px + blur 8px -> 0) on `--spring-snappy`; per-item
  stagger via `--i`; count-up counters; `scrambleText` for words; loops only while intersecting
  (`visibleLoop` = IntersectionObserver + `visibilitychange`), `prefers-reduced-motion` renders a
  static mid-state. Mobile (`max-width: 760px`) halves point counts and shortens windows.
- Lazy mounting: `initViz` dynamic-imports each view when it comes within 60% of the viewport.

Non-normative: `app/web/prototypes/*.html` (hero explorations incl. `c3-now.html` "Now Playing") are not
shipped pages; treat them as ideas only.

---

## 3. Listen architecture snapshot (what the visuals plug into)

- Shell: `components/layout/Shell.tsx` picks `DesktopShell` (Sidebar + TopBar + PlayerBar + Outlet) or
  `MobileShell` (TopBar + MobileBottomNav + PlayerBar). Heavy player surfaces are preloadable lazies in
  `components/player/lazy-player-surfaces.tsx` (Queue, Lyrics, EqualizerPopover, ExtendedPlayer,
  FullscreenPlayer).
- Routing: `app-shell/route-table.tsx`, all pages `React.lazy`; `heroRoute()` wraps transparent-header
  pages (artist, album, playlists).
- Data: `hooks/use-api.ts` (Listen's own) over `lib/cache.ts` (scoped invalidation from the
  `/api/cache/events` SSE, `Last-Event-ID` resume, 502/503/504 retry). Imperative `api()` in `lib/api.ts`.
  Snapshot streams follow `pages/use-home-discovery-stream.ts`.
- Player: `PlayerProvider` facade -> `use-player-provider-runtime.tsx`; three contexts
  (`usePlayerActions`, `usePlayerState`, `usePlayerProgress`); engines `GaplessWebEngine` (Gapless-5,
  WebAudio optional) or `androidNativeEngine`; remote targets Cast / Crate Connect / native.
- v3 primitives available in `@crate/ui/primitives`: `MonoLabel`, `StatusDot`, `StatNumber`,
  `HairlineList`/`HairlineRow`; `CratePill` restyled as the mono chip; `@crate/ui/domain/player/EqBands`
  redrawn as the curve chart.
- Bundle: initial JS gzip budget 300 KB (`scripts/check-bundle-budget.mjs`). Every new visual must be a
  route- or surface-level lazy chunk.
- Policies that constrain v3 work: `design-token-policy.test.ts` (arbitrary radius/z/shadow/type
  budgets), `radius-policy.test.ts` + the `index.css` rule that pins `[data-slot="button"]` and
  `button.rounded-full[class*="px-"]` to `radius-lg` (pills render 6 px in Listen),
  `component-policy.test.ts` (raw `button` budget 110), `badge-policy.test.ts`, `toast-policy.test.ts`,
  `genre-pill-policy.test.ts`, i18n catalog checks (7 locales, ICU, no hardcoded copy). The AGENTS file
  allows hand-built SVG/CSS charts only for the Stats tape, heatmap and decade bars; new custom charts
  (MixViz, MoodMap, fields) need that exception widened explicitly or must be framed as
  "visualisations", not charts (Nivo stays for axes-and-series charts).

---

## 4. Route inventory

Public routes (`publicAppRoutes`): `/server-setup` (ServerSetup, native multi-server), `/offline`
(OfflineAccessRoute -> OfflineLibrary), `/auth/callback`, `/login`, `/register`.

| Route | Page | Main components | Data (hook -> endpoint) | Realtime | Site mapping | Gap vs site |
| --- | --- | --- | --- | --- | --- | --- |
| `/` | `Home` | `HomeTasteHero`, Recently played, Recommended tracks, Favorite artists, Essentials, Just landed, Suggested/Upcoming albums, `HomeUpcomingSection`, `HomeShowPrepSection`, `HomeReplaySection` (+`StatsMiniTape`) | `useHomeDiscoveryStream` -> `/api/me/home/discovery` (readplane), desktop `/api/me/stats/dashboard?window=30d` | SSE `/api/me/home/discovery-stream` (readplane), degrade to 60 s refresh after 75 s silence | Yours (Heatmap counters), Live (ticket), Discover | No mono eyebrows, glass/lifted cards, replay card uses `text-3xl font-extrabold` Poppins + `text-accent-action` fills; counters not `StatNumber` |
| `/explore` (`?genre`, `?decade`, `?playlistCategory`) | `Explore` | `ExploreFeatureCard` (Radio, Paths), `JustLandedSection`, `GenreExplorer` (`GenreTile` covers), time tunnels, `MoodBrowseSection`, `ExploreCratePlaylists`; detail views `GenreDetailView`, `DecadeDetailView`, `PlaylistCategoryView` | `/api/browse/explore-page` (filters, playlists, moods, recent artists), `/api/browse/mood/{mood}?limit=50`, `/api/genres/{slug}?view=genre-detail-v5`, `/api/curation/playlists/{id}/follow` | cache SSE | Discover -> MoodMap; Admin genre wheel (taxonomy) | Moods are coloured tiles using `state-warning/info/danger/success` (decorative state colours); no energy x valence plane; genres are cover tiles, no taxonomy view |
| `/radio` | `RadioPage` | `RadioHero` (glow card), `RadioSessionStatus` (pulsing dot), `RadioStationRail` x2, `RadioSeedPanel` | `/api/radio/stations`, `/api/radio/can-discover`, `/api/radio/start`, `/api/radio/next`, `/api/radio/feedback`, search `/api/catalog/search` + `/api/genres` | none | Radio dive | No sound map, no seed/neighbour/score/queue readouts, no feedback visual; hero is glow + shadow, not hairline |
| `/paths`, `/paths/:id` | `Paths`, `PathDetail` | `EndpointPanel`, `PathRow`, step slider; detail `PathDetailParts` (1D progress line with traveller node) | `/api/paths` (GET/POST), `/api/paths/{id}` (GET/DELETE), `/api/paths/{id}/regenerate`, endpoint search `/api/genres` + catalog search (`/api/paths/preview` exists server-side but Listen does not call it) | none | Paths dive | No route-through-space visual, no per-step BPM/key labels in mono, no planner info (payload does not expose which planner or LLM review produced the route) |
| `/stats`, `/stats/global`, `/users/:username/stats` | `Stats` | `StatsHeadlineNumbers` (`CountUpNumber`), `StatsSignalTape`, artist of period, highlights, top tracks/artists/albums, `StatsHeatmapCard`, `SoundProfileCard`, `StatsGenreTrendCard`, music age, discoveries, affinity | `/api/me/stats/dashboard?window=...` (stale-first `ui_snapshot`, dedup refresh task), `/api/me/stats/today`, `/api/stats/dashboard` (global), `/api/users/{u}/stats/dashboard` | polling 1.5 s x 40 while `snapshot.pending` (`use-pending-stats-snapshot-refresh.ts`) | Yours -> Heatmap + counters | Heatmap is one third of a row inside a filled card; no night band, no peak marker, no hover readout, no mono axes; counters are Poppins 800 at 1.75-2.25 rem, not Cabinet display numerals |
| `/stats/digging` | `StatsDigging` | `DiggingStory` (auto-advancing chapters 5.2 s: minutes, artist, tracks, age, habits, summary), share sheet | same dashboard payload | none | Yours (Crate Digging) | Story chapters use v2 cards; share story canvas (`lib/social-share-story-builder.ts`) embeds Poppins 600/700/800, not the v3 faces |
| `/upcoming` (`/shows` redirects) | `Shows` (Radar) | `UpcomingRows`, `ShowCard` -> `UpcomingShowExpandedView` (v3 ticket), `ReleaseRow` | `/api/me/upcoming`, `/api/genres/{slug}?view=genre-detail-v5`, `/api/me/shows/{id}/attendance`, `/reminders`, `/api/artists/{id}/setlist-playlist` | cache SSE | Live -> Setlist | Done in `50854a6e` except: no notches (`mask`), no "in library / missing" per song, no "N of M playable" footer with play CTA (data missing, see 7.7) |
| `/artists/:artistSlug` (+ `/catalog/artists/:uid`, `/artists/:slug/top-tracks`) | `Artist` | `ArtistHeroSection`, top tracks, albums, `ArtistSetlistSection` (modal list with frequency bars), bio modal, community sections | `/api/catalog/artists/...` (readplane), `/api/artists/{id}/enrichment`, `/api/artists/{id}/top-tracks`, `/api/artists/{id}/setlist-playable`, `/api/artists/{id}/radio` | cache SSE | Live (setlist), Discover | Spec rollout step 4 pending: display-face name, `HairlineList` setlist, mono metadata |
| `/albums/:albumId/:slug`, `/artists/:a/:album`, `/catalog/albums/:uid` | `Album` | `AlbumHero`, `AlbumActions`, `AlbumTrackList` (glass toolbar), `ReleaseCountdown` | `/api/catalog/albums/...` (readplane) | cache SSE | - (TrackReadout on Admin) | Spec step 5 pending: `HairlineRow` tracks, mono indices; tracks carry `bpm/audio_key/energy` that are never shown |
| `/library`, `/collection`, `/collection/:section` | `Library` | tabs: Artists, Crates (`Crates`), Playlists, Albums, Liked, Bandcamp, Contributions | `/api/me` (desktop counts), `/api/catalog/me/artists`, `/api/catalog/me/albums`, `/api/me/playlists-page`, `/api/me/crates`, `/api/me/crates/followed`, `/api/bandcamp/me/collection`, `/api/bandcamp/me/wishlist`, `/api/me/contributions` | cache SSE | Yours (Crates, playlists) | Tabs are filled pills (`bg-text-primary/5`, active solid `accent-action`), not mono `CratePill` chips; grids of lifted cards |
| `/crate/:crateRef` | `Crate` | `CratePageHeader`, `CrateCoverFlow` (`@ashishgogula/coverflow` 3D), members modal, follow, ZIP download | `/api/crates/{ref}`, `/playback`, `/albums`, `/albums/order`, `/copy` | SSE `/api/events/task/{id}` (ZIP progress) | Yours (Crates) | 3D cover flow is a v2 showpiece; v3 would frame it with mono header and hairline list |
| `/playlist/:id`, `/curation/playlist/:id`, `/home/playlist/:id`, `/home/section/:id` | `Playlist`, `CuratedPlaylist`, `HomePlaylist`, `HomeSection` | `PlaylistHeroSection`, `PlaylistTrackList`, composer, collaborators modal | `/api/playlists/{id}` (+ tracks, members, follow, copy, generate), `/api/curation/playlists/{id}`, `/api/me/home/playlists/{id}`, `/api/me/home/sections/{id}` | cache SSE | Yours (collaborative / smart playlists) | Same hero/list migration as Album |
| `/search` | `SearchResults` | artist/album/track result sections, empty/error states; TopBar dropdown | `/api/catalog/search?q=&limit=50` (readplane) | none | - | Remote (federated) results exist (`origin`, node) but have no provenance treatment |
| `/settings` | `Settings` | Language, Playback (quality, infinite playback, smart transitions, crossfade, EQ, suggestions), Offline, Servers, Shows location, Sleep timer, Account (+ `ConnectDevicesSection`), OpenSubsonic credentials, Scrobble, Bandcamp, Links; `ThemeSkinSection` behind `VITE_LISTEN_APPEARANCE_SETTINGS_ENABLED` | `/api/auth/*`, `/api/me/location`, `/api/me/cities/search`, `/api/me/devices`, `/api/auth/subsonic-token`, `/api/me/scrobble/*`, `/api/bandcamp/me/*` | none | Everywhere (Devices, offline, servers, OpenSubsonic, languages, scrobbling) | Settings rows are v2 cards; the device list has no device-state visual. Personal access tokens (`AccessTokensSection`) and Smart Mix settings exist only on `smart-mix-phase-1` |
| `/people`, `/users/:username`, `/followers`, `/following` | `People`, `UserProfile`, `UserConnections` | profile hero, taste, match (`affinity_reasons` as rounded pills), library and network sections | `/api/me/social`, `/api/users/{u}/page`, `/api/users/{id}/follow`, `/api/users/search` | none | Together (follow, affinity) | No affinity visual; reasons are `rounded-full` pills (6 px in Listen) |
| `/jam*` | `JamSession`, `JamInvite` | full lobby/room UI | `/api/jam/*`, WS `/api/jam/rooms/{id}/ws` | WebSocket | Together (Jams, coming soon) | `JAM_ROOMS_ENABLED = false`; routes redirect to `/`. Out of scope for v3 visuals |
| `/bandcamp` | `Bandcamp` | status, radar grid (`MediaGrid`), items | `/api/bandcamp/me/status`, `/radar`, `/radar/refresh`, `/sync` | none | Live (Bandcamp) | v2 grid |
| `/upload` | `Upload` | drag/drop + chunked upload progress | `/api/acquisition/upload`, `/chunked`, `/chunk`, `/complete` | none | - | v2 |
| `/offline` | `OfflineLibrary` | offline-only library | local offline stores | `@capacitor/network` | Everywhere (offline) | v2 |

---

## 5. Page-by-page notes

### 5.1 Home

- Hero: artist imagery (`HomeTasteHero`, `HomeCanonicalHero`, `ArtistHeroFrame`) with greeting in
  `text-3xl font-bold` Poppins. The site uses display-face headlines; the greeting is the natural
  `font-display` candidate.
- Replay/"Listening DNA" (`components/home/HomeReplaySection.tsx`): already shows minutes/plays/artists
  and a mini signal tape from the same stats snapshot. It is the right place for a compact Heatmap or
  counters band (site chapter 05): `StatNumber size="lg"` x3, `MonoLabel accent="Stats" meta=["last 30
  days"]`, the tape below. The `/api/me/stats/dashboard` request here is an extra desktop-only fetch;
  keep it (snapshot-backed) but do not add more.
- Upcoming preview/show prep (`HomeUpcomingSection`, `HomeShowPrepSection`) should reuse the v3 ticket
  header (display artist, mono date/venue) instead of the v2 feature card.
- Sections use `SectionHeader` from `@crate/ui/domain/lists`; spec step 6 swaps its eyebrow for
  `MonoLabel`. One change there migrates every rail at once.

### 5.2 Explore

- `MoodBrowseSection` (`pages/ExploreLandingSections.tsx:194`): eight buttons with `MOOD_COLORS` built
  from `state-warning/info/danger/success`. v3 says amber is status only and cyan is the only accent, so
  this palette has to go regardless of MoodMap.
- MoodMap fits here as the Moods block: energy x valence plane, mood labels as real buttons (keyboard,
  screen readers, i18n), tap selects and shows the thresholds as a mono readout plus a "Play mood" CTA
  that keeps today's `/api/browse/mood/{mood}` playback. Backend contract in 7.3.
- `GenreExplorer` shows cover tiles. The Admin genre wheel (site `GenreWheel.astro`,
  `taxonomy-math.ts`: `buildTaxonomy`, `radialLayout`, `resolveEq`, `genreRoute`) becomes a real Admin
  feature; if Explore also adopts a wheel view ("Genre rooms"), the wheel is used by both apps and
  belongs in `@crate/ui` (it is not today). Listen already has the data source
  `/api/genres/taxonomy/tree` (only used by the Jam lobby, `hooks/use-jam-lobby-data.ts:34`).
- Time tunnels are pills; v3 chips (`CratePill`) with mono labels.

### 5.3 Radio

- Current: glow hero (`.radio-page-hero` with 90 px shadow + radial gradient in `recipes.css:1171`),
  pulsing session dot, two station rails, search panel.
- Data already in the radio payload per track (`radio_engine.py` serializers, `api/schemas/radio.py`):
  `bpm`, `audio_key`, `audio_scale`, `energy`, `danceability`, `valence`, `bliss_vector` (20-d),
  `distance`, `year`. `RadioTrack.score` exists in the schema but the engine does not fill it.
- Scoring weights: the site shows sound 0.34, artists 0.22, genre 0.16, BPM 0.09, energy 0.08,
  Camelot 0.05, era 0.03. These are the default/discovery constants (`db/paths_candidates.py`), but
  seeded radio uses per-profile weights (`radio_engine.py:96-101`: contextual 0.01/0.44/0.26, track
  0.16/0.30/0.20 for bliss/artist/genre). An in-app "Score" readout must show the weights of the
  profile actually used, so the session payload should carry `profile` and its `weights`.
- Feedback: like moves the target 8 % (capped at 40 %), dislike excludes a 0.10 radius
  (`_DISLIKE_PENALTY_RADIUS`). `/api/radio/session/{id}` exists; exposing the current target shift would
  let the UI animate the "like" step for real.
- Seed search issue: `use-radio-controller.ts` calls `search()` on every `onQueryChange` (no debounce)
  and fetches the full `/api/genres` list each time to merge genre matches.

### 5.4 Paths

- `PathDetail` already animates a 1D traveller along the steps; per-step data includes `bliss_vector`,
  `bpm`, `audio_key`, `energy`, `valence`, `distance`, `progress`.
- The site's PathsDive (route polyline through the library cloud with `START / 02 / END · BPM · key`
  labels) is feasible with the same projection artefact as Radio (7.6). The traveller should follow the
  currently playing step (read `currentTrack` from `usePlayerActions`, not progress).
- Payload gaps for the site copy: which planner produced the route (genre map, scenes, bliss line) and
  whether an LLM review ran are not in `db/paths_service_payloads.py`.
- `POST /api/paths` computes the path inside the request (`api/paths.py:49` -> `create_music_path`).
  Pre-existing; a richer "planning" visual should not encourage repeated synchronous recomputes.

### 5.5 Stats and Crate Digging

- The stats payload is a stale-first per-user `ui_snapshot` with a deduplicated refresh task
  (`db/user_stats_dashboard_surface.py`); it is safe for richer visuals.
- `StatsHeatmapCard` already uses the site's model (`cells`, `peak`, `night_share`). Gap is purely
  presentational: full-width band, night overlay (22-05 with share), peak cell ring, hover/focus readout
  (`Mon 22:00 · 123 min`), mono hour axis, cyan-hi alpha ramp with glow, staggered spring entrance.
  Cells are `<i>` with no keyboard access; the readout should also be reachable (roving focus or a
  visually hidden table).
- Headline counters (`StatsHeadlineNumbers`, `CountUpNumber`) -> `StatNumber` with a larger size step
  (site counters reach 8.4 rem; `StatNumber` tops at `text-5xl`), top genre as a scrambled word.
- `StatsSignalTape`, `StatsMiniTape` and decade bars are allowed hand-built SVG; restyle to hairline
  axes and mono labels.
- Digging: story chapters are a good fit for full-bleed display numerals. The share image builder must
  load Cabinet Grotesk/JetBrains Mono through `FontFace` before drawing, otherwise canvas bakes fallback
  glyphs.

### 5.6 Shows / Radar

Done in `50854a6e` (ticket header, mono metadata, perforation, numbered setlist with frequency).
Remaining: notches (CSS `mask` as on the site), "in library / missing" per song, playable count footer
(7.7), and the Home preview cards reusing the ticket header.

### 5.7 Artist and Album

- Spec rollout 4 and 5. The track list rows already carry `bpm`, `audio_key`, `energy`; a mono
  trailing readout (`124 · 8A`) on desktop rows would echo the site without new data.
- `ArtistSetlistSection` is the second setlist surface (modal, frequency bars in `accent-action/70`);
  it should become the same `HairlineList` rows as the ticket so both read identically.

### 5.8 Collection, Crates, Playlists, Search

- Tabs (`pages/Library.tsx` `TAB_ITEM_CLASS_NAME`) -> `CratePill`.
- Crate page keeps `CrateCoverFlow`; header and album order list move to mono labels and hairlines.
- Search results: remote tracks/albums from federated nodes have `origin: "remote"` and node data in
  the row model (`components/cards/TrackRowModel.ts`, `lib/playable-track.ts`); a mono provenance tag
  (`via north.crate`) is the Listen-side answer to the Federation chapter (7.5).

### 5.9 Settings

- Sections are `SettingsPrimitives` cards. v3: mono section headers, hairline rows, `StatusDot` for
  connection states (scrobble, Bandcamp, servers, OpenSubsonic credential).
- Devices: `ConnectDevicesSection` lives inside `AccountSection`, not at the top level; it is where a
  real Devices visual can live (7.6). It declares its own `ConnectDevice` interface, duplicating
  `lib/crate-connect.ts`.
- Tokens: `crate_v3` only has OpenSubsonic credentials (`/api/auth/subsonic-token`).
  `AccessTokensSection` (personal access tokens for the VDJ plugin) and `SmartMixSettings` are on
  `smart-mix-phase-1`; they will need the v3 treatment after the merge.

### 5.10 Social / profiles

- `UserProfileMatch` renders `affinity_reasons` as pills. An affinity visual (overlap of two listening
  profiles) is not on the site; the site's Together chapter only lists Follow / Affinity / Shared Crates
  / Federation / Jams. Keep it to v3 primitives (mono label, hairline reasons list).

### 5.11 Jam, Bandcamp, Upload

- Jam is gated off (`JAM_ROOMS_ENABLED = false`) and the site marks it "coming soon": no v3 work now.
- Bandcamp and Upload: plain migration to primitives; no site visual.

---

## 6. Player surfaces

| Surface | Files | Current visual | Live data | Site counterpart | Gap |
| --- | --- | --- | --- | --- | --- |
| Player bar (desktop + mobile mini) | `components/player/PlayerBar.tsx`, `bar/*` (`PlayerBarView`, `PlayerBarTransportControls`, `PlayerSeekBar`, `WaveformCanvas`, `QualityBadge`, `PlayerVolumeControl`) | Glass bar, `SpectrumPlayButton`, a masked `WaveformCanvas` behind the transport drawing the live FFT (`frequenciesDb`) | `usePlayerBarController` uses `usePlayer()` (re-renders per tick) + `useAudioVisualizer` (state at ~20 fps) | Devices mock (progress line), MixViz playhead | Spec step 3: mono time codes, display title; hairline progress |
| Extended player (desktop) | `ExtendedPlayer*.tsx`, `extended/*` (InfoTab, LyricsTab, QueueTab, SuggestedTab) | Artwork or WebGL visualizer on the left, tabbed panel on the right tinted by the album palette (`lib/palette.ts`) | `usePlayer()` | MixViz (up next transition), TrackReadout (Admin) for Info | No transition strip; Info tab uses `SectionCard` + `MetricBar` with `tone="warm"` (amber-ish) |
| Fullscreen player (mobile) | `FullscreenPlayer*.tsx`, `useFullscreenPlayer*` | Swipe-down sheet, artwork crossfade during transitions, tabs (player, queue, lyrics, info), mobile EQ glass sheet | `usePlayer()`, `crossfadeTransition` | MixViz (Android Smart Mix), EqViz | No transition strip; EQ sheet is `listen-mobile-eq-glass` (blur) |
| Queue | `QueuePanel.tsx`, `QueueTrackRow.tsx`, `extended/QueueTab*.tsx` | List rows | queue from `usePlayerActions` | MixViz compact (between current and next) | Natural home for the planned-transition line (mode, bars/seconds, Camelot, LUFS) |
| Lyrics | `LyricsPanel.tsx`, `extended/LyricsTab.tsx`, `LyricsLine.tsx`, `use-lyrics.ts` | Synced lines, tap-to-seek, smooth scroll | `/api/lyrics`; `usePlayerProgress()` at list level | "Synced lyrics with tap-to-seek" (copy only) | Progress subscribed by the whole list instead of a leaf (re-renders all lines per tick) |
| EQ panel / popover | `EqualizerPanel.tsx`, `EqualizerPanelSections.tsx`, `EqualizerSmartReadout.tsx`, `EqualizerPopover.tsx`, shared `EqBands.tsx`, `lib/equalizer.ts`, `lib/adaptive-eq.ts`, `hooks/use-equalizer*.ts`, `use-effective-eq.ts` | v3 done: hairline grid, glowing curve, bars from 0 dB, display numerals, mono chips, Smart EQ chain | presets, adaptive EQ, effective EQ resolution | EqViz | Spring morph between presets (site: per-band spring; product: CSS `transition-[top] ease-snap` on handles only); chain labels hardcoded English; chips are 6 px in Listen; mobile sheet still glass; no live spectrum underlay (only possible with an analyser) |
| Visualizer | `player/visualizer/*` (`MusicVisualizer`, WebGL2 spheres, 10-pass bloom, `visualizer-quality.ts`, palette from album) | Spheres + bloom, album palette optional | `AnalyserNode` (fft 2048) | "a WebGL visualizer" (copy only) | Default palette should be cyan/cyan-hi; album palette as an opt-in |
| Spectrum ribbon / spectrum play button / spinning disc | `SpectrumRibbonCanvas.tsx`, `SpectrumPlayButton.tsx`, `SpinningDisc*.tsx` | Canvas 2D ribbon, CD mode (`PlayerSurfaceMode` cd/cover/visualizer) | analyser | - | Keep as player identity; recolour to cyan ramp |
| Playback targets | `PlaybackTargetButton/Menu/Popover.tsx`, `lib/playback-target-*.ts` | Popover list | Cast, Crate Connect, native | Devices | See 7.6 |
| Radio feedback | `RadioFeedback.tsx` | like/dislike buttons | `/api/radio/feedback` | Radio dive step 5 | No visual of the target shift |

Render-loop notes (AGENTS hard rules):

- `hooks/use-audio-visualizer.ts` copies the analyser into new `number[]` arrays (1024 bins + 2048
  waveform samples) and calls `setFrequenciesDb`/`setWaveform` every third frame (~20 fps). Consumers:
  `usePlayerBarController` (whole bar view) and `layout/sidebar/Sidebar.tsx` (only to compute a glow
  strength during Discovery radio). Any new v3 visual that wants live spectrum should read the analyser
  inside its own rAF loop via refs (the pattern `WaveformCanvas`/`SpectrumRibbonCanvas` already use for
  drawing), not through React state.
- `useCrossfadeProgress` sets state every frame during a transition; acceptable for short fades but a
  MixViz playhead must write SVG attributes directly (site pattern) to avoid re-rendering the player.

---

## 7. Site visual -> Listen feature mapping

Each entry: target surface, data available on `feat/crate_v3`, missing data and where it must be
computed, rendering approach, platform notes, and placement (`@crate/ui` only if Admin uses it too).

### 7.1 MixViz (Smart Mix strip)

- Target: player. (a) "Next transition" strip at the top of the Queue tab / QueuePanel and in the
  ExtendedPlayer info area; (b) live strip in FullscreenPlayer/ExtendedPlayer while a transition runs.
- Data on `crate_v3`: `CrossfadeTransition {outgoing, incoming, durationMs, startedAt}` in player state;
  client smart-transition seconds (`contexts/player-smart-transition.ts`: 2/4/6 s, mixed queue 3 s,
  Android continuous album 1 s); tracks carry `bpm`, key, energy. Enough for an honest
  "crossfade N s, equal power, A key -> B key" strip without waveforms or beat grid.
- Data on `smart-mix-phase-1` (needed for the site version): `GET /api/tracks/by-entity/{uid}/mix-profile?detail=summary|full`
  (`bpm`, `beatAnchorMs`, `downbeatAnchorMs`, `beatGridMs` on full, `camelot`, `introCueMs`,
  `outroCueMs`, `introLufs`, `outroLufs`, `integratedLufs`, intro/outro energy and spectral density,
  quality); `POST /api/playback/transition-plans` (`mode` gapless/adaptive/beatmatch, `durationMs`,
  `outgoingCueMs`, `incomingCueMs`, `incomingTempoRatio`, `beatPhaseOffsetMs`, gains in dB,
  `curve: equal-power`, `bassHandoff`, `confidence`, `fallbackReason`); native
  `EngineTransitionEvent {type, durationMs, progress, outgoing/incoming index/id}` resolved by
  `lib/native-transition-visual.ts`.
- Waveform lanes: there is no per-track waveform today. Options: (1) bars from `intro/outro energy`
  only (stylised, honest label); (2) energy envelope from the worker-generated cast spectrum artefact
  (`crate/cast_spectrum.py`: CRSP v1, 24 bands, 100 ms frames) - currently only reachable through a
  Cast session lease (`/api/cast/sessions/{lease}/items/{item}/spectrum`), so Listen would need an
  authenticated per-track read endpoint that returns the cached artefact or 202 + a deduplicated
  generation task. Never generate in the request.
- Render: SVG built once per transition (site `mix-view.ts`), playhead/clip/gain meters updated by a rAF
  loop through refs; reduced motion shows the mid-fade state; pause when hidden
  (`lib/motion-availability.ts`).
- Platform: Smart Mix is Android-only (two native decks). Web/desktop show the crossfade variant;
  iOS stable pipeline decodes one track (no crossfade), so the strip should read "gapless" or "cut".
  Fallback reasons (`low_confidence`, `incompatible_tempo`, ...) deserve a mono line, not a toast.
- Placement: Listen-local (`components/player/`). Move to `@crate/ui/domain/player` only if the Admin
  Smart Mix inspector (`smart_mix_admin.py` on the branch) renders plans with it.
- Dependency: merge `smart-mix-phase-1` (or at least its API + `lib/smart-mix.ts`) before building the
  full version.

### 7.2 EqViz

- Target: `EqualizerPanel` (desktop popover, mobile fullscreen sheet). Mostly done.
- Remaining: per-band spring when switching presets (port `stepSpring` from `eq-math.ts`, drive the SVG
  path through refs, not state); i18n the chain labels (`EqualizerSmartReadout.tsx:83-90` hardcodes
  "User track preset", "Curator album preset", ...; violates the Listen i18n hard rule and is now shown
  six at a time); decide pill radius (spec risk "Pills"); flatten the mobile glass sheet.
- Platform: WebAudio EQ is unavailable on iOS/Android stable pipeline (`canUseWebAudioEffects`).
  `smart-mix-phase-1` adds `NativeEqController.java` on Android; after the merge the panel must gate on
  "EQ available on this engine", not on WebAudio.
- Placement: `EqBands` already shared (Admin genre EQ editor uses it).

### 7.3 MoodMap

- Target: Explore Moods block (replaces `MOOD_COLORS` tiles). Optional: player Info tab "where this
  track sits" dot on the same plane (track `energy`/`valence` are in `TrackInfo`).
- Data today: `MOOD_PRESETS` (server) equal to the site's `MOODS`; per-mood `track_count` from
  `api_browse_moods` (`api/browse_media.py:1672`) via `count_mood_presets`
  (`db/queries/browse_media_mood.py`): `COUNT(*) FILTER (...)` over `global_catalog_tracks` LEFT JOIN
  `library_tracks` and `track_analysis_features`, run inside the request whenever the 10-minute cache
  misses. That breaks the "no COUNT over library_tracks in HTTP" rule.
- Needed: a worker-built, deduplicated `explore_mood_map` snapshot (projector-warmed after analysis
  batches, or a scheduled task): energy x valence histogram (for example 32x32 bins, counts),
  per-mood counts (replacing the request-time COUNT), and optionally a stratified sample of up to ~1,500
  `{track_entity_uid, energy, valence}` for hover-to-preview. One CTE, one `read_scope` to serve it;
  FastAPI reads the snapshot (readplane can serve it later).
- Render: canvas 2D with pre-rendered sprites and `lighter` compositing (site `mood-view.ts`), density
  drawn from the histogram instead of fake gaussians; DOM buttons for labels; mono readout of the
  thresholds (`energy ≥ 0.70 · danceability ≥ 0.50`); auto-cycle only when visible and not reduced.
- Mobile: halve sprites (site does 90 vs 190 per mood); cap DPR at 2 (site does).
- Placement: Listen-local unless Admin analytics adopts it.

### 7.4 Heatmap + counters

- Target: Stats "Listening" section (make it a full-width band at the top of the analytics part) and a
  compact version in Home Replay.
- Data: complete today (`heatmap`, `overview`, `highlights.artist_count`, top genres) from the
  snapshot-backed dashboard; global variant from `/api/stats/dashboard`.
- Render: CSS grid as the site (168 elements are cheap), CSS custom properties per cell, staggered
  spring entrance, hover/focus readout. Keep `stats-reveal` and reduced-motion fallbacks. Restrict
  per-cell `box-shadow` glow on mobile to the top quantile to keep paint cheap.
- Placement: Listen-local (Stats is a Listen surface; Admin has no heatmap).

### 7.5 Federation

- Not a Listen page. Pairing, descriptors, grants and keys are Admin concerns and should not leak into
  Listen.
- Listen analogue with real data: provenance of remote items. `Track.remote: RemoteTrackRef`
  (`nodeUid`, `nodeName`, `availability {catalog, stream, import, stale, healthy}`, `playbackSession`)
  and `lib/playback-provenance.ts` (`origin: local | remote | imported`). A small route diagram in the
  player Info "Source" section (peer node -> your node -> this device, "relayed") and a mono
  `via <nodeName>` tag in rows/search would carry the Together chapter's message.
- Placement: Listen-local; the full Federation diagram is an Admin feature.

### 7.6 Devices

- Target: Settings > Devices (promote `ConnectDevicesSection` out of Account) and the playback target
  popover.
- Data: `/api/me/devices` (`device_type`, `app_platform`, `app_version`, `active`, `last_seen_at`),
  `/api/me/connect/session` (`active_device_id`, `status`, `state_revision`), cast sessions
  (`/api/me/cast/sessions`), live via the Crate Connect WebSocket (`hooks/use-crate-connect-ws.ts`,
  ticketed through `/api/me/connect/ws-ticket`) and the commands SSE (`/api/me/connect/events`).
- Render: line-art device glyphs per `app_platform` (desktop, Android, iOS/PWA, Cast; Subsonic clients
  are not Connect devices and should not be drawn as live), `StatusDot` presence, the active device's
  progress line from `use-remote-playback-state.ts` for remote and from a progress leaf for local.
- Placement: Listen-local.

### 7.7 Setlist ticket

- Done except ownership. `probable_setlist` items carry title + frequency only.
- Needed: precompute `in_library` (and optionally the matched `track_entity_uid`) per setlist song when
  the upcoming snapshot is built, batching title matches per artist with `ANY(:ids)`, never per request
  and never with a per-row loop. `/api/artists/{id}/setlist-playable` does a per-request match for one
  artist today; fine for the artist page, not for a list of tickets.
- Render: site `Setlist.astro` (notch mask, rows with "in library / missing", "N of M playable" footer
  + round play button).

### 7.8 Radio and Paths field dives

- Target: `/radio` (session map: seed, picks, liked shift) and `/paths/:id` (route through the map with
  per-step labels, traveller on the playing step). Not scroll-scrubbed stories: in the app the field is
  a live instrument tied to the session and playback. GSAP is not a Listen dependency; do not add it.
- Data available: per-track 20-d `bliss_vector` and `distance` in radio and path payloads.
- Needed: a shared projection so tracks land in the same place every time: a worker task (dedup key per
  library revision) that computes the PCA basis (3x20 components + mean + radius) and a sampled cloud of
  N tracks as int16 coordinates, the same format as the site's `library-cloud.bin`
  (`export_site_library.py`, which lives only in the website worktree together with
  `crate/db/queries/site_library_sample.py`). Store as a snapshot/artefact; serve it cached with an ETag
  (readplane-friendly). The client projects the 20-d vectors of seed/picks/steps with the basis (a
  3x20 multiply, trivial) so the radio/path payloads need no extra query. Optionally return
  `score`, `profile` and `weights` in the radio session payload, and planner info in paths.
- Render: port `field/renderer.ts` (WebGL2 points with soft sprites, focus glow) + SVG overlay. Point
  budget: 14K desktop, 6K mobile (site values), lower on Tauri Linux if needed. Fallback when WebGL2 is
  unavailable or the context is lost: static 2D canvas of the same points (site toggles `no-gl`).
  Lazy chunk only on `/radio` and `/paths/:id`.
- Placement: Listen-local (`components/radio/`, `components/paths/`, shared `lib/sound-map/`).

### 7.9 Genre wheel (cross-app note)

Admin owns the real taxonomy wheel. If Listen Explore and the Paths "genre map" planner readout use the
same radial layout, the wheel component and `taxonomy-math` equivalents go to `@crate/ui` (used by both
apps). Listen's data source would be `/api/genres/taxonomy/tree` (already exposed).

---

## 8. Realtime mechanisms

| Mechanism | Where | Notes for v3 visuals |
| --- | --- | --- |
| SSE `/api/cache/events` | `lib/cache.ts` `connectCacheEvents()` at startup | Scoped invalidation; `Last-Event-ID` persisted; degrades after silence. Snapshot-backed visuals refresh through this, no polling needed |
| SSE `/api/me/home/discovery-stream` | `pages/use-home-discovery-stream.ts` | Served by the Go readplane; keeps highest `snapshot.version`; degrades to 60 s refresh |
| SSE `/api/events`, `/api/events/task/{id}` | `hooks/useRemoteImport.ts`, `components/crates/crate-download.ts` | Task progress (remote import, Crate ZIP) |
| SSE `/api/me/connect/events` + WS `/api/me/connect/ws` (ticket) | `contexts/use-crate-connect-commands.ts`, `hooks/use-crate-connect-ws.ts` | Device control/state; feeds Devices |
| WS `/api/jam/rooms/{id}/ws` | `hooks/use-jam-websocket.ts` | Flagged off |
| Polling | stats pending refresh (1.5 s x 40), auth heartbeat, device presence (`/api/me/devices/current/presence`), now-playing POST, play-event queue | Stats visuals must tolerate `snapshot.pending` (cold dashboard) |
| Cast | `lib/cast-sender*.ts`, `/api/me/cast/*` | Cast receiver has its own spectrum artefact |
| Native events | `contexts/subscribe-native-player-events.ts`, `use-native-playback-event-bridge.ts` | Android transitions; Smart Mix progress after merge |

Rules to keep: no `currentTime`/`isPlaying` in effect deps that open SSE/WS/timers; per-frame drawing
through rAF + refs; subscribe to `usePlayerProgress()` only in leaf components.

---

## 9. Platform constraints (Capacitor iOS/Android, Tauri, web)

Audio and analysis

- iOS/Android default to the stable pipeline: HTML5 audio, WebAudio off, one decoded track
  (`lib/mobile-audio-mode.ts`). No `AnalyserNode` -> no live spectrum, waveform, sphere visualizer or
  EQ unless "enhanced audio" was enabled at startup. Android uses the native engine
  (`lib/android-native-engine.ts`); Smart Mix adds native decks and native EQ on the branch.
- Consequence: mobile visuals must be data-driven (analysis fields, mix profiles, cast spectrum
  artefact, snapshots). Desktop/web can add live layers on top.

Graphics

- WebGL2: the existing visualizer already requires WebGL2 (`visualizer-webgl-resources.ts`). iOS floor
  is 15.0 (`IPHONEOS_DEPLOYMENT_TARGET`), where WKWebView has WebGL2; Android minSdk 24 uses the
  updatable Chromium WebView. Old/low-end Android GPUs need the 2D fallback.
- Tauri Linux: WebKitGTK >= 2.40, hardware acceleration forced to `Always` (`src-tauri/src/lib.rs`), a
  `tauri-linux` visualizer quality profile exists (currently identical to default). WebKitGTK WebGL
  performance varies by driver; field visuals need a point-count knob.
- Tauri CSP (`tauri.conf.json`): `default-src 'self'`, `script-src 'self'`, `font-src 'self' data:`.
  No `worker-src`/`blob:`: an OffscreenCanvas worker must be a Vite-emitted file, not a blob URL. Fonts
  must stay bundled (they are).
- Animated `filter: blur()` (the site's `enter-up`) is costly on Android WebView and WebKitGTK; use
  opacity + transform in the app, or blur only on desktop web.
- `visibleLoop` equivalent is mandatory: stop rAF when off-screen or `document.hidden`
  (`isMotionBlocked()` already folds visibility + reduced motion + `data-crate-motion`). Tauri has
  `backgroundThrottling: disabled` for audio; it does not excuse loops in hidden windows.

CSS features

- Spring tokens use CSS `linear()` (`tokens/animations.css`). Unsupported before Safari 17.2 (iOS 15/16
  WKWebView) and old Android WebViews: the declaration becomes invalid and falls back to `ease`. Wrap
  spring usage in `@supports (transition-timing-function: linear(0, 1))` with an `ease-snap` fallback.
- `mask` with radial gradients (ticket notches) works on iOS 15 with `-webkit-mask`.

Fonts and type

- Cabinet Grotesk (500/700/800) and JetBrains Mono (latin + latin-ext 400) ship on every runtime
  (`index.css` imports); Poppins only on web (`main.tsx`), system font on native. Native therefore mixes
  system body + brand display/mono; this is the open spec decision.
- Canvas text (share stories, any label drawn into a canvas) must await `document.fonts.load(...)`.
  Prefer DOM labels over canvases (the site does this for MoodMap).
- Mono uppercase labels in seven languages: Catalan/Basque/German strings are longer; labels need
  wrapping (`min-w-0`, `text-balance`) and translations of every key (catalog checks).

Shell and layout

- Safe areas via `--listen-safe-*`, mobile bottom chrome height, fullscreen EQ offset
  (`index.css:160-205`). Full-bleed bands must respect them.
- Linux desktop theme (`app/listen-desktop/src/lib/linux-theme.ts`, `linux-theme.css`) maps the GTK
  accent onto `--color-primary` (so `accent-action`) while `--accent-action-hi` stays cyan. v3 needs a
  decision: keep cyan everywhere, or derive the hi accent from the GTK accent.
- Bundle: 300 KB initial gzip; field/mood/mix code must be lazy per route/surface.

---

## 10. Issues found during the audit

| Severity | Issue | Location | Note |
| --- | --- | --- | --- |
| Medium (rules) | Mood preset counts run `COUNT(*) FILTER` over `global_catalog_tracks` ⋈ `library_tracks` ⋈ `track_analysis_features` inside `/api/browse/moods` / `/api/browse/explore-page` on cache miss | `api/browse_media.py:1672`, `db/queries/browse_media_mood.py` | Precompute in the MoodMap snapshot (7.3) |
| Medium (perf) | `useAudioVisualizer` pushes new 1024/2048-element arrays into React state at ~20 fps; re-renders `usePlayerBarController` and `Sidebar` | `hooks/use-audio-visualizer.ts:44-72`, `components/layout/sidebar/Sidebar.tsx:21` | Move to a ref-based analyser store read in rAF |
| Medium (i18n) | Smart EQ chain labels hardcoded in English, now all six rendered | `components/player/EqualizerSmartReadout.tsx:83-90` | Pre-existing map, amplified by `d91d2c1a`; needs keys in 7 catalogs |
| Low (perf) | Radio seed search: no debounce, refetches full `/api/genres` per keystroke | `pages/use-radio-controller.ts:42-63` | Debounce + cache genres once |
| Low (perf) | Lyrics panels subscribe to `usePlayerProgress()` at list level | `components/player/LyricsPanel.tsx:41`, `extended/LyricsTab.tsx:13` | Active-line leaf |
| Low (design) | Decorative use of state colours (amber/red/green) | `pages/ExploreLandingSections.tsx:20-29` (`MOOD_COLORS`), `extended/InfoTabBliss.tsx` (`tone="warm"` -> `.info-tab-metric-fill[data-tone="warm"]` gradient from `--state-warning`, `recipes.css:931`) | v3: cyan only, amber for status |
| Low (design) | Linux GTK accent overrides `--color-primary`, `accent-action-hi` stays cyan | `app/listen-desktop/src/linux-theme.css`, `lib/linux-theme.ts:98-105` | Decision needed |
| Low (cleanup) | `leaflet`/`react-leaflet`/`@types/leaflet` unused; `.upcoming-map` and Leaflet overrides dead | `app/listen/package.json`, `src/index.css:590-639` | Remove separately |
| Low (cleanup) | Duplicate `ConnectDevice` interface | `components/settings/ConnectDevicesSection.tsx:33`, `lib/crate-connect.ts:59` | Reuse the lib type |
| Info | Site radio weights are the default/discovery profile; seeded profiles differ | `radio_engine.py:96-101`, `db/paths_candidates.py:13-19` | Any in-app readout must show real profile weights |
| Info | `POST /api/paths` computes synchronously in the request | `api/paths.py:49` | Pre-existing; watch if the Paths visual increases usage |
| Info | Share-story canvas embeds Poppins | `lib/social-share-story-builder.ts:42-50` | Switch to v3 faces with `FontFace` loading |
| Info | Spec points to `components/lab/viz` | `docs/plans/2026-10-14-crate-v3-design-system.md` | Path is `components/viz` |

---

## 11. Visual pattern inventory (Listen `src`, non-test `.tsx`)

| Pattern | Files / hits | v3 direction |
| --- | --- | --- |
| `backdrop-blur` | 43 / 55 | Flat surfaces; keep blur only where content scrolls under chrome (top bar, player bar) |
| `listen-glass*` | 16 / 18 | Same |
| `rounded-xl` | 71 / 116 | `rounded-panel` (14 px) for cards, hairline borders |
| `rounded-panel` | 63 / 74 | Already moved to 14 px by the token change |
| `shadow-*` | 70 / 125 | Remove on flat cards; keep for popovers/modals |
| `uppercase tracking*` hand-rolled labels | 57 / 84 | `MonoLabel` |
| `font-mono` | 13 / 22 | Now resolves to JetBrains Mono |
| `font-display` | 2 / 2 | Titles, names, numerals |
| `CrateBadge` | 33 / 135 | Keep (badge policy); mono variant where it is metadata |
| `GenrePill` | 8 / 17 | Keep (policy); align to `CratePill` look |
| v3 primitives (`MonoLabel`, `StatusDot`, `StatNumber`, `HairlineList`, `CratePill`, `accent-action-hi`) | 6 files | Roll out per spec order |

---

## 12. Suggested sequencing (Listen)

1. Finish the cheap, data-complete pieces: Heatmap band + counters on Stats and Home (front-end only);
   EQ springs + i18n chain labels; ticket notches.
2. Spec steps 3-6 (player bar/fullscreen type, artist, album, home headers) with the primitives.
3. Backend precomputes, each as a deduplicated worker task writing a snapshot: upcoming setlist
   `in_library`; Explore mood map (also removes the request-time COUNT); sound-map projection basis +
   cloud.
4. MoodMap on Explore; Radio session map; Paths route map (lazy chunks, WebGL2 with 2D fallback).
5. After merging `smart-mix-phase-1`: MixViz strip in queue/extended/fullscreen, native EQ gating,
   Access tokens + Smart Mix settings in v3 style.
6. Devices visual in Settings + playback target popover; provenance tag for remote items.

Each step ships its tests (Vitest + Testing Library for components, pure-math unit tests for projection,
spring and layout helpers as the site does in `*-math.test.ts`, pytest for every new snapshot builder),
i18n keys in all 7 catalogs, and intentional visual snapshot updates (`npm run test:listen-visual`).

---

## 13. Open questions

- Pill radius in Listen: lift the `radius-lg` pin so `CratePill`/CTAs render as true pills like the
  site?
- Native fonts: keep Cabinet/JetBrains on iOS/Android with a system body, or system display/mono on
  native?
- Album-palette tinting of the extended player and visualizer: keep as an option or go cyan-only?
- Should the Admin genre wheel also power a Listen "Genre rooms" view (then it moves to `@crate/ui`)?
- Merge plan for `smart-mix-phase-1` relative to `feat/crate_v3` (MixViz depends on it)?
- Linux desktop: honour the GTK accent or enforce cyan?
- Is a Listen-facing per-track spectrum endpoint (from the cast spectrum artefact) acceptable for
  mobile-safe visuals, given generation cost on the analysis worker?
- AGENTS currently whitelists only the Stats tape/heatmap/decade bars as custom SVG; should the
  `/listen` visualisations (MixViz, MoodMap, sound map) be added to that exception explicitly?

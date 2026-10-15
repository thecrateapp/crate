# Crate v3 analysis: inventory of the site's live visualisations

Status: analysis input for `feat/crate_v3`. Read-only survey; no product code changed.

The only visual reference is the new site in `worktrees/website/app/web`, branch `feat/website`
at `258bbaee`. Its merge base with `origin/main` is `b63e53b7`, the same base `feat/crate_v3`
uses. Every repo file the site's drift tests read is therefore the same file the v3 product
work starts from.

Out of scope: `design/crate_vnext` was ignored. The `app/web/prototypes/*.html` hero
experiments (Signal Lock, Paths, Order, Mark, Spectrum, Digging, Shelf, Crate, Now Playing)
are not served by the site and are only listed in the last section.

Path note: `docs/plans/2026-10-14-crate-v3-design-system.md` points at
`components/lab/viz/*.astro`. That path does not exist. The components live in
`app/web/src/components/viz/*.astro`, and their runtime is in `app/web/src/scripts/viz/*`.

---

## 1. Summary table

Realness is graded on this scale:

- **copied+drift**: a constant copied from app code, with a vitest that reads the app source
  file and fails if the two diverge.
- **copied**: a constant copied from app code with no source test.
- **ported**: app logic re-implemented in TypeScript and tested against hand-written
  expectations, not against the Python.
- **example**: hand-written illustrative values.
- **synthetic**: seeded PRNG data (`mulberry32`).
- **recorded**: real screen recordings.

| # | id | Page · chapter | Component | Realness on the site | Product |
|---|----|----------------|-----------|----------------------|---------|
| 1 | hero-particle-mark | `/` hero | `Hero.astro` + `scripts/hero/mark.ts` | synthetic (has an unused hook for a real library cloud) | none |
| 2 | screencast-walkthrough | `/` | `Screencast.astro` | recorded | none |
| 3 | inside-tile-eq | `/` Inside Crate | `InsideCrate.astro` | copied+drift (presets) | listen |
| 4 | inside-tile-path | `/` Inside Crate | `InsideCrate.astro` | copied+drift (taxonomy) + ported (Dijkstra) | listen |
| 5 | inside-tile-heatmap | `/` Inside Crate | `InsideCrate.astro` | synthetic | both |
| 6 | inside-tile-health | `/` Inside Crate | `InsideCrate.astro` | copied+drift (17 checks) | admin |
| 7 | health-scan | `/admin` 01 Health | `viz/HealthScan.astro` | copied+drift checks, example findings | admin |
| 8 | album-sidecar | `/admin` 02 Imports | `viz/AlbumSidecar.astro` | copied+drift keys and ids, example values | admin |
| 9 | release-timeline | `/admin` 03 Acquisition | `viz/ReleaseTimeline.astro` | copied+drift task names, example release | admin |
| 10 | enrichment-orbit | `/admin` 04 Enrichment | `viz/EnrichmentOrbit.astro` | copied+drift sources, TTLs, intervals and parallelism; synthetic durations | admin |
| 11 | genre-taxonomy-wheel | `/admin` 05 Genres | `viz/GenreWheel.astro` | copied+drift (61 genres, relations, signed release) | both (admin first) |
| 12 | genre-eq-inheritance | `/admin` 05 Genres | `viz/GenreWheel.astro` (panel) | copied+drift presets + ported BFS | both |
| 13 | track-analysis-readout | `/admin` 06 Analysis & Insights | `viz/TrackReadout.astro` | example values, drift-checked feature names | both |
| 14 | queue-lanes | `/admin` 07 Operations | `viz/QueueLanes.astro` | copied+drift (generated `scale.json`), synthetic traffic | admin |
| 15 | resource-governor-gauges | `/admin` 07 Operations; `/architecture` story 08 | `viz/GovernorGauges.astro` | copied+drift thresholds, ported evaluation, synthetic load | admin |
| 16 | smart-mix-crossfade | `/listen` 01 Play | `viz/MixViz.astro` | example plan + ported equal-power maths | listen |
| 17 | eq-curve | `/listen` 01 Play | `viz/EqViz.astro` | copied+drift (21 presets, 10 bands, ±12) | both (already ported in v3) |
| 18 | radio-dive | `/listen` 02 Radio | `listen/RadioDive.astro` (WebGL) | synthetic cloud; weights copied without a test | listen |
| 19 | paths-dive | `/listen` 03 Paths | `listen/PathsDive.astro` (WebGL) | synthetic cloud and readouts | listen |
| 20 | mood-map | `/listen` 04 Discover | `viz/MoodMap.astro` | copied+drift thresholds, synthetic points | listen |
| 21 | listening-heatmap | `/listen` 05 Yours | `viz/Heatmap.astro` | synthetic ("synthetic listener") | both |
| 22 | federation-relay | `/listen` 06 Together | `viz/Federation.astro` | example | admin |
| 23 | devices-row | `/listen` 07 Everywhere | `viz/Devices.astro` | example (CSS only) | listen (low) |
| 24 | setlist-ticket | `/listen` 08 Live | `viz/Setlist.astro` | example | both (Listen already ported in v3) |
| 25 | api-capabilities-terminal | `/developers` 01 APIs | `viz/ApiTerminal.astro` | copied, drift test skipped on main | none |
| 26 | token-allowlist | `/developers` 02 Tokens | `viz/TokenAllowlist.astro` | ported matcher, drift test skipped on main | listen (low, blocked) |
| 27 | roadmap-cards | `/developers` 06 Working on | `developers/Roadmap.astro` | example | none |
| 28 | system-map | `/architecture` 01 System map | `architecture/SystemMap.astro` | hand-authored, structural tests only | admin |
| 29 | like-trace | `/architecture` 02 Follow one like | `architecture/Trace.astro` | hand-authored | none |
| 30 | outbox-sequence | `/architecture` 03 Stories #02 | `viz/OutboxSequence.astro` | example | admin (optional) |
| 31 | redis-pair | `/architecture` 03 Stories #04 | `viz/RedisPair.astro` | copied+drift flags, example keys and writes | admin (optional) |
| 32 | uuid-derivation | `/architecture` 03 Stories #06 | `viz/UuidDerivation.astro` | ported (UUIDv5), computed at build time | none |
| 33 | scale-figures | `/architecture` 04 Scale | `architecture/ScaleFigures.astro` | generated from the repo at prebuild | none |

Totals: 33 visuals.

- 11 have a source-reading drift test on at least part of their data.
- 2 have source tests that skip on `main`, because the code they check only exists on the
  unmerged Smart Mix branch.
- 20 rely on example or synthetic data for the part that moves.

---

## 2. Visual language the visuals share

These rules are common to every visual and should become product primitives or tokens.

- **Frame.** Every visual is a `<figure>` with `padding-top: 22px; border-top: 1px solid var(--line)`.
  It opens with a `.viz-bar` header: a flex row of two `.viz-label`s, justified apart.
- **Label.** `.viz-label` is JetBrains Mono 11 px, uppercase, `letter-spacing: .14em`, `--fg-3`
  and tabular numbers. The first `<b>` is the key word, in `--cyan-hi` with a 10 px gap.
  Metadata parts are joined with ` · `.
  This is the v3 `MonoLabel`.
- **Numerals.** Cabinet Grotesk 800 at `clamp(2.8rem, 5.6vw, 5.4rem)`, `line-height .85`,
  `letter-spacing -.05em`, tabular. Used by Health totals, the release clock, heatmap counters,
  queue counts, the wheel's centre and its legend.
  This is the v3 `StatNumber`.
- **Rows.** Hairline lists with `rgba(241,245,249,.06)` dividers, zero-padded mono indices
  (`01`), and a scanning state drawn as a 2 px cyan bar on the left plus a cyan gradient wash.
  This is the v3 `HairlineList`.
- **Chips.** Pills with `min-height: 32px`, a hairline border, mono 11 px and a transparent
  idle state. Hover gives a cyan .4 border; active is solid `--cyan-hi` with `--bg` text;
  press scales to `0.95` with `--spring-snappy`.
  This is the v3 `CratePill`.
- **Colour.** Cyan is the only accent: `--cyan #06b6d4` for fills and glows, `--cyan-hi #67e8f9`
  for curves, active chips and key words. Amber `#fbbf24` is reserved for status: "confirm"
  badges, "waiting" results, governor breaches, deferred chips and the coming-soon or
  optional-LLM badges.
- **Cards.** `#0d0e14` with a 14 px radius and a hairline border. Used only for the JSON
  sidecar, the terminal and the ticket.
- **Motion tokens.** Copied into v3 already:
  - `--spring-snappy` and `--spring-smooth`, as `linear()` springs.
  - `--ease-out` (.16,1,.3,1), `--ease-snap` (.22,1,.36,1), `--ease-in-out` and
    `--ease-dramatic`.
  - `enter-up`: 22 px rise plus 8 px blur, 0.7 s spring-snappy, with stagger through `--d`
    or `--i * N ms`.
- **Data-driven motion.**
  - Values animate through a damped spring integrated per frame, `stepSpring(value, target,
    dt, stiffness, damping)` in `scripts/viz/eq-math.ts`. It is used for the EQ, the wheel's
    mini EQ, the analysis readout and the Inside EQ tile.
  - Text changes use `scrambleText` (glyph scramble, 360-1100 ms).
  - Counters use `initCounters`, a 1.6 s count-up once 60% visible.
- **Lifecycle** (`scripts/viz/index.ts`, `scripts/viz/loop.ts`):
  - Each `[data-viz]` root is lazy-loaded by IntersectionObserver with a `60%` root margin,
    as a dynamic import chunk.
  - The `requestAnimationFrame` loop runs only while the visual is visible and the tab is not
    hidden (`visibleLoop`), and `dt` is capped at 50 ms.
  - Every view returns a cleanup that restores the final static state.
  - Under reduced motion, each view renders its final state and stops.
  - CSS-only visuals (Devices, Roadmap) use `[data-playing]`, which toggles `.is-playing` while
    in view.
- **Product implication.** In React, the equivalent is a `useVisibleFrame(ref, cb)` hook that
  stores per-frame values in refs. The repo rule that SSE and WebSocket effect deps must never
  include per-frame values applies directly: springs and clocks must live in refs, never in
  state or dependency arrays.

---

## 3. Per-visual inventory

### Home (`/`)

#### 1. hero-particle-mark

- **Files:**
  - `src/components/Hero.astro`
  - `src/scripts/hero/mark.ts`
  - `src/scripts/field/renderer.ts`: raw WebGL2 point renderer, about 300 lines of GLSL and
    buffers, no three.js.
  - `src/scripts/field/math.ts`: `perspective`, `lookAt` and `project`.
  - `src/scripts/field/sources.ts`
- **Shows:** a full-viewport fixed canvas with 40,000 points (12,000 on mobile).
  - Points start as 16 gaussian clusters and morph into the Crate logo over 2.6 s with
    `power3.inOut`. The logo shape is sampled from the alpha of `/icons/logo.svg`, lifted 0.62.
  - Points carry per-point jitter and depth alpha. They brighten and grow near a focus point,
    and are repelled by the pointer.
  - A mono caption under the mark reads "48,213 tracks · one library". The number comes from
    `data/scale.json.tracks`, which is maintained by hand; the generator keeps the existing
    value.
- **Data:** `clusterCenters` and `cloudPositions` with `Math.random`. `loadLibraryCloud()`
  tries `/data/library-cloud.json` (`{count, radius}`) and `/data/library-cloud.bin`
  (Int16-quantised xyz) and swaps the real cloud in. **Neither file exists in `public/`, and
  no exporter exists anywhere in the repo.** The hook is designed for a real projection of the
  library, probably bliss vectors, but it is unused today.
- **Interaction:**
  - With a fine pointer, pointer moves give parallax (yaw ±0.18, pitch ±0.1) and push a repel
    field.
  - Scrolling the 200vh `.hero-pin` is scrubbed with ScrollTrigger: the mark un-morphs back
    to the cloud over the first 45%, the camera dives in from 30% to 100%, and the copy fades.
  - The canvas also fades with the scroll progress of `.statement` and `.screencast`.
- **Fallbacks:** a static `<img>` mark is shown until WebGL takes over. On context loss the
  static mark returns; on restore it fades out again. Under reduced motion only the static
  mark is shown.
- **Tests:** `field/math.test.ts`, `field/sources.test.ts` (cloud determinism and the loader
  contract) and `e2e/home.spec.ts` (static-to-field handover, context-loss fallback).
- **Product:** none. It is a brand surface. If someone later builds the
  `library-cloud.bin` exporter (a worker task projecting bliss vectors to 3D, written as a
  static asset), the same renderer could back a Listen "library map". That is not requested.

#### 2. screencast-walkthrough

- **Files:** `src/components/Screencast.astro`, `src/scripts/screencast/player.ts`, and
  `public/screencast/{library,player,radio,paths,offline}.{mp4,webm,jpg}`.
- **Shows:** five real recordings of the product (Library, Player, Radio, Paths, Offline) in
  one frame, with numbered chapter tabs and a round play/pause toggle.
- **Interaction:** tabs switch chapters and reset the previous video. Autoplay runs while in
  view unless reduced motion or Save-Data is on.
- **Tests:** `screencast/player.test.ts`.
- **Product:** none.

#### 3-6. Inside Crate tiles

- **Files:** `src/components/InsideCrate.astro` and `src/scripts/viz/inside-view.ts`.
- **Layout:** four tiles in one hairline row, each a link to the chapter it previews. Tiles
  enter with `enter-up` staggered by 90 ms. Hover gives a cyan `.04` wash. Each tile holds a
  numbered label, a 120 px "mini" instrument, a display title and a body line. One shared
  `visibleLoop` drives all four.
- **inside-tile-eq:**
  - Shows a 240×120 smooth EQ curve with a glow and a dashed 0 dB line. It cycles `EQ_CYCLE`
    every 2.2 s through springs (stiffness 120, damping 14), and the preset name is shown in
    cyan mono.
  - Data: `EQ_PRESETS` and `EQ_CYCLE` from `content/listen/viz.ts`, drift-tested against
    `app/listen/src/lib/equalizer.ts`.
  - Product: a Listen compact EQ glyph, for example on the player's EQ button or in the
    Smart EQ readout.
- **inside-tile-path:**
  - Shows a zig-zag route of genre hops `jazz → soul → funk → electronic → techno`, with the
    cost between hops (1.0 for a parent or child link, 2.5 for related). The route draws
    over 3 s, holds 1.6 s, and lights the nodes it has reached.
  - Data: `genreRoute()` in `scripts/viz/taxonomy-math.ts` is a Dijkstra port of
    `build_scene_genre_route` (`app/crate/db/paths_scene.py`), run over the copied `GENRES`.
    Its tests use hand-written expected routes, not the Python.
  - Limitation: the tile's cost label only tells parent apart from other links. The real
    planner also has influence links (1.0) and fusion links (1.6).
  - Product: Listen Paths cards and the Path detail. Today `PathRouteVisualization` in
    `app/listen/src/pages/PathDetailParts.tsx` is a plain progress rail.
- **inside-tile-heatmap:**
  - Shows a 7×24 cell grid with cyan alpha set by minutes; a white outline marks the "now"
    hour and advances every 0.22 s.
  - Data: synthetic `generateHeatmap()`, normalised to `STATS.hours`.
  - Product: a Listen Home or Profile stats teaser, and an Admin Dashboard instance-listening
    tile.
- **inside-tile-health:**
  - Shows 17 thin bars, one per health check. Checks that need confirmation are shorter and
    grey. A scan highlight steps every 0.14 s: cyan on automatic checks, amber on confirm
    checks.
  - Data: `HEALTH_CHECKS` (drift-tested).
  - Product: an Admin Dashboard health tile backed by the health snapshot.
- **Tests:** `e2e/viz.spec.ts`, "the home page shows four live pieces that link to their
  pages".

### Admin (`/admin`)

#### 7. health-scan (01 Health, full-width band)

- **Files:** `src/components/viz/HealthScan.astro` and `src/scripts/viz/health-view.ts`.
- **Shows:**
  - Header: "Health example scan" and a live status. The final status is
    "39 issues · 21 fixed · 18 waiting".
  - Three display numerals: Checks 17, Fix on their own 4, Ask first 13.
  - A 17-row hairline table. Each row has an index, label and description, scope
    (db / filesystem / hybrid), a 3-segment risk meter with Safe / Needs review / Destructive,
    an `auto` (cyan) or `confirm` (amber) badge, and a result.
  - Footer: "Files a fix removes go to Library Trash".
- **Data:**
  - `HEALTH_CHECKS`: id, risk, scope and confirmation copied from `REPAIR_CATALOG` in
    `app/crate/repair_catalog.py`; labels and descriptions copied from the `CHECK_LABELS` and
    `CHECK_DESCRIPTIONS` objects in `app/ui/src/pages/Health.tsx`.
  - `RISK_LABELS`.
  - `EXAMPLE_FINDINGS`, illustrative: canonical_mismatch 2, stale_tracks 14,
    has_photo_desync 3, duplicate_albums 1, shadow_quality_tracks 6, unindexed_files 9,
    missing_cover 4.
- **Motion:**
  - Rows are scanned one after another every 0.3 s; the active row gets a cyan left bar and a
    gradient. The status counts "scanning 07/17".
  - Rows with findings first read "N found". After a 0.7 s settle they become "N fixed" in
    cyan (automatic) or "N waiting" in amber (confirm).
  - The status then reads "applying automatic fixes" and settles on the final line, holds
    4.2 s, and loops. Clean rows read "clean".
- **Interaction:** none.
- **Drift tests** (`content/admin/viz.test.ts`, "health checks copied from the repair
  catalog"): same ids, risk, scope and confirmation in the same order, exactly 17 checks, and
  labels and descriptions matching `Health.tsx`.
- **Product: admin, the Health page.** The real data already exists:
  - `GET /api/manage/repair-catalog`, `GET /api/admin/health-snapshot`, the SSE
    `GET /api/admin/health-stream`, and `POST /api/manage/health-check` and the fix and
    dismiss endpoints, all consumed by `app/ui/src/pages/Health.tsx`.
  - Gap: the row-by-row scanning state needs per-check progress events from the
    `health_check` task. Without them, render the snapshot and animate only on SSE changes.

#### 8. album-sidecar (02 Imports, full-width band)

- **Files:**
  - `src/components/viz/AlbumSidecar.astro`
  - `src/scripts/viz/sidecar-view.ts`
  - `src/lib/json-lines.ts`: JSON to tokenised lines, `typedAt`.
  - `src/lib/entity-uid.ts`: a UUIDv5 port of `crate.entity_ids`.
- **Shows:**
  - Header: "Portable metadata schema_version 1", with "sorted keys · written atomically".
  - Left: a folder tree, `/music/Slowdive/Souvlaki/` with 10 `.flac` files, `cover.jpg` and
    `.crate/album.json`. The target file is cyan with a glowing dot. Files stagger in at 45 ms.
    Below the tree are the four identity tag chips: `crate_artist_uid`, `crate_album_uid`,
    `crate_track_uid` and `crate_audio_fingerprint`.
  - Right: a `#0d0e14` card holding a syntax-coloured `.crate/album.json`. Keys are in fg,
    strings in cyan, and "… 9 more tracks" is an italic comment.
  - Bottom: two flow steps, `01 write_portable_metadata` and
    `02 rehydrate_portable_metadata`, each with a hairline progress bar.
- **Data:** `SIDECAR` holds example values. The keys are drift-checked against
  `app/crate/portable_metadata.py` and `app/crate/db/queries/portable_metadata.py`, and the
  entity UIDs are derived exactly as `crate.entity_ids` does. The 20-number bliss vector is an
  example. `SIDECAR_TRACKS` lists Souvlaki's titles.
- **Motion:**
  - The JSON "types" at 16 lines per second, auto-scrolling with exponential easing. Auto
    scrolling stops as soon as the user scrolls, presses or types in the card.
  - Step 01's bar fills while typing. After a 1.2 s hold, a highlight sweeps every line over
    2.4 s while step 02's bar fills, then rests 2.6 s and loops.
- **Drift tests:** "portable metadata sample". Every key exists in the sources,
  `PORTABLE_SCHEMA_VERSION = 1`, the identity tags are present, the UIDs are correct, the
  track count is 10 and the bliss vector has 20 numbers. Also `lib/entity-uid.test.ts` and
  `lib/json-lines.test.ts`.
- **Product: admin**, as an album page "Portable metadata" panel.
  - Today `Analysis.tsx` only has the action buttons (`/api/manage/portable-metadata`,
    `/rehydrate`, `/export-rich`).
  - Gap: there is no read endpoint for one album's sidecar. Build it from the same query
    builder in `db/queries/portable_metadata.py` inside `read_scope()`, rather than reading
    `/music` from the API. Writes stay in worker tasks.

#### 9. release-timeline (03 Acquisition, full-width band)

- **Files:** `src/components/viz/ReleaseTimeline.astro` and `src/scripts/viz/release-view.ts`.
- **Shows:**
  - Header: "Acquisition example timeline · Slowdive · Everything Is Alive".
  - A huge display "Release clock" that counts `T−24 d … T−1 d`, then reads "Day 0".
  - On the right: "Now" with the current stage title in cyan (scrambled) and its task name in
    mono.
  - A 5-stage horizontal rail; it turns vertical below 900 px. Each stage has a dot, a
    numbered title, a `code` task name, a body and step chips:
    - Detected (`check_new_releases`; status: detected)
    - Release day (`promote_due_releases`; release_date ≤ today)
    - Fetched (`tidal_download`; queued, downloading, processing, completed)
    - Imported (`process_new_content`; folders, artist, genres, MBIDs, Bandcamp, lyrics)
    - Analysed (analysis daemon; features, bliss)
- **Motion:**
  - Stage durations are 3, 1.4, 2.6, 3 and 1.8 s, followed by a 2.6 s hold.
  - The rail's cyan line scales to the progress.
  - The active dot scales to 1.35 with a 6 px cyan halo, and finished dots fill.
  - Step chips light one after another: the active chip rises 2 px, finished chips turn cyan.
- **Drift tests:** "task queues generated from crate.actors". Each release-stage task whose
  name is a single word must exist in `TASK_POOL_CONFIG`; "analysis daemon" is exempt.
- **Product: admin**, the New Releases page (`app/ui/src/pages/NewReleases.tsx` with
  `/api/acquisition/new-releases/snapshot` and its SSE `/stream`).
  - Gap: the per-release lifecycle (detected and promoted timestamps, download task state,
    import task, analysis pending) is not in one payload.
  - It must be precomputed into the snapshot or joined in one CTE, not looked up per row,
    which would be an N+1.

#### 10. enrichment-orbit (04 Enrichment, split with the visual on the left)

- **Files:** `src/components/viz/EnrichmentOrbit.astro`, `src/scripts/viz/enrichment-view.ts`
  and `src/scripts/viz/pool-math.ts`.
- **Shows:**
  - Header: "Enrichment 13 sources · 3 at a time · cached per source".
  - An SVG orbit with a core node, "Slowdive · artist", inside a halo.
  - Inner ring (radius 150): 6 artist sources with their cache TTL:
    - Last.fm 7 days
    - Spotify 3 days
    - MusicBrainz 30 days
    - Setlist.fm 1 day
    - Fanart.tv 30 days
    - Discogs 30 days
  - Outer dashed ring (radius 252): 7 more sources with their role (Cover Art Archive,
    Deezer · iTunes, Wikidata, Wikipedia, Ticketmaster, lrclib, Bandcamp).
  - Below: a "Thread pool" Gantt with 3 worker lanes. Each artist source is a job bar whose
    fill shows progress, and a white playhead sweeps the lanes.
- **Data:**
  - `ENRICHMENT` is drift-tested against `app/crate/enrichment.py`: `_ENRICHMENT_FETCH_ORDER`,
    `_SOURCE_TTLS_SECONDS`, `_PROVIDER_MIN_INTERVAL_SECONDS` and
    `config.get("enrichment_parallelism", 3)`.
  - Job durations are invented (lastfm 1, spotify 0.7, musicbrainz 1.8, setlist 1.2, fanart
    0.9, discogs 1.4) and scaled by `UNIT 1.15`.
  - `schedulePool()` reproduces ThreadPoolExecutor ordering: submission order, first free
    worker.
- **Motion:**
  - A running job sends a cyan packet along its spoke, and the spoke draws through
    `stroke-dashoffset`.
  - When a job finishes, its node fills and the core halo pulses (0.9 s).
  - After the pool drains, the outer spokes light one by one every 0.32 s. The cycle holds
    2.8 s and loops.
- **Tests:** "enrichment sources copied from crate.enrichment" and `pool-math.test.ts`.
- **Product: admin**, as an artist enrichment panel (Artist page, Settings > Enrichment).
  - Gap: per-source state lives only as cache entries (`enrichment:source:*` in
    `cache_store`, with TTL), and `enrich_artist` emits no per-source progress.
  - A real orbit needs per-source `fetched_at`, `ok/error` and TTL remaining. It can be read
    from cache metadata, or carried in the task progress payload so the SSE task stream drives
    the packets.

#### 11. genre-taxonomy-wheel (05 Genres, full-width band; key visual)

- **Files:**
  - `src/components/viz/GenreWheel.astro`: layout computed at build time.
  - `src/scripts/viz/genre-view.ts`
  - `src/scripts/viz/taxonomy-math.ts`: `buildTaxonomy`, `radialLayout`, `resolveEq`,
    `genreRoute`.
- **Shows:** a 760×760 SVG radial tree.
  - Header: "Taxonomy crate-core 1.0.0 · ed25519" and the digest prefix
    `sha256:9d6af6a06c7b…`.
  - Two faint orbit circles at radius 132 and 212. Ring 1 holds the **14 top-level
    families** (rock, alternative, metal, punk, electronic, hip-hop, jazz, blues, soul, folk,
    country, pop, classical, ambient), with uppercase 11.5 px labels and 5.5 px nodes. Ring 2
    holds their children; ring 3 (radius 256) holds the grandchildren (beatdown-hardcore and
    powerviolence under hardcore-punk).
  - Each family's angular sector is proportional to its subtree weight plus 2.
  - Labels are radial and flip on the left half. Nodes that own an EQ preset are filled grey;
    nodes that inherit one are hollow.
  - **47 parent links** are drawn as radial cubic Béziers. **102 related links** are drawn as
    faint quadratic curves bowed towards the centre (control point at 0.18).
  - The centre shows a display numeral **61** over "genres".
  - Legend: Families 14 · Parent links 47 · Related links 102 · Relation types 4
    (`parent · related · influenced_by · fusion_of`).
- **Interaction and motion** (shared with the EQ panel, item 12):
  - Hovering a node (`pointerover`) selects it.
  - One of 7 walk chips can also select (powerviolence, post-punk, funk, thrash-metal, techno,
    gothic-rock, crust-punk; these are genres without their own EQ). Manual selection holds
    for 9 s; otherwise the walk auto-advances every 3.4 s.
  - Selecting lights the inheritance path. Path nodes get a cyan ring (`is-path`), the
    starting node grows to r 6 (`is-start`), the source node fills cyan (`is-from`), parent
    edges along the path become cyan at 2.25 px, and the genre's related edges turn cyan at
    .32.
  - Transitions use `--ease-snap` (0.3-0.4 s); the radius change uses `--spring-snappy`.
  - On mobile only ring 1 is labelled, at 16 px.
- **Drift tests** ("genre taxonomy copied from the seeded definitions"):
  - All 61 `GenreDefinition`s in `_RAW_GENRE_DEFINITIONS` (`app/crate/genre_taxonomy.py`),
    with parents, related and EQ template name.
  - The `_EQ_*` tuples equal Listen's `EQ_PRESETS`.
  - `RELATION_TYPES` equals `VALID_RELATION_TYPES` in
    `app/crate/db/repositories/genres_taxonomy_edges.py`.
  - The id, version, digest and release date equal
    `app/crate/data/taxonomy/crate-core-1.0.0.json`.
  - Also `taxonomy-math.test.ts` (layout invariants: rings, sectors, no overlaps, 61 nodes)
    and `e2e/viz.spec.ts`, "the genre wheel explains where an inherited EQ comes from".
- **Product: both, admin first.** Admin Genres taxonomy overview. Optionally a read-only
  genre map in Listen (Explore, Genre rooms, the Paths endpoint picker); if only Admin adopts
  it, the component stays in `app/ui`, not `@crate/ui`.
- **Real data available today:**
  - `GET /api/genres/taxonomy/tree` (`app/crate/api/genres.py:346`) returns per node: slug,
    name, top_level, parents, children, related, influenced_by and influences, fusion_of and
    fusion_genre, aliases, artist and album counts, `eq_gains`, `eq_preset_source` and
    `eq_preset_inherited_from`.
  - Admin `Genres.tsx` requests it only for curators (`canCurate`).
  - The release descriptor (digest, signature, key_id, released_at, verification status)
    comes from `get_core_taxonomy_descriptor()` and `taxonomy_release_health()`. It is
    surfaced today only inside the admin global-catalog status.
- **Gaps:**
  - (a) The tree payload carries no `origin` (core or overlay) per node or edge, although
    `genre_taxonomy_nodes.origin` exists (migration 059). The "local overrides on top of a
    signed release" story cannot be drawn without it.
  - (b) It has no inheritance path, only the source slug.
  - (c) The release metadata is not in the same payload.
  - (d) The endpoint rebuilds children, influences and fusions with O(n²) loops, calls
    `resolve_genre_eq_preset` per node and runs `get_all_genres()` on every request. That is
    fine at about 61 nodes but should be cached on the existing `genre_taxonomy:revision` key.
  - (e) `get_core_taxonomy_descriptor(include_release=True)` verifies the ed25519 signature
    from disk on every call and should be memoised.
  - (f) The site draws only the **first** parent. The real taxonomy, with overlays, can have
    several parents plus influence and fusion edges; the product must draw them, for example
    dashed for influence and dotted for fusion.
  - (g) The real payload's counts allow an encoding the site lacks: node size by album count,
    and a "library footprint" mode where empty genres are dimmed.
  - `radialLayout` is pure and deterministic and can be ported to TS in the app unchanged.

#### 12. genre-eq-inheritance (05 Genres, the panel beside the wheel)

- **Shows:**
  - "Genre EQ inherited from the nearest preset".
  - The walk path in mono (`powerviolence → hardcore punk`).
  - The preset name as a large cyan display word, scrambled on change.
  - "inherited from hardcore punk" or "its own preset".
  - A 10-band mini EQ: bars from 0 dB with a cyan gradient, signed gain values and frequency
    labels 32…16K.
  - The walk chips and the legend.
- **Data:** `resolveEq()` is a breadth-first search up the parents, mirroring
  `resolve_genre_eq_preset` (`genre_taxonomy.py:1043`), with tests using hand-written
  expectations: powerviolence takes hardcore from hardcore-punk, funk from soul, crust-punk
  from punk, thrash-metal from metal. There are 40 genres with their own preset and 21 that
  inherit.
- **Motion:** gains run through springs (stiffness 140, damping 15); text uses `formatGain`.
- **Product: both.**
  - Admin: the `GenreEqEditor` (already on the shared `EqBands` since v3 commit `d91d2c1a`)
    should show the inheritance walk.
  - Listen: `EqualizerSmartReadout` ("which one applies and why").
  - Gap: the API must return the BFS path, for example
    `eq_preset_path: [slug, …, source]` from `resolve_genre_eq_preset`.

#### 13. track-analysis-readout (06 Analysis & Insights, split with the visual on the right)

- **Files:** `src/components/viz/TrackReadout.astro` and `src/scripts/viz/analysis-view.ts`.
- **Shows:**
  - "Analysis example values · Slowdive · Souvlaki".
  - The track title as a display headline, scrambled on change.
  - Four figures over hairlines: BPM (e.g. 103.4), Key (Camelot `10B` plus "D major"),
    Loudness (`−11.2` LUFS) and Dynamic range (`9.8` dB).
  - Five feature rows (energy, danceability, valence, acousticness, instrumentalness) with a
    2 px cyan bar and a value.
  - A "bliss 20 numbers · nearest neighbours in pgvector" chart: 20 bipolar bars around a
    zero line.
  - Track chips: Alison, When the Sun Hits, 40 Days.
- **Data:** `EXAMPLE_TRACKS` are examples. The first bliss vector is `SIDECAR`'s example; the
  others are `mulberry32` seeds 7 and 3.
- **Motion:** auto-cycle every 4.6 s, manual hold 10 s. Every number and bar is a spring with
  staggered stiffness `90 + (i % 7) * 8` and damping 13, so the bars settle in a ripple. On
  first view the values grow from 0.6× or 0.
- **Drift tests:** "analysis readout". Each feature and figure is stored as `analysis_<name>`
  in `db/queries/portable_metadata.py`, and `LoudnessEBUR128` exists in
  `app/crate/audio_analysis.py`.
- **Product: both.**
  - Admin: `components/album/AudioProfileCard.tsx`, `TrackTable`, and the coverage on the
    Analysis page.
  - Listen: the player info tab `components/player/extended/InfoTabAudioProfile.tsx`.
  - Real per-track values exist in `library_tracks` analysis columns and the bliss vector. Not
    verified: whether the bliss vector reaches Listen's track-info payload.

#### 14. queue-lanes (07 Operations, full-width band, contains item 15)

- **Files:** `src/components/viz/QueueLanes.astro`, `src/scripts/viz/queue-view.ts` and
  `data/scale.json` (generated by `scripts/scale-numbers.mjs` at prebuild from `actors.py`).
- **Shows:**
  - "Operations 125 task types · five queues", with a key for dashed amber chips: "governed
    by the resource governor".
  - Five lanes. Each has a cyan mono queue name, a display count and its workers:
    - maintenance 59 (maintenance-worker)
    - default 37 (worker)
    - fast 26 (worker · fast-worker)
    - heavy 2 (analysis-worker)
    - playback 1 (playback-worker)
  - Each lane is a track split into queued, running and done zones.
- **Motion:**
  - A chip simulation per lane, with its own spawn rate, run time and slot count; the slot
    count drops to 1 below 500 px.
  - Chips are pill task names from `QUEUE_PICKS` (real task types); governed tasks have
    dashed borders.
  - Chips glide with exponential easing. A running chip fills with progress, and a done chip
    fades over 0.9 s.
  - While the embedded governor reports any breach, the front governed chip stays queued and
    turns amber (`is-deferred`). User work keeps flowing.
- **Drift tests:** "task queues generated from crate.actors". `scale.json` matches
  `TASK_POOL_CONFIG`, and every pick exists on its queue. The governed flag comes from
  `GOVERNED_TASKS`, which is drift-tested.
- **Product: admin**, the Tasks page (`/api/admin/tasks-snapshot` and the SSE
  `/api/admin/tasks-stream`, worker slots, cancel and retry).
  - Real per-queue counts are static, from the config.
  - Live chips come from the task stream (queued, running, finished, failed, with progress).
  - Gap: a "deferred by the governor" state per task is not exposed. Only the last decision is
    cached (`cache_store["resource_pressure"]`), plus deferral metrics.

#### 15. resource-governor-gauges (embedded in Operations; standalone in Architecture story 08)

- **Files:** `src/components/viz/GovernorGauges.astro` (`standalone` prop),
  `src/scripts/viz/governor-view.ts` and `src/scripts/viz/governor-math.ts`.
- **Shows:**
  - "Resource governor example load · heaviest maintenance 02:00–07:00".
  - Five gauges, each with a display value, a 4 px track, a white limit tick and "max N":
    - Load ratio, limit 0.85, scale 1.2
    - iowait, limit 25%, scale 40
    - Swap, limit 30%, scale 60
    - Listeners, limit 10, scale 14
    - Streams, limit 10, scale 14
  - A status line with a dot: "Allowed · background work runs" (cyan), or
    "Deferring governed work · load 0.93>0.85 · iowait … · retry in 300 s" (amber). Gauges
    over their limit turn amber.
- **Data:**
  - `GOVERNOR` thresholds are drift-tested against `DEFAULT_*` in
    `app/crate/resource_governor.py`.
  - `evaluateGovernor()` ports `evaluate_resources`: the same reason wording, and swap counts
    only under memory pressure.
  - The load itself is synthetic: `governorSnapshot(t)` is a gaussian spike in the middle of
    an 11 s cycle.
- **Tests:** "resource governor copied from crate.resource_governor" and
  `governor-math.test.ts`.
- **Product: admin**, `SystemHealth.tsx`.
  - Real data: `GET /api/admin/metrics/system` already returns `resource_pressure`, which
    includes the snapshot, reasons and maintenance window.
  - Perf note: that endpoint calls `evaluate_resources()` live. For a streaming gauge, read
    the cached `resource_pressure` decision that workers write, or sample in the projector or
    a daemon. Do not evaluate on every SSE tick.

### Listen (`/listen`)

#### 16. smart-mix-crossfade (01 Play, first band)

- **Files:** `src/components/viz/MixViz.astro`, `src/scripts/viz/mix-view.ts` and
  `src/scripts/viz/mix-math.ts` (`equalPower`, `beatTimes`, `waveform`).
- **Shows:**
  - "Smart Mix planned on the server · played on Android", "124 BPM · 4 bars · 7.7 s · equal
    power".
  - An SVG built at runtime and sized by ResizeObserver:
    - Two waveform lanes: deck A outgoing (seed 4, fading out) and deck B incoming (seed 9,
      with an intro ramp).
    - A beat ruler with longer downbeat ticks.
    - A cyan fade zone, and equal-power curves (cos and sin) crossing at the marked "−3 dB"
      point.
    - Cue markers: "outro cue 3:41.2", "intro cue 0:00.4" and "+7.7 s".
    - A playhead with dots on both gain curves.
  - Below: A and B gain meters with values, and facts: Camelot 8A → 9A, Loudness BS.1770,
    Beat grid, Range 0–12 s.
  - Deck tags give each deck's key and loudness, for example "A · outgoing · 8A · −9.1 LUFS".
- **Data:** `MIX` is an example plan. The equal-power maths is real (tested so that
  `out² + in² = 1`). There is no test against the Smart Mix planner, which lives only on the
  unmerged `smart-mix-phase-1` branch.
- **Motion:** an 8.5 s sweep plus a 1.6 s hold. The lit waveform is revealed by a clip rect,
  and its opacity follows the gain. On mobile the view zooms to the fade window ±3 s.
- **Tests:** `mix-math.test.ts`, and in `e2e/viz.spec.ts` "never implies beat matching" plus
  reduced motion freezing at mid-fade (gains 0.71 and 0.71).
- **Product: listen.** An Android "next transition" readout in the fullscreen player or the
  queue. It is blocked on merging Smart Mix (`/api/tracks/by-entity/{uid}/mix-profile`,
  `/compatible`, `POST /api/playback/transition-plans` and the admin backfill status exist only
  on that branch). Real waveform peaks would need a precomputed peaks asset, never one decoded
  in a request.

#### 17. eq-curve (01 Play, second band)

- **Files:** `src/components/viz/EqViz.astro` and `src/scripts/viz/eq-view.ts`.
- **Shows:**
  - "EQ 10 bands · ±12 dB · 21 presets", with a trail "prev → **current** → next".
  - A dB scale (+12, +6, 0, −6, −12) and a grid with 10 columns.
  - Per band, a bar from 0 dB with an up or down gradient.
  - A Catmull-Rom curve (`smoothPath`) with a glow, an area fill to 0 dB, a dashed ghost of
    the target preset, and dots.
  - Signed band values and frequency labels.
  - A dwell progress bar, 21 preset chips, and the Smart EQ chain: your preset → curator
    track → curator album → genre → analysis → flat. The applying source is lit: "your
    preset" when manual, "genre" when automatic.
- **Motion:** auto-cycle `EQ_CYCLE` (10 presets) every 2.8 s through springs (stiffness 120,
  damping 14). A chip click holds for 9 s and the progress bar counts the hold down.
- **Drift tests:** `content/listen/viz.test.ts` (presets, band labels and
  `EQ_GAIN_MAX = 12` from `app/listen/src/lib/equalizer.ts`), `eq-math.test.ts`, and the e2e
  reduced-motion test.
- **Product: both, and already ported.** v3 commit `d91d2c1a` redrew the shared
  `app/shared/ui/domain/player/EqBands.tsx`, which Listen's EQ panel and the Admin
  `GenreEqEditor` both use.

#### 18. radio-dive (02 Radio, WebGL scroll story)

- **Files:**
  - `src/components/listen/RadioDive.astro`
  - `src/components/listen/DeepDive.astro`
  - `src/scripts/listen/{index,dive,radio,scene}.ts`
  - `src/scripts/field/*`
- **Layout:** a sticky 100dvh visual column (canvas with a radial mask, an SVG overlay, and
  absolutely placed mono panels), next to 5 scroll steps, each 72vh: Seed, Neighbours, Score,
  Queue, Feedback.
- **Scroll:** GSAP ScrollTrigger maps step-list progress to a phase from 0 to 5, smoothed by
  a 0.12 lerp per frame.
- **Scene:**
  - 14,000 points (6,000 on mobile), from 14 synthetic clusters (`mulberry32(7)`); the real
    library cloud would replace them if it existed.
  - The seed is the densest point.
  - The camera orbits and zooms in, and a pulsing seed ring carries a "SEED" label and the
    readout "01 / Target · 20-number bliss vector".
  - Lines draw to 14 neighbours sampled from the nearest 420.
  - A "Score weights" panel fills its bars: Sound 0.34, Artists 0.22, Genre 0.16, BPM 0.09,
    Energy 0.08, Camelot 0.05, Era 0.03.
  - A "Queue" panel shows 5 picks with score, BPM and Camelot key (`radioPicks`, synthetic),
    and pick rings mark them in the cloud.
  - Then "Like · target +8% · cap 40%" appears, the focus shifts 8% towards the liked pick,
    and its queue row turns cyan.
  - The shader enlarges and brightens points near the focus.
- **Fallbacks:** without WebGL, cards and panels show statically; under reduced motion the
  final state renders statically.
- **Data accuracy:**
  - The weights are not tested. They equal `_W_*` in `app/crate/db/paths_candidates.py`,
    which `radio_engine.py` imports for the discovery profile.
  - Contextual and track radio override the first three weights: bliss, artist and genre are
    0.01, 0.44, 0.26 (contextual) and 0.16, 0.30, 0.20 (track).
  - "+8%, cap 40%" matches `blend_target_towards(blend_step=0.08, max_blend=0.4)` in
    `queue_engine.py`. It is also untested.
- **Tests:** `listen/scene.test.ts` (nearest, densest, segment, picks), and the e2e page
  smoke test.
- **Product: listen**, a "why this track" explainer on the Radio page (`Radio.tsx`,
  `RadioHero`, `RadioSeedPanel`).
  - Gaps: radio responses would need a per-candidate score breakdown and profile weights.
  - A 3D projection of the bliss vectors would have to be precomputed by a worker, never in a
    request.
  - Listen has no GSAP. Its existing WebGL visualizer
    (`components/player/visualizer/visualizer-webgl-resources.ts`) shows that raw WebGL2 fits.
  - 14,000 points on mid-range Android under Capacitor needs a budget check.

#### 19. paths-dive (03 Paths, WebGL scroll story)

- **Files:** `src/components/listen/PathsDive.astro` and `src/scripts/listen/paths.ts`, sharing
  the dive and field code with item 18.
- **Shows:**
  - The same cloud with a slow orbiting camera.
  - A 6-node route is planned by snapping 6 screen anchors along a sine curve to the nearest
    projected random candidates (3,500 samples).
  - A glowing cyan polyline draws progressively (phase 0.7 to 2.9). The end node is filled.
  - Per-node labels are scrambled in: `START`, `02…05`, `END`, and "NN BPM · key". They come
    from `pathReadouts`, which is synthetic: a BPM ramp of about 84 → 120 and keys walking the
    Camelot A ring.
  - A caption reads "Music Paths · 6 steps · 92 → 128 BPM", and "Saved · can be regenerated"
    appears at phase 3.1.
- **Steps:** Endpoints (5 to 50 steps), Genre map (costs 1.0, 1.6, 2.5), Scenes and sound, and
  Keep it (optional LLM review).
- **Accuracy:** the genre-map costs in the text match `_genre_neighbors` in
  `app/crate/db/paths_scene.py` (parent, child and influence 1.0; fusion 1.6; related 2.5)
  but are not tested. The dive does not draw the genre route; only Inside tile 4 does.
- **Product: listen**, Path detail and the Paths list.
  - Real data: `/api/paths/{id}` has tracks with bpm, key and bliss vector (used in
    `PathDetailParts.tsx`).
  - A real route through a projected bliss space needs the same precomputed projection as the
    Radio dive. Without it, a 2D route view drawn from per-step bpm and key plus the genre hops
    is feasible immediately.

#### 20. mood-map (04 Discover, split with the visual on the right)

- **Files:** `src/components/viz/MoodMap.astro`, `src/scripts/viz/mood-view.ts` and
  `src/scripts/viz/mood-math.ts`.
- **Shows:**
  - "Moods from audio analysis · energy × valence".
  - A square 2D canvas with a 4×4 hairline grid and axis labels "valence →" and "energy →".
  - 8 mood labels as buttons, each placed at its threshold centre or its `lean` override.
  - 190 glowing cyan points per mood (90 on mobile), gaussian-sampled inside each mood's
    threshold rectangle, plus 620 pale "dust" points.
  - A readout gives the mood name (scrambled) and its thresholds, for example
    "energy ≥ 0.70 · danceability ≥ 0.50 (third axis)".
- **Motion:**
  - On entry, points spring out of the centre with a back-out ease staggered per mood
    (1.25 s), on additive blending, with a gentle sinusoidal sway.
  - The highlight auto-cycles every 2.6 s. The active mood's dashed threshold rectangle fades
    in, and other moods dim to a weight of 0.05.
- **Interaction:** the pointer picks the nearest mood centre within 16% of the canvas size.
  Focus and click on a label also select it.
- **Drift tests:** `content/listen/viz.test.ts` checks `MOODS` filters equal `MOOD_PRESETS` in
  `app/crate/api/browse_media.py`, and `mood-math.test.ts` checks that regions, centres and
  samples stay inside the thresholds.
- **Product: listen**, the Explore moods entry point. Admin Insights "energy against
  danceability" can reuse the chart style.
  - Real data: `GET /api/browse/moods` (presets plus track counts) and
    `/api/browse/mood/{mood}`.
  - **Perf flag (pre-existing):** on a cache miss (600 s TTL), `count_mood_presets` runs
    `COUNT(*) FILTER` over a CTE on `global_catalog_tracks LEFT JOIN library_tracks` inside
    the HTTP request. A real point cloud needs a precomputed energy×valence histogram (for
    example 24×24 bins) warmed by a task or the projector, and the counts should move there
    too.

#### 21. listening-heatmap (05 Yours, full-width band)

- **Files:** `src/components/viz/Heatmap.astro`, `src/scripts/viz/heatmap-view.ts` and
  `src/scripts/viz/heatmap-math.ts`.
- **Shows:**
  - "Stats last 12 months · synthetic listener · when you listen".
  - Three giant numerals: Hours listened 1,284 and Artists 418 count up; Top genre
    "post-punk" is scrambled in over 1.1 s.
  - A 7×24 grid with cyan alpha set by minutes, a bordered peak cell, and a night band over
    22–05 labelled "night 22–05 · N%".
  - Day letters, hour labels every 6 hours, and the readout "Peak Saturday 23:00 · N min".
- **Motion:** cells enter in a diagonal wave (`(col + row × 2.5) × 22 ms` with spring-snappy).
  Hovering a cell rewrites the readout ("Mon 22:00 · 123 min").
- **Data:** synthetic `generateHeatmap(seed 11)` with weekday and weekend curves, normalised
  to 1,284 hours. `NIGHT_HOURS` equals `_NIGHT_HOURS` in
  `app/crate/db/queries/user_library_stats_signal.py`, but the test uses hard-coded values.
- **Product: both.**
  - Listen: Stats (`components/stats/StatsHeatmapCard.tsx`, a hand-rolled grid). The real
    `heatmap {cells, peak, night_share}` comes precomputed from the user stats dashboard
    snapshot (`refresh_user_stats_dashboard_snapshot`).
  - Admin: Dashboard or Insights instance-wide listening, since `_heatmap(session, user_id=None)`
    feeds the instance stats snapshot.

#### 22. federation-relay (06 Together, split with the visual on the left)

- **Files:** `src/components/viz/Federation.astro` and `src/scripts/viz/federation-view.ts`.
- **Shows:**
  - "Federation node to node · Ed25519 · approved pairing".
  - A 600×600 SVG with three peers (north.crate, basement.crate, radio-club.crate), each with
    a fake ed25519 fingerprint.
  - "Your node" sits in the centre with a halo; "your listener" is a phone at the bottom,
    labelled "never sees the peer URL".
  - A dashed "never" edge with an X joins the club peer and the listener.
  - A chip switches from pending to approved, and a "grant · stream" label appears.
  - Four numbered steps: Descriptor, Pairing, Grant, Relay.
- **Motion** (a 9.2 s loop):
  1. A descriptor packet travels from club to yours.
  2. Signed, then approved: a check mark draws.
  3. Grant.
  4. Relay: a "stream" pill travels from club to yours, becomes a "ticket", and travels from
     yours to the listener.
  5. Done.
  Throughout, catalog-delta dots flow from north and basement into your node.
- **Data:** example only (`FEDERATION`); no tests.
- **Product: admin**, as a live topology header for the Federation overview
  (`pages/federation/FederationOverview.tsx`, with the Peers, Pairing, Streams and Policies
  panels and existing APIs). Real peers, pairing state, grants and active relayed streams
  exist. Animate on SSE or snapshot change, not on a timer.

#### 23. devices-row (07 Everywhere, full-width band)

- **Files:** `src/components/viz/Devices.astro`. CSS only, no script view.
- **Shows:** five line-art devices (desktop monitor, Android, PWA iPhone, Cast TV, Subsonic
  client), each with a skeleton player UI and a mono caption.
- **Motion:** outlines draw through `stroke-dashoffset`, staggered by 140 ms. While in view,
  every device's progress bar runs a shared 14 s linear loop, conveying "one queue position".
- **Data:** example only (`DEVICES`).
- **Product: listen, low priority.** The glyphs and the "same position everywhere" idea fit the
  Crate Connect device picker (`/api/connect/session`, `/transfer`, `/events` SSE). Otherwise
  it is marketing only.

#### 24. setlist-ticket (08 Live, split with the visual on the left, not sticky)

- **Files:** `src/components/viz/Setlist.astro`. CSS only.
- **Shows:** a ticket card with notched sides (radial-gradient mask) and a dashed perforation.
  - Head: "Upcoming show Ticketmaster · Last.fm", the artist in display type, then date and
    venue.
  - Body: "Probable setlist 12 recent shows · Setlist.fm". Eleven numbered rows, each marked
    "in library" or "missing" (dimmed).
  - Foot: a round play glyph and "9 of 11 playable from your library".
- **Motion:** rows enter with spring-snappy, staggered by 55 ms.
- **Data:** example only (`SETLIST`).
- **Product: both.**
  - Listen is already ported in v3 commit `50854a6e` (`UpcomingShowExpandedView`, plus the new
    `HairlineList`, `MonoLabel`, `StatNumber` and `StatusDot` primitives).
  - Admin Shows should drop its local `ShowCard` copy, as the v3 spec's Admin step 5 says.
  - Gap noted in the spec: a precomputed `in_library` per setlist song in the upcoming
    snapshot.

### Developers (`/developers`)

#### 25. api-capabilities-terminal (01 APIs, full-width band)

- **Files:** `src/components/viz/ApiTerminal.astro` and `src/scripts/viz/terminal-view.ts`.
- **Shows:** a terminal card with window chrome and "your-crate". The command is
  `curl -H "Authorization: Bearer crv_Q2x9Tf7mLw…" https://your-crate/api/capabilities`, and
  the response is `HTTP/1.1 200 OK · application/json` followed by syntax-coloured JSON of
  `CAPABILITIES` (smart_mix, vdj, access_token.scopes).
- **Motion:** the command types at 38 characters per second, then 0.45 s later the status
  appears. JSON lines stream at 14 per second, hold 4.5 s and loop. A caret blinks.
- **Tests:** `content/developers/viz.test.ts` checks the CapabilitiesResponse fields. That
  test **skips on main**, because `app/crate/api/schemas/capabilities.py` exists only on
  `smart-mix-phase-1`. Another test checks that "beatmatch" and "automation" never appear.
  The e2e test checks that the terminal streams.
- **Product: none.** Documentation only.

#### 26. token-allowlist (02 Tokens, split with the visual on the right)

- **Files:** `src/components/viz/TokenAllowlist.astro` and `src/scripts/viz/allowlist-view.ts`.
- **Shows:**
  - "Personal access token crv_ · 32 random bytes · stored as a SHA-256 digest".
  - The token, with its 12-character display prefix bright and the rest dim.
  - Four scope chips: `vdj.catalog.read`, `vdj.media.read`, `vdj.smart_mix.read` and
    `vdj.play_events.write`.
  - A request probe row with a verdict.
  - 12 allowlisted routes with method badges; the matching route is highlighted.
- **Motion:** 8 probes cycle. Each path types at 70 characters per second, shows "checking"
  for 0.25 s, then "allowed" (cyan) or "treated as signed out" (amber).
- **Data:** `allowlistMatch()` ports `_is_vdj_access_token_request`. Its source tests (patterns
  against `auth.py` `_VDJ_ACCESS_TOKEN_ROUTES`, prefix, bytes and scopes against
  `db/repositories/access_tokens.py`) **skip on main**, because the code is on
  `smart-mix-phase-1`.
- **Product: listen, low priority and blocked.** After the Smart Mix merge,
  `/api/auth/access-tokens` (create, list, revoke) needs a settings screen, and the
  token-and-scope card pattern fits it. The allowlist animation itself stays documentation.

#### 27. roadmap-cards (06 Working on)

- **Files:** `src/components/developers/Roadmap.astro`. CSS only.
- **Shows:** two numbered cards, Jams and the VirtualDJ plugin, each with an amber "Coming
  soon" status badge, a body, fact chips, and an "In development" bar with an infinite 2.4 s
  "building" shimmer while in view.
- **Product: none.**

### Architecture (`/architecture`)

#### 28. system-map (01 System map)

- **Files:** `src/components/architecture/SystemMap.astro`,
  `src/content/architecture/map.ts` (27 nodes and the edges) and `src/lib/system-map.ts`
  (edge routing, viewBox).
- **Shows:** an SVG service map with two hand-authored layouts, wide and tall, switched by
  CSS.
  - Client boxes for Listen and Admin; service boxes for traefik, frontends, readplane, api,
    projector and the six workers; store boxes for postgres, redis and redis-durable.
  - A "workers" group box.
  - Each node shows its tech line, memory limit and `/music` mount (ro or rw). Fallback edges
    to the API are dashed.
  - The legend and figcaption read: "ro / rw", "Memory: the container limit", "Dashed line:
    fallback", "Names drop the crate- prefix".
- **Motion:** a fade-in on reveal only.
- **Tests:** structural only (`content/architecture/map.test.ts`, `lib/system-map.test.ts`).
  Memory limits and mounts are not checked against `docker-compose.yaml`.
- **Product: admin**, as a live "Stack" map on `pages/Stack.tsx` and `SystemHealth.tsx`. The
  real data is `/api/admin/stack-snapshot` and the SSE `/api/admin/stack-stream` (container
  status, health). The node boxes can carry status dots (`StatusDot`), memory use against the
  limit, and restart counts.

#### 29. like-trace (02 Follow one like)

- **Files:** `src/components/architecture/Trace.astro` (sticky `SystemMap variant="trace"`,
  without workers and frontends) and `src/scripts/architecture/trace.ts`.
- **Shows:** six steps (Tap, One transaction, Relay, Project, Publish, Deliver). As the page
  scrolls, each step's route edges draw one after another over 70% of the step; a dot travels
  along the current edge (`getPointAtLength`), and nodes take "on" and "past" states.
- **Scroll:** ScrollTrigger from top-top to bottom-bottom.
- **Tests:** `map.test.ts` checks that every trace route resolves to drawn edges.
- **Product: none** as a scroll story. It could later become a live event-flow overlay on the
  admin Stack map.

#### 30. outbox-sequence (03 Stories #02 "Transactional outbox to Redis Streams")

- **Files:** `src/components/viz/OutboxSequence.astro` and `src/scripts/viz/steps-view.ts`
  (`data-viz="steps"`, rate 1.1 s).
- **Shows:** a sequence diagram with five cyan lane headers (api, postgres, relay,
  redis-durable, projector) and six numbered rows. Each row has an arrow between two lanes and
  a mono message, for example `BEGIN · INSERT like · INSERT domain_event_outbox · COMMIT`,
  `SELECT … FOR UPDATE SKIP LOCKED`, `EVAL dedupe by uid · XADD crate:domain_events · seq 1042`,
  and `XACK 1042 · only after the snapshot is warm`.
- **Motion:** rows activate every 1.1 s and type their text at 60 characters per second. The
  sequence holds 3 s and loops.
- **Data:** example only.
- **Product: admin, optional.** The Admin Dashboard already reads the domain-event runtime
  (`AdminDomainEventRuntimeResponse`: latest_sequence, stream_length, pending, lag,
  recent_events) through `OpsSnapshotContext`. Real recent events could flow through these
  lanes.

#### 31. redis-pair (03 Stories #04 "Two Redises, on purpose")

- **Files:** `src/components/viz/RedisPair.astro` and `src/scripts/viz/redis-view.ts`.
- **Shows:**
  - Two panes separated by a hairline.
  - The cache pane: `crate-redis` with its real flags (`--maxmemory 512mb --maxmemory-policy
    volatile-lru`), a 10×4 key grid (TTL cells marked), a memory meter "78% of 512mb", a
    legend and a set/evict log.
  - The durable pane: `crate-redis-durable` with its flags (`--appendonly yes --appendfsync
    everysec --maxmemory-policy noeviction`), an AOF list of example writes (XADD, LPUSH, SET
    lease, XACK) and an fsync meter that sweeps every second.
- **Motion:** a set every 0.42 s. Once 36 of the 40 cells are used, the oldest TTL key is
  evicted with an "out" animation and an "evict" log line. An AOF write lands every 0.7 s,
  keeping a 6-line window.
- **Drift tests:** `content/architecture/viz.test.ts` checks the flags against the redis
  service commands in `docker-compose.yaml`.
- **Product: admin, optional.** A SystemHealth Redis panel. Gap: `cache_store.get_cache_stats()`
  reports only the cache Redis `used_memory_human`. There are no evicted keys and no
  durable-instance INFO yet.

#### 32. uuid-derivation (03 Stories #06)

- **Files:** `src/components/viz/UuidDerivation.astro`, `steps-view` at rate 1.3 s, and
  `src/lib/entity-uid.ts`.
- **Shows:** the namespace chain `uuid5(URL, "crate:entity-uids:v1")` → root, then
  `uuid5(root, "artist")`. Then two spellings, "Sigur Rós" and "SIGUR  RÓS ", both become
  `name:sigur ros` and the same UUIDv5. The verdict reads "Same id on every rebuild and every
  server · MBID first".
- **Data:** computed at build time.
- **Tests:** `lib/entity-uid.test.ts` (RFC 4122 vector, normalisation like `crate.entity_ids`)
  and the e2e test "derive the same id for both spellings".
- **Product: none.**

#### 33. scale-figures (04 Scale)

- **Files:** `src/components/architecture/ScaleFigures.astro`,
  `src/scripts/architecture/counters.ts` and `src/lib/counter.ts`.
- **Shows:** six display numerals that count up over 1.6 s: ~4,425 pytest cases, ~3,861
  Vitest cases, 255 Go tests, 250 Rust tests, 125 task types and 108 migrations. A note follows.
- **Data:** `scripts/scale-numbers.mjs` regenerates the figures from the repo at prebuild
  (`scale-numbers.test.ts`).
- **Product: none.**

---

## 4. Drift coupling: app files the site pins, and what v3 must not break

Site vitests resolve paths from the worktree root (`src/lib/source-drift.ts`), so after both
branches merge, these files are contract surfaces. A v3 refactor that moves or reshapes them
breaks the site's suite.

| App file | Pinned shape | v3 risk |
|----------|--------------|---------|
| `app/ui/src/pages/Health.tsx` | object literals `const CHECK_LABELS = {…}` and `const CHECK_DESCRIPTIONS = {…}` parsed with a regex | **High**: v3 Admin rollout step 3 restyles Health. Moving the tables to another module or changing the literal format breaks `viz.test.ts`. Keep them, or update the site test in the same PR. |
| `app/listen/src/lib/equalizer.ts` | `export const EQ_PRESETS` block of `name: [..]` arrays, `label: "…"` entries, `EQ_GAIN_MAX = 12;` | Medium: EQ work in v3 so far touched only the shared `EqBands`. |
| `app/crate/repair_catalog.py` | `REPAIR_CATALOG: tuple` of `RepairCatalogEntry(` with positional strings | Low |
| `app/crate/genre_taxonomy.py` | `_RAW_GENRE_DEFINITIONS`, `GenreDefinition(`, `parents=(…)`, `related=(…)`, `eq_gains=_EQ_X`, `_EQ_X = (…)` tuples | Medium if the wheel work touches the definitions |
| `app/crate/db/repositories/genres_taxonomy_edges.py` | `VALID_RELATION_TYPES = {…}` | Low |
| `app/crate/data/taxonomy/crate-core-1.0.0.json` | id, version, digest, released_at | Low (signed artefact) |
| `app/crate/enrichment.py` | `_ENRICHMENT_FETCH_ORDER`, `_SOURCE_TTLS_SECONDS` (`86400 * N`), `_PROVIDER_MIN_INTERVAL_SECONDS`, the literal `raw = config.get("enrichment_parallelism", 3)` | Medium if per-source progress is added to enrichment |
| `app/crate/resource_governor.py` | `DEFAULT_*` constants, `RESOURCE_GOVERNED_TASK_TYPES = frozenset(` | Low |
| `app/crate/actors.py` | `TASK_POOL_CONFIG` entries `"name": TaskPoolConfig("queue"` (and `scale.json` must be regenerated) | Medium: any new task type requires `npm run build` in `app/web` |
| `app/crate/portable_metadata.py`, `app/crate/db/queries/portable_metadata.py` | every sidecar key, `PORTABLE_SCHEMA_VERSION = 1`, identity tag strings, `"<feature>": track.get("analysis_<feature>")` | Medium if a sidecar read endpoint refactors the builder |
| `app/crate/audio_analysis.py` | contains `LoudnessEBUR128` | Low |
| `app/crate/api/browse_media.py` | module-level `MOOD_PRESETS = {…}` dict literal | Medium: moving the moods into `db/` or a constants module during MoodMap work breaks it |
| `docker-compose.yaml` | redis service `command: redis-server …` flags | Low |
| `app/crate/api/auth.py`, `db/repositories/access_tokens.py`, `api/schemas/capabilities.py` | skipped unless present (Smart Mix branch) | Activates when Smart Mix merges |

Claims shown on the site with **no** source test, and so free to drift:

- Radio weights and the like blend (`paths_candidates._W_*`, `queue_engine.blend_target_towards`).
- Paths genre costs (`paths_scene._genre_neighbors`).
- `genreRoute` and `resolveEq` parity with Python. Their tests use hand-written expectations,
  even though their names say "like build_scene_genre_route" and "like
  resolve_genre_eq_preset".
- Heatmap `NIGHT_HOURS`.
- System map memory limits and mounts.
- Mix plan numbers and the "0–12 s" range.
- Federation and Setlist examples.

---

## 5. Findings for turning these into real product features

1. **Realness split.**
   - Structural data is real and pinned: catalogues, thresholds, taxonomy, presets, queues and
     identities.
   - Everything that moves is simulated: findings counts, timings, loads, listening, points,
     picks, plans.
   - Making a visual "real" therefore mostly means replacing the clock-driven simulation with
     snapshot and SSE-driven state. The existing streams are health-stream, tasks-stream,
     stack-stream, new-releases/stream and the domain-event runtime. The simulation should
     stay only as an empty or demo state.
2. **Genre wheel is the most ready.**
   - The tree endpoint already carries almost everything the wheel needs, plus counts the site
     lacks.
   - Missing pieces: node and edge `origin` (core or overlay), the EQ inheritance path, the
     release descriptor in the same payload, cache invalidation on `genre_taxonomy:revision`,
     and multi-parent, influence and fusion rendering.
   - Two options for Listen's read-only map: open `taxonomy/tree` beyond curators, or serve a
     lighter `/api/genres/map` snapshot from the read plane.
3. **Performance traps to avoid when wiring the visuals.**
   - Mood counts and histograms must be precomputed. The current request-time
     `COUNT(*) FILTER` on a cache miss already breaks the rule.
   - Release timelines must come from one CTE or a snapshot, never per-row lookups.
   - The governor stream must read the cached `resource_pressure` decision, not run
     `evaluate_resources()` on every tick.
   - A bliss projection for the Radio and Paths dives, or a library cloud, must be a
     worker-produced asset.
   - Taxonomy release verification should be memoised.
   - In React, per-frame springs and clocks go in refs (the SSE deps rule).
4. **Chart rule conflict, needs a decision from Diego.** AGENTS.md says "Charts use Nivo",
   but every site visual is bespoke SVG, Canvas 2D or WebGL. There is v3 precedent for bespoke
   instruments (`EqBands`, Listen's hand-rolled `StatsHeatmapCard`). Proposal:
   - Use Nivo where a matching Nivo chart exists and the visual is a chart: Insights scatter,
     bars, line timeseries, and possibly heatmaps (`@nivo/heatmap` is in admin only).
   - Use bespoke SVG for instruments Nivo cannot express: the radial taxonomy wheel, the
     orbit, queue lanes, gauges, the ticket and the crossfade.
   - Listen ships only `@nivo/core` and `@nivo/line`. Adding heatmap or scatterplot costs
     bundle size.
5. **`@crate/ui` placement.**
   - Shared today and correct: `EqBands`, `MonoLabel`, `StatNumber`, `StatusDot`,
     `HairlineList`.
   - The wheel, the EQ inheritance panel, the heatmap grid and the setlist ticket qualify only
     if both apps adopt them.
   - The health scan, sidecar, release rail, orbit, queue lanes, gauges, system map and
     federation topology are Admin-only, so they belong in `app/ui`. Admin uses
     `lucide-react` and `sonner`; Listen uses `@crate/ui/icons` and `notify`.
6. **Motion stack.** The site uses GSAP ScrollTrigger and Lenis. Neither app has GSAP or any
   motion library.
   - Data-driven loops (springs, `visibleLoop`, scramble) are tiny and port to React hooks
     directly.
   - The scroll-scrubbed dives would need either GSAP (bundle cost, Capacitor) or a small
     IntersectionObserver and scroll-progress hook. The second is recommended.
7. **Blocked by the Smart Mix branch.** smart-mix-crossfade, token-allowlist and the
   capabilities terminal's data all depend on `smart-mix-phase-1` (`/api/tracks/by-entity/*`,
   `/api/playback/transition-plans`, `/api/auth/access-tokens`,
   `/api/admin/smart-mix/{status,backfill}`), which is not merged.
8. **Already done in v3.** eq-curve (shared `EqBands`, Admin `GenreEqEditor` header) and
   setlist-ticket in Listen (Radar ticket and primitives).

---

## 6. Non-live material, for completeness

- `app/web/prototypes/` holds static hero experiments: a-signal-lock, a1-paths, a2-order,
  a3-mark, b-spectrum, c-digging, c1-shelf, c2-crate, c3-now, plus `v1/` and the shared
  `field.js` and `hero.js`. None is linked from the site; they are the origin of the hero
  field.
- Non-visual motion used across pages:
  - `initTextMotion` with `data-split` word reveals (Statement, page titles, story titles).
  - `enter-up` on FeatureList, EndpointList, Roadmap and tile entries.
  - ChapterToc and Chapter status badges (amber "coming soon" and "optional LLM").
  - `VizSplit`, a 5/7 grid with a sticky pinned visual and a `side` and `sticky` prop.
  - Lenis smooth scroll.

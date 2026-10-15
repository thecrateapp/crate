# Crate v3 analysis: coverage of surfaces with no site visual

Date: 2026-10-15
Status: analysis only. Read-only pass; nothing was built, tested or bundled.

Visual reference: the new site only (`worktrees/website/app/web`). Paths are relative to the
`crate-v3` worktree unless prefixed with `site:`.

Inputs:

- `admin-audit.md` (sections 6 and 8), `listen-audit.md` (sections 4 to 6), `site-language.md`,
  `platform.md` and `v3-state.md`.
- The 26 verified mapping cards.
- Site sources read for this pass: `PageHeader`, `Chapter`, `ChapterToc`, `FeatureList`,
  `StatusBadge`, `Nav`, `InstallCommand`, `Explore`, `Footer`,
  `developers/{EndpointList,Roadmap}`, `architecture/ScaleFigures`, `viz/UuidDerivation`, and
  `styles/base.css`.
- Spot reads of product code, cited per finding.

Conventions:

- **Priority.** P0 means v3 does not read as one product without it (shell, chrome, landing
  pages, shared recipes). P1 means a spec rollout screen, or a page that sits next to a site
  chapter. P2 is everything else.
- **Effort.**
  - S: up to about 2 days, front-end only.
  - M: a few days, possibly a small additive backend change.
  - L: a week or more, or blocked by a backend precondition.
- **Tokens.** Product token names are used throughout: `text-text-primary` (site fg),
  `text-text-muted` (fg-2), `text-text-subtle` (fg-3), `accent-action-hi` (cyan-hi),
  `accent-action` (cyan), `state-warning` (amber), `border-border-quiet` (`--line`) and
  `border-border-quiet-subtle` (row divider at .06).
- **References.** "Recipe §x" points to a section of `site-language.md`.

---

## 0. TL;DR

- The 26 cards cover the surfaces that sit behind a site chapter. That still leaves **26 Admin
  and 29 Listen surface groups** (about 60 screens and parts) with no site visual: the shells,
  the player chrome, the library and entity pages, settings, social, onboarding, and most
  operator pages.
- **Most of these do not need a bespoke instrument.** They need the cross-cutting recipes in
  section 2, applied so that real data becomes display numerals, hairline lists, status dots,
  meters and mono readouts.
- **About a dozen surfaces merit a new data-driven visual,** each built on data that already
  exists:
  - Acquisition lanes: the QueueLanes model reused for Tidal, Soulseek and uploads.
  - Schedules with interval-elapsed hairlines.
  - Album energy arc (both apps), computed client-side.
  - Users presence strip.
  - Global catalog reconcile rail, plus a duplicate confidence band.
  - Setup first-scan phase rail.
  - Upload import phase rail.
  - Lyrics line progress.
  - Offline storage meter.
  - Discover completeness meters.
  - i18n locale coverage meters.
  - Social affinity numeral.
- **Seven recipes are P0** and should land before the per-screen work, because every screen
  uses them:
  - page header (2.2);
  - section header and panel shell (2.3);
  - navigation chrome (2.4);
  - lists, tables, track rows and media grids (2.5);
  - empty, loading, error and stale states (2.11);
  - status colour policy (2.13);
  - toasts (2.10). Both Toasters run sonner `richColors`, which gives filled green, red and blue
    toasts: an app-wide palette violation.
- **Primitive gaps keep appearing in the card verifications.** They should be closed once, up
  front (2.1): `InstrumentPanel`, `Meter`, `Readout`, `ProgressHairline`, a `StatNumber` xl tier,
  a `HairlineRow` that works as a link or button, a `CratePill` action variant at 32 px, prop
  pass-through on `MonoLabel`, a non-legacy object-card surface utility, a shared motion gate and
  a shared Toaster config.
- **New preconditions found in this pass** (no card covers them; details in section 5):
  1. `/api/acquisition/stream` rebuilds per client every 3 s. It calls slskd with synchronous
     `requests` inside the async generator, so it blocks the event loop for up to 10 s.
     `/snapshot` and `/stream` also require only authentication, so any logged-in user can read
     Soulseek usernames and file paths.
  2. `/api/admin/global-catalog/status` runs 4 `COUNT(*)` over `global_catalog_*`, a
     `COUNT(DISTINCT)`, a confidence-band `COUNT` and assertion aggregates, across 3
     `read_scope()` calls, on every request.
  3. The Admin users presence query left-joins every play event of the listed users to
     `library_tracks` through an `OR` condition, then applies `DISTINCT ON`.
  4. Smaller items:
     - both Toasters use `richColors`;
     - Admin `components/ui/error-state.tsx` is dead code;
     - the Linux titlebar imports undeclared `lucide-react`;
     - Listen profile badges carry `gold`, `green` and `rose` tones;
     - the object-card colour exists only as the legacy `bg-card` utility.

---

## 1. What the cards already cover

| Card | Admin surface | Listen surface |
| --- | --- | --- |
| inside-tile-eq | | EQ button glyph in the player bar, extended header and fullscreen |
| inside-tile-path | | `/paths/:id` route map, `/paths` row glyph |
| inside-tile-heatmap | Dashboard tile (phase 2) | Home desktop Listening DNA tile, `/stats#listening` |
| inside-tile-health | Dashboard health tile | |
| health-scan | `/health` (and the footer link to `/trash`) | |
| album-sidecar | Album detail, portable metadata panel | |
| release-timeline | `/new-releases` band and rows; deep links from Discover and Upcoming | |
| enrichment-orbit | Artist, Enrichment tab; hero Enrich action | |
| genre-taxonomy-wheel | `/genres` wheel, `/genres/:slug` locator | `/explore` wheel and genre locator (phase 2), EQ link |
| genre-eq-inheritance | Genres inspector, `GenreEqEditor` header | EQ Smart and Genre readouts |
| track-analysis-readout | `/analysis` latest readout, Album readout | Info tab readout |
| queue-lanes | `/tasks` band, Dashboard strip | |
| resource-governor-gauges | `/tasks`, `/system` Resources, Dashboard status line | |
| smart-mix-crossfade | | Queue tab, fullscreen queue tab, queue drawer |
| eq-curve | `GenreEqEditor`, tree inspector | EQ panel, popover and sheet; Smart chain |
| radio-dive | | `/radio` hero, `RadioFeedback` |
| paths-dive | | `/paths/:id` field, `/paths` glyph, planning state |
| mood-map | | `/explore` Moods block |
| listening-heatmap | Settings > Downloads quiet-hours heatmap (phase 2) | `/stats`, `/stats/global`, `/users/:u/stats` band and counters |
| federation-relay | `/federation` Overview hero, approve fix, Streams link | |
| devices-row | | Settings > Devices, playback target popover |
| setlist-ticket | `/upcoming` expanded card, Artist setlist tab | Radar ticket, Home show meta, Artist setlist modal |
| token-allowlist | | Settings > Access tokens (after the smart-mix merge) |
| system-map | `/stack` | |
| outbox-sequence | `/system` event pipeline; Dashboard bus card summary | |
| redis-pair | `/system` Redis band | |

**Partly covered.** A card touches each of these pages but leaves part of it as v2. The
remaining part is treated in sections 3 and 4.

- **Admin:**
  - Dashboard: everything except the tiles.
  - Tasks: history, needs-attention, repair runs, playback delivery and task detail.
  - System: score, latency, metric streams, routes.
  - Analysis: the coverage panels.
  - Artist and Album: everything except the enrichment tab, setlist tab, readout and sidecar.
  - Genres: the grid and tree views and the invalid/unmapped boxes.
  - Federation: the Peers, Policies, Streams, Imports, Security and Audit tabs.
  - Upcoming: the calendar and month list.
- **Listen:**
  - Home: everything except the heatmap tile.
  - Explore: everything except moods and the wheel.
  - Stats: everything except the heatmap and counters.
  - Radar: the rows and release rows.
  - Settings: everything except devices and tokens.
  - Player: everything except the EQ glyph, Info readout and queue mix strip.
  - Radio and Paths: the station rails, seed search and endpoint panel.

Site visuals with no product home yet: `ApiTerminal`, `UuidDerivation`, `ScaleFigures`,
`Explore` rows, `Roadmap` cards, `ChapterToc`. Suggested homes are in section 6.

---

## 2. Cross-cutting recipes

Every recipe below shows real state on first paint, renders the final state under reduced
motion, and keeps per-frame values in refs (`platform.md` sections 3 and 4). Each one needs tests
for its static render, its states and its keyboard behaviour.

### 2.1 Primitive gaps to close first (P0 · M)

These gaps come straight out of the card verifications. Closing them once avoids 26 local
workarounds.

| Gap | Cards that hit it | Proposal | Home |
| --- | --- | --- | --- |
| No instrument panel shell | health, release, orbit, readout, lanes, gauges, wheel, sidecar, outbox, redis, system map | `InstrumentPanel`: a `<figure>` with `pt-[22px]` and `border-t border-border-quiet`, a header row with two `MonoLabel`s (`accent` + `meta`), a right-hand status slot with `aria-live="polite"`, and an optional `aria-label` sentence. Replaces `OpsPanel`, Admin `Card` panels and Listen `SettingsPrimitives.Section` | `@crate/ui/primitives` (both apps) |
| No meter | gauges, redis, sidecar, offline, completeness, i18n | `Meter`: a 2–4 px track, `scaleX(var(--v))` fill in `accent-action-hi`, an optional limit tick, an `over` state that turns `state-warning` and changes the label text, and `role="meter"`. Value writes go through a ref | `@crate/ui/primitives` |
| No readout | EQ, health, release, gauges, heatmap, wheel | `Readout`: one mono line with reserved width (`min-w-[12ch]`), plus a separate sr-only `aria-live` node so hover scrambles are never announced | `@crate/ui/primitives` |
| No progress hairline | sidecar, release, imports, uploads, tasks | `ProgressHairline`: determinate `--p`, or indeterminate (the site Roadmap "building" bar), visibility-gated, static under reduced motion | `@crate/ui/primitives` |
| `StatNumber` stops at `text-5xl`, weight 700, label always below | health, release, heatmap, page headers | Add an `xl` tier (800, `leading-[.85]`, `-0.05em`, `clamp(3.2rem, 8.4vw, 8.4rem)`), weight 800 on `lg`, and a `unit` slot that renders the mono unit inline (site `dd small`). Also forward `ref` | `@crate/ui/primitives` (changes Listen and Admin; needs a visual check) |
| `HairlineRow` renders children in `span.truncate` and cannot be a link or button | health tile, outbox, sidecar, token | `as` / `href` / `onSelect` props, pass-through `id` and `aria-*`, and an `active` state (2 px bar plus gradient, recipe §2.10) | `@crate/ui/primitives` |
| `MonoLabel` drops `role`, `id` and `aria-*` | tokens, heatmap | Pass the props through | `@crate/ui/primitives` |
| `CratePill` always emits `aria-pressed`, is about 24 px tall, and gets 6 px corners in Listen | release, wheel, tokens, radio | Default `min-h-8`. An action variant (no `aria-pressed`). Settle the Listen pill radius (`v3-state.md` 5.1, option b) | `@crate/ui/primitives` |
| `#0d0e14` exists only as `--color-card`. `bg-card` counts as legacy in the Listen drift check | sidecar, tokens, toasts, dialogs | A semantic alias, for example `--color-surface-object` (utility `bg-surface-object`), generated from the registry and referenced in the same change | `@crate/ui/tokens` |
| Motion gate exists only in Listen (`lib/motion-availability.ts`) | every animated card | Move the DOM half (media query, `data-crate-motion`, `document.hidden`) to `@crate/ui/lib/motion-gate.ts`. Listen wraps it with its preference store | `@crate/ui/lib` |
| `stepSpring`, `useVisibleLoop` and `scramble` are about to be ported 6+ times | EQ, wheel, readout, release, gauges, orbit | Port once into `@crate/ui/lib`, moved there the day the EQ spring fix (used by both apps) lands. App-only consumers stay app-local until then (`platform.md` 10.1) | `@crate/ui/lib` |
| Two independent Toaster setups | — | Section 2.10 | `@crate/ui/lib` |

### 2.2 Page header anatomy (P0 · M)

- **Site source:**
  - `PageHeader.astro`: eyebrow mono 11.5 px at .16em; display H1 in Cabinet 800,
    `clamp(3.2rem, 9vw, 9.5rem)`, max 11ch, lh .9, -0.045em; lede in Cabinet 500 fg-2, 36ch; gap
    28 px.
  - `Chapter.astro`: a 5fr/7fr head with `<b>03</b> / Title` + H2 + `StatusBadge` on the left
    and the lede on the right, `align-items: end`.
  - `ChapterToc.astro`: mono 11.5 px at .14em with the index in cyan-hi.
- **Product today:**
  - Listen `@crate/ui/domain/navigation/PageHeader` (11 files): `text-3xl font-bold` with a
    `text-xs font-semibold` eyebrow.
  - Listen `domain/hero/PageHero` (9 files).
  - Admin `OpsPageHero` (10 pages), 3 inline copies, and 7 ad-hoc `h1` recipes
    (`admin-audit.md` §4).
- **Recipe (app scale):**
  - **Back link** (optional): mono `← Artists` in `text-text-subtle`, turning `text-text-primary`
    on hover.
  - **Eyebrow:** a `MonoLabel` with an accent key word and meta. In Admin pages that back a site
    chapter it carries the site's /admin chapter number (`<accent>03</accent> / Acquisition`).
    Everywhere else it is context (`Collection · Albums`, `Admin · Users`).
  - **Title:** `font-display` 800, `leading-display`, `tracking-[-0.045em]`, `text-balance`.
    - Page tier: `clamp(2.25rem, 4vw, 3.75rem)`. The site's 9.5 rem is marketing scale and too
      large inside a shell.
    - Entity tier (artist, album, playlist, genre, profile): `clamp(2.6rem, 5vw, 4.4rem)`, the
      site's ticket-artist size, at most two lines with ellipsis.
    - Do not assume Cabinet metrics for non-Latin names (`platform.md` 7).
  - **Lede** (optional): Cabinet 500, `text-text-muted`, 36ch.
  - **Meta row:** either a `MonoLabel` meta list (`12 albums · 143 tracks · added 3 d ago`) or a
    `StatStrip` of 2–4 `StatNumber`s. Never icon tiles.
  - **Actions:** on desktop, right-aligned on the title baseline (pill CTA plus ghost chips); on
    mobile, a wrapped row below.
  - **Framing:** no card, glow, top rule or icon tile on the header. The first panel below it
    carries the top rule.
  - **Entrance:** one `enter-up` per route (opacity plus 12 px translate, 0.5 s
    `ease-out-expo`). Do not split words in the apps: the cost and the accessibility work are not
    worth it. No `filter: blur` entrance on Android WebView or WebKitGTK. Nothing under reduced
    motion.
- **Homes:**
  - Restyle the Listen `PageHeader` in place.
  - Admin gets a local `PageHeading` that replaces `OpsPageHero` and the ad-hoc recipes. Delete
    the dead `shared/ui/domain/stats/Ops*`.
  - Converge the two later if Admin adopts the shared one.

### 2.3 Section headers and panel shell (P0 · S, then adoption)

Two kinds of section:

1. **Data or instrument section.** Uses `InstrumentPanel` (2.1). The left label holds the key
   word plus a plain description; the right label holds technical meta or live status (recipe
   §2.1). Applies to every Admin panel, the Listen Stats cards, the Settings sections and the
   player Info tab sections.
2. **Content rail** (Listen Home, Artist and Explore rails; Admin discography and related
   albums). Restyle the shared `SectionHeader` (17 Listen files) once, which migrates every
   rail:
   - an optional `MonoLabel` eyebrow;
   - the title in Cabinet 700, `clamp(1.25rem, 1.7vw, 1.6rem)`, -0.02em (site `FeatureList`
     h3);
   - the count as mono tabular `text-text-subtle`;
   - "See all →" as a `u-link` (cyan-hi underline drawn from the left in .45 s `ease-snap`) with
     a 44 px hit area on coarse pointers.

Spacing: 12–28 px from header to body. Use fixed 32, 48 or 64 px steps between sections, not the
site's vh units (recipe §8.8).

### 2.4 Navigation chrome (P0 · M)

- **Site source:**
  - `Nav.astro` and `base.css`: a fixed bar with a gradient fade 28 px below it instead of blur;
    an 18 px Cabinet 800 wordmark; sans 13 px links.
  - The mobile menu is a full-screen `role="dialog"` with a focus trap, Escape to close and focus
    restore.
  - `u-link` underline.
- **Admin sidebar** (`components/layout/Sidebar.tsx`):
  - Group labels become `MonoLabel` (they are `text-[10px] tracking-[0.18em] text-white/25`
    today).
  - Items in sans 14. The active item gets a 2 px `accent-action-hi` bar on the left plus
    `text-text-primary` (site `.scan-list li::before`), replacing the filled `bg-white/10` pill.
  - Badges become a mono tabular count plus `StatusDot`: `warn` for issues, `on` for running.
    The collapsed 72 px rail keeps only the dots.
  - The regrouping question stays open (`admin-audit.md` Q3).
- **Admin header:**
  - Flat canvas, no glass. A bottom hairline appears only after scroll.
  - A mono breadcrumb, for example `ADMIN · 07 / OPERATIONS · TASKS`, with the chapter number in
    `accent-action-hi`.
  - Back and forward become ghost icon buttons with no shadow.
  - Search follows 2.6.
- **Admin command palette** (Cmd+K):
  - Built on the popover recipe (2.9).
  - Group labels as `MonoLabel`, hairline rows, and the active row marked with the 2 px bar.
  - Keyboard hints as mono tags.
  - Task actions show their queue in mono, using the `queue` and `governed` catalog flags the
    queue-lanes card adds.
- **Listen desktop sidebar** (`components/layout/sidebar/*`):
  - Same item recipe as Admin. The collection sections use hairline rows with mono counts.
  - Remove the Discovery-radio glow driven by `useAudioVisualizer` state (`listen-audit.md` §10
    perf issue).
- **Listen top bar** (`components/layout/TopBar.tsx`, `topbar/*`):
  - Keep the transparent-header pattern, but replace the blur with the site's gradient fade where
    content scrolls under.
  - The search field follows 2.6 and its dropdown follows 4 (L13).
  - The user menu follows the popover recipe.
- **Listen mobile tab bar** (`components/layout/MobileBottomNav.tsx`):
  - Four or five items, each an icon (`@crate/ui/icons`, 22 px) plus a mono 10 px label at .08em.
  - Active item: `accent-action-hi` icon and label plus a 2 px top bar that draws in with
    `scaleX` and `ease-snap`. Inactive items use `text-text-subtle`. No filled pill.
  - Respects `--listen-safe-*` and keeps 44 px targets.
  - The mini player above it carries a 1 px `accent-action-hi` progress line on its top edge,
    written through a ref from a `usePlayerProgress` leaf.
  - The collection sheet follows 2.9.
- **Page transition:** replace `animate-page-in` with opacity plus an 8 px translate,
  0.35 s `ease-out-expo`. Nothing under reduced motion.

### 2.5 Lists, tables, track rows, media grids (P0 · M)

- **Hairline list** (recipe §2.10, via `HairlineList`):
  - Rows with 9 px vertical padding and `border-border-quiet-subtle` dividers; the list starts on
    a `border-border-quiet` top rule.
  - Mono index in `2.4ch`, `text-text-subtle`. Title in sans 14–15 `text-text-primary`. Meta in
    fixed-`ch` mono columns, so columns align without a table.
  - Hover: `bg-accent-action/4` (the site tile hover at .04).
  - Active: a 2 px bar plus `from-accent-action/8` gradient to transparent at 70%.
- **Tables:** use a semantic `<table>` when the data has three or more comparable columns or
  needs sorting (Users, Roles, task history, reconcile runs, route latency, Federation streams,
  i18n bundles).
  - No zebra stripes and no cell borders.
  - `thead` in mono 10.5 px at .14em, uppercase, `text-text-subtle`, with a bottom
    `border-border-quiet`.
  - Body rows like the hairline list. Numeric cells right-aligned in tabular mono. Status cells
    show `StatusDot` plus a word.
  - Sortable headers are buttons with `aria-sort` and a mono `↑`/`↓`.
  - Sticky header on a canvas background inside scroll areas.
  - Drop columns at 1000 px and 760 px, as the site does.
  - `TableSkeleton` keeps the same geometry and shows `—`.
- **Track row**, used by the Listen `domain/tracks/TrackList`, `AlbumTrackList`,
  `PlaylistTrackList`, `QueueTrackRow` and search results, and by the Admin `TrackTable`:
  - Columns: index | title over artist | trailing meta | duration | actions.
  - The index swaps to a play glyph on hover or focus.
  - Playing row: the active bar plus the title in `accent-action-hi`.
  - Trailing meta in mono 10.5 px: `124 · 8A` (BPM and Camelot, already in the row data), desktop
    only.
  - Quality and explicit flags as mono tags, never coloured badges.
  - Remote items carry `via <node>` (2.18).
  - The duration is a tabular mono string, never re-rendered per tick.
- **Media grid and rail** (`MediaGrid`, `MediaRail`, `EntityCard`, `MediaCover`):
  - Square covers with no shadow, a 1 px inset hairline (`ring-1 ring-inset ring-border-quiet`)
    and the product radius.
  - Title in sans 14/500, truncated; meta in mono 10.5 px `text-text-subtle` (`2019 · LP`).
  - Hover: the hairline goes to `accent-action-hi/40` and the title to `accent-action-hi`. No
    lift and no scale.
  - Play overlay: the 40 px round cyan disc from the site's setlist footer, on hover or focus.
  - Placeholder: an `accent-action/16` fill with mono initials (the site's artwork placeholder).

### 2.6 Forms (P1 · M)

The site has almost no forms. This recipe is built from its chip, CTA, focus ring and mono-label
rules.

- **Field** (`FormField`: 9 Listen files; Admin uses ad-hoc label plus `Input` in 25 files):
  - A `MonoLabel` above (11 px, .14em, uppercase, `text-text-subtle`) with an 8 px gap.
  - Input: 40 px tall (44 on coarse pointers), transparent on the canvas and `surface-input` on
    cards, `border-border-quiet`, `rounded-lg` (6 px, consistent with Listen's pin), sans 15
    `text-text-primary`, placeholder `text-text-subtle`.
  - Focus: a 2 px `accent-action-hi` outline at offset 2, and the border at
    `accent-action-hi/40`.
  - Helper text in mono 11.5 px `text-text-subtle`.
  - Error: `StatusDot` warn plus the message in `state-warning`, with `aria-invalid` and
    `aria-describedby`. No red border.
  - Validate on blur. Field errors never raise a toast.
- **Search** (`SearchInput`: 11 Listen files; Admin `SearchBar`): same field recipe, a search
  glyph in `text-text-subtle`, a mono `⌘K` tag in Admin, and the clear button as a ghost icon.
- **Select:** with seven options or fewer, a chip group (`role="group"`, `aria-pressed`, recipe
  §2.7). With more, a select whose trigger uses the field recipe and whose popover uses 2.9
  (`AdminSelect` in 12 files, shadcn `select`).
- **Switch:** a 32×18 hairline track. Off: a `text-text-subtle` thumb. On: an `accent-action-hi`
  track with a canvas thumb. No slide under reduced motion.
- **Segmented control** (6 Listen files): becomes a chip group.
- **Checkbox and radio:** a hairline box; checked state is an `accent-action-hi` fill with a
  canvas mark.
- **Textarea:** the field recipe. Mono when the content is code (playlist rules, JSON).
- **Slider** (crossfade seconds, path steps, volume, EQ bands): a 2 px track (site feature
  bars), an `accent-action-hi` fill through `--v`, a 14 px ring thumb, the value as tabular mono
  on the right, and keyboard steps.
- **Submit:** keep the label width and show an inline busy glyph with `aria-busy`.

### 2.7 Buttons (P0 · S)

- **Primary CTA:** a pill with an `accent-action` fill and canvas text (site `.cta .pill`: sans
  500, 13 px, 36 px tall, 16 px horizontal padding). Hover scales to .975 and press to .95 over
  0.08 s, with the spring set through longhand properties and an `@supports` fallback
  (`platform.md` 3.2). Focus outline offset 4. The Listen radius is still open (`v3-state.md`
  5.1).
- **Secondary:** a ghost chip (hairline, mono 11) using the `CratePill` action variant with no
  `aria-pressed`.
- **Round play** (`domain/media/PlayButton`): 40 px in rows and tickets, 56–64 px in heroes and
  fullscreen; an `accent-action` disc with a canvas triangle.
- **Icon button:** ghost, no tile, no shadow, hover `bg-accent-action/4`, 32 px (44 on coarse
  pointers).
- **Link:** `u-link`.
- **Destructive:** still undecided (`admin-audit.md` Q4). Proposal: no red anywhere except the
  confirm button inside a destructive dialog. That button states its consequence in text, for
  example "Delete 12 files".

### 2.8 Tabs and filters (P1 · S)

- **Switching panels:** keep `role="tablist"`. Style the tabs as mono 11.5 px .14em uppercase
  text (the site TOC look), with the active tab marked by a 2 px `accent-action-hi` underline.
  Applies to:
  - Admin Federation, Download, Artist, Settings sections and i18n panes;
  - Listen Library, Extended and Fullscreen player tabs.
- **Filtering a list:** a chip group with `aria-pressed`.
- **URL state:** keep the selected tab in the URL (`?tab=`, `?section=`, `?queue=`). The
  enrichment-orbit and federation-relay cards already need this.
- **Mobile:** a single horizontally scrolling row (the site's chip recipe).

### 2.9 Dialogs, sheets, popovers, menus, tooltips (P1 · M)

- **Site:** only the full-screen mobile menu (focus trap, Escape, focus restore, `menu-in`).
- **Product today:**
  - Listen: `AppModal` (10 files), `composites/ConfirmDialog` (12), `MobileActionSheet` (3),
    `ContextMenu`, `ItemActionMenu`, `AppPopover`.
  - Admin: shadcn `dialog` (11), `alert-dialog` (2), `sheet` (2), and a local `ConfirmDialog`
    (15 consumers).
- **Modal:**
  - Surface: object card (2.1) or the popover token (`#111218`), `border-border-quiet`,
    `rounded-panel`. The Listen 12 px modal pin is open (`v3-state.md` 5.5).
  - Overlay: canvas at .72 with no blur.
  - Header: a `MonoLabel` eyebrow plus a Cabinet 700 title at 1.4–1.6 rem, -0.03em.
  - Body: `text-text-muted`, 60ch.
  - Footer: a top hairline, with ghost cancel and CTA confirm on the right.
  - Widths: 420, 560 and 760 px.
  - Entrance: `popIn`, or `sheetUp` on mobile, with longhand easing. Reduced motion gets a
    0.2 s fade.
- **Confirm dialog:** one implementation. Admin moves to the shared composite, which makes it
  legitimately shared.
  - Add a `consequence` line in mono, for example `12 files · 1.4 GB · moves to Library Trash`.
  - Add a typed confirmation for wipe and rebuild.
- **Sheets:**
  - A 36×4 grabber in `border-border-quiet` and hairline rows.
  - Remove the `listen-mobile-eq-glass` blur.
  - The Admin mobile sidebar sheet reuses the sidebar recipe.
- **Popovers and menus:**
  - Popover surface plus hairline plus `rounded-panel`, with one soft elevation shadow (allowed
    for overlays).
  - Group labels as `MonoLabel`. Items in sans 14, 36 px tall (44 on coarse pointers).
  - Hover `bg-accent-action/4`. The checked item gets `accent-action-hi` text plus a
    `StatusDot`.
  - Separators in `border-border-quiet-subtle`; shortcuts as mono tags.
- **Tooltip:** object card, hairline, mono 11 px `text-text-muted`, 28ch max, 400 ms delay.

### 2.10 Toasts and inline feedback (P0 · S)

- **Site:** has no toasts. Feedback happens in place.
  - `InstallCommand` scrambles its pill to "Copied" over 320 ms and back after 1.7 s.
  - Readouts update with `aria-live`.
- **Product today:**
  - Admin mounts `<Toaster theme="dark" position="bottom-right" richColors />`
    (`app/ui/src/App.tsx:466`), and 52 files call `toast`.
  - Listen mounts `<Toaster richColors position="bottom-center">` (`app/listen/src/main.tsx:71`)
    behind `notify`, which 80 files use.
  - `richColors` paints success, error, info and warning as filled green, red, blue and amber
    toasts. That is the most visible palette violation in either app.
- **Recipe:**
  1. **Prefer inline feedback** whenever the control is still on screen: a scrambled label swap
     (plain swap under reduced motion), the panel readout (`queued · task 3f2a`), or a
     `StatusDot` change. Use a toast only when the outcome outlives the control: navigation away,
     a background task finishing, or a network error.
  2. **Skin:**
     - Drop `richColors` and pass `toastOptions.classNames`.
     - Object card, hairline, `rounded-panel`, 12/16 px padding, 380 px max width.
     - Message in sans 14. The type is a `MonoLabel` key word (`SAVED`, `QUEUED`, `FAILED`) in
       `accent-action-hi` for success and info, `state-warning` for warning and error.
     - Description in mono 11.5 px `text-text-muted`. The action is a ghost chip.
     - Icons are optional, through the existing icon props: lucide in Admin, `@crate/ui/icons` in
       Listen.
  3. **One shared config:** `@crate/ui/lib/toaster-config.ts` holds the class names and default
     durations. Both apps mount their Toaster with it in the same change, which is legitimate
     because sonner is already a peer of `@crate/ui`.
  4. **Admin task toasts** carry the task id in mono plus `Open task →` linking to `/tasks?task=`.
- **Tests:** the Listen `toast-policy` stays as it is. Add a snapshot of the class-name contract.

### 2.11 Empty, loading, error, stale, warming, offline (P0 · M)

Principle (recipe §2.6 and every card): reserve the real geometry. Never put a spinner inside an
instrument, and never use a dashed box with a big icon.

| State | Recipe | Product components |
| --- | --- | --- |
| Loading (in place) | The final layout with `—` numerals and idle rows (1 em bars at `.05`). No shimmer. An sr-only `role="status"` line | `LoadingState section`, Admin `table-/grid-/card-skeleton` |
| Loading (route) | A `MonoLabel` `LOADING` over a 120 px indeterminate hairline in `accent-action-hi` (the site Roadmap bar), shown only after 200 ms | `LoadingState page/screen`, `CrateLoader` (17 Listen files), Suspense fallbacks |
| Empty | Inside the panel shell: one mono readout plus one `text-text-muted` sentence plus at most one CTA. Lists keep their top rule | `EmptyState`: make `inline` the default with no icon; deprecate `panel` and `dashed`. Admin dashed boxes go away |
| Error (inline) | `StatusDot` warn, a mono readout (`offline · retrying in 6 s`) and a ghost `Retry` chip. The last data stays visible, marked stale | per surface |
| Error (page) | A `MonoLabel` eyebrow (`ERROR · 503`, `NOT FOUND`), a Cabinet 800 2.5 rem title, a `text-text-muted` body, a Retry CTA and a Back `u-link`. No red icon | shared `primitives/ErrorState` (11 Admin files plus Listen) |
| Stale | Header meta `updated 4 min ago` in `text-text-subtle`. Amber only past the surface's threshold (per card) | per surface |
| Warming (snapshot cold or pending) | A `MonoLabel` `BUILDING` plus `StatusDot` warn (with a pulse prop when motion is allowed) plus the skeleton geometry. Driven by push or task events; no new polling | snapshot surfaces |
| Offline (Listen) | `OfflineBadge` becomes a mono `OFFLINE` tag with a ring dot. Disabled actions explain why in text instead of just dimming | `domain/offline/OfflineBadge` |
| Partial | Render what exists, show `—` with a `title` explaining it, and never hide the whole panel | all |

Also replace `Loader2 animate-spin` progressively (48 Listen files, 51 Admin files). Spinners
remain only inside buttons. Delete the dead Admin `components/ui/error-state.tsx`, which is only
re-exported from a barrel that nothing imports.

### 2.12 Progress (P1 · S)

- **Determinate:** a 2 px `border-border-quiet` track and an `accent-action-hi` fill at
  `scaleX(var(--p))`, with the value in tabular mono (`42%` or `07/17`). Use
  `role="progressbar"` and write the value through a ref.
- **Indeterminate:** the site Roadmap "building" bar (96×2 px, a 36% block, a 2.4 s loop) in
  `accent-action-hi`. Visibility-gated; a static block under reduced motion.
- **Task progress** (Admin tasks, health, sidecar, enrichment; Listen ZIP download, remote
  import, upload): a progress hairline plus a mono phase line built from `TaskProgress`
  (`phase · item · done/total`) plus elapsed time.
- **Fixed phases:** when a task has a fixed sequence (the 9 `process_new_content` phases, the
  `library_pipeline` health → repair → sync phases, write then rehydrate), use the site step rail
  (recipe §2.14).
- **Replacements:** shadcn `progress` and the ad-hoc bars.

### 2.13 Status colour and severity policy (P0 · S, decision)

| Meaning | Visual |
| --- | --- |
| ok, done, active, on, in library | `StatusDot on` and `accent-action-hi` |
| waiting, needs confirmation, deferred, degraded, stale, over limit | `StatusDot warn` and `state-warning` |
| off, never run, missing, idle | `StatusDot off` (ring) and `text-text-subtle` |
| failed | `warn` plus the word "failed". The site has no red; open decision |
| severity (Health critical/high/medium/low, log levels) | the 3-step grey risk meter plus a word (recipe §2.8), not red, orange and yellow |
| destructive action | open decision; see 2.7 |

Decorative state colours to remove:

- Listen: `MOOD_COLORS` (handled by the mood-map card), Info tab `tone="warm"` (readout card),
  profile badge tones `cyan/gold/green/rose` (`pages/user-profile-model.ts:47`; this pass), and
  the affinity band tint (`ProfileHoverCardContent.tsx`).
- Admin: 398 emerald/green/red/rose classes, 284 amber/yellow/orange and 63
  violet/fuchsia/blue/sky; Download quality badges; Health scope badges.

Charts follow the same rule: series in cyan-hi and cyan plus fg alpha steps, with amber only for
threshold or over-limit series.

### 2.14 Numbers, units, time (P1 · S)

- Use `tabular-nums` on every number that changes.
- Use a real minus (`−`), ` · ` separators and `→` for flows.
- Units are lower-case mono, small, after the numeral (`41 min`, `2.3 MB/s`, `dB`). Use `~` for
  estimates (site `ScaleFigures`), and compact `12.3K` only in headers.
- Durations: `m:ss` under an hour, `h:mm:ss` above.
- Relative time in mono (`3 h ago`) with the absolute time in the `title`.
- Countdowns read `T−12 d` (the release-timeline card's `clockLabel` in Admin, `ReleaseCountdown`
  in Listen).
- Indices are zero-padded (`01`); progress reads `07 / 17`.
- Listen formats with `Intl` in the active locale; Admin uses `en-US`. Each app keeps one format
  module. Move a helper to `@crate/ui/lib` only when both apps call it (`formatGain` already
  lives in `EqBands`).

### 2.15 Nivo charts (Admin mostly · P1 · M)

- One token-resolved theme per app: `readCssColorToken` at mount, re-resolved when the appearance
  changes (`platform.md` 2.1).
  - Hairline grid in `border-border-quiet`, no domain lines.
  - Mono ticks at 10–11 px in `text-text-subtle`.
  - Crosshair in `accent-action-hi`. Tooltips use the object card with a hairline.
  - Area fill at .08 at most.
  - `animate={!reducedMotion}`.
- Replace pies with a proportional hairline bar plus a mono legend; replace radars with feature
  bars (readout card).
- Use small multiples on hairline separators instead of filled cards.
- Applies to Insights, SystemHealth metric streams, Dashboard diagnostics and ArtistStats.

### 2.16 Motion defaults for screens (P1 · S)

- Page and list entrances: list items stagger at 70 ms (site), capped at 8 items, with opacity
  plus a 12 px translate.
- Colour and state changes: 0.3 s `ease-snap`. Press: scale .95 on chips and CTAs.
- No blur entrances on Android WebView or WebKitGTK.
- Springs only inside instruments. Data refreshes elsewhere crossfade in 0.2 s.
- Every rule passes through the shared motion gate (2.1).

### 2.17 Focus and keyboard (P0 · S)

- `:focus-visible` becomes a 2 px `accent-action-hi` outline at offset 3 (site), replacing
  `shadow-focus` on `accent-action` (`v3-state.md` 4.1). Use an inset of -2 px on edge-to-edge
  rows and tiles.
- Roving tabindex in chip groups and in instrument node sets.
- A skip link in both shells.
- Escape closes layers (`lib/use-escape-key`).

### 2.18 Remote provenance tag (Listen; Admin global catalog · P2 · S)

- A mono 10.5 px tag `via north.crate` in track rows, search results and Admin global catalog
  sources. It adds a ring `StatusDot` when `availability.stale` is set or `healthy` is false.
- The Listen Info tab "Source" section adds a static mini route: `north.crate → your node → this
  device · relayed`. Data: `Track.remote` and `lib/playback-provenance.ts` (`listen-audit.md`
  7.5).
- The full federation diagram stays in Admin (federation-relay card).

---

## 3. Admin surfaces without a site visual

Each block lists the files, the v3 treatment, the real data that becomes a visual, any
precondition, and then priority and effort.

**A1. Shell: sidebar, header, command palette, keyboard help, mobile top bar.** P0 · M

- Files: `components/layout/{Shell,Sidebar,SearchBar,CommandPalette}.tsx`.
- Treatment: section 2.4.
- Data to visual: sidebar badges from `useOpsSnapshot().status` become a mono count plus
  `StatusDot`; the breadcrumb comes from the route table and the site chapter numbers.
- Test: `Shell.test.tsx` for the active bar, badges and breadcrumb.

**A2. Dashboard (beyond the tiles).** P0 · M

- File: `pages/Dashboard.tsx`.
- Treatment:
  - `PageHeading` `Admin · Overview`.
  - A status row of `StatusDot` plus mono labels: Postgres, watcher and health (today's hero
    chips), plus the event-pipeline status once the outbox-sequence card lands.
  - A `StatStrip`:
    - the health tile (card);
    - running and queued, from the `queue_breakdown` sums;
    - listeners now, from `runtime.active_users_5m` and `streams_3m`;
    - library size, from the ops snapshot counts, using the site `ScaleFigures` recipe with `~`
      when approximate.
  - "Needs attention" as a `HairlineList` with amber dots. Sources: confirm-waiting health
    issues, failed tasks, stale snapshots, deferred tasks.
  - Recent albums as a cover row with mono `added 3 h ago`.
  - Advanced diagnostics: the formats pie becomes a proportional hairline bar, decades become a
    hairline histogram, and the event bus collapses to the outbox summary line (card).
  - Rebuild and wipe move into a bottom "Maintenance" panel with typed confirmation (2.9).
- Precondition: `OpsSnapshotContext` `fresh=1` on focus rebuilds `ops/dashboard` inside the
  request (V3). Every card repeats this blocker.
- Test: new `Dashboard.test.tsx` (there is none today).

**A3. Login and Setup.** P2 · S (Login) / M (Setup)

- Login: the page-header anatomy at login scale.
  - Eyebrow `CRATE · <host>`, display title "Sign in".
  - Form per 2.6; OAuth buttons as ghost pills; CTA pill.
- Setup: a 3-step rail (recipe §2.14): `01 Admin account → 02 Keys → 03 First scan`.
  - Step 3 is real. `POST /api/setup/scan` returns a `library_pipeline` `task_id`
    (`app/crate/api/setup.py:136`); follow `/api/events/task/{id}` and show the health → repair
    → sync phase line.

**A4. Browse.** P1 · M

- Files: `pages/Browse.tsx`.
- Treatment:
  - Artist grid per the media-grid recipe: photo, name, and mono `12 albums · 143 tracks`.
  - `FilterBar` chips for genre, decade, format and missing photo; sort chips.
  - List mode uses the table recipe.
  - The header meta shows filtered and total counts.
- Data: `/api/artists`, `/api/browse/filters`. No new aggregates.

**A5. Artist (all tabs except Enrichment and Setlist).** P1 · L

- Files: `pages/Artist.tsx`, `components/artist/*`.
- Treatment:
  - **Hero:** display name (entity tier); mono meta `ARTIST · 12 albums · 143 tracks · MBID
    linked · enriched 2 d ago`; actions Enrich (card), Repair and Radio.
  - **Tabs:** text tabs with `?tab=`.
  - **Overview:** the first bio paragraph as a Cabinet 500 lede; facts as a mono `dl`.
  - **Top tracks:** the track row with mono play counts.
  - **Discography:** a media grid grouped by type under `MonoLabel` headers.
  - **Similar:** retint `ArtistNetworkGraph` through tokens (`readCssColorToken`), with mono
    canvas labels and a hairline tooltip. Fetch `/api/shows/artists-with-shows` once per page
    instead of on every centre change.
  - **Stats:** the Nivo theme; pie becomes a proportional bar, radar becomes feature bars.
  - **Artwork editor (Konva):** chrome per the form and dialog recipes.
  - **Shows:** the ticket (card).

**A6. Album (except the readout and sidecar).** P1 · M

- Files: `pages/Album.tsx`, `components/album/*`.
- Treatment:
  - Display title; mono meta `ALBUM · 2019 · 10 tracks · 41 min · FLAC 16/44.1`.
  - `TrackTable` per the track-row and table recipe: mono `124 · 8A`, analysis and bliss state
    dots, and the duration.
  - `TagEditor` per the form recipe with mono keys. The diff against file tags is highlighted
    the way the site highlights a JSON line (`from-accent-action/10`).
  - `MatchCard` shows a confidence meter plus candidate rows.
  - Related albums: a cover row.
- Optional data visual, the **album energy arc**: a 1 px SVG polyline of track `energy` in disc
  and track order.
  - Header meta adds the BPM range and the set of keys.
  - Computed client-side from rows already in the payload, so there is no backend work.
  - An sr-only summary carries the values; missing values leave gaps.
  - Shared with Listen L15. It moves to `@crate/ui/domain/tracks` only if both apps adopt it in
    the same change.

**A7. Trash and Contributions.** P2 · S each (plus a precondition for Trash)

- Trash:
  - A `StatStrip` with files and size.
  - Hairline rows with restore and delete ghost chips.
  - Empty readout `Library Trash is empty`.
- Contributions: a review queue in hairline rows with avatar, album, mono files and size, and a
  status dot (pending warn, approved on, rejected off).
- Precondition (Trash): `/api/manage/tracks/quarantine` runs `rglob` plus a tag read per file
  inside the request (health-scan card). The worker should maintain the index and counts.

**A8. Download / acquisition workspace.** P1 · L, with P0 preconditions

- File: `pages/Download.tsx` (2034 lines).
- **Treatment: acquisition lanes.** Reuse the queue-lanes model (`components/viz` in Admin)
  locally.
  - One lane per source: Tidal, Soulseek and Upload.
  - Zones: queued, transferring, processing, done.
  - Chips are labelled with the album in mono; the fill is the real progress. Soulseek chips
    carry `2.3 MB/s · user` in mono.
  - Done chips link to the album.
- **Search results:** hairline rows with mono quality tags (`FLAC · 16/44.1 · 312 MB`). A
  suspected fake FLAC shows as an amber tag with text.
- **Tabs:** become text tabs. The quality select becomes chips.
- **Wishlist and history:** tables.
- **Artist suggestions:** a cover row.
- **Data:** `AcquisitionQueueItemResponse` (`source`, `status`, `progress`, `speed`, `username`,
  `task_id`).
- **Preconditions** (section 5):
  - Move queue sampling to a worker that writes `ops_runtime_state` or a `ui_snapshot` and
    publishes it.
  - Gate `/snapshot` and `/stream` by capability.
  - Move the Last.fm key and cover lookups server-side (`admin-audit.md` 7.3).

**A9. Upcoming (calendar and month list).** P2 · M

- Files: `pages/Upcoming.tsx`, `components/shows/ShowCard.tsx`.
- Treatment:
  - Month view as a 7-column cell grid: day numerals in Cabinet 700, a filled dot for a show and
    a ring for a release (heatmap-cell recipe).
  - List grouped by month under `MonoLabel` headers, the same as the Listen Radar.
  - Releases link into the release rail (card); expanded shows use the ticket (card).
  - Popover filters become chip groups.
- Data: `/api/upcoming`.

**A10. Bandcamp.** P2 · M

- Treatment:
  - Header with the connection `StatusDot`.
  - A `StatStrip` of collection, wishlist and matched-to-library counts, only if those counts
    already arrive in the payload. Do not add request-time aggregates.
  - Items as cover rows with mono `bought 2024 · FLAC`.
  - Admin match review as hairline rows, with a confidence meter when `confidence` is present.
  - The display type goes from `text-4xl font-black` to the page tier.

**A11. Discover.** P2 · M, blocked by the insights snapshot

- Treatment:
  - Completeness rows use the site's row meter (`auto 1fr 5ch`): `local_count / mb_count` with
    a limit tick at 100%, sorted by the gap. Missing albums expand as a mono list.
  - Release radar uses `ReleaseRailCompact` (card).
  - Genres to expand: `GenrePill`s with counts.
  - Momentum: hairline rows with mono listeners and popularity.
- Data: `/api/discover/completeness` (`local_count`, `mb_count`, `pct`, `missing_albums`). Refresh
  is already a task.
- Precondition: `/api/insights` must become a snapshot (`admin-audit.md` 9.1).

**A12. Insights.** P1 · M, blocked by the same precondition

- Treatment:
  - Nivo theme (2.15) and small multiples.
  - A coverage `StatStrip` (photo, enriched and cover ratios as `Meter`s).
  - BPM histogram as a Nivo bar.
  - Energy × danceability as a scatter with `accent-action-hi` points at .35 alpha.
  - Decades as a hairline histogram.
  - Top genres as `GenrePill`s plus bars.

**A13. Analysis (except the readout).** P1 · M

- Treatment: one "Coverage" `InstrumentPanel`.
  - One row per pipeline: features, bliss, fingerprints, lyrics, portable metadata, and Smart Mix
    after the merge.
  - Each row is a stacked hairline bar: done in `accent-action-hi`, active in `accent-action`,
    pending as a track, failed in `state-warning`. Mono counts read
    `39,876 / 48,112 · 1.2% failed`.
  - A legend strip (recipe §2.4).
  - Backfill actions as ghost chips on each row, showing live task state from `ops-stream`.
    Smart Mix pause, resume and cancel slot in the same way.
  - Operator notes as `FeatureList` rows.
- Data: the ops snapshot `analysis` block, which is precomputed and live.
- Layout: coordinate the 5fr/7fr page reorganisation with the readout card.

**A14. Timeline.** P2 · S

- Treatment:
  - Year bars as hairlines with an `accent-action-hi` fill (`--v` = year count / max), mono
    years and decade dividers.
  - A `StatStrip` of span, total and peak year.
  - An expanded year shows a cover row.
- `/api/timeline` returns every album per request. That is fine at 4.4K albums, but it should
  become a snapshot if Timeline ever turns into a landing view.

**A15. Tasks (below the lanes).** P0 · M (same page as the queue-lanes card)

- Treatment:
  - A `StatStrip` of today, completed, failed, success rate and average duration.
  - History as a table: mono type, label, `StatusDot`, tabular duration, relative finish time,
    pool. Filter chips by status and `?queue=`.
  - "Needs attention": amber hairline rows with a retry chip.
  - Repair runs: rows with a risk meter.
  - Playback delivery: `Meter`s per variant. The 15 s poll stays until there is a push
    alternative.
  - Task detail drawer: header `TASK · tidal_download · 3f2a…`, a progress hairline plus a phase
    line, and `TaskEventLog` per the terminal recipe (recipe §2.12, mono 12/1.7).
- Preconditions: the fan-out and `tasks-stream` fixes from the queue-lanes card.

**A16. System (except the governor, Redis and event pipeline bands).** P1 · M

- File: `pages/SystemHealth.tsx`.
- Treatment:
  - Score as an xl `StatNumber` plus a mono readout (`3 warnings · p95 182 ms · governor
    allowed`).
  - API latency as a `StatStrip` (p50, p95, p99).
  - The 14 `MetricChart` cards become Nivo small multiples (2.15) with period chips
    (`1h · 6h · 24h · 7d`, `?period=`).
  - Route latency as a table with mono p95 and p99 plus an inline 2 px bar.
  - Transcoding as `Meter`s.
- The timeseries stay as on-demand fetches. Live values arrive through the governor card's
  push.

**A17. Logs.** P1 · M

- Treatment:
  - The console uses the terminal recipe (recipe §2.12): an object card with a chrome row
    `MonoLabel LOGS · live · 100 lines` plus a stream `StatusDot`.
  - Lines in mono 12/1.7: `HH:MM:SS level worker category message`. The level column is a fixed
    5ch: info in `text-text-subtle`, warn in `state-warning`, error as `state-warning` plus the
    word `ERR` (pending the failed-colour decision).
  - The task id links to the task.
  - Filters as chip groups plus search.
  - Auto-follow scrolling that yields on any user input: reuse the sidecar card's
    `useAutoFollowScroll`.
  - The worker roster as hairline rows with a `StatusDot` (seen within 60 s is on) and a mono
    `log_count`.
- Data: `AdminLogsSnapshotResponse` (`logs[]` with `level`, `category`, `worker_id`, `task_id`;
  `workers[]` with `last_seen`, `log_count`).
- Precondition: drop `fresh=1` from the page loader (V3).

**A18. Users.** P2 · M, with a precondition

- Treatment:
  - A presence strip: a `StatStrip` of online now, listening now, active devices and pending
    invites, computed client-side from the user list that already loads.
  - A table of users:
    - avatar, name, role in mono;
    - presence `StatusDot`: online is on, idle is off, suspended is warn;
    - now playing in mono (`title — artist`);
    - last seen as relative time; session count.
  - The Leaflet map gets a dark, desaturated basemap and markers drawn as 6 px `accent-action-hi`
    dots with a ring.
  - The dialogs follow 2.9.
- Data: `AdminUserSummaryResponse` (`online_now`, `listening_now`, `activity_status`,
  `active_devices`, `active_sessions`, `current_track`, `last_seen_at`).
- Precondition (section 5):
  - Rewrite the presence play-events query as a per-user top-1 `LATERAL` followed by a
    primary-key join.
  - Batch the `now_playing:{id}` cache reads.
- Live: no polling. Rows refresh on focus.

**A19. Roles.** P2 · S

- Treatment: a capability matrix as a table.
  - Rows are capabilities, as mono ids grouped under `MonoLabel` domain rows; columns are roles;
    cells are `StatusDot` on or off.
  - Sticky first column. On mobile, a role-picker chip group.
- Data: `/api/auth/roles`, read-only.

**A20. Playlists and the Playlist editor.** P2 · M

- Playlists: hairline rows with a 40 px artwork, the name, mono `smart · 48 tracks · regenerated
  2 d ago`, and a `StatusDot`.
- Editor:
  - The rule builder as chip rows with mono operators (`genre = post punk`, `bpm 120–140`).
  - The preview count as a `StatNumber`, read from the preview endpoint.
  - Generation progress as a phase line on the playlist stream, which needs reconnect handling
    through the shared `useSnapshotStream` from `admin-audit.md` §10.
  - Tracks use the track row with a drag handle.
  - AI description: a textarea plus an inline busy chip.

**A21. Translations (`/i18n`).** P2 · M

- Treatment:
  - Locale health as one row per locale:
    - the code in mono;
    - a `StatusDot`: stable is on, review is warn, no bundle is off;
    - draft, published and request counts as small numerals;
    - a stacked coverage meter (translated, stale, missing), built from the `/quality` issue
      codes (`missing_key`, `stale_translation`).
  - Bundles as a table.
  - Editor: a two-column source/target layout with mono keys; stale strings as an amber tag with
    text.
  - Import and export as ghost chips.

**A22. Settings.** P2 · L (1,931 lines)

- **Section navigation:** text tabs or a side list with `?section=`. The enrichment-orbit card
  needs `?section=enrichment`.
- **Primitives:** local `Section`, `StatTile`, `PanelCard` and `StatusDot` give way to v3
  primitives, which also removes the `StatusDot` name collision.
- **Schedules** (data visual): one hairline row per scheduled task.
  - Label, mono `every 6 h`, `last run 3 h ago`.
  - A 2 px hairline showing elapsed / interval. It turns amber once the run is more than 1.5×
    overdue.
  - A "Run now" chip.
  - Data: `settings.schedules` holds the intervals today. Add `last_runs` from the
    `schedule:last_run:{task}` settings keys (`app/crate/scheduler.py:96,182`) as one additive
    `key = ANY(:keys)` read in `GET /api/settings`.
- **Connections:** Tidal, Soulseek, Telegram and LLM as `StatusDot` rows.
- **Download policy:** the heatmap card, phase 2.
- **Storage:** a `StatNumber` plus a `Meter` wherever totals exist.
- **Audit log:** a table.

**A23. Federation (the Peers, Policies, Streams, Imports, Security and Audit tabs).** P2 · M

- Peers: a table of host, trust `StatusDot`, latency in mono, preset chip and a short mono
  fingerprint. The approve fix belongs to the card.
- Policies: chip groups plus hairline rows.
- Streams: a table with mono bytes and duration and a Revoke chip.
- Imports: task progress rows (2.12).
- Security: mono fingerprints and a key-rotation step rail (recipe §2.14).
- Audit: a table.
- Tabs move to the URL (`?tab=`), as the card requires.

**A24. Global catalog.** P2 · M, with a precondition

- Treatment:
  - A `StatStrip` of artists, albums, tracks and sources (the `ScaleFigures` recipe).
  - Serving mode as a `StatusDot`: global is on, local is off, warming is warn.
  - The taxonomy id, version and digest in mono, matching the wheel header.
  - **Last reconcile as a step rail:** `seen 52,113 → upserted 48,020 → created 312 → merged 41 →
    ambiguous 9`, with a mono numeral per step from `global_catalog_reconciliation_runs`.
  - Runs as a table.
  - **Duplicate review:** hairline rows with a confidence `Meter` whose limit ticks sit at .85
    and .90, so the ambiguity band is visible. A selected candidate gets the site
    `UuidDerivation` readout: normalised name → entity uid, explaining why two spellings share
    an id.
- Precondition (section 5): build the status payload at reconcile completion and serve it by
  primary key.

**A25. Genres residue (grid and tree views, invalid and unmapped boxes).** P1 · S, alongside
the wheel

- Tree: a `HairlineList` with indentation, mono counts and an EQ-source `StatusDot` (direct is
  on, inherits is off, none is warn).
- Grid: a `GenrePill` grid.
- The amber-gradient "needs taxonomy mapping" box becomes a `StatusBadge`-style amber note with a
  count.

**A26. Orphans.** S, decision

- `pages/Shows.tsx` and `pages/Profile.tsx` are not routed: delete them or route them.
- Verify that `artists/:artistId/:slug` is shadowed by the album route (`admin-audit.md` §6).

---

## 4. Listen surfaces without a site visual

**L1. Desktop shell: sidebar, top bar, transparent header, page transition.** P0 · M

- Treatment: section 2.4.
- Search dropdown: see L13.
- User menu: popover recipe.
- Test: update `Shell.test.tsx` and `TopBar.test.tsx`.

**L2. Mobile shell: tab bar, top bar, collection sheet, mini player.** P0 · M

- Treatment: section 2.4.
- Mini player: display-face title at 15 px; artist in mono 11 px `text-text-subtle`; a 1 px
  progress line driven by a ref; the round play disc at 36 px.
- Remove the glass, or keep blur only where content actually scrolls under the chrome
  (`listen-audit.md` §11).

**L3. Desktop app chrome (Tauri).** P2 · S

- macOS uses the native title bar; there is nothing to style.
- Linux frameless titlebar (`app/listen-desktop/src/components/LinuxWindowTitlebar.tsx`):
  - Mono window title.
  - Window controls from `@crate/ui/icons`. Today it imports `lucide-react`, which
    `listen-desktop/package.json` does not declare; it resolves only through workspace
    hoisting.
  - Hover `bg-accent-action/4`. Close hover stays neutral, pending the red decision.
- The tray and native menus cannot be styled. Only their strings change.
- The GTK accent question stays open (`listen-audit.md` §9).

**L4. Player bar (transport, seek, identity, volume, quality, waveform).** P0 · M

- Files: `components/player/PlayerBar.tsx`, `bar/*`, `PlayerTrackIdentity.tsx`.
- Treatment:
  - Title in the display face at 15–16 px (700); artist and album in sans `text-text-muted`.
  - Time codes in tabular mono, written through refs.
  - Seek: a 1 px hairline track that grows to 3 px on hover, with an `accent-action-hi` fill.
  - Play is the round disc; secondary controls are ghost icons.
  - Volume uses the slider recipe.
  - `QualityBadge` becomes a mono tag (`FLAC · 24/96`) with no colour.
  - `WaveformCanvas` and `SpectrumPlayButton` draw only where an analyser exists (desktop and
    web), with colours from tokens. Mobile shows the hairline only.
- Data-visual follow-up (P2): once the smart-mix card's phase C ships `rms_envelope`, the seek
  track can draw the real loudness envelope at 10 Hz. Until then, draw nothing synthetic.
- Fix in the same pass: `usePlayerBarController` re-renders on every tick, and
  `useAudioVisualizer` pushes arrays into state at 20 fps (`listen-audit.md` §6). Move both to
  refs.

**L5. Fullscreen player (mobile).** P0 · M

- Files: `FullscreenPlayer*.tsx`, `useFullscreenPlayer*`.
- Treatment:
  - Artwork with no shadow and a 1 px inset hairline.
  - Title in Cabinet 700 at `clamp(1.6rem, 6vw, 2.2rem)` with two-line truncation; artist and
    album in mono.
  - Seek per L4 with 44 px hit areas.
  - Play disc at 64 px.
  - Tabs (player, queue, lyrics, info) as text tabs.
  - The mobile EQ sheet loses `listen-mobile-eq-glass` (2.9).
- The double `useCrossfadeProgress` per-frame re-render is a known risk (smart-mix card). Track
  it separately.

**L6. Extended player (except the EQ glyph, Info readout and mix strip).** P1 · M

- Treatment:
  - Header `MonoLabel` `NOW PLAYING · from <source>`. The source comes from `playSource`: album,
    playlist, radio or path.
  - Text tabs.
  - The album-palette tint of the panel stays open (`listen-audit.md` Q3); the default is
    cyan-only.
  - **Suggested tab:** hairline rows with mono `92% · 124 BPM · 8A`, where the percentage comes
    from the similarity `distance` the suggestions already carry.

**L7. Queue (panel, tab rows, past tracks).** P1 · S

- Treatment:
  - Header `MonoLabel` `QUEUE · 24 tracks · 1 h 42 min` (summed client-side from the queue).
  - A source line (`RADIO · Burial · track profile`).
  - Rows use the track-row recipe with drag handles. The current track gets the active bar.
  - Past tracks at `text-text-subtle`.
- Mix strip: card.

**L8. Lyrics (panel, extended tab, fullscreen).** P1 · M

- Treatment:
  - Synced lines in Cabinet 700: the active line `text-text-primary`, past lines
    `text-text-subtle`, future lines `text-text-muted`.
  - The active line gets a 1 px `accent-action-hi` underline at `scaleX(lineProgress)`, written
    through a ref from a progress leaf.
  - Tap to seek, as today.
  - Footer `MonoLabel` `LYRICS · synced · lrclib`.
  - Empty state: `No synced lyrics · plain text` and the plain text.
- Data: `/api/lyrics` synced timestamps.
- Fix: `LyricsPanel.tsx:41` and `extended/LyricsTab.tsx:13` subscribe to `usePlayerProgress()` for
  the whole list. Only the active-line leaf should subscribe.

**L9. Visualizer, spinning disc, spectrum ribbon, surface switch.** P2 · S

- Recolour to the accent tokens. The default palette is cyan; the album palette becomes opt-in.
- Gate on `data-crate-effects` (`off` means a static frame).
- `SpectrumRibbonCanvas` has no production importer: remove it or keep it, as a decision
  (`platform.md` Q10).

**L10. Continue-playback prompt and sleep-timer readout.** P2 · S

- Prompt: an object card with `MonoLabel` `RESUME · <device> · 2:14` (`/api/me/playback-state/resume`),
  a progress hairline at the saved position, a Resume CTA and a Dismiss ghost.
- Sleep timer: a mono countdown in the player meta (`sleep 12:40`) plus the settings row
  (L21).

**L11. Home (except the heatmap tile).** P1 · L

- Files: `pages/Home*`, `components/home/*`.
- Treatment:
  - Greeting as a page-tier display title, with a mono eyebrow carrying the date and time of
    day.
  - Hero: artist imagery with no glow, and a mono meta line (`because you played …`).
  - Rails go through `SectionHeader` (2.3).
  - Recently played: a `HairlineList` with mono relative `played_at`, which is present in
    `home-types.ts`.
  - Just landed: a cover row with mono `added 2 d ago`.
  - Custom mixes: covers with mono `24 tracks · 92–128 BPM`, from the `bpm` fields on the mix
    tracks.
  - Upcoming preview and show prep reuse the ticket header (card).
- Data: the home discovery snapshot (readplane). Add no new fetch on mobile.

**L12. Explore (except moods and the wheel).** P1 · M

- Feature cards (Radio, Paths): `FeatureList`-style rows with display titles and `→` links, no
  glow.
- Just landed: cover row.
- Genre tiles (until the wheel ships): `GenrePill`s with mono artist counts from the
  explore-page payload.
- Time tunnels: a decade chip row.
- Crate playlists: a cover row.
- Decade detail: a year strip using the Timeline hairline bars (A14), from the decade payload
  rows.
- Playlist category: hairline rows.
- Genre detail page beyond the locator:
  - display genre name;
  - mono `family · 214 artists · EQ inherited from metal` (from the eq-inheritance card's data);
  - top artists rail.

**L13. Search (page and top-bar dropdown).** P1 · M

- Files: `pages/SearchResults.tsx`, `components/layout/topbar/TopBarSearch*`.
- Treatment:
  - Results grouped into `HairlineList`s, each under a `MonoLabel` (`ARTISTS · 4`,
    `ALBUMS · 12`).
  - The query match highlighted in `accent-action-hi`.
  - Keyboard navigation marks the active row with the bar.
  - Remote results carry `via <node>` (2.18).
  - Empty state: `No results for "…"` plus a suggestion.
  - Loading per 2.11, with no spinner.
- Data: `/api/catalog/search` (readplane). It already carries `origin` and the node.
- Fix: debounce the seed search. The Radio controller fires a search plus a full `/api/genres`
  fetch on every keystroke (`listen-audit.md` §10).

**L14. Artist.** P1 · L (spec step 4)

- Treatment:
  - Hero name (entity tier); mono meta `ARTIST · 12 albums · listened 41 h`, where the hours
    come from the user stats payload if present, never from a new aggregate.
  - Top tracks: the track row with mono plays and `124 · 8A`.
  - Albums: a rail.
  - Bio modal: lede typography.
  - Community sections: hairline rows.
  - Radio: a CTA pill.
  - The setlist modal belongs to the card.

**L15. Album.** P1 · M (spec step 5)

- Files: `pages/Album*`, `components/album/*`.
- Treatment:
  - Mono meta `ALBUM · 2019 · 10 TRACKS · 41 MIN · FLAC`.
  - `AlbumTrackList` per the track-row recipe, showing the `bpm`, `audio_key` and `energy` the
    rows already carry.
  - `ReleaseCountdown` as an xl numeral clock (`T−12 d`).
  - Remove the glass toolbar.
  - **Energy arc** (A6 data visual), client-side from the rows.

**L16. Library / Collection (Artists, Crates, Playlists, Albums, Liked, Bandcamp,
Contributions).** P1 · M (spec step 9)

- Treatment:
  - Page header with a `StatStrip` of artists, albums, liked and crates, from
    `get_user_global_library_counts` (user-scoped).
  - Tabs: the filled pills (`TAB_ITEM_CLASS_NAME`) become text tabs with `?section=` (the route
    already exists).
  - Grids use the media-grid recipe; the Liked list uses track rows.

**L17. Crates (list, crate page, editor, create modal).** P2 · M

- Keep `CrateCoverFlow`.
- Header: display name plus mono `5 members · 18 albums`.
- Album order: a `HairlineList` with drag handles.
- Members modal: hairline rows with presence dots.
- ZIP download: a `ProgressHairline` driven by the existing task SSE.

**L18. Playlists (playlist, curated, home playlist, home section).** P1 · M

- Hero: display name, mono `PLAYLIST · smart · 48 tracks · 3 h 12 min`.
- Smart rules: mono chips.
- Collaborators: avatars with `StatusDot`s.
- Tracks: track rows.
- Composer: forms per 2.6.

**L19. Stats (except the heatmap and counters) and Digging.** P1 · M (Stats) / P2 · M (Digging)

- Stats:
  - Cards become panels (2.3).
  - The signal tape, decade bars and genre trend keep their hand-built SVG (the allowed
    exception), restyled to hairline axes and mono labels.
  - Top lists: hairline rows with mono plays.
  - Sound profile: feature bars (readout card).
- Digging:
  - Each chapter as a full-bleed xl numeral (minutes, artists), with the artist name scrambled
    on reveal (1.1 s, the site's top-genre timing). Data from the same dashboard snapshot.
  - Share story canvas: load Cabinet Grotesk and JetBrains Mono through `FontFace` before
    drawing (`lib/social-share-story-builder.ts:42-50`).

**L20. Radar (except the ticket).** P1 · S

- Rows and collapsed cards are mostly done in the v3 slice.
- Release rows: a mono date plus a `T−12 d` countdown numeral.
- Summary: the `StatNumber` strip, already done.
- Home upcoming feature: ticket header (card).

**L21. Settings (except devices and tokens).** P1 · L (spec step 8)

- **Shell:** sections in the panel shell, rows on hairlines, connection states as `StatusDot`
  (scrobble, Bandcamp, servers, OpenSubsonic).
- **Offline** (data visual): two `Meter`s.
  - `readyTrackCount / trackCount`.
  - `totalBytes` against `navigator.storage.estimate()` quota, already read in
    `lib/offline-assets.ts`.
  - Errors show as an amber count with text.
  - Data: `OfflineSummary`, held client-side.
- **Playback:** crossfade and smart-transition controls with a static equal-power glyph sized by
  the chosen seconds. Reuse the smart-mix card's phase-A `mix-math`.
- **Language:** the locale list as chips.
- **Servers:** a hairline list with a reachability `StatusDot`, from the probe `ServerSetup`
  already runs.
- **Shows location:** a city search field.
- **Sleep timer:** chips.
- **Appearance:** the editor, behind its flag.
- **After the merge:** Smart Mix settings get a capability `StatusDot`, mode chips, and copy that
  is careful not to claim beat matching (smart-mix card honesty rule).

**L22. Social (People, UserProfile, UserConnections, ProfileHoverCard).** P2 · M

- **Affinity** (data visual): `affinity_score` as an L `StatNumber` (`82`) plus the mono band
  word (`high`). `affinity_reasons` become a `HairlineList`. No band colours.
- **Stats:** plays and minutes as a `StatStrip`.
- **Top genre:** a `GenrePill`.
- **Badges:** mono tags with an optional `accent-action-hi` key word. Remove the tones.
- **Connections:** hairline rows with follow chips.
- Data: `pages/user-profile-model.ts`.

**L23. Bandcamp (Listen).** P2 · S

- Sync `StatusDot` plus mono `synced 2 h ago`.
- Radar grid becomes cover rows with mono `new · 3 d`.

**L24. Upload.** P2 · M

- Per file: a `ProgressHairline` in bytes, with mono speed and ETA (from the chunked upload
  callbacks).
- After the upload: follow the returned `task_id` over `/api/events/task/{id}` and show the
  `process_new_content` phases as a step rail (recipe §2.14). Today the page shows only the task
  id.

**L25. Offline library.** P2 · S

- Hairline rows with ready, error or downloading `StatusDot`s.
- The storage `Meter` from L21.

**L26. Login, Register, auth callback, Server setup.** P2 · M

- Page-header anatomy; forms per 2.6.
- `ServerSetup` already has a probe-driven `StatusLine`: map it to the site status line (a 7 px
  dot plus mono text, amber when blocked).
- Saved servers: hairline rows with dots.

**L27. Share sheet and story canvas.** P2 · S

- The sheet follows 2.9.
- The canvas: v3 faces loaded through `FontFace`, colours through `readCssColorToken`.

**L28. Radio and Paths (outside the instruments).** P1 · S

- Station rails go through `SectionHeader`.
- Seed search: the field recipe, debounced (L13).
- Paths `EndpointPanel`: the form recipe, with the step slider per 2.6.

**L29. Jam.** Out of scope

- It is behind `JAM_ROOMS_ENABLED = false` and the site marks it "coming soon".

**Remote provenance:** see 2.18.

Cast receiver (`app/cast-receiver`) is not part of this pass.

---

## 5. New preconditions and findings (not in any card)

| # | Severity | Finding | Location | Fix |
| --- | --- | --- | --- | --- |
| 1 | High (perf) | The acquisition stream rebuilds the surface every 3 s per connected client inside an async generator. It makes a synchronous `requests.get` to slskd (`timeout=10`), a DB read and `tidal.is_authenticated()`, which blocks the event loop for up to 10 s and multiplies with open tabs. `_stream_soulseek_search` does the same per search | `app/crate/api/acquisition.py:129-176`, `:403-421`; `app/crate/soulseek.py:28,260` | A worker sampler (the governor card's pattern) writes the Tidal and Soulseek queue to `ops_runtime_state` or a `ui_snapshot` and publishes it. The stream forwards on pubsub and reads through `asyncio.to_thread`. Search status runs as a task, or at least through `to_thread` |
| 2 | High (security) | `GET /api/acquisition/snapshot` and `/stream` require only `_require_auth`, so any logged-in Listen user can read Soulseek usernames, file paths and the Tidal queue. Only Admin consumes them | `app/crate/api/acquisition.py:283-291`, `:343` | `require_any_permission(("library.import.manage", "library.tidal.manage"))`. This is a behaviour change for third-party API clients; warn before merging |
| 3 | Medium (perf, rules) | `GET /api/admin/global-catalog/status` runs per request: 4 `COUNT(*)` (`global_catalog_artists/albums/tracks/sources`), `COUNT(DISTINCT node_uid)`, a confidence-band `COUNT(*)` and genre-assertion aggregates, across 3 `read_scope()` calls, plus the taxonomy descriptor | `app/crate/db/queries/admin_global_catalog.py:15-104`, `db/queries/global_catalog.py:261` | Write a status snapshot when reconcile completes (the handler already holds the counts) and serve it by primary key. One consolidated CTE as a fallback |
| 4 | Medium (perf) | The Admin users presence query left-joins every play event of the listed users to `library_tracks` through `lt.id = upe.track_id OR entity_uid OR path`, then applies `DISTINCT ON (user_id)`. The `OR` join defeats index use. `now_playing:{id}` is read with one `get_cache` per user | `app/crate/db/queries/auth_presence.py:48-82` | A `LATERAL (… ORDER BY ended_at DESC LIMIT 1)` per user, then joins by primary key or unique key. One `MGET` for now-playing. Verify with `EXPLAIN` on production data |
| 5 | Medium (design) | Both Toasters use `richColors` (filled green, red and blue) | `app/ui/src/App.tsx:466`, `app/listen/src/main.tsx:71` | Section 2.10 |
| 6 | Low (design) | Listen profile badges carry `gold`, `green` and `rose` tones; the affinity band is colour-coded | `app/listen/src/pages/user-profile-model.ts:47`, `components/social/ProfileHoverCardContent.tsx` | Section 2.13 |
| 7 | Low (cleanup) | Admin `components/ui/error-state.tsx` is dead: it is exported only from a barrel that nothing imports, and pages use `@crate/ui/primitives/ErrorState` | `app/ui/src/components/ui/{error-state.tsx,index.ts}` | Delete it and its test |
| 8 | Low (convention) | The Linux titlebar imports `lucide-react`, undeclared in `listen-desktop/package.json` (it resolves through hoisting). Listen's convention is `@crate/ui/icons` | `app/listen-desktop/src/components/LinuxWindowTitlebar.tsx:3` | Switch to `@crate/ui/icons` |
| 9 | Low (tokens) | The object-card colour exists only as `--color-card` (`bg-card`), which the Listen drift check counts as legacy, so every boxed object (ticket, JSON card, toast, dialog) either violates the budget or reaches for another token | `app/shared/ui/tokens/surfaces.css:7`, `scripts/design-system/drift-inventory.mjs:77` | A non-legacy semantic alias (2.1) |

---

## 6. Site recipes not yet assigned

Optional suggestions. None of them requires new data.

- **`ScaleFigures`** (an L numeral with the mono label below and a `~` for approximate values):
  the library size strip on the Admin Dashboard (A2), and the Global catalog counts (A24).
- **`UuidDerivation`:** the Global catalog duplicate review readout (A24), showing normalisation
  and the entity uid for real names.
- **`ApiTerminal` / `CodeBlock`:** in Listen Access tokens (token-allowlist card), a static
  "example request" block with the server host and token prefix plus the copy-pill feedback
  (2.10). No live requests.
- **`Explore` rows** (Cabinet 700 rows with `→` and mono meta): a chapter index at the bottom of
  the Admin Dashboard, with live meta per chapter (`Health · 12 waiting`,
  `Acquisition · 3 downloading`) taken from the ops snapshot. Only if Diego wants a landing
  index next to the sidebar.
- **`ChapterToc`:** jump links on long Admin pages (Settings, Federation) when tabs are not
  used.
- **`Roadmap` cards and the amber `StatusBadge`:** only if gated features (Jam, Decks) are ever
  surfaced in the apps. Otherwise keep them out.

---

## 7. Ordering

Fold the uncovered surfaces into the existing rollouts (`admin-audit.md` §11,
`listen-audit.md` §12, spec rollout):

1. **Cross-cutting P0** (2.1, 2.2, 2.3, 2.4, 2.5, 2.7, 2.10, 2.11, 2.13, 2.17), together with
   the drift-budget fixes (`platform.md` 6.3). One commit per recipe, each with tests and
   intentional re-baselines.
2. **Backend preconditions:** the V3 `fresh=1` fix, then findings 1–4 in section 5, alongside
   the preconditions the cards already list.
3. **Listen:** L4/L5/L2 (player, spec step 3), then L14/L15 (artist and album), L11 (home),
   L19 (stats), L21 (settings), then L16/L18/L13 (library, playlists, search). Instruments slot
   in as their cards land.
4. **Admin:** A1/A2 (shell, dashboard), then A15/A16/A17 (tasks, system, logs) around the
   lanes, governor, Redis and outbox cards, then A13/A12 (analysis, insights after their
   snapshot), A4/A5/A6 (browse, artist, album), A8 (acquisition, after preconditions 1 and 2),
   and the rest as P2.
5. **P2 surfaces** in any order, each reusing the recipes; no new primitives.

Every step follows the "if you touch it, you test it" rule. Pages without a page-level test
today get one: Dashboard, Tasks, SystemHealth, Stack, Logs, Insights, Analysis, Download,
NewReleases, Upcoming, Bandcamp, Timeline, Playlists, Contributions and Setup. Listen visual
baselines change on every shell and player step.

---

## 8. Index of uncovered surfaces

| ID | Surface | Main v3 treatment | Real data that becomes a visual | P | E |
| --- | --- | --- | --- | --- | --- |
| A1 | Admin shell | mono labels, active bar, breadcrumb | ops badges → count + dot | P0 | M |
| A2 | Dashboard residue | `PageHeading`, `StatStrip`, hairline needs-attention | ops snapshot counts, runtime listeners | P0 | M |
| A3 | Login / Setup | header anatomy, step rail | `library_pipeline` task phases | P2 | S/M |
| A4 | Browse | media grid, filter chips | artist album and track counts | P1 | M |
| A5 | Artist residue | entity hero, tabs, retinted graph | plays, discography | P1 | L |
| A6 | Album residue | track table, tag diff, match meter | energy arc, BPM range | P1 | M |
| A7 | Trash, Contributions | hairline review lists | trash size (after index) | P2 | S |
| A8 | Download | acquisition lanes | queue progress, speed | P1 | L |
| A9 | Upcoming calendar | day cell grid | show and release dates | P2 | M |
| A10 | Bandcamp | cover rows, match meter | sync state, confidence | P2 | M |
| A11 | Discover | completeness row meters | `local_count / mb_count` | P2 | M |
| A12 | Insights | Nivo theme, small multiples | insights snapshot | P1 | M |
| A13 | Analysis residue | coverage stacked bars | ops `analysis` block | P1 | M |
| A14 | Timeline | hairline year bars | albums per year | P2 | S |
| A15 | Tasks residue | `StatStrip`, history table, terminal log | task stats, events | P0 | M |
| A16 | System residue | xl score, small multiples | metrics timeseries | P1 | M |
| A17 | Logs | terminal console, roster | level, worker, `last_seen` | P1 | M |
| A18 | Users | presence strip, table, map | `online_now`, `listening_now`, devices | P2 | M |
| A19 | Roles | capability matrix | roles × capabilities | P2 | S |
| A20 | Playlists, editor | rule chips, preview numeral | preview count, stream | P2 | M |
| A21 | Translations | locale coverage meters | quality issue codes | P2 | M |
| A22 | Settings | panels, schedules list | interval and `last_run` | P2 | L |
| A23 | Federation tabs | tables, rotation rail | peers, streams, keys | P2 | M |
| A24 | Global catalog | reconcile rail, confidence band | reconcile run counts | P2 | M |
| A25 | Genres residue | tree hairlines, notes | EQ source per node | P1 | S |
| A26 | Orphans | delete or route | — | — | S |
| L1 | Desktop shell | sidebar, top bar, gradient fade | — | P0 | M |
| L2 | Mobile shell | tab bar, mini player | progress line | P0 | M |
| L3 | Tauri chrome | mono titlebar, token glyphs | — | P2 | S |
| L4 | Player bar | hairline seek, mono time, disc | playhead (`rms_envelope` later) | P0 | M |
| L5 | Fullscreen player | display title, 64 px disc, text tabs | playhead | P0 | M |
| L6 | Extended player residue | source label, Suggested rows | similarity distance | P1 | M |
| L7 | Queue | track rows, totals | queue duration sum | P1 | S |
| L8 | Lyrics | line progress underline | synced timestamps | P1 | M |
| L9 | Visualizer family | token palette, effects gate | analyser (desktop) | P2 | S |
| L10 | Resume, sleep timer | object card, mono countdown | resume position | P2 | S |
| L11 | Home residue | rails, hairline history | `played_at`, mix BPM | P1 | L |
| L12 | Explore residue | rows, decade strip | decade rows, genre counts | P1 | M |
| L13 | Search | grouped hairline lists, match highlight | group counts, origin | P1 | M |
| L14 | Artist | entity hero, track rows | plays, BPM and key | P1 | L |
| L15 | Album | track rows, countdown clock | energy arc, BPM and key | P1 | M |
| L16 | Library | `StatStrip`, text tabs | user library counts | P1 | M |
| L17 | Crates | header meta, order list | members, ZIP task | P2 | M |
| L18 | Playlists | hero meta, rule chips | track totals | P1 | M |
| L19 | Stats residue, Digging | panels, xl story numerals | dashboard snapshot | P1/P2 | M |
| L20 | Radar residue | release countdown | release dates | P1 | S |
| L21 | Settings residue | panels, offline meters | `OfflineSummary`, storage estimate | P1 | L |
| L22 | Social | affinity numeral, reasons list | `affinity_score`, reasons | P2 | M |
| L23 | Bandcamp | sync dot, cover rows | sync time | P2 | S |
| L24 | Upload | byte meters, import rail | upload bytes, task phases | P2 | M |
| L25 | Offline library | status rows, storage meter | offline items | P2 | S |
| L26 | Auth, server setup | header anatomy, status line | server probe | P2 | M |
| L27 | Share | sheet, canvas fonts | — | P2 | S |
| L28 | Radio and Paths residue | rails, debounced search | — | P1 | S |
| L29 | Jam | out of scope (gated) | — | — | — |

---

## 9. Open questions (new in this pass)

1. **App display scale.** Is it acceptable to cap page titles at `clamp(2.25rem, 4vw, 3.75rem)`
   and entity titles at 4.4 rem inside the shells, instead of the site's 9.5 rem?
2. **Toasts.** Drop `richColors` in both apps and share one toaster config through `@crate/ui`?
   And adopt the rule "inline feedback first, toast only when the result outlives the control"?
3. **Failed and destructive colour.** This blocks 2.7, 2.13, Logs and Tasks. It is the same
   question as `admin-audit.md` Q4; it needs one answer for both apps.
4. **Acquisition permissions.** Tighten `/api/acquisition/snapshot` and `/stream` to the
   acquisition capabilities? This is a behaviour change for any API client.
5. **Admin Dashboard chapter index** (`Explore` rows with live meta), in addition to the
   sidebar: wanted or not?
6. **Album energy arc** in both apps: is the client-side `energy` polyline a welcome addition,
   or out of scope for v3?
7. **Spinners.** Remove `animate-spin` outside buttons across both apps (about 100 files), as a
   gradual migration rule?

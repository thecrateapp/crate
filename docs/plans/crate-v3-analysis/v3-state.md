# Crate v3: state of `feat/crate_v3` (2026-10-14)

Scope: what the v3 spec decided, what the four commits on `feat/crate_v3` actually
implement, where they drift from the site language, what is open, and what has
not been verified. Visual reference is only the new site
(`worktrees/website/app/web`); the full recipe catalogue for it lives next to
this file in `site-language.md`. Everything here was read from source; no test,
build or bundle check was run for this document.

## 0. Branch snapshot

| Item | Value |
| --- | --- |
| Worktree | `/Volumes/MacData/Projects/Ninja/musicdock/worktrees/crate-v3` |
| Branch | `feat/crate_v3`, clean working tree |
| Upstream | tracks `origin/main` (no `origin/feat/crate_v3`; never pushed) |
| Merge base | `b63e53b7` (PR #289 merge) |
| Drift | 3 commits behind `origin/main` (`2451aa75`, PR #291 soulseek); backend only, no overlap with v3 files |
| Commits | `bce7dd92` spec, `38c7576c` tokens + fonts, `50854a6e` primitives + Radar ticket, `d91d2c1a` EQ chart |
| Size | 50 files, ~1,800 insertions (5 woff2 + 2 licences included) |

Note on upstream: the branch tracks `origin/main`. Before the first push, set
an explicit upstream (`git push -u origin feat/crate_v3`) so nothing ever
targets `main` by accident.

## 1. What the spec decided

Spec: `docs/plans/2026-10-14-crate-v3-design-system.md`.

- Presentation-layer migration only: "Behaviour does not change". Listen and
  Admin should read as the same product as the site: near-black canvas, one
  cyan accent, hairlines instead of filled boxes, Cabinet Grotesk display face
  for names/numbers, JetBrains Mono uppercase labels for metadata.
- All colour changes go through `lib/appearance-token-registry.ts`, then
  `themes.css` is generated (`npm run design-system:tokens:generate`). Default
  dark preset only; light mode and `crateRed` are a later pass.
- New tokens: `--accent-action-hi` (+ AA foreground), `font-display`,
  `font-mono`, `text-label` (11 px), `leading-display` (.9), easings
  `ease-snap`, `ease-out-expo`, `ease-dramatic`, `ease-spring-snappy`,
  `ease-spring-smooth`. `--radius-panel` 12 -> 14 px. Preset radius scale
  untouched.
- New shared primitives: `MonoLabel`, `StatusDot`, `StatNumber`,
  `HairlineList`/`HairlineRow`. Restyle in place: `CratePill` (v3 chip),
  `EqBands` (curve chart). Each primitive adopted by at least one surface per
  app in the same change.
- Migration: tokens -> primitives -> one screen per commit
  (behaviour-identical, tests updated) -> visual baselines re-recorded per
  screen, intentionally.
- Risks recorded: native fonts on Capacitor, bundle size, Cabinet only at
  >= 20 px, fg-3 contrast on raised surfaces, flat card `#0d0e14` needs
  hairlines, radius preset deferred, Listen pins pills to `radius-lg`, light
  and `crateRed` not redesigned.
- Follow-up data work: precomputed `in_library` per setlist song.

## 2. What is implemented, commit by commit

### 2.1 `38c7576c` tokens and fonts

Registry (`app/shared/ui/lib/appearance-token-registry.ts`), default preset,
dark mode:

| Token | v2 | v3 on branch | Site |
| --- | --- | --- | --- |
| `--crate-token-color-muted-foreground` (`text-muted`, fg-2) | `#94a3b8` | `#999ca0` | `rgba(241,245,249,.62)` |
| `textSubtle` (`text-subtle`, fg-3) | `#94a3b8` | `#7e8084` | `rgba(241,245,249,.5)` |
| `textFaint` | `#475569` | `#4a4c52` | n/a |
| `surface-card-solid` | `#16161e` | `#0d0e14` | `#0d0e14` |
| `surface-secondary-solid` / `accent-solid` | `#1c1c28` | `#15161d` | n/a |
| `surface-muted-solid` | `#16161e` | `#0d0e14` | n/a |
| `surface-popover-solid` | `#16161e` | `#111218` | n/a |
| `surface-input-solid` | `#141419` | `#111218` | n/a |
| `surface-raised-solid` | `#12121a` | `#0f1016` | n/a |
| `surface-border-solid`, `borderSubtle`, `borderQuiet` | `#252535` / white .1 | `rgba(241,245,249,.1)` | `--line` same |
| `borderQuietSubtle`, idle border | white .06 | `rgba(241,245,249,.06)` | row divider same |
| idle/hover/pill/chip ladders (`interactive.css`) | `rgba(255,255,255,a)` | `rgba(241,245,249,a)`; idle text .6 -> .62, muted .45 -> .5 | fg alphas |
| `--accent-action-hi` (new) | none | cyan `#67e8f9`, red `#fda4af`, violet `#c4b5fd`; light cyan `#0e7490` | `--cyan-hi` |
| `--accent-action-hi-foreground` (new) | none | computed AA (`#0a0a0f` on cyan hi) | `--bg` |

Unchanged on purpose or not yet touched: scrollbar `#252535`/`#353545`,
`surface-panel` `#0c0c14`, glass popover/raised/modal/overlay
`rgba(18,18,26,…)`/`rgba(16,16,24,…)` (still the purple-grey family), warning
`#f59e0b` (site amber is `#fbbf24`), success/info/danger colours.

Other token changes:

- `semantic.css`: `--text-subtle` fallback now `--idle-text-muted` (.5);
  `--accent-action-hi(-foreground)`, `--color-accent-action-hi(-foreground)`,
  `--color-border-quiet-subtle` exposed; `--font-display-stack` and
  `--font-mono-stack` defaults.
- `typography.css`: `--font-display`, `--font-mono`, `--text-label`
  (0.6875rem, lh 1.4), `--leading-display` .9. Existing `--tracking-display`
  is -0.04em (site uses -0.045em for display, -0.03em for numerals).
  `--text-2xs` already equals `--text-label` (both 0.6875rem).
- Registry: `typography: system` switches display to `system-ui` and mono to
  `ui-monospace, "SF Mono", Menlo`. `crateRed` defaults to `system`, so it
  keeps its native look.
- `animations.css`: the five easings, values copied from the site. Site
  `--ease-in-out` (.65,0,.35,1) not ported.
- `radius.css`: `--radius-panel: 14px`.
- `recipes.css`: `.eq-smart-surface` deleted.
- `cn.ts`: `text-label` added to the font-size group, `leading-display` to
  the leading theme, so `twMerge` resolves them.
- `themes.css`: regenerated values committed (sync is guarded by
  `appearance-theme-css.test.ts` / `design-system:tokens:check`; not run).

Fonts (`app/shared/fonts/`): Cabinet Grotesk 500/700/800 (~20.5 KB each, ITF
Free Font License) and JetBrains Mono 400 latin (21 KB) + latin-ext (7 KB, OFL
1.1), all `font-display: swap`, self-hosted. Admin `index.css` imports both
after Poppins. Listen `index.css` imports both statically, so they ship on
every runtime including Capacitor iOS/Android (Poppins stays web-only via the
build-time guard in `main.tsx`). This is the open "native fonts" decision,
already implemented one way.

Tests changed: `appearance-token-registry.test.ts` (+3 cases),
`runtime-contract.test.ts` (+1 case, updated card value), `cn.test.ts` (+1).

### 2.2 `50854a6e` primitives and Radar ticket

Primitives (`app/shared/ui/primitives/`, exported through the existing
`./primitives/*` wildcard):

| Primitive | API | Consumers (Listen / Admin) | Tests |
| --- | --- | --- | --- |
| `MonoLabel` | `as` (`p/span/div/h2/h3`), `accent`, `meta[]` (falsy parts dropped, `·` separators `aria-hidden`), `children` | Radar, month groups, EQ header/helpers/Smart chain / `GenreEqEditor` | 3 |
| `StatusDot` | `tone` `on` (filled, cyan hi) / `off` (ring, fg-3) / `warn` (amber), `label`, `title` (dot-only becomes `role="img"`) | collapsed + expanded show / `GenreEqEditor` | 4 |
| `StatNumber` | `value`, `label`, `size` `sm/md/lg`, `align` | Radar summary / indirect via `EqBands` only | 2 |
| `HairlineList` / `HairlineRow` / `formatRowIndex` | `as` `ol/ul`, `label` (aria), row `index` (`01`), `trailing`, `muted` | ticket setlist / **none** | 3 |

`CratePill` restyle (`CrateBadge.tsx`): mono, `px-3`, `tracking-wide`,
`ease-snap` transitions, `active:scale-95` (reduced-motion safe); active =
solid `accent-action-hi` with its foreground. Idle stays on the pill/idle
ladders. `CrateBadge` itself is unchanged. In Listen the global rule
`:is(button, a).rounded-full[class*="px-"] { border-radius: var(--radius-lg) }`
turns the pill into 6 px corners; in Admin it is a real pill.

Listen Radar (`app/listen/src/components/upcoming/*`, `pages/ShowsContent.tsx`):

- `ShowCard`: `rounded-panel border-border-quiet bg-card`, no shadows, hover
  `border-border-interactive`, `ease-snap`, `motion-reduce:transition-none`.
  Action menu moved from top-left to top-right.
- Expanded view is a ticket: `MonoLabel` countdown (accent) + date/time,
  `StatusDot` "Attending", artist link in `font-display` 800 `text-4xl
  sm:text-6xl`, support line, mono venue line (`venue · address · city,
  region, country`), genre pills, dashed perforation with two notch circles,
  probable setlist as `HairlineList` rows with play frequency `%`, then a
  round cyan play button + "Play setlist" label and mono ghost actions
  (Going/Attend, Directions, Get tickets with an on-sale `StatusDot`).
- Collapsed view: date as mono month / display day / mono weekday;
  attendance dot is `StatusDot`; `PreloadBackground` removed.
- Artist background and artist photo are no longer loaded by the ticket.
- Page: section headings and month labels are `MonoLabel`; summary pills are
  `StatNumber` with a left hairline; section icons removed.
- `design-token-policy.test.ts`: removed the `text-[1.25rem]` budget entry.

Tests: `ShowCard.test.tsx` rewritten (4 cases), `UpcomingShowCardViews.test.tsx`
(ticket header assertions), `Shows.test.tsx` (scoped to summary list).

### 2.3 `d91d2c1a` EQ chart

`EqBands` (`app/shared/ui/domain/player/EqBands.tsx`, shared by Listen and
Admin):

- Layout: 2.5rem mono dB scale (`+12 … 0 dB … −12`), SVG stage
  (`viewBox 0 0 100 100`, `preserveAspectRatio="none"`,
  `vector-effect: non-scaling-stroke`), numeral row of `StatNumber size="sm"`
  with mono frequency captions.
- SVG: `stroke-border-quiet` gain lines, `stroke-border-quiet-subtle` column
  lines, dashed zero line (`stroke-text-faint`), bars from 0 dB with one
  vertical gradient (`accent-action-hi` .55 -> .08), glow path
  (`stroke-accent-action`, width 14, `opacity-15`), curve
  (`stroke-accent-action-hi`, 2.25).
- Interaction: per-band `data-band` columns keep the pointer-capture drag;
  handle is a hollow ring that transitions `top` 500 ms `ease-snap` when not
  dragging.
- Exported helpers `formatGain` (typographic minus) and `eqCurvePath`
  (Catmull-Rom style cubic path).

Listen panel (`EqualizerPanelSections.tsx`, `EqualizerSmartReadout.tsx`):
header is `MonoLabel` "Equalizer · <mode>", chart first at
`trackHeight={160}` under a hairline, presets as `CratePill` chips
(`px-3 py-1.5 text-label`), helpers row label is `MonoLabel`, Smart readout is
the resolution chain (6 sources, active one `aria-current` in cyan hi) plus
the detail line. Mode badge row, track-preset actions, adaptive and genre
readouts are unchanged v2.

Admin `GenreEqEditor.tsx`: heading `MonoLabel` "Equalizer preset · <genre>",
status `StatusDot` on/off/warn instead of coloured `Badge`s. New test file
(3 cases). Container, inner chart box and helper text still v2 (see 4.2).

Tests: `EqBands.test.tsx` (5 cases incl. drag snap, disabled, path),
`EqualizerPanel.test.tsx` (chain + chips), `GenreEqEditor.test.tsx` (new).

## 3. Implemented vs pending

| Spec item | State |
| --- | --- |
| Token layer, default dark | Done |
| Light mode / `crateRed` v3 | Pending by design (only shared hairlines, accent hi, panel radius, fonts moved) |
| Fonts | Done, shipped on all runtimes (decision open) |
| Motion tokens | Added; none of the spring/expo/dramatic easings is used yet (only `ease-snap`, 3 files) |
| `--radius-panel` 14 px | Done; Listen modals still forced to 12 px by `index.css` overrides |
| `MonoLabel`, `StatusDot`, `StatNumber` | Done, both apps (StatNumber in Admin only through `EqBands`) |
| `HairlineList` | Done, Listen only |
| `CratePill` v3 chip | Done; pill radius only in Admin |
| `EqBands` curve chart | Done, static (no spring morph) |
| Listen 1: Radar ticket + setlist | Done minus `in_library` status, "N of M playable" footer, setlist source line, row entrance motion |
| Listen 2: EQ panel | Partially: chart, chips, chain done; mode badge, track-preset actions, adaptive/genre readouts still v2 |
| Admin 1: Genre EQ editor | Partially: header + status only |
| Listen 3-9, Admin 2-6 | Not started |
| Buttons (pill CTA + round play), cards, `SectionHeader` -> `MonoLabel`, page headers | Not started |
| Visual baselines re-recorded | Not done (no PNG touched in any commit) |
| `in_library` data work | Not started |

## 4. Deviations from the site language

### 4.1 Token and component level

| Element | Site | Branch | Note |
| --- | --- | --- | --- |
| Accent hi on hover | chips hover `rgba(103,232,249,.4)` border | `--hover-border` fg .2 | chips and ticket actions do not warm to cyan on hover |
| Chip metrics | 32 px min height, 11 px, `.06em` | `py-1` 10 px `tracking-wide` (.025em); EQ overrides to 11 px | default `CratePill` is smaller than the site chip |
| Chip shape in Listen | pill (999 px) | 6 px (Listen radius rule) | open decision 5.1 |
| Focus | `outline 2px cyan-hi, offset 3px` | `shadow-focus` on `accent-action` | not aligned |
| Display tracking | -0.045em display, -0.03em numerals | `tracking-display` -0.04em for both | small |
| Status palette | cyan + amber only | success green, info blue, danger red still live | needs a policy (5.5) |
| Amber | `#fbbf24` | `#f59e0b` mixed 82% with fg | small |
| Texture | fixed fractal-noise overlay at 4.5% | none | probably intentional (mobile GPU); not decided |
| Purple-grey family | none | scrollbar, panel, glass popover/modal/overlay keep `#0c0c14`/`rgba(18,18,26)` | visible on sheets and popovers |
| Motion | springs drive data (EQ morph, row entrances, count-ups) | spring tokens unused; data changes snap | biggest gap vs "data-driven animation" |

### 4.2 Screen level

Ticket (`Setlist.astro` vs `UpcomingShowExpandedView.tsx`):

- Notches: site masks real cut-outs (`mask: radial-gradient…`); branch draws
  two bordered circles filled with `bg-surface-canvas`. On any non-canvas
  background (sheet, modal, Home rail) the notches show the wrong colour.
- Header label: site `UPCOMING SHOW · Ticketmaster · Last.fm` (source);
  branch uses the countdown as the accent word.
- Rows: site status column `in library` (filled dot) / `missing` (ring, title
  dimmed) and footer `N of M playable from your library`; branch shows play
  frequency `%` and no footer count. Needs `in_library` (5.3).
- Setlist meta: site `12 recent shows · Setlist.fm`; branch `N songs`. The
  data exists in the setlist cache context (`source_show_count`, `mode`) but
  is not in the `/api/me/upcoming` payload.
- Rows enter with a spring stagger on the site; branch has none.
- Size: artist 36/60 px vs site clamp(41.6-70.4 px); rows inherit body size vs
  15 px.

EQ (`EqViz.astro` + `scripts/viz/eq-view.ts` vs `EqBands.tsx`):

- No spring morph: on the site `stepSpring` animates every band between
  presets; on the branch the curve, bars and numerals jump while the ring
  handles glide 500 ms. Result: on preset apply, Smart resolve or adaptive
  updates, the handles visibly detach from the curve for half a second. This
  is a regression introduced by `d91d2c1a` (v2 had no curve to detach from).
- Missing layers: area fill under the curve, separate up/down bar gradients,
  ghost curve of the target preset, progress line, scrambled numerals.
- Scale column 40 px vs 52 px; Listen chart 160 px vs site clamp(260-460 px);
  numerals 16/20 px vs clamp(17.6-32 px).
- Chain labels are hard-coded English ("User track preset", "Curator track
  preset", …) and longer than the site's ("your preset", "curator track", …).
  Pre-existing strings, now rendered six at a time.
- Mode is shown twice in Listen: in the header meta (`equalizerModeLabel`) and
  in the v2 `EqualizerModeBadge` below the helpers.

Admin `GenreEqEditor`:

- Still `rounded-md border-white/12 bg-black/15` outer box and a second
  `border-white/10 bg-black/30` box around the chart (box in box, the opposite
  of the site's hairline-over-panel), `text-white/55`, `text-[11px]`.
- Admin overall: ~1,600 `*-white/*` utilities, ~216 `bg|border-black/*`, ~97
  inline hex colours in `app/ui/src`. The spec's claim that "most of both
  apps shift at once" holds for Listen, not for Admin: Admin will only move
  where it already uses semantic tokens (`bg-card`/`bg-muted`/`bg-secondary` in ~100 places).

## 5. Open decisions

### 5.1 Pill radius in Listen

Today Listen forces `radius-lg` (6 px) on `[data-slot="button"]` and on any
`button|a.rounded-full[class*="px-"]`, guarded by `radius-policy.test.ts`. The
site's chips and CTAs are pills. Options: (a) keep 6 px everywhere (Listen
diverges from the site on the most visible control); (b) exempt `CratePill`
only, e.g. a `data-slot="chip"` the rule skips, and update the policy test;
(c) lift the rule for all text pills (wider visual change, every CTA). (b) is
the smallest change that matches the site; needs Diego's call.

### 5.2 Native fonts on iOS/Android

Implemented as "brand fonts everywhere" (~90 KB of woff2 in the Capacitor
bundle, no network). Alternative in the spec: system display + SF Mono on
native only, which would need the same build-time guard as Poppins and a
registry rule so `typography: brand` on native resolves the display/mono
stacks to system faces. Not confirmed with Diego.

### 5.3 `in_library` flag for setlists

Facts that change the spec's wording:

- Radar reads `/api/me/upcoming` (`app/crate/api/me.py`, `upcoming()`), which
  is assembled per request; it is not a `ui_snapshots` surface. The home
  upcoming block (`db/home_builder_upcoming_feed.py`) is a separate builder.
- Probable setlists come from `cache_store` (Redis first, Postgres `cache`
  fallback) with one `get_cache` per show artist
  (`_probable_setlists_for_artists`), written by the `refresh_probable_setlist`
  worker task (`setlistfm.refresh_probable_setlist`).

Recommended shape: compute `in_library` (and ideally `track_id`) per song in
the worker when the setlist cache entry is written, matching titles against
the artist's tracks in one batched query; recompute for the artist when a
library change event for that artist arrives (projector/domain event or a
deduplicated task). The request path only reads the flag. Never match titles
against `library_tracks` inside `/api/me/upcoming`. While there, batch the
per-artist cache reads (Redis `MGET`, one `ANY(:keys)` fallback) since they
are an N-per-request loop today. Decision needed: title matching rules
(normalisation, live/acoustic suffixes) and whether the flag can go stale
between refreshes.

### 5.4 Flat cards contrast

`#0d0e14` on `#0a0a0f` is ~1.07:1: a borderless card disappears. Listen barely
uses the card fills (1 site, bordered). Admin uses `bg-card`/`bg-muted`/`bg-secondary` ~100 times, ~36 of them with
no border class on the same line (heuristic). Options: keep the site value and
add hairlines per screen during the Admin rollout (spec's plan), or keep a
lifted value for Admin until its screens are migrated. Needs a decision before
merging the token commit, because Admin shifts immediately.

### 5.5 Other decisions surfaced by this review

- Status colours: map success to `StatusDot on` (cyan) and keep red only for
  destructive actions, or keep green/blue? The site has no green or blue.
- Modal radius: Listen pins shared modals to 12 px while panels are 14 px.
- Spec scope vs goal: the spec is presentation-only, but the stated goal is
  that the site visualisations (genre taxonomy wheel and the Admin mocks:
  HealthScan, QueueLanes, EnrichmentOrbit, ReleaseTimeline, AlbumSidecar,
  TrackReadout; Listen: MixViz, MoodMap, Heatmap, Federation, Devices) become
  real features on real data. None of them is in the spec's rollout. The
  genre wheel's EQ inheritance walk is the same data `GenreEqEditor` shows
  ("Inherits from …"), so that pair is the natural first feature slice.
- `HairlineList` lives in `@crate/ui` but only Listen uses it. The
  `export-usage-policy` test passes (it only requires one consumer), but the
  repo rule says shared components need both apps. Either adopt it in Admin
  in the next slice (health/tasks rows) or keep it local to Listen.

## 6. Verification status and test infrastructure

Nothing below has a recorded green run on this branch.

- Vitest: suites touched by the branch are
  `shared/ui` (`appearance-token-registry`, `runtime-contract`, `cn`,
  `CrateBadge`, `HairlineList`, `MonoLabel`, `StatNumber`, `StatusDot`,
  `EqBands`), `listen` (`ShowCard`, `UpcomingShowCardViews`, `Shows`,
  `EqualizerPanel`, `design-token-policy`), `ui` (`GenreEqEditor`). Policy
  suites that read the changed files: `shared/ui/design-token-policy`,
  `export-usage-policy`, `color-contrast`, `appearance-theme-css`
  (`design-system:tokens:check`), Listen `badge-policy`, `radius-policy`,
  `component-policy`, `layout-policy`. Reported issue: Vitest workers hit the
  60 s start timeout when run from the external disk, so these must run from
  CI or a clone on the internal disk.
- Contrast coverage gap: `color-contrast.test.ts` checks foreground/panel,
  muted/app and primary pairings per skin. It does not check `--text-subtle`
  (fg-3) on canvas/card/popover or `--accent-action-hi` on canvas/card, which
  are now the label colours. Computed by hand: fg-3 `#7e8084` is 5.0:1 on
  canvas, 4.9:1 on card, 4.7:1 on popover `#111218`; AA holds but with little
  margin. Add these pairings to the test.
- Visual baselines: `tests/listen-visual/listen-pages.spec.ts-snapshots/` has
  44 PNGs (11 states x desktop/mobile x darwin/linux). All should be treated
  as stale: default dark changes everywhere, default light and `crateRed` move
  through panel radius, hairlines, fonts and accent hi. The Radar fixture has
  no `probable_setlist`, so the new setlist rows are not covered; there is no
  EQ panel baseline at all. Re-record linux baselines in the Playwright
  container used by CI, and add setlist data to the Radar fixture first.
- Appearance Playwright suite (`test:appearance`): not run; may assert
  computed surfaces or radii.
- `check:bundle` (Listen): not run. It measures initial JS gzip only (300 KB
  budget), so it does not see the fonts at all; the font cost needs its own
  check (asset list of the Capacitor build) if 5.2 stays "brand everywhere".
- Typecheck and ESLint for `app/ui`, `app/listen`, `app/shared/ui`: not run.

## 7. Remaining rollout order

Fix-ups on the current slice first (they touch shipped code):

1. `EqBands`: animate gains (spring per band in a rAF loop, reduced-motion
   snaps) so curve, bars, numerals and handles move together; add area fill
   and up/down gradients. Keep the rAF state out of effect dependencies.
2. Listen EQ: drop the duplicated mode badge, move track-preset actions and
   adaptive/genre readouts to chips/mono labels, i18n the chain labels.
3. Admin `GenreEqEditor`: remove box-in-box and `white/*` colours.
4. Ticket: real notches via mask, row entrance stagger, source line once the
   payload carries setlist context.
5. Tests: contrast pairings, Radar fixture with setlist, EQ panel baseline,
   then re-record baselines.

Then the spec's order:

- Listen: 3 player bar and fullscreen player, 4 artist hero and setlist modal,
  5 album track list, 6 Home sections, 7 Stats, 8 Settings and appearance,
  9 Library, search, playlists.
- Admin: 2 dashboard and ops tiles, 3 health and tasks, 4 library tables,
  5 shows (one `ShowCard`: today there are three, Listen's
  `components/upcoming/ShowCard`, Admin's `components/shows/ShowCard` and the
  unused shared `domain/shows/ShowCard`), 6 settings, users, federation
  (Admin `Settings.tsx` has its own local `StatusDot` to replace).
- Cross-cutting: buttons (pill CTA + round play), cards, `SectionHeader` ->
  `MonoLabel`, page headers in the display face.
- Data: `in_library` + setlist context in the upcoming payload (5.3).
- Feature track (not in the spec yet): genre taxonomy wheel and the Admin
  visualisations on real data, each backed by a precomputed snapshot or worker
  output, not request-time aggregation.

## 8. File index

- Spec: `docs/plans/2026-10-14-crate-v3-design-system.md`
- Tokens: `app/shared/ui/lib/appearance-token-registry.ts`,
  `app/shared/ui/tokens/{themes,semantic,typography,animations,interactive,radius,recipes}.css`,
  `app/shared/ui/lib/cn.ts`
- Fonts: `app/shared/fonts/{cabinet-grotesk,jetbrains-mono}.css` and folders;
  imported in `app/listen/src/index.css`, `app/ui/src/index.css`
- Primitives: `app/shared/ui/primitives/{MonoLabel,StatusDot,StatNumber,HairlineList,CrateBadge}.tsx`
- EQ: `app/shared/ui/domain/player/EqBands.tsx`,
  `app/listen/src/components/player/{EqualizerPanelSections,EqualizerSmartReadout}.tsx`,
  `app/ui/src/components/genres/GenreEqEditor.tsx`
- Radar: `app/listen/src/components/upcoming/{ShowCard,UpcomingShowExpandedView,UpcomingShowCollapsedView,UpcomingRows}.tsx`,
  `app/listen/src/pages/ShowsContent.tsx`
- Listen radius rule: `app/listen/src/index.css` (~line 563),
  `app/listen/src/radius-policy.test.ts`
- Setlist data path: `app/crate/api/me.py` (`upcoming`,
  `_probable_setlists_for_artists`), `app/crate/setlistfm.py`,
  `app/crate/db/cache_store.py`, `app/crate/db/home_builder_upcoming_feed.py`
- Site references: `worktrees/website/app/web/src/components/viz/{Setlist,EqViz,GenreWheel}.astro`,
  `src/scripts/viz/eq-view.ts`, `src/styles/{tokens,base}.css`

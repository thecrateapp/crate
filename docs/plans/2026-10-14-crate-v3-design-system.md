# Crate v3 design system

Status: specification. Supersedes the 2026-10-14 version of this file (commit `bce7dd92`).
Revised: 2026-10-15. Branch: `feat/crate_v3` (worktree `worktrees/crate-v3`).

Nothing was built, tested or run to write this revision. Measured numbers (drift counts, bundle
sizes, file line numbers) come from the analysis reports listed below; contrast ratios were
computed from the token values.

Visual source of truth: the new site only, `worktrees/website/app/web`:

- `src/styles/tokens.css`, `src/styles/base.css`
- `src/components/viz/*.astro` and their controllers in `src/scripts/viz/*.ts`
- `src/components/{PageHeader,Chapter,ChapterToc,FeatureList,StatusBadge,InsideCrate,Nav}.astro`,
  `src/components/{listen,architecture,developers}/*`
- `src/scripts/motion/*`, `src/lib/counter.ts`, `e2e/{a11y,viz}.spec.ts`

The previous version cited `components/lab/viz/*.astro`; that path does not exist. The visuals live
in `src/components/viz/*.astro`.

Site reference pin: `feat/website` at `258bbaee` (the SHA `crate-v3-analysis/site-visuals.md`
records). Every site path and line number in this document (`SystemMap.astro:185`,
`content/listen/en.ts:75`, `scripts/viz/*`) refers to that commit. The branch is still moving, so:

- each port PR records the site SHA it copied from, in the PR body or in the test fixture that
  carries the ported cases;
- before each release group that ports site math or geometry, Diego reviews a deliberate re-sync:
  the diff of the ported site files from the pinned SHA to the new one, then the pin moves here.

Evidence behind this document (read them for backend detail; where they disagree with this file,
this file wins because it applies the verified corrections):

| Report | Content |
| --- | --- |
| `docs/plans/crate-v3-analysis/site-language.md` | site tokens, recipes, motion, a11y, performance |
| `docs/plans/crate-v3-analysis/site-visuals.md` | inventory of the 33 site visuals and what is real |
| `docs/plans/crate-v3-analysis/v3-state.md` | what the 4 commits on this branch implement |
| `docs/plans/crate-v3-analysis/platform.md` | `@crate/ui` mechanics, budgets, runtimes, tests |
| `docs/plans/crate-v3-analysis/admin-audit.md`, `listen-audit.md` | per-app audits |
| `docs/plans/crate-v3-analysis/coverage.md` | surfaces with no site visual, cross-cutting recipes |
| `docs/plans/crate-v3-analysis/genres.md` | genre taxonomy wheel and EQ inheritance |
| `docs/plans/crate-v3-analysis/backend-admin.md`, `backend-listen.md` | data contracts and rule violations |

Tracking: `docs/plans/` is gitignored (`.gitignore:71`). Only this file is tracked (force-added in
`bce7dd92`); the product design, the implementation plan and `crate-v3-analysis/` show as ignored.
Before Phase 0 they must be un-ignored (`!docs/plans/2026-10-14-crate-v3-*.md`,
`!docs/plans/crate-v3-analysis/`) or force-added (implementation plan Task 0.1), otherwise clones,
CI and PR reviewers do not see the documents the tasks cite.

The 26 mapping cards used during the analysis are not in the repository. This document and the
product design already carry every verified correction from them; no rule or task depends on the
cards.

Conventions in this document:

- "must" is a rule enforced by review or a test; "should" is the default with room for a stated
  exception.
- `[Dn]` points to the decisions register (6.12). Where a decision is still open, this document
  writes the recommended default and marks it.
- Site names (`--fg-3`, `--cyan-hi`) are translated to product tokens (`text-text-subtle`,
  `accent-action-hi`) everywhere outside the mapping tables in 1.9.

---

## 0. Scope and principles

### 0.1 Two tracks

v3 has two tracks that share one design system.

1. **Track A, language migration.** Listen and Admin read as the same product as the site:
   near-black canvas, one accent, hairline structure instead of filled boxes, Bricolage Grotesque for
   names and numerals, JetBrains Mono uppercase labels for metadata. Behaviour does not change.
   One screen per commit.
2. **Track B, instruments on real data.** The site's live visualisations (genre wheel, health
   scan, queue lanes, governor gauges, release rail, enrichment orbit, album sidecar, track
   readout, heatmap, mood map, sound map, setlist ticket, crossfade strip, devices, token reach,
   system map, event pipeline, Redis pair) become product features backed by precomputed data and
   real events. Each instrument ships with its backend contract and its tests. Section 4 specifies
   them.

The previous version of this file covered Track A only.

### 0.2 Principles

1. **One accent.** `accent-action` (cyan `#06b6d4` in the default preset) for fills,
   `accent-action-hi` (`#67e8f9`) for strokes, key words, curves and active chips. Amber is status
   only. No other hue carries meaning (1.1.4).
2. **Hairlines, not boxes.** A panel is a top rule and a header row. Only standalone objects
   (ticket, terminal, JSON card, dialog, toast, popover) get a filled, bordered card.
3. **Display and mono.** Bricolage Grotesque for names, titles and numerals; Poppins (or the system
   font) for body and controls; JetBrains Mono for labels, units, indices and readouts.
4. **Real state on first paint.** Every visual renders the current real state the moment its data
   arrives. Nothing animates from zero to fake a story.
5. **Animate only real transitions.** Springs re-target when data changes, a path draws when an
   edge appears, a count-up runs once on first view. No auto-cycling, no scripted loops, no demo
   data in the product [D7].
6. **Precomputed data only.** Instruments read warmed `ui_snapshots`, `ops_runtime_state`, Redis
   runtime keys, or task and domain events. No request-time aggregates over `library_tracks`, no
   snapshot rebuilds in requests, batch lookups with `ANY(:ids)`, one CTE per surface.
7. **Per-frame values live in refs.** One rAF loop per visual, gated by visibility, document
   visibility and the motion gate. Effects that open streams depend only on connection identity.
8. **Final state without motion.** Under reduced motion, `effects=off`, no WebGL or headless
   tests, a visual renders its real final state statically and stays fully interactive.
9. **Placement follows use.** A component goes into `@crate/ui` only when Admin and Listen both
   render it in the same change; otherwise it stays in the app with its math.
10. **Honest copy.** Labels say what the data is: `dB` not `LUFS` when the analyser measured RMS,
   "Key" not "Camelot" when the scoring compares key and scale, "Beat grid cues" not "beatmatch".

### 0.3 What changed against the 2026-10-14 version

Kept:

- Colour changes go through `app/shared/ui/lib/appearance-token-registry.ts`, then
  `npm run design-system:tokens:generate`.
- Default dark preset first; the light mode and `crateRed` redesign is a later pass; v3 holds them
  to the minimum bar [D41] (1.1.5).
- The v3 values already shipped in `d9df9d51` (fg-2 `#999ca0`, fg-3 `#7e8084`, rgba hairlines,
  `#0d0e14` card, `accent-action-hi`, fonts, five easings, `--radius-panel: 14px`).
- `MonoLabel`, `StatusDot`, `StatNumber`, `HairlineList`, the `CratePill` chip restyle and the
  `EqBands` curve chart.
- Migration order: tokens, then primitives, then one screen per commit with intentional
  re-baselines.
- Brand fonts on every runtime, including Capacitor [D3]; the display face is Bricolage Grotesque
  (SIL OFL 1.1), decided 2026-10-15 (1.2.1).

Changed or added:

- Scope: Track B (0.1). The genre wheel and the Admin mocks are product features.
- Cyan-hi contrast on the canvas is 13.6:1, not "~12:1".
- Status colour policy (1.1.4): success and info no longer have their own hues; failed is amber
  plus a word; red is limited to the confirm button of a destructive dialog [D4].
- Warning hue aligns with the site amber `#fbbf24` [D5].
- New tokens (1.9.4): object surface alias, active-node surface, numeral tiers, display tiers,
  eyebrow size, headline and numeral tracking, numeral leading, chip tracking.
- Primitive changes (2.2): `StatNumber` gains an `xl` tier and inline units, `MonoLabel` passes
  through ARIA props, `HairlineRow` gains `active` and an interactive variant, `CratePill` gains a
  32 px minimum and an action variant.
- New shared primitives (2.3): `InstrumentPanel`, `Meter`, `Readout`, `ProgressHairline`. Legends
  use a `dl` of `StatNumber`s (Admin: `StatStrip`); there is no `LegendStrip`.
- New shared lib modules (2.4): motion gate, spring stepping, visible loop, scramble, EQ curve
  math, Camelot, toaster config.
- Motion: data springs are mandatory for data-driven visuals. Commit `ce506e86` introduced a
  regression (EQ handles glide 500 ms while the curve jumps); 4.1 fixes it.
- `linear()` spring easings are only allowed through longhand properties (1.8.6).
- Rule amendment needed: "charts use Nivo" must allow hand-built instruments [D1].
- Drift budget: the branch currently fails `drift-inventory --check` (inline styles 93 > 91, one
  legacy utility, token definitions 138 > 134 and 95 > 91). The claim "budgets are not widened"
  was wrong: token ceilings are raised deliberately (6.2) and inline styles go back down.
- "Most of both apps shift at once" holds for Listen only. Admin (`app/ui/src`, `.ts`/`.tsx`) has
  about 1,400 `*-white/N` utilities plus about 200 bare `*-white`, about 220 `black/*` and 89
  inline hex colours; it moves screen by screen.
- The `in_library` follow-up is specified in 4.6. `/api/me/upcoming` is not a snapshot; the
  match is written by the worker that writes the setlist cache.
- Delivery order: the implementation plan's phases and release groups are the only order (6.11).
- Review pass (2026-10-15): one Admin live stream route (`/api/admin/live-stream`); demand-gated
  samplers and trailing-edge coalescing (3.9); the Health contract follows the product design
  (4.14); the maintenance window rule corrected (4.20); site Radio weights are correct (4.9, 6.5);
  font licence decided: Bricolage Grotesque replaces Cabinet Grotesk (1.2.1, [D3], 2026-10-15); iOS 15 fallbacks (1.2.2, 4.7, [D11]).
- Second review pass (2026-10-15): the site reference is pinned (header); `--surface-popover` is
  remapped to the solid popover value and the modal scrim gets its own token (1.1.1, 1.9.2,
  1.9.4); coalesced refreshes keep their due time in Redis so the stale-pending redispatcher
  cannot fire them early (3.9); hidden Admin tabs stop marking viewers and samplers check the
  viewer key once per second (3.4, 3.9); the genre overrides use the plan's `local_*` +
  `eq_override` model and ship before the wheel (4.3, 6.11); mood-map window 900 s and `explore`
  broadcast only on change (4.10); EQ drags commit once (4.1); Paths planning moves to a task
  with phase A (4.8); federation stream events no longer rebuild the topology per play (4.21);
  `admin:live:viewers:stack` (4.22); stack sampler placement is [D43].

---

## 1. Foundations

### 1.1 Colour

#### 1.1.1 Roles

Values are the default preset, dark mode, cyan accent. "Done" means shipped in `d9df9d51`.

| Role | Site | Product token | Tailwind utility | Value | State |
| --- | --- | --- | --- | --- | --- |
| Canvas | `--bg` | `--surface-app` / `--surface-canvas` | `bg-surface-canvas` | `#0a0a0f` | unchanged |
| Foreground (fg) | `--fg` | `--text-primary` | `text-text-primary` | `#f1f5f9` | unchanged |
| Secondary text (fg-2) | `--fg-2` (.62) | `--text-muted` | `text-text-muted` | `#999ca0` | done |
| Labels and meta (fg-3) | `--fg-3` (.5) | `--text-subtle` | `text-text-subtle` | `#7e8084` | done |
| Faint (decorative only) | fg .30 | `--text-faint` | `text-text-faint` | `#4a4c52` | done |
| Hairline | `--line` (.10) | `--border-quiet`, `--color-border` | `border-border-quiet` | `rgba(241,245,249,.1)` | done |
| Row divider | fg .06 | `--border-quiet-subtle` | `border-border-quiet-subtle` | `rgba(241,245,249,.06)` | done |
| Object surface | `#0d0e14` (literal) | `--color-card` today; new alias `--surface-object` | `bg-surface-object` | `#0d0e14` | alias new (1.9.4) |
| Popover surface | n/a | `--surface-popover` (today `--crate-token-surface-overlay-*`, `rgba(18,18,26,.95)` in both materials; v3 remaps it to `--crate-token-surface-popover-*`) | `bg-surface-popover` (new, 1.9.4; today only the custom `.bg-popover-surface`) | `#111218` after the remap; shadcn `--color-popover` (`bg-popover`) already resolves to it | remap pending (1.9.2) |
| Raised | n/a | `--surface-raised` | `bg-surface-elevated`, `.bg-raised-surface` | `#0f1016` | done |
| Input | n/a | `--color-input` | `bg-input` | `#111218` | done |
| Modal scrim | n/a | new `--surface-scrim` | `bg-surface-scrim` | canvas at .72 | new (1.9.4) |
| Active node surface | `#0b1d24` (literal) | new `--surface-accent-active` | `bg-surface-accent-active` | accent 11% over canvas | new |
| Accent (fill) | `--cyan` | `--accent-action` | `bg-accent-action` | `#06b6d4` | unchanged |
| Accent hi (stroke, key word) | `--cyan-hi` | `--accent-action-hi` | `text-accent-action-hi`, `stroke-accent-action-hi` | `#67e8f9` | done |
| Text on accent hi | `--bg` | `--accent-action-hi-foreground` | | `#0a0a0f` (computed AA) | done |
| Status | `--amber` | `--state-warning`, `--state-warning-text` | `text-state-warning-text` | `#fbbf24` proposed (today `#f59e0b`) | [D5] |
| Selection | `::selection` cyan, bg text | global rule | | `accent-action` / canvas | new rule |

Accents are user-selectable. `accent-action-hi` is `#fda4af` with the red accent, `#c4b5fd` with
violet, `#0e7490` in light cyan. Every rule in this document says "accent", never "cyan", outside
the mapping tables. Literal cyan values must not appear in components.

Purple-grey leftovers to move to the neutral family in the registry (default dark): scrollbar thumb
`#252535`/`#353545` (to fg .10/.18), `surface-panel` `#0c0c14` (to `#0d0e14`), glass popover,
raised, modal and overlay `rgba(18,18,26,…)` / `rgba(16,16,24,…)` (to the solid popover surface plus
a hairline). The registry's `overlay` and `modal` entries are panel fills: `--surface-popover`
(AppPopover, shadcn `select`, `TrackTable`, `CrateEditor`) and the semantic `--surface-overlay`
(hover cards, jam options in `recipes.css`) read them. They are never set to a translucent canvas;
the scrim behind a modal is its own token, `--surface-scrim` (canvas at .72).

#### 1.1.2 Alpha ladders

The site uses a small set of alpha steps. The product expresses them through existing color-mix
tokens or Tailwind opacity modifiers on token colours. Both compile to `color-mix()`, which the
token layer already depends on (374 uses in `app/shared/ui/tokens`). Below Safari 16.2 the
Tailwind 4.2.4 fallback cannot resolve `var()`-based theme colours, so every opacity modifier on a
token (`bg-accent-action/4`, `/8`, `/14`, `border-accent-action-hi/40`) disappears on iOS 15. This
is why [D11] raises the iOS target to 16.4; if 15.0 is kept, the four alpha steps used for hover,
active row wash, halo and chip hover get literal `rgba()` tokens per skin.

Foreground steps:

| Site alpha | Use | Product expression |
| --- | --- | --- |
| .015 to .03 | group fills, lane tracks, night band | `bg-text-primary/2`, `bg-text-primary/3` |
| .04 | secondary grid columns | `stroke-text-primary/4` |
| .05 | orbit rings, idle cells | `stroke-text-primary/5`, `bg-text-primary/5` |
| .06 | row dividers, related edges | `border-border-quiet-subtle`, `stroke-border-quiet-subtle` |
| .10 | the hairline | `border-border-quiet` |
| .14 | inactive meter segments, tracks | `bg-text-primary/14` |
| .18 | parent edges, perforation, zero lines (mini) | `border-text-primary/18` |
| .22 | EQ zero line, beat ticks | `stroke-text-primary/22` |
| .35 | ghost curve | `stroke-text-primary/35` |
| .45 | node strokes | `stroke-text-primary/45` |
| .55 | own-preset node fill | `fill-text-primary/55` |
| .30 | decorative zone captions | `text-text-faint`, always `aria-hidden` |

Accent fill (`accent-action`) steps: .04 hover wash (`bg-accent-action/4`), .05 zone
(`fill-accent-action/5`), .08 active row gradient start (`from-accent-action/8`), .10 halos and
highlighted line (`--surface-accent`), .12 curve glow (`stroke-accent-action` with
`stroke-opacity-12`), .14 active-dot ring, .16 artwork placeholder, .20 to .28 bar and progress
fills.

Accent hi (`accent-action-hi`) steps: .28 CTA border, .30 job border, .32 lit related edge, .38 OK
edges, .40 chip hover border and accent tags (`border-accent-action-hi/40`), .45 auto badge, .50
verdict, .55 CTA hover and cache cells, .60 downbeat ticks.

Amber (`state-warning`) steps: .06 badge fill (`--state-warning-surface`), .35 badge border,
.45 confirm and pending borders, .70 dashed legend key and evicted cells, .80 deferred chip border.

Rule: a canvas or WebGL palette reads tokens through `readCssColorToken`
(`@crate/ui/lib/read-css-color`, `app/listen/src/lib/canvas-color.ts`) and re-reads on appearance
change (`subscribeThemeSkin`); each canvas or WebGL instrument has a test that fires the resolver's
appearance event and asserts the palette is re-read. Alpha is applied with `globalAlpha` or parsed
`rgba()`, never by concatenating hex suffixes to a computed colour (it returns `rgb(...)`).

#### 1.1.3 Contrast

WCAG ratios computed for the opaque v3 values (default dark). The popover column is `#111218`:
`bg-popover` today and `bg-surface-popover` once the 1.9.2 remap lands. Until then
`--surface-popover` is the translucent `rgba(18,18,26,.95)`, so these ratios do not yet describe
what `.bg-popover-surface` consumers render.

| Colour | canvas `#0a0a0f` | object `#0d0e14` | raised `#0f1016` | popover `#111218` | secondary `#15161d` |
| --- | --- | --- | --- | --- | --- |
| fg `#f1f5f9` | 18.03 | 17.59 | 17.33 | 17.06 | 16.46 |
| fg-2 `#999ca0` | 7.16 | 6.99 | 6.89 | 6.78 | 6.54 |
| fg-3 `#7e8084` | 4.99 | 4.87 | 4.80 | 4.72 | 4.56 |
| faint `#4a4c52` | 2.30 | 2.24 | 2.21 | 2.18 | 2.10 |
| accent hi `#67e8f9` | 13.63 | 13.29 | 13.10 | 12.89 | 12.44 |
| accent `#06b6d4` | 8.14 | 7.94 | 7.82 | 7.70 | 7.43 |
| amber `#fbbf24` | 11.83 | 11.54 | 11.37 | 11.20 | 10.80 |
| amber today `#f59e0b` | 9.20 | 8.97 | 8.84 | 8.70 | 8.40 |
| accent hi red `#fda4af` | 10.45 | 10.19 | 10.04 | 9.88 | 9.54 |
| accent hi violet `#c4b5fd` | 10.70 | 10.44 | 10.28 | 10.12 | 9.77 |
| hairline `#212226` | 1.24 | | | | |

Canvas text on accent hi (active chip): 13.63. Canvas text on accent (CTA pill): 8.14.

Rules:

- Informative text never goes below fg-3. On popovers, secondary surfaces and glass, small
  informative text uses fg-2 (`text-text-muted`): fg-3 is only 4.56 to 4.72 there.
- `text-text-faint` and anything at fg .30 or .45 is decorative and `aria-hidden`.
- Hairlines (1.24:1) are structure, not information. Any state carried by a line also changes
  text, shape (filled vs ring dot, solid vs dashed) or a count.
- `color-contrast.test.ts` must add these pairings per skin: `--text-subtle` on canvas, object
  and popover; `--accent-action-hi` on canvas and object; `--state-warning-text` on canvas and
  object (6.3).

#### 1.1.4 Status colour policy [D4]

| Meaning | Visual |
| --- | --- |
| ok, done, active, on, in library, running, allowed | `StatusDot tone="on"`, `accent-action-hi` text |
| waiting, needs confirmation, deferred, degraded, stale past threshold, over limit, pending dead letters | `StatusDot tone="warn"`, `state-warning-text` |
| off, never run, missing, idle, disabled | `StatusDot tone="off"` (ring), `text-text-subtle` |
| failed | `tone="warn"` plus the word "failed" (or `ERR` in log columns) |
| severity (health critical to low, log levels, repair risk) | 3-segment grey `RiskMeter` plus a word; never red, orange and yellow |
| destructive action | neutral control everywhere; red (`--state-danger`) only on the confirm button inside a destructive dialog, whose label states the consequence ("Delete 12 files") |

`--state-success`, `--state-info` and `--state-danger` stay defined (Crate Red, light mode and
legacy screens use them) but new v3 code must not use success or info, and uses danger only as
above. Decorative uses of status colours go away: Listen `MOOD_COLORS`
(`pages/ExploreLandingSections.tsx`), Info tab `tone="warm"` (`recipes.css`), profile badge tones
(`pages/user-profile-model.ts:47`), the affinity band tint; Admin's 398 emerald/green/red/rose,
about 288 amber/yellow/orange and about 48 violet/fuchsia/blue/sky classes. Sonner `richColors`
goes away in both apps (5.10).

`StatusDot on` follows the user's accent like every other accent use; with the red accent it reads
pink-red next to the red destructive confirm. Both stay distinguishable without hue (filled dot plus
a word vs a labelled button inside a dialog), and [D42] records the choice.

Charts follow the same rule: series in accent hi and accent plus fg alpha steps; amber only for a
threshold or over-limit series.

#### 1.1.5 Presets, modes and runtime overrides

- `crateRed` and light mode keep their own values except the shared hairlines, panel radius,
  fonts and `accent-action-hi`. Their redesign is out of v3 scope (product design §7). The v3
  minimum bar [D41] applies to every visual: tokens only, contrast tests green per skin, canvas and
  WebGL re-read tokens on appearance change, and the P0 Listen instruments are captured in `light`
  and `crateRed` (6.6), which `docs/technical/listen-design-system-visual-qa.md` treats as
  release-gate variants.
- `typography: system` (default in `crateRed`) switches display to `system-ui` and mono to
  `ui-monospace, "SF Mono", Menlo`.
- Listen Linux desktop maps the GTK accent onto `--color-primary` while `accent-action-hi` stays
  cyan (`app/listen-desktop/src/lib/linux-theme.ts`). Two accents must not coexist: either derive
  the hi accent from the GTK accent or ignore the GTK accent [D17].
- Album palette tinting (extended player, visualizer) is opt-in; the default is the accent [D16].

### 1.2 Typography

#### 1.2.1 Families and loading

| Family | Faces | Use | Loading |
| --- | --- | --- | --- |
| Bricolage Grotesque (`font-display`, `--font-display-stack`) | 500, 700, 800 from one variable file (`wght` 200–800, `opsz` 12–96) | titles, names, numerals, ledes | self-hosted woff2 (`app/shared/fonts/bricolage-grotesque/`, unmodified from `@fontsource-variable/bricolage-grotesque` 5.3.0), `font-display: swap`, latin 77 KB plus latin-ext 31 KB by `unicode-range`, every runtime |
| Poppins (`font-sans`, `--font-brand`) | existing | body, row titles, controls, inputs | web only in Listen (`main.tsx` guard); system font on Capacitor |
| JetBrains Mono (`font-mono`, `--font-mono-stack`) | 400 latin + latin-ext | labels, units, axes, indices, chips, readouts, code | self-hosted, 21 KB + 7 KB, every runtime |

Licence (decided 2026-10-15, [D3]; a reading of the licence, not legal advice). The first draft
used Cabinet Grotesk under the ITF Free Font License 2.0, whose §02 forbids distributing the font
through a public repository and making it available to third parties through an application. A
public repository and GHCR images that third parties run fall on the wrong side of both, so the
product and cratemusic.app use Bricolage Grotesque (SIL OFL 1.1, `OFL.txt` next to the files)
instead, and no commit contains the Cabinet files (the font commit was rewritten before any push; it is now `d9df9d51`, formerly `38c7576c`).
Components reference `font-display` / `--font-display-stack` only, so the swap was a token change
and the type scale (1.2.2) stays.

Optical size and metrics (measured with fontTools against the removed Cabinet files):

- The `opsz` axis carries the display character. `font-optical-sizing: auto` (the CSS default)
  picks it from the font size; never set `font-variation-settings: "opsz"` by hand. The static
  Google Fonts weights are instanced at opsz 14, so they are not used.
- Width at weight 800 versus Cabinet: about 5% narrower at display sizes (opsz 96), about 4% wider
  at 12 to 16 px. Truncation budgets hold.
- Tracking: the display tokens below were tuned for Cabinet and stay unchanged in the swap. If the
  `VISUAL` captures (plan 0.11) show touching counters at 800, ease the title and XL/L numeral
  tracking by 0.01em (`-0.045em` → `-0.035em`, `-0.05em` → `-0.04em`) in one token commit.
- Vertical: x-height .52 em (Cabinet .49), cap height .66 (.67), ascent .93 and descent .27 with
  `USE_TYPO_METRICS` (Cabinet .87 / .28). Under leading .85 to .9 the glyph box overflows a little
  more; check capital diacritics in line-clamped titles and add `padding-block: 0.05em` to the
  clamped recipe if they clip, rather than changing the leading.
- Figures: `tnum`, `pnum` and `frac` are present, so `tabular-nums` works on display numerals
  [D31].

Rules:

- No new weights or families.
- Mono is always weight 400. Emphasis inside a mono label is colour (`accent-action-hi`), never
  weight.
- Bricolage Grotesque only at 20 px and above for titles, 16 px and above for numerals. Exception: player bar
  and mini-player track titles at 15 to 16 px, weight 700.
- Names in non-Latin scripts fall back per glyph to the brand or system font; layouts must not
  assume display-face metrics.
- Canvas text (share story, any canvas label) awaits `document.fonts.load()` for the v3 faces
  before drawing.
- `tabular-nums` on every number that changes. Bricolage Grotesque has `tnum`, so count-up
  numerals need no reserved width [D31].

#### 1.2.2 App type scale

The site's macro sizes are marketing scale (H1 up to 9.5 rem). Inside the app shells they are
capped [D14]. Instrument sizes use container query units (`cqi`) so they follow the panel, not the
viewport; without a container ancestor `cqi` resolves against the small viewport, which is safe.

Engines without `cqi` (iOS 15, [D11]): a `cqi` value inside a custom property is invalid at
computed-value time, so `font-size: var(--text-numeral-xl)` falls back to the inherited body size,
not to an earlier declaration. Each tier that uses `cqi` (readout word, the four numeral tiers,
stage title) is therefore emitted as a utility with two literal declarations: the rem minimum of
its `clamp()` first, then the `clamp(… cqi …)` value, which the parser drops where `cqi` is
unknown.

Display (Bricolage Grotesque):

| Tier | Token (new) | Size | Weight | Leading | Tracking | Use |
| --- | --- | --- | --- | --- | --- | --- |
| Page title | `--text-display-page` | `clamp(2.25rem, 4vw, 3.75rem)` | 800 | `.9` | `-0.045em` | page H1 |
| Entity title | `--text-display-entity` | `clamp(2.6rem, 5vw, 4.4rem)` | 800 | `.9` | `-0.045em` | artist, album, playlist, genre, profile, ticket artist; max 2 lines |
| Readout word | `--text-display-readout` | `clamp(2.2rem, 4.2cqi, 3.8rem)` | 800 | `.95` to `1` | `-0.045em` | track title readout, EQ preset word; one line, truncate with `title` |
| Sub-head | `--text-subhead` | `clamp(1.25rem, 1.7vw, 1.6rem)` | 700 | `1.1` | `-0.025em` (`tracking-tight`) | section titles, dialog titles (`1.4` to `1.6rem`, `-0.03em`) |
| Stage title | existing `text-2xl`/`text-3xl` | `clamp(1.6rem, 3cqi, 2.6rem)` | 700 | `1` | `-0.035em` | "Now" stage, step H3 |
| Lede | existing `text-lg` to `text-xl` | `1.15rem` to `1.5rem` | 500 | `1.2` | `-0.025em` (`tracking-tight`) | page lede, bio first paragraph, 36ch |

Numerals (Bricolage Grotesque, tabular):

| `StatNumber` size | Token (new) | Size | Weight | Leading | Tracking | Site source |
| --- | --- | --- | --- | --- | --- | --- |
| `xl` | `--text-numeral-xl` | `clamp(3.2rem, 8.4cqi, 8.4rem)` | 800 | `.85` | `-0.05em` | listening counters, release clock |
| `lg` | `--text-numeral-lg` | `clamp(2.8rem, 5.6cqi, 5.4rem)` | 800 | `.85` | `-0.05em` | health totals, scale figures |
| `md` | `--text-numeral-md` | `clamp(1.6rem, 2.6cqi, 2.4rem)` | 700 | `1` | `-0.035em` | analysis figures, lane counts |
| `sm` | `--text-numeral-sm` | `clamp(1.1rem, 2.1cqi, 1.9rem)` | 700 | `1` | `-0.03em` | gauge outputs, EQ band values, legend values |

Today `StatNumber` is 700, `leading-none`, `-0.04em`, `sm`/`md`/`lg` = `text-base sm:text-xl` /
`text-3xl` / `text-5xl`. Moving the existing sizes onto these tokens changes Listen's Radar summary
and the EQ numerals: visual check in the same commit.

Body (Poppins): 15 px (`text-body`) default, lh 1.6; long text `clamp(.98rem, 1.1vw, 1.08rem)`, lh
1.7, `text-text-muted`, max 60 to 62ch; small body 13 px (`text-caption`) lh 1.55; row titles 14
to 15 px weight 500.

Mono micro scale (weight 400):

| Size | Token | Tracking | Case | Use |
| --- | --- | --- | --- | --- |
| 11.5 px | new `--text-eyebrow` | `.16em` (`tracking-kicker`) | upper | eyebrows, tab labels, TOC, breadcrumb |
| 11 px | `--text-label` | `.14em` (`tracking-caps`) | upper | `MonoLabel`, panel header, dt, captions, sidebar group labels |
| 11 px | `--text-label` | `.04em` (new `--tracking-chip`) | as is | chips, flags, routes |
| 10.5 px | `--text-label` at 10.5 only inside instruments via the recipe classes | `.06` to `.14em` | upper or as is | axis titles, scan rows, units, legend keys |
| 10 px | `--text-badge` | `.08` to `.12em` (`tracking-label`) | upper | lane names, step chips, mono tags |
| 9.5 px | recipe class only | `.06` to `.12em` | upper | legend dt, method and auto/confirm badges |
| 12 to 13 px | `text-caption` | `0` to `.04em` | as is | code, JSON (12.5 px lh 1.7), terminal (13 px lh 1.75), file tree (12 px lh 2) |

Sizes below 11 px exist only inside instruments, through component-local recipe classes in the
app (not arbitrary `text-[10.5px]` utilities, which count against the design-token budgets).

#### 1.2.3 Tracking and leading ladders

- Positive (mono): `.04em` chips (`--tracking-chip`), `.12em` tags (`tracking-label`), `.14em`
  caps labels (`tracking-caps`), `.16em` eyebrow (`tracking-kicker`). `tracking-eyebrow` (`.18em`)
  and wider are v2 and must not be used in new code.
- Negative (display): `-0.025em` (`tracking-tight`, site `-0.02` to `-0.025em`) small display, sub-heads and ledes, `-0.03em` small numerals (new
  `--tracking-numeral-sm`), `-0.035em` stage titles and mid numerals, `-0.04em` rows
  (`tracking-display`), `-0.045em` headlines (new `--tracking-headline`), `-0.05em` hero numerals
  (new `--tracking-numeral`).
- Leading: `.85` numerals (new `--leading-numeral`), `.9` display (`leading-display`), `1`
  headings and numerals, `1.1` to `1.2` sub-heads and ledes, `1.4` labels, `1.55` small body,
  `1.6` to `1.75` body and code, `2` file tree.

#### 1.2.4 Typographic conventions

- Real minus `−` (U+2212) for negatives (`formatGain`, `−11.2 dB`, `T−24 d`).
- ` · ` between metadata parts (`MonoLabel` renders the separator `aria-hidden`).
- `→` for flows and paths, `…` for truncation, `~` before approximate numbers (raised mono glyph).
- Indices zero-padded (`01`); progress as `07 / 17`.
- Units lower-case mono after the numeral, on the same baseline (`41 min`, `2.3 MB/s`, `dB`).
- Durations `m:ss` under an hour, `h:mm:ss` above. Relative time in mono (`3 h ago`) with the
  absolute time in `title`. In Listen these strings are locale-formatted (1.2.5); the English
  forms here are the Admin and catalog `en` forms.
- Slugs shown lower-case with spaces (`post punk`). Genre names from the taxonomy are lower-case
  in the catalog; capitalise in the client only where a sentence needs it.
- Listen formats numbers with `Intl.NumberFormat(i18n.language)`; Admin uses `en-US`. Shared
  components take preformatted strings or a `format` prop.

#### 1.2.5 Internationalisation

- Listen: every visible string, aria label and readout goes through `t()` in the 7 catalogs (en,
  es, fr, de, it, ca, eu), then `node scripts/i18n-check.mjs --write-metadata`. Admin is English.
- Uppercase mono labels grow in German and Basque: reserve width, allow two lines or truncate with
  `title`, never size a panel to the English string.
- Listen must sync `<html lang>` with the active locale so uppercase transforms, hyphenation and
  screen readers follow it [D15].
- Listen mono readouts are locale-formatted: relative time (`3 h ago`) with
  `Intl.RelativeTimeFormat(i18n.language, { style: "narrow" })`; dates, weekday names and the
  heatmap week start (`Peak Sat 23:00`) with `Intl.DateTimeFormat(i18n.language)`; countdowns
  (`T−12 d`, `Day +N`) and units (h, min, d, MB/s) from catalog keys. Count strings (`9 of 11
  playable`, `20 STEPS`, `N OF M ANALYSED`, `2 online · 1 recent`) use ICU plural keys, and their
  key prefixes are added to `app/listen/src/i18n/plural-counts.test.ts` in the change that adds
  them.
- Copy rule for audio features: never "beatmatch", "sync", "lock", "handoff" or "automix" in any
  locale (4.11).

### 1.3 Spacing and layout

#### 1.3.1 Rhythm

The site's macro rhythm is in `vh` for long scrolling pages. The apps use fixed steps.

| Element | Value | Utility |
| --- | --- | --- |
| Between page sections | 32, 48 or 64 px | `gap-8`, `gap-12`, `gap-16` |
| Panel top rule to header | 22 px | `pt-5.5` |
| Header to body | 12 to 28 px | `mt-3` to `mt-7` |
| Header label gap | `8px 24px` (row, column) | `gap-x-6 gap-y-2` |
| Hairline row padding | 9 to 10 px vertical | `py-2.5` (existing `HairlineRow`) |
| Lane rows | 14 px | `py-3.5` |
| Feature rows | 26 to 30 px | `py-7` |
| Chip gap | 8 px | `gap-2` |
| Label to value | 10 to 14 px | `gap-2.5` to `gap-3.5` |
| Object card padding | header `12px 18px`, body 16 to 30 px | `px-4.5 py-3`, `p-4` to `p-7.5` |

#### 1.3.2 Grids

- **VizSplit** (site `components/viz/VizSplit.astro`): `grid-template-columns: minmax(0,5fr)
  minmax(0,7fr)`, gap `clamp(24px, 5vw, 80px)`; text column and visual column; `visual-left`
  swaps the order. In the apps the visual column is sticky only on long pages (`top:
  max(12vh, 96px)` becomes the shell's header height plus 24 px).
- **Full-width band**: a panel spanning the content column. Used for dense instruments (EQ, health
  scan, queue lanes, release rail, wheel, heatmap band).
- **Inspector split** (wheel and similar): visual 7fr, inspector 4fr, collapsing at 1000 px
  container width.
- Text measure: 60 to 62ch body, 36ch ledes, 28 to 30ch statements.

#### 1.3.3 Breakpoints and containers

- App shells keep their Tailwind viewport breakpoints for chrome and page grids.
- Instruments respond to their container: `InstrumentPanel` sets `container-type: inline-size`, and
  instrument layouts collapse at container widths of 1000 px (two-column panels to one) and 760
  px (single column, visual first, secondary labels hidden, chip rows scroll). This makes the same
  instrument work in a 360 px drawer, a half-width tab and a full band.
- Instrument layouts are written narrow-first: the base styles are the single-column layout and
  container queries only widen it, so an engine without container queries (iOS 15, [D11]) gets
  the narrow layout rather than a broken wide one.
- Each instrument entry in section 4 states its narrow-width behaviour (a Mobile line or the
  entry's layout rules); each instrument task adds a 375 px render test.
- Coarse pointers: 44 px minimum targets (`min-h-11`), including chips and node hit areas.
- Listen safe areas: `--listen-safe-*`, mobile bottom chrome height and fullscreen EQ offset
  (`app/listen/src/index.css`) apply to full-bleed bands.

### 1.4 Radii

| Radius | Token | Use |
| --- | --- | --- |
| 999 px | `rounded-full` | chips, CTA pills, status badges, tags, packet labels |
| 50% | `rounded-full` | dots, nodes, play discs |
| 14 px | `--radius-panel` (`rounded-panel`) | object cards (ticket, terminal, JSON, dialogs, popovers, toasts) |
| 6 px | `rounded-lg` (default `subtle` preset) | lane tracks, fact chips, inputs in Listen |
| 4 px | `rounded-md` | method badges, pool tracks |
| 2 px | `rounded-sm` | bars, gain bars, gauge tracks, heat cells (site 3 px) |
| 1 px | instrument recipe | risk meter segments |

- The preset radius scale (`subtle` vs `rounded`) is unchanged. Instrument micro radii follow it.
- Listen pins text controls to `--radius-lg` (`index.css` rule
  `:is(button, a).rounded-full[class*="px-"]` and `[data-slot="button"]`, guarded by
  `radius-policy.test.ts`). `CratePill` therefore renders 6 px corners in Listen. Default for v3:
  exempt chips through `data-slot="chip"` (the rule skips it; the policy test is updated in the same
  commit) and keep CTAs pinned until decided [D2].
- Listen modals are pinned to 12 px while panels are 14 px; align to `rounded-panel` [D2].

### 1.5 Hairlines, strokes and dashes

- Every border is 1 px. Panel structure: top rule `border-border-quiet`, row dividers
  `border-border-quiet-subtle`, section dividers `border-border-quiet`.
- Meter tracks: 1 px progress lines, 2 px feature bars and gain meters, 3 px cache meter, 4 px
  gauges.
- SVG strokes: 1 (orbits, grids), 1.25 (nodes, edges, outlines), 1.5 (active dots), 1.75 (lit
  edge), 2 (curves, active nodes), 2.25 (active parent edge, EQ curve); a 10 to 14 px glow stroke
  at `.12` under primary curves. `vector-effect="non-scaling-stroke"` on scaled SVG.
- Dash patterns (`stroke-dasharray`): `2 4` zero lines, `3 5` ghost or target curve, `2 6` outer
  ring and "never" edge, `3 4` dimmed curves and client nodes, `4 5` fallback edges and selection
  regions, `2 5` group boxes. CSS: `1px dashed` at fg .18 for ticket perforation; `border-dashed`
  for governed chips.
- Line drawing uses `pathLength="1"` with `stroke-dasharray: 1` and `stroke-dashoffset: 1 → 0`;
  never `getTotalLength` (jsdom lacks it and it is layout work).

### 1.6 Surfaces and elevation

- Flat. The canvas is the page; a panel is a rule and a header.
- Object card: `bg-surface-object`, `border border-border-quiet`, `rounded-panel`,
  `overflow-hidden`. Only for standalone objects (ticket, terminal, JSON, code, toast, tooltip).
- Overlays (popover, menu, dialog, sheet, toast): `bg-surface-popover` (or object), hairline,
  `rounded-panel`, one soft elevation shadow. These are the only shadows. `bg-surface-popover`
  exists once the 1.9.2 remap and the 1.9.4 utility land (plan Task 1b.1); the scrim behind a
  modal or sheet is `bg-surface-scrim`, never the popover or overlay fill.
- Every card fill must carry a hairline: `#0d0e14` on `#0a0a0f` is 1.07:1, so a borderless card
  disappears [D6].
- No glass on panels, cards, sheets or modals. Admin switches `data-surface` from `glass` to
  `solid` by default. Listen keeps the user material setting (`solid` default, `glass` opt-in);
  v3 visuals must work under both [D13].
- Chrome that content scrolls under uses the site's gradient fade (canvas `.92 → .6 → 0` over 28
  px), not blur.
- No grain texture in the apps (the site's fixed noise overlay is costly on mobile GPUs) [D12].
- Labels over graphics use a halo (`text-shadow` in the canvas colour), never a box.

### 1.7 Iconography

- Admin: `lucide-react`. Listen and Desktop: `@crate/ui/icons` (Solar) sized with
  `CRATE_ICON_SIZE`. The Linux titlebar must switch from undeclared `lucide-react` to
  `@crate/ui/icons`.
- Shared components never import an icon set; they take icons as `ReactNode` or
  `ComponentType<{ size }>` props.
- Instruments are typographic: `→`, `·`, CSS dots, rings and triangles. No icon tiles in panel or
  stat headers. Icons stay on actions and navigation.
- Sizes: 16 px in rows and chips, 18 to 20 px in navigation, 22 px in the Listen mobile tab bar.
- No emojis anywhere, including task icons (`task_icon()` defaults to a gear emoji and must not be
  rendered).

### 1.8 Motion

#### 1.8.1 Easing tokens

| Token | Value | Use |
| --- | --- | --- |
| `--ease-snap` | `cubic-bezier(.22,1,.36,1)` | colour, border, opacity and state changes, hovers |
| `--ease-out-expo` | `cubic-bezier(.16,1,.3,1)` | path and hairline drawing, page transitions, halos (site `--ease-out`) |
| `--ease-dramatic` | `cubic-bezier(.77,0,.175,1)` | reserved |
| `--ease-spring-snappy` | `linear()` spring, about 9% overshoot | entrances, chip press, node radius, row slides |
| `--ease-spring-smooth` | `linear()` spring, about 4% overshoot | state crossfades, sector zoom |

No keyword easings in new code (`ease`, `ease-in-out`), except `linear` for constant progress and
plain fades. The site's `--ease-in-out` is not ported.

#### 1.8.2 Durations

| Duration | Use |
| --- | --- |
| 80 ms | press (`:active`) |
| 200 ms | reduced-motion fades, data refresh crossfades outside instruments |
| 250 ms | scanning bar, packet opacity |
| 300 ms | colour, border, background state changes (`ease-snap`) |
| 350 to 450 ms | edges, row opacity, check-mark draw, chip press spring |
| 500 to 600 ms | panel entrance, hover transforms, hairline draws, step underline |
| 700 ms | row and cell entrances |
| 900 ms | long hairline draw, halo pulse, label clip reveal |
| 1.2 s | path route draw |
| 1.6 s | count-up |

Use Tailwind `duration-*` utilities; no duration tokens are added.

#### 1.8.3 Entrances and stagger

- Panel entrance: opacity plus a 12 px rise, 500 to 700 ms, `ease-spring-snappy` (longhand) with
  `ease-out-expo` fallback. No `filter: blur` entrance on Android WebView or WebKitGTK.
- Page transition: opacity plus 8 px, 350 ms, `ease-out-expo`; replaces `animate-page-in`.
- List stagger: 70 ms per item (setlist rows 55 ms, devices 140 ms), capped at 8 items (20 for a
  setlist), base delay 80 to 300 ms, total under about 800 ms. Static stagger uses `:nth-child`
  delays in recipe CSS, not per-item `style={{}}` (drift budget).
- Word-split reveals are site-only; the apps do not split words.
- Entrances run once per mount, never on refetch. Keys stay stable so refetches do not remount.

#### 1.8.4 Data motion (JS)

Ported once. The spring helpers start in `@crate/ui/domain/player/eq-morph.ts` (not exported) with
the EqBands morph and move to `@crate/ui/lib/spring.ts` when an app imports them directly (2.4):

```ts
// semi-implicit Euler; dt clamped to 50 ms, first frame 1/60 s
force = (target - value) * stiffness - velocity * damping;
velocity += force * dt; value += velocity * dt;
settled = |target - value| < eps && |velocity| < eps;   // eps 0.01 for dB, 1e-3 for unit values
```

| Use | Stiffness / damping | Notes |
| --- | --- | --- |
| default | 170 / 18 | |
| governor gauges | 170 / 18 | one spring per gauge |
| EQ curve, EQ glyph | 120 / 14 | zeta about .64, about 5% overshoot, settles in 0.7 to 1.1 s |
| genre mini EQ | 140 / 15 | |
| analysis readout | `90 + (i % 7) * 8` / 13 | values settle in a ripple |

- Springs re-target on new data; the loop never restarts the animation.
- Loops stop when every spring has settled, when the element leaves the viewport, when the
  document is hidden (jump to target) or when motion is blocked. The site's loops run while
  visible; the product's must stop on settle (Tauri disables background throttling).
- Clocks are not motion: elapsed time on running chips, scan rows and readouts is written by a 1 s
  timer into a text node, never by a rAF loop, so a long-running task does not keep a loop alive.
- Exponential smoothing for positions and opacities that follow a moving target:
  `x += (target - x) * (1 - exp(-dt * k))`, k = 7 (8 for auto-scroll).
- Scramble (Admin-local `app/ui/src/lib/motion/scramble.ts` from plan Task 3.1; moves to
  `@crate/ui/lib/scramble.ts` in plan Task 4.5, where the Listen EQ trail is its first Listen
  consumer, 2.4): glyphs `ABCDEFGHJKLMNPRSTUVWXYZ0123456789#/<>_` (no I, O,
  Q), settles left to right, one running scramble per element, durations 320 ms (copy feedback),
  360 ms (mood), 380 ms (stage), 420 ms (preset), 480 ms (track title), 1100 ms (top genre). The
  scrambled node is `aria-hidden` and React-unmanaged (written through a ref); an sr-only sibling
  holds the final text. Reduced motion writes the final text at once.
- Count-up: ease-out cubic, 1600 ms, from the previous value (Listen `CountUpNumber` exposes a
  duration prop instead of changing its global 1200 ms), writes `textContent` through a ref.

#### 1.8.5 Reduced motion and effects

| Layer | Listen | Admin |
| --- | --- | --- |
| User setting | `data-crate-motion="reduced"` from the appearance resolver (values `reduced` and `system`) | not applied today [D9] |
| OS | `prefers-reduced-motion` media query, `motion-reduce:` variants | same |
| JS gate | `isMotionBlocked()` and `subscribeToMotionAvailability()` (`lib/motion-availability.ts`) | none today |
| Effects | `data-crate-effects="off\|subtle\|expressive"` | not set |

- The DOM half of the Listen gate (media query, `data-crate-motion`, `document.hidden`) moves to
  `@crate/ui/lib/motion-gate.ts` the day a shared visual needs it (EqBands morph). Listen wraps it
  with its preference store. Shared hooks take the gate as an injected function.
- Under reduced motion: no springs (write targets), no scramble, no count-up, no entrances, no
  draws, chip and CTA transforms off; fades become 200 ms linear opacity. Interaction is unchanged.
- The global rule `[data-crate-motion="reduced"] *` zeroes durations but not delays. Animations
  that use `animation-fill-mode: both` with a delay must sit behind `motion-safe:` and
  `:root:not([data-crate-motion="reduced"])`, or set delays to 0 in reduced mode; otherwise items
  stay hidden for the delay.
- Glow, bloom and WebGL extras honour `data-crate-effects` in Listen (`off` means none).

#### 1.8.6 `linear()` support

`linear()` needs Chrome 113, Safari 17.2, Firefox 112. Floors without it: WebView2 111 (Windows),
WebKitGTK 2.40 (Linux DEB/RPM), macOS 11, iOS below 17.2.

- Spring tokens only through longhand properties (`transition-timing-function`,
  `animation-timing-function`). Tailwind `ease-*` utilities already do this. An unsupported value
  becomes invalid at computed time and falls back to the initial value (`ease`), not to an
  earlier declaration in the cascade.
- Never inside the `transition` or `animation` shorthand: the whole declaration becomes invalid
  (`animation-name: none`, no transition).
- Custom CSS that needs a real fallback uses `@supports (transition-timing-function: linear(0, 1))`.
- The final state must never depend on an animation running: no `opacity: 0` in a base state that
  only an animation reveals.
- JS springs (1.8.4) do not depend on CSS support and are the tool for data motion.

### 1.9 Token mapping

#### 1.9.1 Site names to product tokens

| Site | Product |
| --- | --- |
| `--bg` | `--surface-canvas` (`bg-surface-canvas`) |
| `--fg` | `--text-primary` |
| `--fg-2` | `--text-muted` |
| `--fg-3` | `--text-subtle` |
| `--line` | `--border-quiet` |
| fg .06 | `--border-quiet-subtle` |
| `--cyan` | `--accent-action` |
| `--cyan-hi` | `--accent-action-hi` |
| `--amber` | `--state-warning` (text: `--state-warning-text`) |
| `#0d0e14` | `--surface-object` (new alias of the card solid) |
| `#0b1d24` | `--surface-accent-active` (new; same formula as product design 3.1.1 and 1.9.4, ≈ `#0a1d25`) |
| `--display` / `--sans` / `--mono` | `font-display` / `font-sans` (`--font-brand`) / `font-mono` |
| `--spring-snappy` / `--spring-smooth` | `--ease-spring-snappy` / `--ease-spring-smooth` |
| `--ease-out` | `--ease-out-expo` |
| `--ease-snap` / `--ease-dramatic` | same names |
| `.viz-label` | `MonoLabel` |
| `.eyebrow` | `MonoLabel size="eyebrow"` |
| `.chip` | `CratePill` |
| `.viz-bar` + figure | `InstrumentPanel` |

#### 1.9.2 Registry changes (`appearance-token-registry.ts`, default preset, dark)

| Token | v2 | v3 | State |
| --- | --- | --- | --- |
| `muted-foreground` (`text-muted`) | `#94a3b8` | `#999ca0` | done |
| `textSubtle` | `#94a3b8` | `#7e8084` | done |
| `textFaint` | `#475569` | `#4a4c52` | done |
| `surface-card-solid` | `#16161e` | `#0d0e14` | done |
| `surface-secondary-solid` / `accent-solid` | `#1c1c28` | `#15161d` | done |
| `surface-muted-solid` | `#16161e` | `#0d0e14` | done |
| `surface-popover-solid`, `surface-input-solid` | `#16161e`, `#141419` | `#111218` | done |
| `surface-raised-solid` | `#12121a` | `#0f1016` | done |
| `surface-border-solid`, `borderSubtle`, `borderQuiet` | `#252535` / white .1 | `rgba(241,245,249,.1)` | done |
| `borderQuietSubtle` | white .06 | `rgba(241,245,249,.06)` | done |
| idle, hover, pill, chip ladders (`interactive.css`) | `rgba(255,255,255,a)` | `rgba(241,245,249,a)`; idle text .62, muted .5 | done |
| `accent-action-hi` (+ foreground) | none | cyan `#67e8f9`, red `#fda4af`, violet `#c4b5fd`, light cyan `#0e7490` | done |
| warning (dark) | `#f59e0b` | `#fbbf24` | proposed [D5] |
| scrollbar thumb / hover | `#252535` / `#353545` | fg .10 / .18 | pending |
| `surface-panel` | `#0c0c14` | `#0d0e14` | pending |
| `--surface-popover` mapping (`appearance-token-registry.ts:563-565`, `tokens/surfaces.css:26,51`) | `--crate-token-surface-overlay-{solid,glass}` (`rgba(18,18,26,.95)` in both) | `--crate-token-surface-popover-{solid,glass}` (`#111218` solid; glass unchanged at `rgba(18,18,26,.95)`); `--color-surface-popover` added to the semantic `@theme` so `bg-surface-popover` exists; asserted in `tokens/runtime-contract.test.ts` | pending (plan Task 1b.1) |
| glass popover, raised, modal, overlay | `rgba(18,18,26,…)`, `rgba(16,16,24,…)` | solid popover + hairline; these stay panel fills (the modal scrim is the new `--surface-scrim`, 1.9.4) | pending |
| success, info (dark) | `#22c55e`, `#3b82f6` | unchanged values, usage restricted | policy [D4] |

#### 1.9.3 Hand-rolled utilities to v3

| v2 pattern | v3 replacement |
| --- | --- |
| `text-white/55`, `text-white/60` | `text-text-muted` |
| `text-white/40`, `text-white/35`, `text-white/25` (labels) | `text-text-subtle` (never below fg-3 for information) |
| `border-white/10`, `border-white/8`, `border-white/12` | `border-border-quiet` |
| `bg-white/[0.04]`, `bg-black/15`, `bg-black/30` boxes | no fill; hairline row or `bg-surface-object` object card |
| `uppercase tracking-[0.18em] text-[10px]` labels | `MonoLabel` |
| `text-xl font-semibold` stat values | `StatNumber` |
| coloured `Badge` tones | `StatusDot` with a word |
| `shadow-[…]`, `backdrop-blur-*` on panels | none |
| `focus-visible:shadow-focus` | global outline recipe (1.9.5) |
| `Loader2 animate-spin` inside panels | reserved geometry with `—`, `ProgressHairline` |
| `rounded-xl` cards | `rounded-panel` object card or no card |
| icon tiles in headers | removed |
| `text-[11px]` | `text-label` |
| `richColors` toasts | shared toaster config (5.10) |

#### 1.9.4 New tokens

Add in `app/shared/ui/tokens` (colours through the registry, then generate). Each must be
referenced in the commit that adds it (unreferenced tokens budget is 0) and the definition
ceilings are raised by exactly the number added (6.2). A token lands in the task of its first
consumer, with the registry and contrast tests in the same commit; `--surface-accent-active`
therefore lands with the GenreWheel (plan Task 3.7, ceiling +1), and `--color-surface-popover` and
`--surface-scrim` land with the overlay recipe together with the `--surface-popover` remap (plan
Task 1b.1, ceiling +2).

| Token | Value | Utility | First consumer |
| --- | --- | --- | --- |
| `--surface-object` | registry: card solid (`#0d0e14` default dark) | `bg-surface-object` | ticket, JSON card, toasts |
| `--surface-accent-active` | `color-mix(in srgb, var(--accent-action) 11%, var(--surface-canvas))` (about `#0a1d25`, matching the site's `#0b1d24`) | `bg-surface-accent-active`, `fill-surface-accent-active` | GenreWheel pinned node (plan Task 3.7); StackMap active node later |
| `--color-surface-popover` | `var(--surface-popover)` in the semantic `@theme`, after the 1.9.2 remap | `bg-surface-popover` | overlay recipe (5.9, plan Task 1b.1) |
| `--surface-scrim` | `color-mix(in srgb, var(--surface-canvas) 72%, transparent)` (not `--surface-canvas-overlay`, which is .60 and also used as a shadow colour) | `bg-surface-scrim` | modal and sheet backdrop (5.9, plan Task 1b.1) |
| `--text-eyebrow` | `0.71875rem`, line-height 1.4 | `text-eyebrow` | page header eyebrow |
| `--text-display-page` | `clamp(2.25rem, 4vw, 3.75rem)`, line-height .9 | `text-display-page` | page header |
| `--text-display-entity` | `clamp(2.6rem, 5vw, 4.4rem)`, line-height .9 | `text-display-entity` | ticket artist, artist hero |
| `--text-display-readout` | `clamp(2.2rem, 4.2cqi, 3.8rem)`, line-height 1 | `text-display-readout` | track readout title, EQ word |
| `--text-subhead` | `clamp(1.25rem, 1.7vw, 1.6rem)`, line-height 1.1 | `text-subhead` | `SectionHeader` title |
| `--text-numeral-xl` / `-lg` / `-md` / `-sm` | 1.2.2 | `text-numeral-*` | `StatNumber` |
| `--tracking-headline` | `-0.045em` | `tracking-headline` | display titles |
| `--tracking-numeral` | `-0.05em` | `tracking-numeral` | `StatNumber lg/xl` |
| `--tracking-numeral-sm` | `-0.03em` | `tracking-numeral-sm` | `StatNumber sm` |
| `--tracking-chip` | `0.04em` | `tracking-chip` | `CratePill` |
| `--leading-numeral` | `0.85` | `leading-numeral` | `StatNumber lg/xl` |

`cn.ts` must register the new font-size, tracking and leading keys so `twMerge` resolves them (as
`d9df9d51` did for `text-label` and `leading-display`).

#### 1.9.5 Global rules

- `:focus-visible`: `outline: 2px solid var(--accent-action-hi); outline-offset: 3px` (4 px on
  CTAs, `-2px` inset on edge-to-edge rows and tiles). `--focus-shadow` stops being the focus
  indicator; components drop `focus-visible:shadow-focus`.
- `::selection`: accent background, canvas text.
- `-webkit-font-smoothing: antialiased`; `color-scheme: dark` (already set).

---

## 2. Primitives

### 2.1 Placement rules

1. Both apps render it in the same change: `@crate/ui`.
   - `primitives/`: app-agnostic parts (`MonoLabel`, `StatusDot`, `StatNumber`, `HairlineList`,
     `InstrumentPanel`, `Meter`, `Readout`, `ProgressHairline`, chips; `StatStrip` once Listen
     adopts it).
   - `domain/`: music concepts (`domain/player/EqBands`, `domain/genres/*`,
     `domain/analysis/TrackReadout`, `domain/shows/SetlistTicket`; `domain/tasks/StepRail` once
     Listen adopts it).
   - `lib/`: hooks and pure helpers used by both apps.
   - Not `composites/` for visuals, and never `domain/stats/Ops*` (dead admin copies; 6.10).
2. One app renders it: it stays in that app (`app/ui/src/components/<domain>/`,
   `app/listen/src/components/<domain>/`), math included. It moves the day the second app adopts
   it, deleting the local copy in the same change.
3. Never park a single-app component in `@crate/ui` behind `UNUSED_EXPORT_ALLOWLIST`.
4. Shared components take data, copy, aria strings, formatters, icons and callbacks as props. No
   `useApi`, SSE, i18n, toasts, router hooks or player contexts inside `@crate/ui`.
5. Wildcard exports map `primitives/*`, `composites/*`, `domain/*`, `shadcn/*`, `icons/*` to `.tsx`
   only and `lib/*` to `.ts`. Pure `.ts` helpers go in `lib/`; a `.ts` file elsewhere needs explicit
   entries in `exports` and `publishConfig.exports`.
6. `export-usage-policy.test.ts` only proves that one app imports a module, and it follows
   `export … from` but not `import`. The both-apps rule is enforced in review; each shared module
   must be imported directly by an app.
7. Layers (`npm run design-system:layers`): primitives may not import composites or domain;
   composites may not import domain; domain may import primitives.

### 2.2 Existing primitives

State = direct importers today (`grep -rl "@crate/ui/<module>" app/ui/src app/listen/src`,
counts are files, Admin / Listen). "Listen only" means the module is shared ahead of the both-apps
rule; it is not moved, but a v3 change to it is tested in Listen only until Admin adopts it.

| Primitive | File | State | v3 change |
| --- | --- | --- | --- |
| `MonoLabel` | `primitives/MonoLabel.tsx` | both (1 / 5) | ARIA pass-through, `size`, more elements |
| `StatusDot` | `primitives/StatusDot.tsx` | both (1 / 2) | `pulse`, forced colors |
| `StatNumber` | `primitives/StatNumber.tsx` | Listen; Admin only through `EqBands` | `xl`, weights, inline unit, label position, value ref |
| `HairlineList` / `HairlineRow` | `primitives/HairlineList.tsx` | Listen only (rule breach until Admin adopts) | `active`, interactive variant, `truncate`, pass-through |
| `CratePill`, `CrateChip`, `CrateBadge` | `primitives/CrateBadge.tsx` | both (28 / 34) | `CratePill`: 32 px, variants, hover, focus, Listen radius exemption; `CrateChip`: static tag recipe; `CrateBadge`: tones mapped to the status policy (badge policy is Listen's) |
| `ErrorState` | `primitives/ErrorState.tsx` | both (11 / 1) | page and compact variants (5.11) |
| `SearchInput`, `FormField`, `Switch`, `Checkbox` | `primitives/*` | Listen only | form recipe (5.6) |
| `RadioGroup` | `primitives/RadioGroup.tsx` | no importer | candidate for the unused-code cleanup (product design PD47); not restyled |
| `SegmentedControl` | `primitives/SegmentedControl.tsx` | Listen only | becomes a chip group (5.6) |
| `IconButton` | `primitives/IconButton.tsx` | Listen only (31) | ghost, no tile, `aria-expanded` prop |
| `ActionIconButton` | `primitives/ActionIconButton.tsx` | both (10 / 1) | ghost, no tile |
| `AppModal`, `AppPopover` | `primitives/*` | both (2 / 10, 3 / 7) | overlay recipe (5.9) |
| `EqBands` | `domain/player/EqBands.tsx` | both (2 / 2) | spring morph, layers, a11y (4.1) |
| `SectionHeader`, `EmptyState`, `MediaGrid`, `MediaRail` | `domain/lists/*` | Listen only | 5.3, 5.5, 5.11 |
| `PageHeader` | `domain/navigation/PageHeader` | Listen only | 5.2 |
| `LoadingState` | `domain/states/LoadingState.tsx` | Listen only (via `domain/states`) | 5.11 |
| `GenrePill` | `domain/genres/GenrePill.tsx` | both (2 / 13) | chip look; stays required by `genre-pill-policy` |

#### `MonoLabel`

```ts
interface MonoLabelProps extends Omit<HTMLAttributes<HTMLElement>, "children"> {
  as?: "p" | "span" | "div" | "h2" | "h3" | "dt" | "figcaption" | "legend";
  size?: "label" | "eyebrow";      // 11px/.14em (default) | 11.5px/.16em
  accent?: ReactNode;               // key word in accent hi, 10px gap
  meta?: readonly (string | null | undefined | false)[]; // joined with aria-hidden " · "
  children?: ReactNode;
}
```

- `id`, `role` and `aria-*` pass through (today they are dropped).
- Accent spacing is 10 px (`mr-2.5`); separators stay `aria-hidden`.
- Tests: accent and meta render, falsy parts dropped, props pass through, eyebrow size class.

#### `StatusDot`

```ts
interface StatusDotProps {
  tone?: "on" | "off" | "warn";
  label?: ReactNode;
  title?: string;        // dot-only becomes role="img" with aria-label
  pulse?: boolean;       // warming states; motion-gated, static under reduced motion
  className?: string;
}
```

- `on`: filled accent hi. `off`: 1 px ring in `text-text-subtle`. `warn`: filled
  `state-warning-text`.
- Forced colors: the dot gets a `CanvasText` border so filled vs ring survives; `on` uses
  `Highlight`.
- No new tones. "never", "unknown" and "idle" map to `off` with a word.

#### `StatNumber`

```ts
interface StatNumberProps {
  value: ReactNode;                 // pass <span ref={…} /> for count-up or spring writes
  unit?: ReactNode;                 // mono 10.5px text-subtle on the same baseline
  label?: ReactNode;                // mono label
  labelPosition?: "above" | "below";// default "below"; "above" for dl/legend layouts
  size?: "sm" | "md" | "lg" | "xl";
  align?: "start" | "center";
  as?: "span" | "dd" | "div";
  className?: string;
}
```

- Sizes and weights per 1.2.2 (`lg`, `xl` weight 800, leading .85, `tracking-numeral`) [D8].
- `tabular-nums` always. Values that update often are written to the inner span through a ref; the
  component never re-renders per frame.
- Tests: each size, unit inline, label above and below, `dd` element.

#### `HairlineList` / `HairlineRow`

```ts
interface HairlineRowProps extends Omit<LiHTMLAttributes<HTMLLIElement>, "children"> {
  index?: number;          // zero-padded mono index, 2.4ch to 3ch
  trailing?: ReactNode;    // fixed-ch mono meta or a StatusDot
  muted?: boolean;         // title in text-subtle
  active?: boolean;        // 2px accent-hi bar at the left edge + from-accent-action/8 wash
  truncate?: boolean;      // default true; false for multi-line rows or nested content
  asChild?: boolean;       // the single child (Link or button) fills the row, min-h 32px (44 coarse)
  children: ReactNode;
}
```

- `HairlineList` gains `ruled?: boolean` (default `true`): a top rule (`border-t
  border-border-quiet`) above the first row.
- Hover: `bg-accent-action/4`. Active bar animates `scaleY(0 → 1)` in 250 ms `ease-snap`.
- Rows that need columns use a grid on the child with fixed `ch` widths; the row never becomes a
  table. Three or more comparable columns use the table recipe (5.5).
- Tests: active state, `asChild` link fills the row, `truncate={false}`, pass-through props.

#### `CratePill` and `CrateChip`

```ts
interface CratePillProps {
  children: ReactNode;
  variant?: "toggle" | "action" | "static"; // toggle emits aria-pressed; action does not
  active?: boolean;                         // toggle only
  onClick?: () => void;
  disabled?: boolean;
  icon?: ComponentType<{ size: number }>;
  className?: string;
}
```

- Recipe: `min-h-8` (32 px, 44 on coarse pointers), `px-3`, hairline border, transparent, mono
  `text-label` `tracking-chip`, `text-text-muted`. Hover: `text-text-primary`,
  `border-accent-action-hi/40`. Pressed (`aria-pressed="true"`): `bg-accent-action-hi`,
  `text-accent-action-hi-foreground`, border accent hi. Press `scale(.95)` with
  `ease-spring-snappy` (longhand), off under reduced motion. Focus: global outline.
- Group: `role="group"` with `aria-label`, `flex flex-wrap gap-2`; on mobile one horizontally
  scrolling row with the edge padding trick. Roving tabindex optional for long groups.
- Listen: `data-slot="chip"` exempts it from the radius pin [D2].
- `CrateChip` is the static tag: `rounded-full`, hairline, `px-2 py-0.5`, mono `text-badge`.
  Accent tag variant: `border-accent-action-hi/40 text-accent-action-hi`. Step chips (release rail)
  use it.
- `badge-policy.test.ts` forbids `uppercase`, `tracking-*`, `text-accent-action` and `rounded-full`
  on `CratePill`/`CrateBadge` call sites; uppercase copy comes pre-cased from i18n or uses
  `MonoLabel`.

### 2.3 New shared primitives

All four are used by both apps in their first change, which satisfies the placement rule. First
adopters (implementation plan Tasks 1.7 to 1.10):

| Primitive | Listen | Admin |
| --- | --- | --- |
| `InstrumentPanel` | `SettingsPrimitives.Section` | System "Resources" panel |
| `Meter` | Offline storage | System transcoding usage |
| `Readout` | EQ panel trail | `GenreEqEditor` status line |
| `ProgressHairline` | Upload byte progress | Tasks progress, `ScanProgress` |

There is no `LegendStrip`: legends are a `dl` of `StatNumber size="sm"` with `MonoLabel` `dt`s
written in the instrument (Listen) or a `StatStrip` (Admin, 2.5).

#### `InstrumentPanel`

```ts
interface InstrumentPanelProps {
  label: { accent?: ReactNode; meta?: readonly (string | null | false | undefined)[]; children?: ReactNode };
  meta?: ReactNode;          // right-hand label: technical meta (versions, limits, "updated 12 s")
  status?: ReactNode;        // right-hand live status (StatusDot + text); rendered in an aria-live="polite" region
  summary?: string;          // figure aria-label: one sentence with the real numbers
  ruled?: boolean;           // top rule, default true
  as?: "figure" | "section";
  headingLevel?: 2 | 3;      // when the left label is the section heading
  children: ReactNode;
  className?: string;
}
```

- Markup: `<figure aria-label={summary}>` with `pt-5.5 border-t border-border-quiet`, `@container`
  (`container-type: inline-size`), header `flex flex-wrap items-baseline justify-between gap-x-6
  gap-y-2`, then children. Children are styled narrow-first (1.3.3) so the panel still works where
  container queries are missing.
- The status slot only changes on state transitions (not per frame) so `aria-live` stays quiet.
- Replaces Admin `OpsPanel`, `Card` panels, Listen `SettingsPrimitives.Section`, Stats cards.
- Tests: summary label, ruled toggle, status region `aria-live`, heading level.

#### `Meter`

```ts
interface MeterProps {
  value: number | null;      // 0..max; null renders "n/a" with no fill
  max: number;
  limit?: number;            // limit tick at limit/max
  over?: boolean;            // switches fill and value to state-warning and the label text to "over · max N"
  label: ReactNode;          // mono label
  valueText: string;         // formatted value for display and aria-valuetext
  thickness?: 1 | 2 | 3 | 4; // px
  valueRef?: Ref<HTMLElement>; // for spring writes; aria values updated once per sample
}
```

- Track `bg-border-quiet`, fill `bg-accent-action-hi` with `transform: scaleX(var(--v))`,
  `origin-left`; the `--v` custom property is written through a ref, never as React state per
  frame. Limit tick: 1 px `bg-text-primary`, 4 px above and below the track.
- `role="meter"` with `aria-valuemin`, `aria-valuemax`, `aria-valuenow`, `aria-valuetext`.
- Over state never relies on colour alone: the label text changes.
- Forced colors: track border `CanvasText`, fill `Highlight`, tick `CanvasText`.
- Row layout: `grid-template-columns: auto minmax(0,1fr) 5ch` (label, track, value).
- Tests: value and limit positions, over label, null, aria attributes.

#### `Readout`

```ts
interface ReadoutProps {
  children: ReactNode;          // visible mono line (may be scrambled, aria-hidden)
  announcement?: string;        // sr-only aria-live text, updated only on committed changes
  minWidthCh?: number;          // reserved width (default 12)
}
```

- Mono 11.5 px, `tracking-wide`, `text-text-muted`, `min-height: 1.4em`; reserved width so
  scrambles and hover previews never reflow.
- Hover previews update the visible line only; the announcement changes on commit (click, Enter,
  stream state change).

#### `ProgressHairline`

```ts
interface ProgressHairlineProps {
  value?: number;               // 0..1 determinate; omit for indeterminate
  label: string;                // accessible name
  valueText?: string;           // "42%", "07/17"
  thickness?: 1 | 2;
}
```

- Determinate: `role="progressbar"`, fill via `--p` ref write, `scaleX`.
- Indeterminate: the site Roadmap "building" bar (a 36% block moving over 2.4 s), only while
  visible and motion allowed; a static 36% block otherwise.
- Replaces shadcn `progress`, ad-hoc bars and in-panel spinners.

### 2.4 Shared lib modules

| Module | Exports | Ported from | Notes |
| --- | --- | --- | --- |
| `lib/motion-gate.ts` | `isMotionBlocked()`, `subscribeToMotionAvailability(cb)`, `useMotionAllowed()` | `app/listen/src/lib/motion-availability.ts` (DOM half) | checks `prefers-reduced-motion`, `data-crate-motion`, `document.hidden`; Listen wraps it with its preference store; Admin uses it directly [D9]. Lands in plan Task 0.7 |
| `lib/spring.ts` | `stepSpring`, `springsSettled`, `createSpringSet` | site `scripts/viz/eq-math.ts` | dt clamp from `loop.ts`. Lives in `domain/player/eq-morph.ts` (not exported) from plan Task 0.7; moves here in plan Task 4.3 (`EqGlyph`) or 3.5 (`GovernorGauges`), whichever lands first |
| `lib/use-visible-loop.ts` | `useVisibleLoop(ref, frame, { margin, enabled })` | site `scripts/viz/loop.ts` | IntersectionObserver plus `visibilitychange`; `frame` held in a ref so deps are `[ref, enabled]`; guards missing `IntersectionObserver` (jsdom). Created with its first importer (plan Task 3.4, `QueueLanes`), not in 0.7 |
| `lib/scramble.ts` | `scrambleText(el, text, ms)`, `useScramble(ref, text, opts)` | site `scripts/motion/scramble.ts` | WeakMap cancel; motion gate. Admin-local (`app/ui/src/lib/motion/scramble.ts`, plan Task 3.1) until plan Task 4.5 (Listen EQ trail, the first Listen consumer) moves it here; 4.6 (Stats top genre) then imports it |
| `lib/eq-curve.ts` | `gainToY`, `eqCurvePath`, `formatGain` (0.1 dB), band constants | `EqBands.tsx` inline helpers, site `eq-math.ts` | keeps `PlayerBar` from importing `EqBands`. Lands in plan Task 0.7 |
| `lib/use-eq-morph.ts` | `useEqMorph(refs, targetGains, { animate, draggingBand })` | site `eq-view.ts` render loop | rAF only until settled; skips the dragged band. Lives in `domain/player/eq-morph.ts` from plan Task 0.7; moves here in plan Task 4.3, when `EqGlyph` imports it directly |
| `lib/camelot.ts` | `toCamelot(key, scale)` with enharmonics (Db→C#, Eb→D#, Gb→F#, Ab→G#, Bb→A#) | `app/crate/camelot.py` (moved from `sm:app/crate/smart_mix/camelot.py`, 4.5) | shared JSON fixture with pytest |
| `lib/toaster-config.ts` | class names and durations for sonner | new | both apps mount their `Toaster` with it |
| `lib/read-css-color.ts` | `readCssColorToken` | exists | canvas and Nivo colours |

Each module ships with tests and lands in the change where both apps import it. Until then the
first consumer keeps a local copy (2.1 rule 2). After plan Task 0.7 only `motion-gate.ts` and
`eq-curve.ts` are new in `@crate/ui/lib`: `export-usage-policy.test.ts` checks every `lib/*`
export and follows `export … from` but not `import`, so a spring module that only `EqBands`
imports would read as unused. The spring helpers and `useEqMorph` therefore stay in
`domain/player/eq-morph.ts` until an app imports them directly.

### 2.5 App-local building blocks

Admin (`app/ui`):

| Block | Home | Notes |
| --- | --- | --- |
| `PageHeading` | `src/components/layout/PageHeading.tsx` | replaces `OpsPageHero` and seven ad-hoc `h1` recipes (5.2) |
| `StatStrip` | `src/components/admin/StatStrip.tsx` | 2 to 6 `StatNumber`s on hairlines; replaces `OpsStatTile`, Settings `StatTile`, Timeline `StatCard`; also the Admin legend recipe. Moves to `@crate/ui/primitives/StatStrip.tsx` in Listen's first adoption (Library stat strip, plan Task 6.14; product design 4.20), deleting the Admin copy in the same change |
| `RiskMeter` | `src/components/health/RiskMeter.tsx` | three 4×10 px segments, `gap-0.5`, off fg .14, on fg-2, plus the word (Safe, Needs review, Destructive) |
| `StepRail` | `src/components/admin/StepRail.tsx` | horizontal rail with stages, `--p` progress, vertical under 900 px container; release rail, setup, key rotation. Stages are drawn only for phases a handler actually emits. Moves to `@crate/ui/domain/tasks/StepRail.tsx` in Listen's first adoption (Upload phase rail from the `library_upload` phases `preparing`, `importing`, `syncing` emitted through `TaskProgress`; plan Task 6.15; product design 4.22), deleting the Admin copy in the same change |
| `AdminLiveProvider` + `useAdminLive(surface)` | `src/contexts/AdminLiveProvider.tsx`, `src/hooks/use-admin-live.ts` | one `/api/admin/live-stream` EventSource per tab (OpsSnapshotContext pattern); replaces six copies of the reconnect effect and `useSse`. Unlike `OpsSnapshotContext`, which keeps its stream open in hidden tabs, it closes the stream once `document.visibilityState` has been `hidden` for 30 s and reopens it (with a GET of each mounted surface) on `visible`, so a background tab stops renewing viewer keys (3.9) |
| `nivoTheme` | `src/lib/nivo-theme.ts` | token-resolved theme (3.7); replaces 3 `NIVO_THEME` constants (`AudioProfileCard.tsx:30`, `ArtistStats.tsx:9`, `Insights.tsx:67`) and 6 inline `theme={{…}}` objects (`TrackTable.tsx:647`, `ArtistStats.tsx:237`, `Dashboard.tsx:1080,1124,1177`, `SystemHealth.tsx:483`); the task lists all nine |
| `useAutoFollowScroll` | `src/hooks/use-auto-follow-scroll.ts` | sidecar JSON and Logs console; yields on wheel, pointer or key |

Listen (`app/listen`):

| Block | Home | Notes |
| --- | --- | --- |
| `CountUpNumber` | `src/components/stats/CountUpNumber.tsx` | exists; add a duration prop |
| `lib/sound-map/*` | `src/lib/sound-map/` | projection, cloud decode, scene math for Radio and Paths |
| `components/sound-map/*` | `src/components/sound-map/` | WebGL2 point field and 2D fallback |
| equalizer live store | `src/lib/equalizer-live-store.ts` | published by the EQ runtime, read by the EQ glyph |
| `useNowCell` | `src/components/stats/heatmap-model.ts` | hour-aligned timer for the heatmap "now" cell |

---

## 3. Instrument panel anatomy

### 3.1 Shell

```
InstrumentPanel (figure, top rule, pt 22px, container)
├── header row
│   ├── left:  MonoLabel  accent="<Key word>"  meta=["plain description", …]
│   └── right: meta (technical) and/or status (StatusDot + text, aria-live)
├── body (numerals, plot, rows, rail, readout)
└── footer (optional): legend (dl), actions as chips, provenance
```

- Left label: key word in accent hi plus a plain-language description (`EQ · 10 bands · ±12 dB ·
  21 presets`).
- Right label: technical meta (`crate-core 1.0.0 · ed25519`, `updated 12 s`, `sampled 6 s ago`) or
  the live status.
- Free-floating panels (orbit, mood map, federation) may drop the top rule; they keep the header.
- Boxed objects inside a panel (ticket, terminal, JSON) use the object card (1.6).

### 3.2 Body recipes

| Recipe | Spec |
| --- | --- |
| Numerals | `dl` grid; `dt` = `MonoLabel`, `dd` = `StatNumber` with inline unit; label above (totals) or below (scale figures); optional per-figure top hairline with `pt-3` |
| Legend | `dl` grid with a top rule, `pt-4.5`, `gap-3`; `dt` = `MonoLabel` upper `text-text-subtle`; `dd` = `StatNumber size="sm"`. Admin uses `StatStrip` (2.5). Swatch legends (inline key plus text) are written inline in the instrument |
| Y scale | list beside the plot, mono 10.5 px `.06em` `text-text-subtle`, `justify-between`, 52 px column (34 px under 760 px container) |
| X labels | grid with the data's column count; value in display 700 above, band in mono below |
| Grid lines | rows `border-quiet`, columns fg .04, zero line fg .22 dashed `2 4`; hour axis prints every 6th label |
| Axis titles | mono 10.5 px `.14em` upper `text-text-subtle` with an arrow (`valence →`); vertical title rotated from the top-left |
| Annotated band | top hairline fg .18, fill fg .025, labelled with `MonoLabel` (`night 22–05 · 31%`) |
| Readout | `Readout` (2.3): one mono line narrating state (`Peak Saturday 23:00 · 412 min`) |
| Meters | `Meter` (2.3); row meter `auto 1fr 5ch` |
| Rows | `HairlineList`; active/scanning row = 2 px accent-hi bar plus `from-accent-action/8` wash to transparent at 70%; hit row = `border-l-2 border-accent-action-hi` plus `/10` wash |
| Chips | `CratePill` group (2.2) |
| Process chip | 20 px pill, mono 10 px, accent-hi .40 border, progress fill `linear-gradient(90deg, accent .28 var(--p), canvas .92 var(--p))`; governed = dashed; deferred = amber border and text; done = hairline, `text-text-subtle` |
| Verdict pill | mono 10 px `.12em` upper; ok = accent-hi .50 border; no = amber .50 border |
| Step rail | `StepRail`: `::before` hairline, `::after` accent hi `scaleX(var(--p))` `ease-out-expo` 600 ms; 13 px dots (done filled accent hi, active `scale(1.35)` with a 6 px accent .14 halo); inactive text never dimmed below fg-3 (only dots and lines dim) |
| Bipolar CSS bars | grid of N columns; each bar `::after` from the centre line, `scaleY(calc(var(--g) / -12))` (EQ) or `scaleY(clamp(-1, var(--v), 1) * -1)` (bliss, values in −1..1); one custom property per bar written through a ref |
| Object card header | `px-4.5 py-3 border-b border-border-quiet`, `MonoLabel` left and right |
| Ticket | object card with mask notches (4.6), dashed perforation, 40 px accent play disc |
| Terminal | chrome row with three 9 px ring dots fg .25 and the host label; screen mono 13/1.75 `text-text-subtle`; prompt accent hi; caret only while typing |
| JSON tokens | keys and numbers fg, strings accent hi, comments fg-3 italic, punctuation fg-3; indent `calc(depth * 2ch)`; highlighted line `from-accent-action/10` |

### 3.3 SVG graph styling

- Nodes: knock-out fill (`fill="none"` with edges clipped at the node radius, or the canvas token
  through an attribute; `fill: var(--surface-*)` in CSS is a drift role violation), stroke fg .45,
  1.25; r 5.5 (family), r 3.5 (children). A node that owns data (own EQ preset) is filled fg .55
  with no stroke.
- State classes toggled through a ref map (never React state per hover), transitions 300 to
  400 ms `ease-snap`, radius changes `ease-spring-snappy` (longhand):

| Class | Visual |
| --- | --- |
| `is-path` | stroke accent hi, 2 |
| `is-from` | fill accent hi (source of an inherited value) |
| `is-start` | r 6 |
| `is-on` (edge) | parent: accent hi 2.25; related: accent hi .32 |
| `is-active` | stroke accent hi; node fill `surface-accent-active` |
| `is-done` | fill accent hi (near) or fg-2 (far) |
| `is-past` | stroke accent hi .45 |

- Edges: parent = cubic through the mid radius; related = quadratic pulled to 18% of the midpoint
  offset; fallback = dashed `4 5`; "never" = dashed `2 6` with an X mark.
- Labels in SVG: mono 10 px `.04em` `text-text-subtle`, radial and flipped past 180°; family labels
  11.5 px `.1em` upper `text-text-muted`. Labels over SVG in HTML use percentage positions of the
  viewBox, side-aware transforms, a halo text-shadow and `pointer-events: none`; positions are
  written through refs or computed into class-free attributes, not `style={{}}` per node.
- Centre readout: display 800 40 px plus a mono 10.5 px sub-label.
- Paths never animate `d` (Safari): old and new edges crossfade; new edges draw with `pathLength`.

### 3.4 Live indicators and states

Vocabulary in the header status slot (mono, `StatusDot` plus text):

| State | Status slot | Body |
| --- | --- | --- |
| live | `StatusDot on` "live" or a domain word ("Mixing", "Scanning 07/17") | animates real transitions |
| fresh, idle | meta `updated 12 s` / `sampled 6 s ago` in `text-text-subtle` | static |
| stale (past the surface threshold) | `StatusDot warn` "stale · 4 min" | last values, frozen |
| warming (no snapshot yet) | `StatusDot warn pulse` "building" | reserved geometry with `—` |
| reconnecting | `StatusDot warn` "reconnecting" | last values kept |
| offline (Listen) | mono `OFFLINE` with a ring dot | cached data; disabled actions explain why |
| error | `StatusDot warn` and a ghost Retry chip | last data kept if any; otherwise compact `ErrorState` |
| empty | none | one mono readout, one `text-text-muted` sentence, at most one CTA, geometry kept |
| partial | none | render what exists; `—` with a `title`; never hide the whole panel |
| loading | none | final layout with `—` numerals and idle marks (fg .05); no spinner, no shimmer; sr-only `role="status"` |

Rules:

- Stale and warming are computed from the server's `snapshot` block (`built_at`, `stale`,
  `pending`) plus a client clock using server time or `age_seconds`, never `Date.now()` against a
  server timestamp alone (clock skew).
- "stale" is amber only past the surface's own threshold (per catalogue entry). A healthy idle
  writer must refresh its row on a floor cadence so "stale" means "writer stalled". Demand-gated
  writers (3.9) check the viewer key once per second (one Redis `EXISTS`), independent of their
  idle cadence, and sample as soon as it appears, so a new viewer gets a fresh sample within about
  a second and the threshold is measured against the watched cadence; until the first live message
  arrives after the initial GET, an old payload reads "updating", not amber "stale".
- A visual never opens its own stream; the page or a context does (3.8).

### 3.5 Renderer choice

| Marks | Renderer | Examples |
| --- | --- | --- |
| Regular cells, rows, bars, meters, text | HTML/CSS | heatmap (168 cells), gauges, health rows, readouts, ticket, lanes |
| Up to a few hundred marks needing crisp text, focus, hit areas or CSS state | SVG | genre wheel (about 300 elements at 61 nodes), EQ curve, crossfade strip, orbit, federation, system map, path route |
| About a thousand soft points with additive glow | Canvas 2D with pre-rendered sprites, DPR capped at 2 | mood map (up to 1,500 points, 700 on mobile) |
| More than about 10K points or shader effects | WebGL2, lazily created, context loss handled, always with a non-WebGL fallback | sound map for Radio and Paths (14K desktop) |
| Standard statistical charts | Nivo | Insights bars and scatter, System metric streams, BPM histogram |

- Instruments are hand-built; standard charts use Nivo. This needs the rule amendment [D1] in
  `AGENTS.md:69`, `app/ui/AGENTS.md:28`, `app/listen/AGENTS.md:60` and `app/shared/AGENTS.md`.
  Precedents: `EqBands` (shared, SVG) and Listen `components/stats/*`.
- Listen should not adopt Nivo for an instrument: its first import creates a `stats-vendor` chunk.
- Mobile WebGL at 6K points is a declared exception to the 10K threshold; measure on a mid-range
  Android device and allow a 4K step on low-memory devices. `navigator.deviceMemory` exists only in
  Chromium (it is `undefined` in iOS and macOS WKWebView and in WebKitGTK), so the step is: 4K when
  `deviceMemory <= 4`; when `deviceMemory` is `undefined`, 4K on coarse-pointer or mobile runtimes
  (Capacitor iOS included) and otherwise when `hardwareConcurrency <= 4`. A unit test covers the
  missing-API case.

### 3.6 SVG and canvas mechanics

- Fixed `viewBox`, geometry as SVG attributes (`d`, `x`, `cx`, `transform`) with
  `vector-effect="non-scaling-stroke"`. `style={{}}` only for static values with no attribute
  alternative (it counts against the drift ceiling).
- HTML marks placed over a stretched SVG (`preserveAspectRatio="none"`) so they do not deform;
  their first position is written in `useLayoutEffect`, never with a CSS transition on `top`.
- Width-dependent SVG rebuilds from `ResizeObserver`, rounded to integer pixels.
- Canvas: DPR capped at 2, size from `ResizeObserver`, colours from `readCssColorToken`, sprites
  regenerated on theme change, `globalCompositeOperation: "lighter"` only on dark skins.
- WebGL: one context per screen, `webglcontextlost`/`restored` handled, `WEBGL_lose_context` on
  unmount, colours as uniforms read from tokens, static fallback on loss, `effects=off`, reduced
  motion or no WebGL2.

### 3.7 Nivo theme

- One token-resolved theme per app (`app/ui/src/lib/nivo-theme.ts`; Listen only if it adopts Nivo),
  resolved with `readCssColorToken` at mount and on appearance change. Nivo colour modifiers break
  on `var()`.
- Grid in `border-quiet`, no domain lines, mono 10 to 11 px ticks in `text-subtle`, crosshair accent
  hi, tooltip as an object card, area fill at most .08, series accent hi / accent / fg steps.
- `animate={!reducedMotion}`.
- No pies (proportional hairline bar plus mono legend) and no radars (feature bars, 4.5) in v3.
- Small multiples on hairline separators instead of filled cards.

### 3.8 Performance rules

1. **Lazy.** Every instrument sits behind a lazy boundary (`React.lazy` route, a lazy surface such as
   `lazy-player-surfaces.tsx`, or a dynamic import on first visibility). Never from the shell,
   providers, layout or Home's eager path. Add an assertion to `AppRouter.bundle.test.tsx` when a
   heavy surface gets its own boundary.
2. **Mount on visible.** Panels below the fold fetch on first visibility when the data is not
   needed above it.
3. **One loop per visual.** A single rAF loop per visual (never per mark), started only while
   intersecting, the document visible, motion allowed and something unsettled. `dt` clamped to
   50 ms. Animate by `dt`, never frame count (iOS Low Power Mode runs at 30 fps). Elapsed-time
   text uses a 1 s timer, not the loop (1.8.4); idle states render one static frame. Each
   instrument with a loop has a test that the loop stops after settle while its data stays live
   (for example, a task still running).
4. **Refs for per-frame values.** Per-frame values (springs, clocks, progress, analyser data) live in
   refs and typed arrays. Writes go to `transform`, `opacity`, custom properties consumed by
   `transform` (`--v`, `--g`, `--p`), SVG attributes, or a text node only when the formatted string
   changes. No `setState` per frame.
5. **Effect dependencies.** Effects that open an `EventSource`, socket, timer or fetch depend only
   on connection identity (URL, query, capability booleans). Never on payloads, `currentTime`,
   `duration`, `isPlaying` or progress. `react-hooks/exhaustive-deps` is off in both apps, so
   reviewers check dependency arrays by hand and tests assert that a stream opens once across N
   payload updates.
6. **Stream ownership.** The page or a context owns the stream (`OpsSnapshotContext`,
   `AdminLiveProvider`, Listen snapshot streams, `/api/cache/events`). A visual receives the latest
   payload as a prop; a new payload only re-targets springs held in refs.
7. **Discrete state.** Discrete state (verdicts, selections, stale flags) can use
   `useSyncExternalStore` on a small external store; continuous values are written imperatively.
   Never both on the same DOM node: React-managed text nodes are not written by refs.
8. **Player time.** `usePlayer()` re-renders every tick and is reserved for full player surfaces.
   Visuals read the playhead in their loop from a ref fed by a `usePlayerProgress()` leaf or engine
   events. Do not copy `use-audio-visualizer.ts` (setState with 1024-float arrays at 20 fps) or
   `use-crossfade-progress.ts` (setState every frame); both are fixed separately (6.10).
9. **Memo and pure math.** Visuals are `memo`ed with stable props; layout math lives in pure modules
   with table-driven tests and `useMemo` keyed by data revision.
10. **Budgets.** Listen initial JS stays under 300 KB gzip (`check:bundle`); no new runtime
    dependency for visuals (no gsap, lenis, motion libraries); no new font weights.

### 3.9 Data rules for instruments

- Read precomputed payloads: `ui_snapshots` warmed by `crate-projector` or a deduplicated worker
  task, `ops_runtime_state` rows written by a service loop or sampler, Redis runtime keys, task
  events (`/api/events/task/{id}`), domain events.
- Serve stale and schedule (`db/instance_stats_dashboard_surface.py` pattern): fresh row returns,
  stale row returns with `snapshot.stale=true` and schedules a deduplicated refresh, missing row
  returns a cold placeholder (`snapshot {version: 0, stale: true, pending: true}`, the repo's cold
  convention) and schedules. Never `get_or_build_ui_snapshot` in a request; never `?fresh=1`.
- SSE generators read through `asyncio.to_thread` and never build.
- Pydantic response models must declare the `snapshot` block and every field the client reads;
  undeclared fields are dropped by FastAPI while the Go read plane relays raw snapshots, so the two
  diverge silently.
- Admin surfaces stay on FastAPI (permission parity, low traffic). Listen surfaces use the Go read
  plane where a route exists.
- One Admin stream per tab: `GET /api/admin/live-stream?surfaces=…` (contract in product design
  5.3.1), owned by `AdminLiveProvider`. Every Admin instrument in section 4 consumes its surface
  from the provider: no per-instrument stream, no polling fallback. Stack and New Releases keep
  their existing stream routes, made read-only. The name is a convention only: Traefik sends just
  the listed GET prefixes to the read plane (`docker-compose.yaml:460-478`) and `/api/admin/*`
  goes straight to crate-api.
- Demand signal. Viewer keys are `admin:live:viewers:<surface>` (`EX 60`), written through
  `app/crate/admin_viewers.py`. The live stream sets them for each allowed surface on connect and
  on every 30 s heartbeat; the routes that keep their own stream or poll set theirs the same way:
  the tasks stream (`tasks`), the acquisition stream (`acquisition`) and the Stack snapshot and
  stream endpoints (`stack`, 4.22). Samplers and writers that exist only for the UI (governor,
  Redis, acquisition, event pipeline, queue lanes, stack) use their fast cadence only while their
  key exists and drop to an idle cadence (or stop) otherwise; each entry states both. Whatever the
  idle cadence, they check the key once per second (one Redis `EXISTS`), so a new viewer gets a
  fresh sample within about a second. Test per sampler or writer: when the key appears, the next
  sample arrives within about 1 s.
- A viewer is a visible tab. `AdminLiveProvider` (2.5), and every other client that marks a
  viewer, closes its stream once the tab has been hidden for 30 s and reopens it on `visible`, so
  a background tab never renews a key. The Dashboard does not subscribe to the fast surfaces
  (`queues`, `governor`): queue sums come from the ops snapshot (`worker_live.queue_breakdown`
  already holds per-queue running and pending) and the governor word from
  `GET /api/admin/governor` (Redis key, then the persisted row), re-read at most once per 60 s
  while visible. Otherwise the Admin landing page left open in a background tab would keep the 5 s
  governor sampler and the 3 s lane rebuilds running for good. Tests: a tab hidden for more than
  30 s stops renewing viewer keys; the Dashboard never sets `admin:live:viewers:queues` or
  `admin:live:viewers:governor`.
- Acquisition sampler (`/download` lanes, product design 4.4, B9): its own thread with a 2 s slskd
  timeout, never a step of the serial service loop (a 10 s slskd call would stall the scheduler and
  zombie cleanup). Every 2 s only while `admin:live:viewers:acquisition` exists; without viewers,
  every 30 to 60 s while transfers are active (enough to keep `ops_runtime_state('acquisition')`
  and the lifecycle reconciler current), and not at all otherwise. Test: with no viewer and an
  active transfer, at most one slskd call per 30 s.
- Runtime-only samples (governor, Redis, acquisition, pipeline, stack) live in a Redis key with a
  TTL plus a publish. They are persisted (`ops_runtime_state`; `ui_snapshots('ops:stack','global')`
  for the stack) only when the verdict or state changes, or at most once per 60 s. Endpoints read
  the Redis key and fall back to the persisted row. Tests per sampler: no DB write and no external
  call (slskd, Docker, `/proc` beyond the idle cadence) while idle; the cadence switches when the
  viewer key appears.
- No provider calls in a request (V7, B20). An endpoint that needs third-party data reads a cache
  in one `MGET` or `= ANY(:keys)` query and returns hits only; misses enqueue one deduplicated
  fast task (batched, 3 s provider timeout, positive and negative results cached with a TTL), and
  results arrive through `publish_task_signal` or a later re-request. Example: the `/download`
  covers (today `Download.tsx` calls Last.fm `album.getinfo` once per search result) become
  `POST /api/acquisition/covers {items: [{artist, album}]}` (at most 50), keyed by normalised
  `(artist, album)`; moving the per-result call into a handler as is would put N synchronous
  provider calls on the API threadpool that also serves the Listen fallback routes. Tests: the
  endpoint makes zero HTTP calls (provider client patched to raise), and misses enqueue a single
  task.
- Coalescing is trailing-edge, and the due time lives in Redis, not in a `tasks` row. A trigger
  runs `ZADD NX crate:coalesce:due <now + window> <key>` (a no-op while the key is already due).
  The crate-worker service loop drains due keys on each tick (`ZRANGEBYSCORE … -inf <now>`, then
  `ZREM`), or the projector loop for refreshes the projector schedules, and only then calls
  `create_task_dedup`; if that build is still running, the drain re-adds the key at
  `now + window`. A trigger that arrives during a build adds a new due entry, so the last change
  of a burst is always built. A Dramatiq message sent with `delay=window` does not work: its
  `pending` task row exists from the first trigger, and the service loop runs
  `redispatch_stale_pending_tasks(age_seconds=300)` every 60 s (`worker.py:328-333`,
  `db/repositories/tasks_maintenance.py:174`), which re-dispatches any pending row older than
  300 s with no delay. Every window above 300 s (mood map 900 s, insights 30 min, bliss map 6 h)
  would collapse to about 5 minutes, and the delayed message would later fire a second build. If a
  pending row must exist, it carries a `not_before` and the redispatcher adds
  `AND (not_before IS NULL OR not_before < now())`. `schedule_instance_stats_dashboard_refresh`
  (`db/instance_stats_dashboard_surface.py:190-198`) is leading-edge (it drops triggers inside the
  window) and is not the pattern to copy either. Tests per coalesced refresh: a burst of N triggers
  inside the window produces exactly one build after the window, and that build reflects the last
  trigger; a refresh with a 900 s window is not dispatched at 360 s (after the redispatcher has
  run).
- Internal task types use two `TaskTypeInfo` flags (product design 5.3.3, plan Conventions):
  `notify=False` skips `notify_task_completed` (`actors.py:821` calls it for every completed task
  and Telegram sends whenever it is enabled); `quiet=True` also skips the tasks-surface signal,
  the `crate:sse:global` publish and default visibility in history and lanes. Every `refresh_*`
  and `build_*` type is `quiet=True`; every `backfill_*` type and `compute_music_path` is
  `notify=False` (registration, section 4 intro).

### 3.10 Accessibility rules

- Each panel has an `aria-label` sentence with the real numbers ("17 health checks. 39 open
  issues: 21 fix on their own, 18 wait for review. Last scan 3 hours ago.").
- Decorative SVG, canvas and duplicated labels are `aria-hidden`; the accessible equivalent is a
  real list, table, `dl` or readout. Do not put `role="img"` on an SVG that contains interactive
  children.
- Interactive marks are real buttons or links, or `<g role="button" tabIndex={0}>` with an
  `aria-label`; groups use roving tabindex (arrow keys, Home, End), Enter pins, Escape clears
  (`useEscapeKey` from `@crate/ui/lib/use-escape-key`).
- `aria-live="polite"` only for committed state changes, throttled (at most one announcement per
  5 s for streams). Never announce per row, per sample or per hover.
- Colour is never the only signal (1.1.3).
- Focus visible on every interactive mark (1.9.5); 44 px targets on coarse pointers (invisible hit
  circles of r 14 for small nodes).
- Forced colors: fills disappear, so chips, dots, meters, bars and active marks keep a border
  (`CanvasText`) and the active mark uses `Highlight`.
- Route changes (both shells): once the page transition ends, focus moves to the page `h1`
  (`tabIndex={-1}`) and the title is announced through one polite region; under reduced motion
  focus moves immediately. Both shells render a skip link to the main region as their first
  focusable element. Covered by the shell tests (implementation plan Tasks 3.2 and 4.1).

### 3.11 Runtime matrix

| Runtime | Engine floor | WebGL2 | `linear()` | Live analyser | Notes |
| --- | --- | --- | --- | --- | --- |
| Web (Listen PWA, Admin) | evergreen; Tailwind 4 needs Safari 16.4 | yes | yes | Listen web/desktop only (Gapless-5, one analyser per song, pre-EQ) | |
| iOS Capacitor | WKWebView, target 15.0 today (`Podfile`, `project.pbxproj`); 16.4 proposed [D11] | yes | 17.2+ | no (stable pipeline) | Low Power Mode 30 fps; below 16.2 no `color-mix` fallback, below 16 no `cqi`, container queries or subgrid |
| Android Capacitor | System WebView, minSdk 24 | GPU-dependent | current WebView yes | no (stable pipeline, native engine) | `check:bundle` runs on this build only |
| macOS Desktop | WKWebView, macOS 11 | yes | 17.2+ | yes | `backgroundThrottling: "disabled"` |
| Windows Desktop | WebView2 111 | yes | no at floor | yes | no subgrid (Chrome 117) |
| Linux Desktop | WebKitGTK 2.40 (AppImage 2.50.4) | host GL | no at 2.40 | yes | GTK accent override [D17] |

Mobile visuals are data-driven (analysis fields, mix profiles, snapshots, the worker-built Cast
spectrum artefact), never analyser-driven.

---

## 4. Visualisation catalogue

Each entry is a component spec for one product visual with the verified corrections applied (the
analysis mapping cards are not in the repository and are not a source; see the header). Two
pairs of site visuals were merged because they target the same surface: the Inside heatmap tile
plus the listening heatmap (4.7), and the Inside path tile plus the paths dive (4.8). Backend
detail beyond what is listed lives in `backend-admin.md`, `backend-listen.md` and `genres.md`;
where they differ, the entry below is authoritative. Data contracts (TypeScript shapes, endpoints,
events) are owned by the product design; where an entry and the product design disagree on a
contract, the product design wins and the entry points to it.

Common rules for every entry (not repeated): sections 3.4 to 3.10 apply; Listen copy goes through
the 7 catalogs; Admin uses `lucide-react` and `sonner`, Listen `@crate/ui/icons` and `notify`;
"if you touch it, you test it" (pytest per changed public function, Vitest + Testing Library,
Go table tests); new Admin pages get a page-level `*.test.tsx`; migrations are numbered against
`main`, which is canonical: a migration takes `main`'s head + 1 when it merges (`108` today), and
whichever branch is still unmerged renumbers its own revisions and `schema_sections/*_vNNN.py`
files each time it merges `main` (`smart-mix-phase-1` defines 109 to 114 and keeps adding; it
already merges `main` regularly), using a renumber script plus an `alembic stamp` recipe for the
dev and lab databases already at 114 ([D19]). Each migration puts its DDL in an immutable
`schema_sections/*_vNNN.py` and updates the head test in `tests/test_crate_schema_definition.py`.
New task types are registered in five places: `actors.py` (`TASK_POOL_CONFIG`),
`task_registry.py`, a `*_TASK_HANDLERS` dict, the handler table in `worker.py`, and the
`TaskTypeInfo` flags `notify` and `quiet` that `actors.py` checks (3.9): every new `refresh_*` and
`build_*` type is `quiet=True`, every new `backfill_*` type and `compute_music_path` is
`notify=False`, both sets asserted in `test_task_runtime_contract.py`. New task types require
regenerating the site's `scale.json` (6.5). Behaviour changes are marked
"Behaviour change" in the entry and listed in product design 3.4.2.

### 4.0 Index

| # | Component | Site source | App | Home | P | E | Blocked by |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 4.1 | `EqBands` curve chart | `viz/EqViz.astro` | both | `@crate/ui/domain/player` | P0 | M | rule amendment [D1] |
| 4.2 | `EqGlyph` | `InsideCrate.astro` EQ tile | Listen | `app/listen/src/components/player` | P0 | M | 4.1 math |
| 4.3 | `GenreWheel` | `viz/GenreWheel.astro` | Admin, then Listen | `app/ui/src/components/genres` | P0 | L | wheel snapshot plus G1, G2, G3, G7 (plan 2.18a–e, all before the wheel) |
| 4.4 | `GenreEqWalk` | `viz/GenreWheel.astro` panel | both | `@crate/ui/domain/genres` | P0 | M | resolver `path` |
| 4.5 | `TrackReadout` | `viz/TrackReadout.astro` | both | `@crate/ui/domain/analysis` | P1 | L | V3 fix for `/analysis` live |
| 4.6 | `SetlistTicket` | `viz/Setlist.astro` | both | `@crate/ui/domain/shows` | P1 | M | setlist match in worker |
| 4.7 | `ListeningHeatmap` | `viz/Heatmap.astro`, Inside tile | Listen (Admin phase 2) | `app/listen/src/components/stats` | P0 | M | `snapshot` schema fix |
| 4.8 | `PathRouteMap` | `listen/PathsDive.astro`, Inside tile | Listen | `app/listen/src/components/paths` | P1 | L | `music_paths.plan_meta` and the planning task route (B18) |
| 4.9 | `RadioSessionMap` | `listen/RadioDive.astro` | Listen | `app/listen/src/components/radio` | P1 | L | session explain, bliss map |
| 4.10 | `MoodMap` | `viz/MoodMap.astro` | Listen | `app/listen/src/components/explore/mood-map` | P1 | M | mood snapshot (fixes a hot-path violation) |
| 4.11 | `TransitionStrip` | `viz/MixViz.astro` | Listen | `app/listen/src/components/player/mix` | P2 | L | `smart-mix-phase-1` merge [D19] |
| 4.12 | `DeviceConstellation` | `viz/Devices.astro` | Listen | `app/listen/src/components/devices` | P2 | M | Connect presence fixes; build flag [D28] |
| 4.13 | `AccessTokensSection` | `viz/TokenAllowlist.astro` | Listen | `app/listen/src/components/settings/access-tokens` | P2 | M | `smart-mix-phase-1` merge |
| 4.14 | `HealthScan` | `viz/HealthScan.astro` | Admin | `app/ui/src/components/health` | P0 | L | health surface backend |
| 4.15 | `HealthScanTile` | `InsideCrate.astro` health tile | Admin | `app/ui/src/components/health` | P0 | M | 4.14 surface |
| 4.16 | `PortableMetadataPanel` | `viz/AlbumSidecar.astro` | Admin | `app/ui/src/components/album/portable-metadata` | P1 | M | sidecar state migration |
| 4.17 | `ReleaseRail` | `viz/ReleaseTimeline.astro` | Admin | `app/ui/src/components/acquisition` | P1 | L | release lifecycle columns, V6 |
| 4.18 | `EnrichmentOrbit` | `viz/EnrichmentOrbit.astro` | Admin | `app/ui/src/components/artist/enrichment` | P2 | L | per-source state, V7 |
| 4.19 | `QueueLanes` | `viz/QueueLanes.astro` | Admin | `app/ui/src/components/ops` | P0 | L | queues surface, `/tasks` fan-out fix |
| 4.20 | `GovernorGauges` | `viz/GovernorGauges.astro` | Admin | `app/ui/src/components/ops` | P1 | M | governor sampler, V1, V2, V8 |
| 4.21 | `FederationTopology` | `viz/Federation.astro` | Admin | `app/ui/src/components/federation` | P2 | L | approve bugfix (ship first) |
| 4.22 | `StackMap` | `architecture/SystemMap.astro` | Admin | `app/ui/src/components/ops/stack-map` | P1 | L | stack sampler, action policy |
| 4.23 | `EventPipelinePanel` | `viz/OutboxSequence.astro` | Admin | `app/ui/src/components/ops/event-pipeline` | P2 | M | `list_domain_events` bug |
| 4.24 | `RedisPair` | `viz/RedisPair.astro` | Admin | `app/ui/src/components/ops/redis-pair` | P2 | M | Redis sampler |

Admin folder convention: domain folders only (`components/{health,ops,genres,analysis,acquisition,
federation}`, `components/album/portable-metadata`, `components/artist/enrichment`); there is no
`components/viz`. Cross-page building blocks (`StatStrip`, `StepRail`) live in
`components/admin`, page chrome (`PageHeading`) in `components/layout`.

"Blocked by" lists dependencies, not an order. The order is the implementation plan's phases and
release groups (6.11).

---

### 4.1 `EqBands` curve chart

| | |
| --- | --- |
| Site source | `viz/EqViz.astro`, `scripts/viz/eq-view.ts`, `scripts/viz/eq-math.ts` |
| Home | `@crate/ui/domain/player/EqBands.tsx` plus `domain/player/eq-morph.ts` (springs and `useEqMorph`, not exported); `@crate/ui/lib/eq-curve.ts`, `lib/motion-gate.ts` (plan Task 0.7). The springs and the morph move to `lib/spring.ts` and `lib/use-eq-morph.ts` when an app imports them directly (plan Task 4.3, or 3.5 for the springs) |
| Priority · effort | P0 · M |

**Surfaces.** Listen `EqualizerPanel` + `EqualizerPanelSections.tsx` (popover through
`lazy-player-surfaces.tsx`, `ExtendedPlayerHeader`, mobile sheet in `FullscreenPlayerView` when
`canUseWebAudioEffects || androidNativePlayerEnabled`), `EqualizerSmartReadout.tsx`. Admin
`GenreEqEditor` on `/genres/:slug` (`pages/Genres.tsx:2129`) and in the taxonomy tree inspector
(`components/genres/GenreTaxonomyTree.tsx:617`).

**Role.** The primary control of the EQ, full width, no card. Listen 200 to 240 px tall on desktop
(product adaptation; the site uses `clamp(260px, 44vh, 460px)`), 220 px on mobile.

**Data.** Existing: `GET /api/tracks/{id}/eq`, `/api/tracks/by-entity/{uid}/eq`,
`/api/catalog/tracks/{uid}/eq` (Listen prefers the catalog route via `trackEffectiveEqApiPath`),
`EffectiveEqResponse` (`api/schemas/media.py:155`); `PATCH /api/genres/{slug}/eq-preset`;
`EQ_PRESETS` in `app/listen/src/lib/equalizer.ts` (pinned by the site drift test; do not move).
Additive, as in product design 4.12 (the canonical contract; `EqChainLinkResponse` in plan Task
2.19):

```ts
type EqSource = "user_track_preset" | "instance_track_preset" | "instance_album_preset"
              | "genre_taxonomy_preset" | "audio_analysis_preset" | "flat";
interface EffectiveEq /* existing fields unchanged */ {
  source: EqSource | "unavailable";
  genrePath: { slug: string; name: string }[] | null;
  chain: {
    source: EqSource;              // fixed order: user track, curator track, curator album, genre, analysis, flat
    status: "applied" | "shadowed" | "absent";
    label: string | null;
    gains: number[] | null;        // applied and shadowed only (ghost preview)
    reason: "no_preset" | "no_canonical_genre" | "no_genre_preset" | "no_analysis" | "remote_track" | null;
    genre?: { slug: string; name: string } | null;
    genrePath?: { slug: string; name: string }[] | null;
  }[];
}
```

- Resolver consolidation (fixes a rule breach: up to 8 `read_scope` calls per track change on the
  catalog route): one CTE in one `read_scope`, keyed by `global_track_uid | entity_uid | track_id`,
  covering track context, the three preset candidates (explicit ORs aligned with the partial
  indexes, because `user_id IS NULL` rows never match a tuple `IN`), and album/artist genres
  (`LIMIT 10`). `chain[]` is evaluated in memory. The `PUT` preset response carries no chain.
- Freshness across the 2 API workers: `/eq`, `/api/genres/taxonomy/tree` and the genre detail force
  the Redis revision check (one GET) instead of trusting the 30 s per-process TTL.
- Admin: `eq_preset_path` only on FastAPI-only routes (`taxonomy/tree`, PATCH response) unless Go's
  genre detail also implements it (contract smoke compares them); add `eq_clear_effective` so the
  UI knows when Clear actually inherits.

**Behaviour and states.**

- First paint is the real curve. No auto-cycle. The spring morph runs only on preset apply, Smart
  or Adaptive toggles, a track change that resolves another link, or an invalidation that changes
  gains. A dragged band bypasses its spring.
- Layers: bars from 0 dB with separate up and down gradients, area fill to 0 dB, glow, curve,
  ghost (target during the morph; preview on hover or focus of a preset chip or a shadowed chain
  link), handles moved in the same frame as the curve (fixes the `ce506e86` regression).
- Header: `MonoLabel accent="EQ" meta={["10 bands", "±12 dB", "21 presets"]}` and a trail
  `previous → current → fallback` (scramble 420 ms on the current word; this is Listen's first
  scramble, so plan Task 4.5 moves the Admin module to `@crate/ui/lib/scramble.ts`, 2.4). Remove
  `EqualizerModeBadge` (mode shown twice today).
- The hairline under the chart is a resolution indicator (indeterminate while Smart, Adaptive or
  Genre status is loading), not a dwell timer.
- Smart chain: rendered from `chain[]`, i18n labels, applied link `aria-current` in accent hi,
  shadowed links focusable with ghost preview, absent links `text-text-subtle` with the reason.
  Client-only modes (manual preset, Adaptive, Genre adaptive) are not chain links; "your preset"
  means `user_track_preset` only.
- Loading in Smart without cache: the audio holds the last resolved gains until the next track
  resolves (PD32 / [D29], plan Task 4.4, a behaviour change shipped alone to `main`; today
  `useResolvedEqualizer` returns `FLAT_GAINS`), so the chart keeps that curve with the
  indeterminate line. With no previous resolve, no track, or `unavailable`, the audio and the
  chart are flat.
- Error: "Flat · Smart EQ unavailable" with `StatusDot warn`. EQ off: 40% opacity, sliders
  `aria-disabled`. Engine without EQ: the panel is not mounted (existing gating).
- Admin `GenreEqEditor`: flat panel (remove box-in-box and `white/*`), `MonoLabel "EQ · {genre}"`,
  `StatusDot` direct/inherited/none, inheritance trail; ghost = persisted curve while editing;
  Clear enabled only with `eq_clear_effective`; "Generate with AI" proposed as a draft with
  `apply=false` [D35]; tree fix: pass `initialGains` only when the source is `direct` and show the
  ancestor's display name.

**Rendering.** SVG `viewBox="0 0 100 100"`, `preserveAspectRatio="none"`, non-scaling strokes;
handles stay HTML spans positioned in the same rAF tick (first write in `useLayoutEffect`, no CSS
transition on `top`); numerals through `StatNumber value={<span ref/>}`; scale column `flex
justify-between`; heights as classes. This removes EqBands' four `style={{}}` (drift 93 → 89).
The popover dialog needs `max-h` and `overflow-y-auto`.

**Motion.** Spring 120/14 per band, dt clamp 50 ms, stops on settle or when hidden (jump to
target). Effect deps `[gainsKey, animate]`. `animate` comes from the injected motion gate
(`isMotionBlocked` in Listen, `prefers-reduced-motion` in Admin).

Drags and key repeats never go through React state or the preferences per frame. Today each
`onBandChange` calls `setCustomEqualizerGains` (`lib/equalizer-prefs.ts:123-131`: three synchronous
`localStorage` writes plus `EQ_PREFS_EVENT`), every `useEqualizerSnapshotState` subscriber calls
`setState`, and on Android native `useEqualizerRuntime` re-runs and makes a Capacitor bridge call
`androidNativeEngine.setEq(…, 80)` (`hooks/use-equalizer-runtime.ts:96-101`); batching that to one
call per frame would still be 60 writes and bridge calls a second (3.8 rule 4). During a drag or
key repeat:

- gains go to the engine imperatively through a ref: Web Audio `setTargetAtTime` on web and
  desktop; native `setEq` throttled to 15 to 20 Hz with its ramp;
- curve and handles are drawn by ref, and the EQ live store (4.2) receives at most one publish per
  animation frame, without touching the preferences;
- the commit (`localStorage` plus one `EQ_PREFS_EVENT`) happens once, on `pointerup`, on blur, or
  150 ms after the last key press.

**Accessibility.** Each band column `role="slider"`, vertical, −12 to 12, step 0.5,
`aria-valuetext` ("1 kHz, +4 dB", copy and formatter via props). Keys: up/down ±0.5, PgUp/PgDn ±3,
Home/End. Read-only modes: `aria-disabled` plus a description. SVG `aria-hidden`. Trail: sr-only
live region with the final value only. Chain `<ol>`. Forced colors: curve and handles in
`currentColor`, gradients and glow hidden.

**Tests.** Vitest: `eq-curve` and `spring` (dt clamp, settle), `use-eq-morph` (fake rAF: first
paint without animation, stops on settle, jump when blocked, dragged band bypass), `EqBands`
(slider ARIA, keyboard, no `style={{}}`), drag commit (a 60-move drag causes 1 `localStorage`
commit and 1 `EQ_PREFS_EVENT`; native `setEq` calls stay within the 20 Hz throttle; a key-repeat
burst commits once 150 ms after the last press), `EqualizerSmartReadout` (new), `EqualizerPanel` (trail,
states), `GenreEqEditor` (ghost, Clear rules, PATCH response consumed), `GenreTaxonomyTree`
(`initialGains` only for direct). pytest: chain positions and reasons, other users' presets never
appear, one `read_scope` (graph warmed and revision stubbed), catalog and entity keys,
`eq_preset_path`. Go if `path` reaches the read plane.

**Decisions and risks.** [D1], [D29], [D35]; core-genre writes become durable with G1/G2 (plan
Task 2.18d, before the wheel; 4.3). The EQ code lives in a shared component that Admin uses
without screenshot tests: keep the morph fix in its own `fix(eq)` commit.

---

### 4.2 `EqGlyph`

| | |
| --- | --- |
| Site source | `InsideCrate.astro` tile 01, `scripts/viz/inside-view.ts` |
| Home | `app/listen/src/components/player/EqGlyph.tsx`, `EqualizerGlyphButton`; `app/listen/src/lib/equalizer-live-store.ts`, `lib/equalizer-labels.ts`; math from `@crate/ui/lib/eq-curve`, `lib/spring` |
| Priority · effort | P0 · M (player chrome, product design 4.11) |

**Surfaces.** `PlayerBarDesktopActionButtons.tsx` (replaces `SlidersHorizontal`; mono label from
`xl`), `ExtendedPlayerHeader.tsx`, `FullscreenPlayerControls.tsx` (48 px button). Phase 2: one
static glyph per chain link in `EqualizerSmartReadout` (uses `chain[]`, 4.1).

**Role.** A 10-band glyph (about 32×14 px; 24×12 inside the 48 px mobile button) showing the curve
the engine applies now; it is also the button that opens the EQ panel. Not a demo: no cycle.

**Data.** No new request. `useEqualizerRuntime` (the always-mounted resolver,
`use-player-playback-runtime.ts:107`) publishes into a small store read with
`useSyncExternalStore`:

```ts
interface EqualizerLiveState {
  enabled: boolean; available: boolean;
  mode: "preset" | "custom" | "smart" | "adaptive" | "genre";
  preset: EqPresetName | "custom";
  gains: readonly number[];          // exactly what the engine receives
  status: "idle" | "loading" | "ready" | "unavailable";
  source: EffectiveEq["source"] | null;
  genre: { slug: string; name: string } | null;
  inheritedFrom: { slug: string; name: string } | null;
}
```

The store initialises lazily from `getEqualizerSnapshot()`; the runtime publishes in an effect with
value comparison. Preset labels move to `lib/equalizer-labels.ts` (i18n keys) so `EQ_PRESETS`
stays untouched for the site drift test.

**Behaviour.** Labels: preset name; `CUSTOM`; `SMART` plus the source detail (genre name and "from
X", for example `SMART · Thrash ← metal`, "Your track", "Curator track", "Curator album",
"Analysis", "Flat"); `ADAPTIVE`; `GENRE` plus
the genre. Loading shows "resolving" in `text-text-subtle`. Visibility per surface stays as today:
bar `allowEqualizer && !connect && !extendedOpen`; fullscreen `allowMobileEqualizer`; extended
header only `equalizerEnabled`, so the glyph tolerates `available=false` by falling back to the
icon. Click behaviour unchanged (bar keeps `onPrepare` and the lazy popover preload).

**Rendering.** Inline SVG, 3 elements (dashed 0 dB line `2 4` in `text-faint`, glow at low accent
opacity, accent-hi curve at 1.5 px: a deliberate scale-down of the site's 2 px). `d` written
through a ref. Scale ±12 dB (the site tile exaggerates at ±8). Sizes by class, no `style={{}}`.

**Motion.** Spring 120/14 on real changes only; first paint final; rAF on demand, stops on settle or
when hidden. Deps: the string key of the gains. Press `scale(.95)` `ease-snap`.

**Accessibility.** The component that owns `aria-label` subscribes to the store ("Equalizer: Rock",
"Equalizer: Smart, Thrash metal, from Metal"; thrash metal has no preset of its own and inherits
metal's, while black metal and doom metal own theirs). `PlayerBarActionIconButton` gains an `aria-expanded`
prop. SVG `aria-hidden`. Forced colors: curve `CanvasText`, glow hidden. 48 px target on mobile.

**Tests.** `equalizer-live-store` (lazy init, no notify on equal values), `use-equalizer-runtime`
(published gains equal engine gains), `EqGlyph`, `PlayerBar`, `FullscreenPlayer`. Under 2 KB in the
initial chunk: import from `lib/eq-curve`, not `EqBands`.

**Decisions and risks.** On Smart track changes the audio holds the last resolved gains until the
next track resolves (PD32 / [D29], plan Task 4.4); the glyph draws the gains the engine plays, so
it shows the held curve. Genre and Adaptive caches are module-level and never
invalidated (edits reach audio and glyph only after reload). TS and Python adaptive EQ are twin
implementations without a shared fixture.

---

### 4.3 `GenreWheel`

| | |
| --- | --- |
| Site source | `viz/GenreWheel.astro`, `scripts/viz/genre-view.ts`, `scripts/viz/taxonomy-math.ts` (+ tests) |
| Home | Admin: `app/ui/src/components/genres/GenreWheel.tsx`, `GenreWheelInspector.tsx`, `app/ui/src/lib/genre-wheel-math.ts`. Moves to `@crate/ui/domain/genres/GenreWheel.tsx` + `lib/genre-wheel-math.ts` in the PR where Listen adopts it |
| Priority · effort | P0 · L (backend 2.18a–e, including G1, G2, G3, G7 and edge suppression, lands first; then the read-only wheel, inspector and EQ walk, plan Task 3.7, with EQ writes on core genres enabled; EQ edit, link mode, edge hiding and the unmapped mapper in the inspector, plan Task 3.8, frontend only) |

**Surfaces.** Admin `/genres` default view (Wheel / Tree / Grid; tree and grid remain the list and
accessible alternative), `/genres/:slug` locator next to `GenreEqEditor` (may retire
`GenreNetworkGraph` [D21]). Listen phase 2: `/explore` desktop wheel (container 1000 px and
wider), genre page locator (the under-760 px rules apply only here), EQ "Inherited from" link.

**Role.** Admin hero instrument of Genres: wheel 7fr, inspector 4fr, stacking under 1000 px.
Listen: read-only browse and navigation.

**Data.** `GET /api/admin/genres/wheel` (FastAPI, permission `library.view`, PD 4.6.3; the
Admin-only path stays out of the read plane). Counts for the Go `/api/genres` and genre detail come
from the `genre_counts` table the same build writes (plan Task 2.18c-go). Snapshot `ui_snapshots('genre-wheel','local')` with the standard
`decorate_snapshot` envelope; cold response `{status: "warming", task_id: string | null}` (when
`create_task_dedup` deduplicates, resolve the id with `find_active_task_by_type_params`). The
handler never builds.

The contract is `GenreWheelPayload` in product design 4.6.3 (canonical; this entry does not repeat
it). The fields this entry relies on: `nodes[].eq.{source, from, path, template, gains,
overridden, reach}`, `nodes[].aliases: {alias, origin}[]` (from `genre_taxonomy_aliases`, origin
as stored; it feeds the inspector's alias list and the `/` combobox, which matches names and
aliases), `nodes[].primary_parent`, `edges[].{provenance, locked, suppressed}`,
`totals.{overridden_nodes, eq, eq_reach}` and `unmapped.top` (top 50). With the G1 columns (below),
`nodes[].eq.overridden` is `eq_override <> 'none'`, and `totals.overridden_nodes` counts nodes
with `eq_override <> 'none' OR local_name IS NOT NULL OR local_description IS NOT NULL`.

- Builder: `db/jobs/genre_wheel.py` (SQL) and `db/genre_wheel_surface.py` (orchestration). Reads
  `genre_taxonomy:revision` first. Memberships use the read-plane rules exactly (artist
  `weight >= 0.70`; album `GREATEST(album_weight, artist_weight * 0.70) >= 0.45`), unioned across
  aliases (`genre_taxonomy_aliases.alias_slug = genres.slug`), DISTINCT. Roll-ups are set unions
  over descendants of the same runtime graph that produces `eq.path`. Reach mirrors
  `_pick_track_primary_genre` (first canonical album genre by weight desc, name; fallback to the
  artist's genres), weighted by `library_albums.track_count`. Origin, provenance, locked,
  confidence and alias origin come from an explicit read (the runtime graph lacks them). No
  `library_tracks`.
- Provenance before G3: MusicBrainz sync writes edges with the default `source='manual'`, no
  `created_by` and `locked=false`, while curator edges always set `created_by`
  (`api/genres.py:606,654`). The builder maps `source='manual' AND created_by IS NULL AND NOT
  locked` to `other`, so the Provenance mode (shipped read-only in plan Task 3.7) never labels
  MusicBrainz edges as curator edits. G3 (backend in plan Task 2.18e, before 3.7; UI in 3.8) writes
  `musicbrainz` from then on; the fallback still covers edges synced earlier.
- Task `refresh_genre_wheel_snapshot` (`TaskPoolConfig('fast', 1, 300, 1)`, dedup key
  `genre-wheel:local`, `quiet=True`), scheduled by `schedule_genre_wheel_refresh()` with
  trailing-edge coalescing (3.9) over a window of at least 120 s: the key `genre-wheel:local` in
  the `crate:coalesce:due` set, drained by the service loop. Triggers come from the places that
  change genre membership or the taxonomy, not from a list of tasks:
  - the membership choke points `set_artist_genres` and `set_album_genres`
    (`db/repositories/genres_assignments.py:72,200`) schedule after commit, and only when the
    stored genre set changed. This covers `enrich_artist` and `enrich_artists`
    (`enrichment.py:487`), the per-artist enrichment refresh (4.18), `index_genres` and
    `process_new_content`; the coalescing window absorbs bulk enrichment;
  - `db/jobs/repair_artist_jobs.py`, which rewrites `artist_genres` directly during artist merges
    and renames, schedules once at the end of the job; artist and album deletion schedule too;
  - curator taxonomy mutations through `invalidate_runtime_taxonomy_cache_after_commit` (which
    covers generate-eq apply and both DELETEs);
  - a nightly floor, so counts, `eq.reach` and the blast radius are never stale for more than a
    day even if a writer is missed.

  The generic `library` invalidation is not a trigger:
  it reaches the projector on every cover, tag, crate and enrich change (`api/cache_events.py:470-500`,
  `_PROJECTOR_RELEVANT_INVALIDATION_SCOPES`). Batch jobs (MusicBrainz sync, cleanup, inference)
  suppress the per-row hook (today `sync_musicbrainz_genre_graph_batch` commits every node and edge
  on its own, so the hook fires per row) and publish one revision and one schedule when they
  finish. Whether `genre:*` invalidations reach the projector stays product design PD23.
- Mutation responses add `wheel_patch { revision, nodes (structure and eq only), edges?,
  refresh_task_id: string | null }`; counts are kept client-side.
- Edge hiding ([D20]; backend in plan Task 2.18d, UI in 3.8): `PUT
  /api/genres/taxonomy/{slug}/relations` accepts `suppressed: true` on a locked core edge (removal
  stays forbidden); the runtime graph, and so EQ inheritance and Paths, ignore suppressed edges;
  the seeder never clears the flag; "reset to core" does. The inspector lists a suppressed edge
  under its type with a "hidden on this server" word and an Unhide action.
- Listen phase 2 (plan Task 5.10): `GET /api/catalog/genre-wheel` relayed by Go from
  `ui_snapshots('genre-wheel','crate-core')`, contract `ListenGenreWheelPayload` in product design
  4.6.3. It is not a restriction of the Admin shape: top-level `status`, taxonomy `{id, version,
  digest}` only, families without counts, nodes with `rollup {artists, albums}` only and
  `eq {source, from, path, template}`, edges `{source, target, type}` with suppressed edges
  omitted; no `totals`, `eq_templates`, `relation_types`, `counts.{direct, rollup}`, `flags`,
  aliases, provenance, overlay nodes, unmapped tags or custom gains. The `eq` fields come from the
  live, override-aware runtime graph (curator overrides and suppressed edges applied), the same
  one Smart EQ plays and `/eq` `genrePath` reports, so the Listen wheel, the genre page line
  "EQ inherited from metal" and the EQ panel never disagree about a track's genre EQ. Written by
  the same refresh task in the same run as `local`, plus a rebuild when the global catalog serving
  mode flips and when the signed core release changes.
- Invalidation scope: Listen `scopesForUrl` maps `/api/catalog/genre-wheel` to a dedicated
  `genre_wheel` scope through an explicit branch placed before the `/api/catalog` and `/api/browse`
  prefix rules (`lib/cache.ts:200-205`, which map every other `/api/catalog*` and `/api/browse*`
  URL to `library`). `refresh_genre_wheel_snapshot` broadcasts `genre_wheel` only when the row's
  version or digest changes. Without the branch the wheel would inherit `library`, which every
  crate edit, cover, tag and artist enrich broadcasts (`api/cache_events.py`
  `_INVALIDATION_RULES`), and every Listen client on Explore would refetch the whole wheel.
- Measure before tuning: the LOD thresholds, the unplaced sector and the `+N` rule are tuned for
  61 core nodes. Before plan Tasks 2.18b and 3.7, one read-only production query (with Diego's
  approval) counts nodes by origin, orphans, unmapped raw tags, and edges grouped by `source`,
  `locked` and `created_by IS NULL`; the thresholds below are set from those numbers.
- Preconditions, all in plan Task 2.18d, which lands in the Genres group before the wheel (3.7):
  - G1. The pre-v3 seeder runs on every boot (`init_db`) and upserts `eq_gains`, `name`,
    `description` and `origin` for core genres, so overrides cannot live in those columns. The
    migration adds `genre_taxonomy_nodes.local_eq_gains`, `eq_override` (`none | set | cleared`,
    so "clear to inherit" is representable on a core node), `local_name` and
    `local_description`. `eq_gains`, `name` and `description` keep meaning "the core release
    value"; the live value is `COALESCE(local, core)`, with `eq_override = 'cleared'` meaning
    inherit (NULL). The v3 seeder refreshes the core columns only; "reset to core" clears the
    `local_*` columns and sets `eq_override = 'none'`. An image rollback is safe because the old
    seeder never writes the `local_*` columns: the old image ignores the overrides and rolling
    forward restores them.
  - G2. The DB is authoritative and NULL means inherit; Python and Go read the live value, and Go
    `genrePresetSQL` gets the tie-break parity below.
  - G3 (MusicBrainz provenance) and G7 (parent cycle guard, HTTP 400), plus
    `genre_taxonomy_edges.suppressed`.

  Nothing is disabled in the wheel: Clear, Generate (as a draft, [D35]) and Save on core genres
  persist from the first wheel release. Only if 2.18d slipped out of the Genres group would the
  inspector hide those actions and the "local overrides" copy until it ships.
- Remove the request-time aggregates the page sits next to: `/taxonomy/tree` counts and Sound
  Intelligence health (scans `library_tracks`, G4) read the snapshot; `/api/catalog/genres` and
  Explore fallbacks serve stale and enqueue (G5); memoise the ed25519 verification.

**Behaviour.**

- Header: `MonoLabel accent="Taxonomy" meta={[id, version, "ed25519"]}` with `StatusDot warn
  "signature unverified"` when degraded; right label: first 19 characters of the digest. Centre
  numeral: visible node count over "genres". Legend: Families, Parent links, Related links,
  Relation types, Overlay, Unmapped (amber when greater than 0). Relation types listed from the
  payload.
- Marks: own preset = filled fg .55; inheriting = hollow; no preset in chain = amber ring (status);
  local override tick (`eq.overridden`). Primary parent edges radial cubic; extra parents thin arcs; related
  quadratic at .06; `influenced_by` and `fusion_of` hidden until enabled by filter chips.
- Idle (nothing pinned): the panel shows EQ coverage (`direct / inherited / none` with reach) and a
  chip row "Inheriting presets" (the 7 inherited nodes with the highest reach). No auto-walk [D7].
- Hover or focus previews (path lit: `is-path`, `is-on` parents along `eq.path`, `is-from` owner,
  `is-start`; related edges on). Click or Enter pins; Escape clears. The inspector shows origin
  badge, family, direct and roll-up counts (`StatNumber`), the EQ block (`GenreEqWalk`, 4.4),
  relations by type as `HairlineList` rows with provenance dots and a `Lock` on locked core edges,
  aliases, and "Open genre".
- View chips (`aria-pressed`): EQ coverage (default), Content (radius by `rollup.artists`, empty
  dimmed), Provenance (edge alpha by source). Family label click zooms its sector (layout re-run
  across 300 degrees, `ease-spring-smooth` transform).
- Curator actions (`curation.genres.write`): Edit EQ with the blast radius shown when the editor
  opens and "applies to N genres · M albums · K tracks". The blast radius is computed client-side
  in `genre-wheel-math` for owners and inheriting nodes alike: re-resolve every node of the
  payload as if the edited node owned a preset, mirroring the Python BFS in
  `resolve_genre_eq_preset` (`genre_taxonomy.py:1043-1095`: parents sorted in code-point slug order
  at each level, breadth-first, the first owner found wins). Ties at equal depth therefore resolve
  in path order, not by the owner's slug: with parents `a` and `b`, where `a`'s parent `z` and
  `b`'s parent `c` both own presets at depth 2, Python picks `z`. Go does not agree today: its
  preset queries (`readplane/internal/catalog/genre.go:369-405`, `genrePresetSQL` at `:447-471`)
  use `ORDER BY depth, slug` on the owner and pick `c`. Plan Task 2.18a moves Go to
  `ORDER BY depth, path COLLATE "C"` (the path as an array of slugs, compared element-wise) with a
  parity test (G2); the client follows Python. The affected set is the nodes whose owner becomes
  the edited node, and M and K sum their `eq.reach`. No endpoint returns a blast radius. Link mode
  (plan Task 3.8: pick
  a relation chip, toggle targets, provisional dashed edge, `PUT /taxonomy/{slug}/relations`,
  locked edges not removable but hideable, cycle targets disabled); unmapped tags mapping (plan
  Task 3.8). Existing hero task buttons stay; on completion the wheel refetches, new nodes fade in,
  new edges draw in.
- States: loading (labels and orbits with `—`), warming ("Building wheel", pulse dot, `waitForTask`
  with an `AbortSignal`), stale ("updating"), empty library (structure still drawn; Content dimmed;
  "Index genres" CTA), partial (unplaced sector after a dashed separator, cycle amber ring, `+N`
  empty overlay ticks with a "Show empty genres" toggle), error (`ErrorState`; tree and grid keep
  working), live (mutation patches immediately; counts converge after the rebuild; refetch on focus
  when `built_at` is older than 60 s).

**Rendering.** SVG, 760 viewBox, about 300 elements at 61 nodes and 2 to 3K at a few hundred
overlay nodes; memoised on `taxonomy.revision` plus `built_at`; hover is O(degree) `classList`
through a slug-to-element ref map. Ported geometry: `C=380`, rings 132/212/256 plus
`256 + 34 * (ring - 3)` for depth 3 and more (the site's `RADII` would produce NaN); sectors
proportional to `weight + 2`; children inside the parent span; `visited` guards in `weight()` and
`place()`; parent edges keyed by `child>parent`; `primary_parent` is the sorted-first parent (the
Python BFS tie-break). Level of detail: above 300 related pairs draw related edges only for the
hovered or pinned node; ring 2 and 3 labels only for the walk, neighbours and top N per sector
(thresholds confirmed by the production measurement above). Canvas only above about 1.5K visible
nodes or 4K edges (then a canvas layer for related edges only).

**Mobile.** Under 1000 px container the inspector stacks below the wheel. Under 760 px only ring-1
labels are drawn (16 px), the legend goes to two columns, the mini EQ bars are 72 px tall, and a
node tap pins it and scrolls to the inspector; the Tree view stays one chip away as the list
alternative.

**Motion.** Colour and stroke 300 to 400 ms `ease-snap`; radius `ease-spring-snappy` (longhand);
new edges draw with `pathLength`; mini EQ springs 140/15 in one visible loop; never transition `d`.
Reduced motion snaps everything; scramble becomes a text swap.

**Accessibility.** Figure sentence ("61 genres in 14 families; 40 have their own EQ, 21 inherit").
SVG `role="group"`; each node a focusable `<g>` with a label ("thrash metal, metal family,
inherits thrash from metal, 12 artists"). Roving tabindex: left and right along the ring, up and
down to primary parent and first child. `/` focuses a `SearchInput` combobox matching names and
aliases. Inspector readout `aria-live="polite"` on pin only. Listen hit circles r 14 or sector tap
followed by a list.

**Tests.** Vitest: math (site cases plus cycle, multi-parent, orphan, unplaced, depth 3+, LOD
labels; `eq.path` expectations shared with Python: powerviolence → hardcore-punk, funk → soul,
thrash-metal → metal, and the equal-depth case (parents `a`, `b`; owners `z` via `a` and `c` via
`b`; the owner is `z`); blast radius on multi-parent nodes against the same fixture), component
(hover adds `is-path`, Enter pins, reduced motion, no state update per hover via render spy,
`/` search matches an alias, 375 px render), page save flows, `lib/cache.ts` (`/api/catalog/genre-wheel`
resolves to `genre_wheel` and never to `library`). pytest (pg_db): DISTINCT across aliases,
thresholds, roll-up, cycle bound, reach, aliases with origin, provenance mapping to `other`,
suppressed edges (suppress, reseed keeps it, runtime graph ignores it, reset clears it), G1
(seed, edit, reseed keeps the edit; reset restores core; `eq_override = 'cleared'` inherits;
rollback safety: the pre-v3 seeder SQL, copied verbatim into a fixture, runs over a v3 row with
overrides and every override survives), `overridden` and `overridden_nodes` derivation, warming
and stale responses, coalescing (100 triggers inside the window produce one build that includes
the last change; a MusicBrainz sync schedules once), triggers (an `enrich_artist` run that changes
the tag set schedules exactly one build after the window; an unchanged tag set schedules none),
the Listen row (an overridden core node's `eq.path` equals the `/eq` `genrePath` for a track in that
genre), `genre_wheel` broadcast only on a version or digest change, OpenAPI contract, latency
contract (no `library_tracks` reference, no `get_or_build_ui_snapshot`). Go: parity test for
`genrePresetSQL` (including the equal-depth case and the live value after G1) and the family-map
drift test (G10).

**Decisions and risks.** [D1], [D20], [D21], [D24]. Site drift tests parse
`_RAW_GENRE_DEFINITIONS`, `eq_gains=_EQ_X` and `VALID_RELATION_TYPES`: keep those literals; edge
suppression is a column, not a fifth relation type. Behaviour change: Admin counts drop when the
DISTINCT definition lands (PD21); tests that assert old sums change.

---

### 4.4 `GenreEqWalk`

| | |
| --- | --- |
| Site source | the EQ panel inside `viz/GenreWheel.astro`, `genre-view.ts`, `scramble.ts` |
| Home | shared `@crate/ui/domain/genres/GenreEqWalk.tsx` (presentational; both apps in the same PR); Admin `app/ui/src/components/genres/{GenreEqInheritancePanel,MiniEqBars}.tsx` |
| Priority · effort | P0 · M |

**Surfaces.** Admin: inspector beside the wheel (until then `NodeDetailPanel` in
`GenreTaxonomyTree.tsx`), header of `GenreEqEditor` on `/genres/:slug`, rendered outside the
`canCurateGenres` gate so `library.view` users see it. Listen: `EqualizerSmartReadout` detail when
the source is `genre_taxonomy_preset`; `EqualizerAdaptiveReadouts` genre mode (replaces the v2
`GenreResolutionChip` box).

**Role.** Answers "which genre preset applies and where does it come from".

**Content.** `MonoLabel` "GENRE EQ · inherited from the nearest preset"; walk path in mono
(`powerviolence → hardcore punk`), segments are buttons (Admin, select on the wheel) or links
(Listen, `/explore?genre=`); display word (template label when the owner's gains exactly match a
template, otherwise the owner's name plus mono "custom curve"); source line ("its own preset",
"inherited from hardcore punk", or `StatusDot warn` "no preset · plays flat"). Admin adds
`MiniEqBars` (10 CSS bipolar bars, `--g` per bar via ref, values via the shared `formatGain` at
0.1 dB), a chip row "Inherit this preset" (blast radius computed as a client re-resolve diff with
`genre-wheel-math`, same BFS tie-break as 4.3, at most 12 plus `+N`), and a reach line once the
wheel snapshot provides it.
Listen has no mini EQ (the full `EqBands` curve is above it).

**Data.**

- One Python helper `preset_payload(slug) -> {gains, source, inheritedFrom, path}` in
  `genre_taxonomy.py`, used by `equalizer.py:443`, `browse_media.py:809` and `api/catalog.py:1098`.
  `resolve_genre_eq_preset` returns `path` (BFS predecessors, same tie-break) and `template`.
- `EffectiveEqResponse.genrePath`, `GenrePresetResponse.path` (additive). Fix
  `/api/catalog/tracks/{uid}/genre`, which returns `preset: None` in its global-catalog branch (the
  route Listen actually calls for global-uid tracks). Bump `listen:track_genre` to v2.
- Tree nodes add `eq_own_gains` (today `eq_gains` is the resolved value), `eq_preset_path`,
  `origin`. Go genre detail and track genre add `path` through one helper whose recursive CTE
  orders by `depth, path COLLATE "C"` (plan Task 2.18a), replacing today's `ORDER BY depth, slug`
  on the owner, which disagrees with Python at equal depth (4.3); names normalised to lower case
  for parity; extend the existing `p2 track genre` smoke cases.
- Template labels come from the payload (`eq.template`) where available; the Go genre detail falls
  back to the owner's name. `EQ_PRESETS` stays in `app/listen/src/lib/equalizer.ts`. A pytest
  drift check asserts `_EQ_X == EQ_PRESETS[x.lower()]` as a subset (Listen has extra presets).

**Behaviour.** Hover previews (no announcement); click, Enter, chip or path segment pins; deep link
`?genre=slug` pins; initial pin: the inheriting genre with the largest reach. Curator actions:
Edit EQ, "Give X its own preset" (seeds the editor with the inherited gains), Clear with a preview
computed from the payload ("hardcore punk will inherit punk from punk"); EQ writes on core nodes
persist through the G1 `local_*` columns (4.3) and are never disabled. The GenreEqEditor consumes
the PATCH response and merges the tree refetch over it (another API worker
may serve the old graph for 30 s). Listen: refetch on track change and `/api/cache/events`;
`useTrackGenre` moves to `useApi` with a `scopesForUrl` entry, or its staleness is documented.
States: loading ("resolving"), error, empty taxonomy, none (overlay orphans), partial (reach
"counting…"), unmapped genre ("not in taxonomy, holding flat").

**Motion.** Mini bars spring 140/15; display word scramble 420 ms (Admin; scrambled node
`aria-hidden`). Reduced motion snaps.

**Accessibility.** Section labelled by its `MonoLabel`; sr-only live sentence on commit only
("powerviolence inherits the hardcore preset from hardcore punk"); mini EQ `aria-hidden` with an
sr-only list of gains; chips `role="group"`, `CratePill` with `min-h-8`; in the Listen popover use
`text-text-muted` for path and source lines (fg-3 is 4.7:1 there).

**Tests.** pytest: path for direct and inherited, multi-parent tie-break (including the
equal-depth `a`/`b`/`z`/`c` case of 4.3, shared with the Go table test), cycle termination,
`eq_own_gains`, catalog genre branch, cache key bump; Go table tests and smoke. Vitest:
`GenreEqWalk` (shared), `GenreEqInheritancePanel`, `MiniEqBars`, blast-radius diff,
`EqualizerSmartReadout`, `EqualizerAdaptiveReadouts`; i18n keys plus `.metadata` hashes; the
hardcoded "Inherited from" moves to the catalog.

**Decisions and risks.** Shared files obey `design-token-policy` (no arbitrary tracking or px text in
`@crate/ui`: use `font-display`, `tracking-headline`, `text-label`). `spring.ts` and scramble are
shared only once an app imports them directly (2.4: springs in plan Task 4.3 or 3.5, scramble in
4.5); until then `MiniEqBars` uses Admin's copies. Do not narrow taxonomy invalidations without
adding a `genre_taxonomy` scope that `scopesForUrl` maps for `/eq` and `/genre` URLs.

---

### 4.5 `TrackReadout`

| | |
| --- | --- |
| Site source | `viz/TrackReadout.astro`, `scripts/viz/analysis-view.ts` |
| Home | `@crate/ui/domain/analysis/TrackReadout.tsx` (variants `full`, `compact`), `@crate/ui/lib/camelot.ts`; Admin `app/ui/src/components/analysis/{LatestAnalysisPanel,AlbumAnalysisPanel}.tsx`; Listen `app/listen/src/components/player/extended/InfoTabReadout.tsx`. If Listen slips, it is born in `app/ui` |
| Priority · effort | P1 · L |

**Surfaces.** Admin `/analysis` (replaces "Recent outputs"; the 5fr/7fr layout requires a page
reorganisation), Album (replaces `AudioProfileCard`, the `TrackTable` radar tooltip and the header
"Analyze" button). Listen Info tab in `ExtendedPlayerTabs` and `FullscreenPlayerTabs` (replaces
`InfoTabAudioProfile` and `InfoTabBliss`; retire `InfoTabQuietMetrics` and the loudness/DR rows of
`InfoTabSource`; the palette tint stays in `InfoTabHero`, outside this change).

**Data.**

```ts
interface TrackAnalysisItem {
  track: { id; entity_uid; title; artist; album; album_id; disc_number; track_number };
  state?: { analysis: "done" | "pending" | "analyzing" | "failed"; bliss: same;
            analysis_completed_at; bliss_computed_at; attempts?; last_error? };  // optional in Listen
  figures: { bpm; key; scale: "major" | "minor" | null; loudness; dynamic_range };
  features: { energy; danceability; valence; acousticness; instrumentalness };  // 0..1 or null, clamped
  bliss: { vector: number[] | null };  // 20 floats, clamped to [-1, 1], 3 decimals
  mood_top: { mood: string; score: number }[] | null;  // at most 3, highest scores from mood_json (PD26)
}
```

The canonical contract is product design 4.7; `mood_top` is computed in the serializer from the
`mood_json` the album query already reads.

- Admin album: `GET /api/admin/albums/{id}/analysis` and `/by-entity/{uid}/analysis` (10 to 30 rows
  by `album_id`, `library.view`; errors only with `library.analysis.manage`). Neighbours:
  `GET /api/admin/tracks/{id}/neighbours?limit=8` with its own query (seed subquery,
  `bliss_embedding IS NOT NULL` so the partial HNSW index is used, `id <> :id`, playable clause),
  returning album id and entity uid for navigation (`?track=` preselects). All in
  `db/queries/track_analysis_readout.py` with one serializer.
- `/analysis` latest: ops `analysis.recent` (at most 6), built in the worker's 120 s step (or the
  projector after the V3 fix). `AnalysisStatusResponse` declares `recent`, `stale`, `unavailable`,
  `updated_at` (the GET drops them today while the SSE sends them).
- `/analysis` Coverage column (product design 4.7, plan Task 3.9a): rows read only
  `ops_runtime_state('analysis_status')`, written by `worker.py:449-470` from
  `db/jobs/analysis_status.py`: the cheap `GROUP BY` counters every 120 s, the full scans (lyrics,
  fingerprints, portable counts and drift) in a separate 15 min step, sooner when a dirty flag is set. It already holds the analysis, bliss and fingerprint counters and,
  through the spread of `get_portable_metadata_status()` (`analysis_status.py:173`), lyrics and
  portable coverage: `lyrics_cached`, `lyrics_found`, `lyrics_missing`,
  `portable_sidecar_albums`, `portable_audio_tag_albums`, `portable_audio_tag_tracks`,
  `portable_tag_errors`, `rich_export_albums`, `rich_export_tracks`. Nothing declares them, so
  `AnalysisStatusResponse` declares them under these existing names and the rows read those
  names. Only two counters are new: `fingerprint_failed` (one more `FILTER` in the same query,
  plan 3.9a) and portable `drift` (`catalog_changed_at > sidecar_written_at`, 4.16, plan 3.10a). A row
  is drawn only for counters the `analysis_status` block writes; never a count in the request.
- Smart Mix coverage row (after the Smart Mix merge, plan Task 5.14; [D19]): the profile backfill
  the site sells as controllable (`sm:app/crate/api/smart_mix_admin.py`, `/api/admin/smart-mix`
  `/status`, `/backfill`, `/backfill/pause`, `/backfill/resume`, `/backfill/cancel`) becomes one
  Coverage row: `StatusDot` plus the word idle, running or paused; Start, Pause and Resume as
  `CratePill variant="action"`; Cancel through `ConfirmDialog`; state from
  `GET /api/admin/smart-mix/status`, refetched after each action and when the ops stream the page
  already holds shows the backfill task done; no new stream and no polling. It replaces
  `SmartMixCoverage.tsx`.
- Listen: `/info` gains `bliss_vector` (Go rounds and clamps like Python; the smoke test asserts the
  shape; the federation allowlist validates at most 20 floats). An adapter
  `trackInfoToReadoutItem` infers state. No `loudness_unit` in v3: label `dB` on the client; LUFS
  only after Smart Mix provides `integrated_lufs` with `measurement_version` and no
  `source_stale_at`.
- Camelot is computed client-side by `toCamelot` with enharmonics. The Python side is one module,
  `app/crate/camelot.py`, moved from `sm:app/crate/smart_mix/camelot.py` (which already has the
  enharmonics and already rewires `bliss._key_compatibility`) in a small `[MAIN]` PR that both
  branches use; no second copy is written. Shared fixture for Vitest and pytest. Behaviour change:
  Essentia emits flats, which score as neutral key compatibility today, so Radio and Paths key
  scoring changes.
- Re-analyse: `create_task_dedup` with `dedup_key 'album:{id}'` (pattern in `api/management.py`
  around lines 270 to 283; behaviour change: a second click returns the running task). The task
  only resets state; daemons analyse later. After `done`,
  refetch, then poll the album endpoint every 10 s while items are pending or analysing, page
  visible, for at most 10 minutes (or relay `track.analysis.updated` filtered by album).

**Behaviour.** Title in `text-display-readout`, truncated to one line with `title`; four figures
(BPM, Key with Camelot, Loudness `dB`, Dynamic range `dB`, tooltip "analyser estimate" in Admin);
five feature bars; 20-bar bliss strip (`scaleY(clamp(v, -1, 1) * -1)`). Admin `/analysis`: chips
are the latest 6, "follow latest" by default, a chip pins, "Latest" resumes; arrivals spring and
scramble the title (480 ms) and announce once. Album: `TrackTable`'s analysis button selects the
row and scrolls to the panel; pending and failed states with `StatusDot warn`. Listen: keep the
previous item while `useTrackInfo` loads so tracks spring into each other; "Not analysed yet" and
"Similarity fingerprint unavailable for this source" states. The top 3 moods of today's tooltip
stay as `mood_top` (PD26): a mono line under the feature bars (`chill .82 · dreamy .64 · warm
.41`), hidden when null; spectral complexity is dropped.

**Rendering.** HTML: `dl` for figures (own markup; `StatNumber` does not fit inline units until
2.2 lands), `output` per feature with an `aria-hidden` bar, CSS bars driven by `--v`. Title slot
or ref, so the title scramble (Admin only) is applied by the Admin wrapper and the shared
component never scrambles.

**Motion.** One visible loop for about 28 springs (`90 + (i % 7) * 8` / 13), values in a
`Float32Array` ref, stops on settle. Deps `[ref, track.id, dataRevision]` with
`dataRevision = analysis_completed_at | bliss_computed_at`.

**Mobile.** Under 760 px container the four figures go to a 2 × 2 grid, feature rows use
`13ch minmax(0,1fr) 4ch`, the title wraps to two lines, the bliss strip keeps its 20 bars at full
width, and the Admin chips scroll in one row.

**Accessibility.** Figure sentence with real values; bliss strip `aria-hidden` with an sr-only
summary; Admin chips `role="group"`; forced colors.

**Tests.** pytest: serializer (shadow over `library_tracks`, rounding, clamps, `mood_top` at most 3
by score and null without `mood_json`), album query, recent, neighbours (bounded limit, null
vector), permissions, dedup, Camelot fixture, `AnalysisStatusResponse` declares the existing
lyrics and portable fields plus `fingerprint_failed`; Go `serializeTrackInfo` table test. Vitest:
`TrackReadout` (final render, nulls, partials, `mood_top` line and its absence, reduced motion
without rAF), `toCamelot`, wrappers (follow and pin, table selection, bounded polling),
`InfoTabReadout`, the Smart Mix coverage row (after the merge: idle, running and paused states,
Cancel through the confirm dialog, refetch when the task is done), Listen baseline update.

**Decisions and risks.** [D34] loudness honesty; [D19] Smart Mix absorbs `SmartMixCoverage` into
`/analysis`. Site drift test reads literal lines of `db/queries/portable_metadata.py` and
`LoudnessEBUR128`: do not refactor them into the new module. `/analysis` live depends on V3.

---

### 4.6 `SetlistTicket`

| | |
| --- | --- |
| Site source | `viz/Setlist.astro` (CSS only) |
| Home | `@crate/ui/domain/shows/{SetlistTicket,ProbableSetlist}.tsx`, `@crate/ui/domain/shows/setlist.ts` (explicit `exports` and `publishConfig.exports` entries); recipes `.setlist-ticket-*` in `tokens/recipes.css` |
| Priority · effort | P1 · M |

**Surfaces.** Listen Radar expanded card (`components/upcoming/UpcomingShowExpandedView.tsx`, which
composes the shared ticket and keeps its actions), Home meta and Play setlist
(`HomeUpcomingFeature.tsx`, `HomeUpcomingFeatureCard.tsx`, `HomeShowPrep.tsx`), Artist setlist
modal (`ArtistSetlistSection.tsx`, an `AppModal` opened from `ArtistContent.tsx`). Admin `/upcoming`
expanded card and calendar popover (replaces `ExpandedShowCardBody` in
`components/shows/ShowCard.tsx`), Admin artist setlist tab (rows only, plus Admin columns via
`renderDetail`).

**Content.** Object card with real notches (CSS `mask` on two stacked boxes, `-webkit-mask` for
iOS 15; replaces the painted circles of `191ed32a`), dashed perforation at fg .18. Head:
`MonoLabel` with the countdown as accent word plus date, time and source (`Ticketmaster`,
`Last.fm`, `Setlist.fm` from `item.source`); artist in `text-display-entity` (cqi-based inside the
card so it fits a 340 px popover); venue in mono. Setlist line: "PROBABLE SETLIST · 12 recent shows ·
Setlist.fm", the tour name in active-tour mode, "N shows" in historical mode. Rows: index, title,
status (`StatusDot on` "in library" or ring "missing" with the title muted). Footer: "N of M
playable from your library" with the 40 px accent play disc (disabled with the reason when N is 0).

**Data.**

- The probable setlist cache entry `setlistfm:probable:v2:{artist}` gains per song
  `library_status: "local" | "missing"`, `library_track_id`, `track_entity_uid`, and
  `context.matched_at` (the `ProbableSetlistContext` validator must keep it). The worker writes the
  match when it writes the setlist; the matcher moves to `app/crate/setlist_matching.py` with a
  stricter "contains" rule (word boundary, 4 characters minimum, both directions; tests in
  `tests/test_track_versions.py`).
- One read helper `read_probable_setlists(names)` (Redis `MGET` without L1, one
  `SELECT … key = ANY(:keys)` fallback) replaces the per-artist loops in `api/me.py:423` and
  `db/home_builder_upcoming_feed.py:42`, and is used by setlist-playable, enrichment, artist shows
  and setlist-playlist. Embedded setlist copies in `enrichment:{name}` are ignored (overlay the
  canonical entry). `total_shows` uses `context.source_show_count` in all four places.
- `GET /api/me/upcoming`: a top-level `probable_setlists` map by artist (avoids duplicating 20
  songs across up to 120 shows), items reference it; `probable_setlist_status: "ready" | "pending" |
  "missing"`; `source`. Same for the `home:discovery` snapshot. Admin `/api/upcoming` adds `source`.
  Behaviour change for API clients: setlists move from each show to the top-level map.
- `GET /api/artists/{id}/setlist-playable` reads stored ids with `ANY(:ids)` (keeping
  `bliss_vector`), drops ids that no longer exist and enqueues a rematch.
- Rematch: `refresh_probable_setlist` with `mode="rematch"` (no provider I/O), its own pending key
  `setlistfm:probable-rematch:{name}`, TTL preserved with `PTTL` or `KEEPTTL`, emits only when the
  payload or status changes, HTTP-triggered enqueue capped at 8 per request, a one-off backfill
  after deploy, and `process_new_content` enqueues only when an entry exists.
- Home insights must receive the enriched shows (`has_setlist` is always false on Home today).

**States.** Loading (existing skeleton), pending (`StatusDot warn` "Preparing setlist", arrives by
SSE), missing ("No recent setlists on Setlist.fm"), partial (no `matched_at`: rows with frequency %,
no status column), zero local ("None of these songs are in your library", Play disabled), status
absent (genre-filtered Radar uses another endpoint: hide the section), error. Admin expands with a
`ResizeObserver` or a `grid-rows` transition so late data is not clipped.

**Motion.** Rows enter once per mount: 600 ms, delay `300ms + i * 55ms` (max 20, `:nth-child`
recipe), longhand easing, no `opacity: 0` in the base state. Status changes 300 ms `ease-snap`. Keys
by title.

**Accessibility.** `article` with a sentence ("Probable setlist for Turnstile, 9 of 11 songs in
your library"); `ol` with visible status text; notches and perforation `aria-hidden`; play button
labelled with the count; forced colors give the filled dot a border.

**Tests.** pytest: matcher (moved cases and false positives), batched candidates (case-insensitive,
one query), worker writes the match, rematch (no HTTP, TTL kept, quiet when identical, dedup),
`read_probable_setlists`, upcoming and home shapes, setlist-playable from stored ids, `total_shows`,
OpenAPI. Vitest: `ProbableSetlist` states, `SetlistTicket` slots and label, Listen and Admin
integrations; the Radar fixture gets setlist data before re-baselining.

**Decisions and risks.** [D32] federated copies as "in library". Removing the unused
`domain/shows/ShowCard.tsx` updates `export-usage-policy`, `genre-pill-policy`,
`design-token-policy` allowlists and `app/shared/AGENTS.md:49`. `setlist.ts` lives next to the
ticket in `domain/shows/` with explicit exports (product design 4.18, plan Task 4.7b).

---

### 4.7 `ListeningHeatmap` (band and tile)

| | |
| --- | --- |
| Site source | `viz/Heatmap.astro`, `scripts/viz/heatmap-view.ts`, `InsideCrate.astro` tile 03 |
| Home | `app/listen/src/components/stats/ListeningHeatmap.tsx` (`variant: "band" \| "tile"`), `heatmap-model.ts`; replaces `StatsHeatmapCard.tsx`. Phase 2: `@crate/ui/domain/stats/ListeningHeatmap.tsx` plus an explicit export for its `.ts` model, when Admin adopts it |
| Priority · effort | P0 · M |

**Surfaces.** Listen `/stats` (the Listening section becomes a full-width band; counters replace
`StatsHeadlineNumbers`), `/stats/global` (labelled "listener local time"), `/users/:u/stats`, Home
desktop Listening DNA tile in `HomeReplaySection.tsx` (links to `/stats#listening`). Admin phase 2:
Settings > Downloads "Quiet Hours & Limits" with the download window overlaid (UTC).

**Data.** Existing `GET /api/me/stats/dashboard` (read plane, `stats:dashboard` snapshot): `heatmap
{cells[7][24] in minutes, peak, night_share}`, `timezone`, `overview.minutes_listened`,
`highlights.artist_count`, `top_genres`. Additive: `heatmap.night_hours`; instance-only
`heatmap.listener_count` and `heatmap_utc` computed in the same single CTE pass over
`user_hourly_listening`. Required fixes:

- `StatsDashboardResponse` must declare `snapshot { pending, stale, built_at }`; FastAPI drops it
  today, so the pending poll never runs on fallback routes.
- `hasStats` treats `snapshot.pending` as non-empty (the cold payload otherwise shows the empty
  state).
- Unify the instance limits to 14 (prewarm defaults, API default, worker fallbacks, Listen) with a
  pytest on subject keys.

**Behaviour.** Counters: hours (`StatNumber xl`, unit `h`), artists, top genre (scrambled 1.1 s only
when it changes, through `@crate/ui/lib/scramble.ts`, shared since plan Task 4.5), plays and
active days (`md`), Today with `StatusDot on`. Grid: 168 cells with alpha from minutes; peak
outlined; night band from `night_hours` ("night 22–05 · 31%"); hour axis
every 6 hours; readout "Peak Saturday 23:00 · 412 min" updated on hover, tap or focus (not
announced). The "now" cell outline is shown only on Home and the user's own `/stats` (decided by
subject, not by `timezone`), moved by a timer aligned to the next hour in the user's timezone (DST,
:30 and :45 offsets, invalid timezone guarded). States: loading skeleton; pending ("building" while
the existing poll runs); stale rendered as is; zero minutes (flat grid, no peak); error (band not
mounted). The tile hides when pending, error or no peak. `/stats#listening` needs an `id` passed
through `StatsReveal` and a scroll effect once data exists.

**Rendering.** HTML grid of 168 cells (the Listen AGENTS exception for `components/stats`); the
level is a `::before` opacity `calc(.05 + var(--stats-level) * .95)` over `accent-action-hi` (no
`color-mix`); one shared `style` per cell for `--stats-level` and `--stats-delay`; the night band
positioned by classes, not another `style={{}}`. Glow only on cells with level 0.6 or more. Each
`role="row"` is its own grid with `grid-template-columns: repeat(24, minmax(0, 1fr))`: no subgrid
(Safari 16, Chrome 117; it breaks on iOS 15 and on the WebView2 111 floor) and no
`display: contents` with `role="row"` (older WebKit drops the role). The `.stats-heatmap*` recipe
moves from the shared `recipes.css` (about line 2440) to Listen CSS in plan Task 4.6 and is
extended there; it returns to the shared file in plan Task 5.12, when Admin adopts the heatmap
(6.7).

**Motion.** Diagonal wave entrance only on the first real payload; data changes transition opacity
400 ms `ease-snap`; count-up 1.6 s from the previous value; longhand easing with `@supports`.

**Accessibility.** Figure sentence; `role="grid"`, roving tabindex, cell labels ("Monday 22:00, 123
minutes"); readout not live on hover; forced colors (cell borders, peak outline in `Highlight`).

**Admin phase 2.** `heatmap_utc` with the window band; "Use quietest window" searches circularly
for the window of equal length with the fewest minutes, updates local state (the `loadedRef` guard)
and calls the existing `PUT /api/admin/download-policy`; inputs labelled UTC.

**Tests.** Vitest: model (now cell across DST, St Johns, Kathmandu, invalid zone), component (168
cells, peak, hidden states), Home sections, Stats hash scroll, `hasStats` with pending. pytest:
`night_hours`, `heatmap_utc` (DST, day boundary, missing projection state), `listener_count`,
snapshot block survives in all three routes, limit alignment. i18n keys under
`home.sections.listeningDna.*` and `stats.heatmap.*`; consider adding them to
`fullyLocalizedStatsPrefixes`.

**Decisions and risks.** [D30] hide the instance grid below 3 listeners. `history` invalidations are
global (up to 8 per aggregate refresh): renders must be cheap when data is unchanged.

---

### 4.8 `PathRouteMap`

| | |
| --- | --- |
| Site source | `listen/PathsDive.astro`, `scripts/listen/paths.ts`, `InsideCrate.astro` tile 02 |
| Home | `app/listen/src/components/paths/{PathRouteMap,PathRouteGlyph,PathGenreRail}.tsx`, `app/listen/src/components/paths/path-route-layout.ts` |
| Priority · effort | P1 · L |

**Surfaces.** `/paths/:id` (`PathDetail.tsx`, replaces `PathRouteVisualization` in
`PathDetailParts.tsx`), `/paths` rows (`PathRow.tsx`: glyph in `leading`, hop meta), planning state
(the task route, which ships with phase A).

**Merged design.** The genre-hop tile and the paths dive describe the same surface. The product
shows one panel: a step map whose x axis is the step index and y axis is energy, with genre bands
and hop chips underneath, so genre hops and per-track sound are read together. The zig-zag hop map
of the site tile is not built separately.

**Phase A (existing data plus the stored plan).**

- Nodes: one per track; x by index (`NN = index + 1`, "N STEPS" is the track count), y = energy
  inverted (gaps interpolated, flat line if none); start and end r 4.5 (end filled accent hi), mids
  r 3. Labels `NN · 118 BPM · 8A` (Camelot with enharmonics; plain key otherwise; `—` when missing):
  all when 8 or fewer, otherwise ends, active, hovered and focused.
- Genre rail: bands per hop with an edge chip (`PARENT 1.0`, `FUSION 1.6`, `RELATED 2.5`,
  `EXCURSION`, `JUMP`); the hop sequence renders as one text node or through `GenrePill`
  (`genre-pill-policy`); chips without `uppercase` classes (`badge-policy`).
- Header: `MonoLabel accent="Music path" meta={["20 steps", "92 → 128 BPM"]}`; right:
  `PLANNER · GENRE MAP | SCENES | SOUND LINE` plus `LLM REVIEW · N SWAPS` when it ran. Footer: saved
  time and Regenerate / Delete as ghost `Button`s (not `CratePill`, which is a toggle).
- Traveller: the node whose track is playing (by `libraryTrackId`, optionally only when
  `playSource.id === path.id`) has a ring and `aria-current="step"`; the route up to it is accent hi.
- Click or Enter on a node calls `playFromStep(i)`; focus scrolls `PathTrackList` to the row.
- States: loading, error, fewer than 2 steps ("NO ROUTE"), partial ("N OF M ANALYSED", hollow nodes),
  regenerating (old route at 40% until the new one draws).
- List glyph: 64×24 energy sparkline with both ends; meta keeps `origin → waypoints → destination`
  for bliss-line paths and shows hop labels otherwise (`Jazz → Soul → … → Techno`).

**Data.**

- `music_paths.plan_meta JSONB` (migration `NNN_music_paths_plan_meta.py`, product design 4.16
  `PathPlanMeta`), written only inside the `compute_music_path` task, after the LLM refinement
  (task route below), never by a request handler:
  `{planner: "genre_graph" | "artist_scene" | "bliss_line", genre_route: [{slug, name, edge:
  "start" | "parent" | "child" | "influence" | "fusion" | "related" | "excursion" | "jump", cost}],
  review: {ran, replaced}, planned_at, summary: {bpm_start, bpm_end, energy[]}}`. `genre_route` is
  derived from consecutive `path_genre` values of the final tracks with a bidirectional
  `genre_hop_edge()` (shared cost table with `_genre_neighbors`; `fusion_of` is asymmetric;
  excursions after the destination are labelled). It carries no band extents: the genre rail
  derives each band's start and length in `path-route-layout.ts` from the runs of consecutive
  `path_genre` values on the steps, which is the same rule that produced `genre_route`, so entry
  i maps to run i.
- Legacy rows: `plan_meta` is null (PD36: persist, never derive on read); the planner reads `—`,
  and when the steps carry `path_genre` the rail draws the runs without edge chips or costs.
- The migration backfills `summary` for existing rows (the list must not detoast `tracks` with
  `jsonb_array_elements` on every GET). `plan_meta` is selected in `get_music_path_row` and
  serialized; the task writes it after planning and again after a regenerate swaps tracks.
- `PathTrack.path_genre`, `PathSummary.updated_at` and `plan_meta` added to
  `app/listen/src/pages/paths-model.ts`.
- Phase B: the shared bliss map (4.9) under the SVG; steps projected from their own vectors.
- Task route (the former phase C, moved into phase A: plan Task 4.9a). `POST /api/paths/plan` and
  `POST /api/paths/{id}/regenerate?mode=task` return 202 with a `compute_music_path` task on the
  fast queue (priority 0, about 180 s, `notify=False`, section 4 intro); events `path_planner`,
  `path_genre_route`, `path_steps` (at most 5 batches, no vectors), `path_review`, `task_done`;
  owner check on `/api/events/task/{id}` through `params.user_id` with an admin bypass (behaviour
  change B16: a task queued before the deploy without `user_id` is no longer readable by a
  non-admin); the client uses `apiSseUrl` and de-duplicates steps by index. New Listen builds use
  only the task route, including the footer's Regenerate.
- Synchronous routes (B18: `POST /api/paths`, `/preview` and `/regenerate` plan in the request,
  with KNN queries, graph loads and the LLM call `refine_music_path_with_llm` from
  `db/paths_scene.py:476,552`) stay only for shipped Capacitor and Desktop builds: a deprecation
  date in the release note, a per-user rate limit, and no LLM refinement when called
  synchronously.

**Rendering.** SVG with geometry as attributes; hollow nodes use `fill="none"` with segments clipped
at the radius; 1:1 scale with horizontal overflow on narrow screens (a stretched viewBox shrinks
text and hit areas). No rAF except the entrance.

**Motion.** Once per path or regeneration: endpoints fade 300 ms, polyline `pathLength` draw 900 ms
`ease-out-expo`, nodes staggered 40 ms through `:nth-child` recipes (up to 12), labels scramble 380
ms; keyframes with `fill-mode: both` behind `motion-safe:` and
`:root:not([data-crate-motion="reduced"])`.

**Accessibility.** Figure sentence ("Music path from X to Y, 20 steps, 92 to 128 BPM, through jazz,
soul and funk"); nodes in a roving group with labels ("Step 5 of 20, Title by Artist, 118 BPM,
8A"); polite announcement of the active step on track change; `PathTrackList` is the complete
alternative; forced colors.

**Tests.** pytest: `genre_hop_edge` both directions and costs equal to `_genre_neighbors`, route from
final tracks (excursion, dropped genres, artist anchors), regenerate recompute, list summary,
migration, legacy row with `plan_meta` null, Camelot per step from `app/crate/camelot.py`; task
route events, dedup and owner checks; `plan_meta` written only by the task; the synchronous routes
never call `refine_music_path_with_llm` (patched to raise) and enforce the per-user rate limit.
Vitest (Regenerate calls the task route): layout (energy interpolation, density rule, fewer than 2
steps, band extents from `path_genre` runs aligned with `genre_route`), map (roving tabindex, Enter
plays, live region), glyph, `Paths.test.tsx`. New visual baseline and fixture for `/paths/:id`.

**Decisions and risks.** Planning runs synchronously in `POST /api/paths`, `/preview` and
`/regenerate` today (per-genre queries over `library_tracks`, full graph loads, an LLM call).
Phase A adds the route map and a visible Regenerate, so it ships with the task route rather than
before it [D36]; otherwise the heavy, LLM-bound request path would grow and become more visible.
Rule amendment [D1].

---

### 4.9 `RadioSessionMap`

| | |
| --- | --- |
| Site source | `listen/RadioDive.astro`, `listen/DeepDive.astro`, `scripts/listen/{radio,scene}.ts`, `scripts/field/*` |
| Home | `app/listen/src/components/radio/{RadioSessionMap,RadioScorePanel,RadioQueuePanel,RadioFeedbackReadout}.tsx`, `use-radio-session-explain.ts`; `app/listen/src/lib/sound-map/{math,projection,cloud,scene-math,radio-fit}.ts`; `app/listen/src/components/sound-map/{SoundMapFigure.tsx,sound-field.ts,sound-field-2d.ts}` |
| Priority · effort | P1 · L |

**Surfaces.** `/radio` (`pages/Radio.tsx`): the panel replaces `RadioHero`; `RadioSessionStatus`
becomes the panel header, fed by `playSource` and the explain payload (not the page reducer, which
loses state on navigation). `RadioFeedback.tsx` reports to the session so the map animates the real
target shift.

**Role.** Hero split: 5fr text (display title, intro, Discovery CTA as a pill `Button`, session
status) and 7fr figure (header `RADIO · <seed> · <profile>`), with Score, Queue and Feedback panels
overlaid on desktop and stacked as hairline rows on mobile. Station rails and seed search move below.

**Behaviour.** Not a scroll story.

- Idle: library cloud plus analysed-track count (`StatNumber`), rendered as one static frame; the
  camera orbits only during a reveal or while the user drags or scrolls the map, then the loop
  stops (3.8 rule 3).
- Session: every radio started in Listen is shaped (`playSource.radio.shapedSessionId`); a new
  session reveals in about 2.2 s: seed ring and label, lines to the next queue tracks that match
  `explain.picks`, score bars, queue rows (00 current, 01 to 04 next), feedback. Partial: legacy
  `playSource` without a session id and album or playlist continuation ("This queue is not from a
  radio session"); `global_catalog` profile (`explainable=false`): no Score.
- Score: the real weights of the profile used (discovery, track, contextual), each term as weight ×
  penalty, where penalty is `null` when data is missing (no year, no key, first pick). Fit is
  `clamp(1 − Σ w·p / Σ w)` over available terms; the engine minimises a cost, so the UI never calls
  it "score". BPM, Energy, Key and Era read "vs previous pick". The key term compares key and scale,
  so the label is "Key", not "Camelot".
- Feedback: a like moves the target from `initial` toward the liked centroid (0.08 per like, cap
  0.40); the readout shows real values; a dislike shows "excluded · radius 0.10" (the radius is not
  drawn: the map is a PCA projection, not the engine's cosine space). A row dislike calls
  `removeFromQueue(index)`; on the current track `next()`.
- Live: refetch explain on a new session id, on queue growth (debounced 500 ms) and on the feedback
  response; never on `currentTrack` change.

**Data.**

- `GET /api/radio/session/{id}` (Redis only, 404 for another user's session): `{session_id, mode,
  profile, explainable, seed{type, label, vector}, weights{…}, target{initial, current, like_blend,
  blend_step: 0.08, max_blend: 0.4, liked_count, session_disliked_count, dislike_radius: 0.10},
  picks[{track_id, order, source, camelot, distance, pool{size, by_source}, terms{…: penalty |
  null}, adjustments{source, variant, curation, artist_repeat}, cost}]}` with a 60-pick ring
  (penalties at 4 decimals, about 12 to 15 KB). `POST /api/radio/feedback` returns `target`.
- Owner checks on `next`, `feedback`, `DELETE` and the new GET (today any session id works). A
  per-session Redis lock prevents lost updates between refill and feedback.
- Bliss map (shared with 4.8): worker task `build_bliss_map` (maintenance queue, PCA with sign
  normalisation and Procrustes alignment to the previous revision, rebuilt when vector count changes
  by 2% or more, coalesced trailing-edge over 6 h from the bliss daemon (3.9), nightly; `quiet=True`),
  writing
  `ui_snapshots('bliss:map','global') {status: "ready" | "warming" | "empty", revision, count,
  points{desktop, mobile}, radius, basis{mean, components, scale}}` and two int16 assets kept for
  two revisions. `GET /api/bliss/map` (snapshot only; warming enqueues) and
  `GET /api/bliss/map/{revision}.bin?tier=` (revision validated, `resolve_confined_path`,
  `private, max-age=31536000, immutable`, ETag and 304), router tag `radio`, `response_model`, OpenAPI
  assertions. The client projects seed, picks and queue vectors with the basis.

**Rendering.** WebGL2 points (14K desktop, 6K mobile as a declared exception, 4K on low-memory
devices, as defined in 3.5) under an SVG overlay (at most about 40 marks) and HTML panels; Canvas
2D static fallback
for no WebGL2, context loss, reduced motion or `effects=off`; colours as uniforms from tokens; DPR 2.

**Motion.** Reveal segments (about 0.45 s per phase unit), focus and camera smoothing k = 7,
`ease-snap` colours, `ease-out-expo` line draws; loop only while visible, document visible, motion
allowed and a reveal, smoothing or interaction is unsettled. With an idle or long-lived session the
WebGL context renders nothing between data changes (14K points, 6K on mobile, must not draw while
the page just sits open). Test: the loop stops after the reveal settles while the session stays
live.

**Accessibility.** Figure sentence ("Sound map: seed Burial, track profile, 14 next tracks, target
shifted 16% toward 2 likes"); canvas and SVG `aria-hidden`; Queue `ol` of `aria-pressed` buttons;
Score `dl`; one announcement channel for feedback (suppress the `notify` toast while the panel is
mounted).

**Tests.** pytest: terms reproduce cost per profile, weights per profile, blend curve, owner 404,
explain without DB, ring bound, lock; bliss map build determinism, sign stability, artefact layout,
warming, cache headers. Vitest: projection parity with a shared Python fixture, `radio-fit`, scene
math, panels. `TEST_GAP` for the WebGL render; Playwright baseline with fixtures for
`/api/radio/session` and `/api/bliss/map`. Seed search debounce fix in `use-radio-controller.ts`.

**Decisions and risks.** [D1]. The site's weights panel (`RadioDive.astro`,
`content/listen/en.ts:75`: sound .34, artists .22, genre .16, BPM .09, energy .08, key .05, era
.03) is correct for Discovery Radio: `radio_engine.py` imports `_W_*` from
`db/paths_candidates.py` and `_seeded_radio_weights` returns them for the discovery profile. The
only site fix is the label "Camelot" → "Key" (the term compares key and scale). The site may add
that the track and contextual profiles override sound, artists and genre (.16/.30/.20 and
.01/.44/.26).

---

### 4.10 `MoodMap`

| | |
| --- | --- |
| Site source | `viz/MoodMap.astro`, `scripts/viz/mood-view.ts`, `mood-math.ts` (+ tests) |
| Home | `app/listen/src/components/explore/mood-map/{MoodMap.tsx,mood-map-model.ts,use-mood-map-canvas.ts,use-mood-map-playback.ts}` |
| Priority · effort | P1 · M (the backend part is a P0 performance fix and can ship first) |

**Surface.** `/explore` Moods block, replacing `MoodBrowseSection` and its `MOOD_COLORS`
(`pages/ExploreLandingSections.tsx:194`), same position in the stack.

**Behaviour.** Composition faithful to the site figure: header (`MOODS · from audio analysis` /
`energy × valence`), square stage, readout and Play CTA below (a 5fr/7fr split with the readout
on the left is a deviation needing Diego's OK). Points are a real stable sample; dust is points
that belong to no mood; labels sit at real centroids with a deterministic anti-collision nudge.
Hover (hover-capable devices) previews the nearest label within 16% of the side; click, tap,
Enter or Space confirms (`aria-pressed`) and enables "Play <mood> mix" (shadcn `Button`; playback
stays `/api/browse/mood/{mood}?limit=50` with `playAll`); Escape or a second tap clears. Moods with
0 tracks are dimmed with Play disabled and a reason. States: loading (grid, axes, disabled labels),
warming ("Mapping moods from audio analysis"; Play disabled), empty ("No analysed tracks yet"),
stale (meta shows `built_at`), error (the 8 moods as a `HairlineList` with counts and Play),
offline-only (Play disabled with reason), live (on a new snapshot version, crossfade the sample;
indices are not stable across rebuilds, so no per-point tween).

**Data.**

- `GET /api/browse/mood-map` (`response_model MoodMapResponse`), one `get_ui_snapshot` read with a
  7-day max age; fresh vs stale computed from `built_at`; warming returns thresholds only and
  schedules. Shape: `{status, snapshot, axes, coverage{analysed_tracks, plotted_tracks,
  catalog_tracks}, moods[{id, filters, region, third_axis, track_count, share, centroid, spread}],
  sample{count, encoding: "u8x3", data: base64}}` (energy, valence, mood bitmask per point).
- `/api/browse/moods` and `explore-page` read counts from the snapshot (removes the request-time
  `COUNT(*) FILTER` over the global catalog join); `/api/browse/mood/{mood}` samples from a stored
  pool of at most 400 uids per mood and hydrates with `get_mood_tracks_by_uids` (`ANY(:uids)`),
  replacing `ORDER BY RANDOM()`. Behaviour change: a mood mix samples from that pool instead of
  every matching track.
- Builder `db/jobs/explore_mood_map.py`: one `MATERIALIZED` features CTE (bpm not null = analysed;
  energy and valence not null = plotted), aggregates, a hash-ordered sample
  (`hashtext(global_track_uid::text)`, 1,500 max), pools; nine upserts in one transaction. The
  handler in `worker_handlers/analysis.py` compares the mood counts and the sample hash with the
  previous row and broadcasts `explore` (lazy import of `crate.api.cache_events`) only when they
  changed; an unchanged rebuild broadcasts nothing, so a backfill does not make every Listen
  client refetch the mood map and the explore page. `MOOD_PRESETS` moves to `app/crate/moods.py`
  (the builder cannot import `crate.api`).
- Triggers: projector on `track.analysis.updated` with `state == "done"`,
  `global_catalog.reconcile.completed`, `federation.catalog.sync.completed`, and `ui.invalidate`
  scope `global_catalog`, coalesced trailing-edge (3.9) over at least 900 s
  (`MOOD_MAP_REFRESH_WINDOW_S = 900`): `track.analysis.updated` is emitted per track, so a 300 s
  window would rebuild the full-catalog `MATERIALIZED` CTE every 5 minutes for the length of an
  analysis backfill. Nightly schedule; stale reads. `refresh_explore_mood_map` is `quiet=True`.
- `cache_invalidation` gains an `explore` scope. Listen `scopesForUrl` maps
  `/api/browse/mood-map` and `/api/browse/explore-page` to `explore` only, through explicit
  branches placed before the `/api/browse` prefix rule (`lib/cache.ts:200-205`), which maps every
  other `/api/browse*` URL to `library`; `library` is broadcast by every crate create or edit,
  cover, tag and artist enrich.

**Rendering.** Canvas 2D, up to 1,500 sprites (700 on mobile), DPR 2; sprites from
`readCanvasColorToken` with parsed alpha, regenerated on `subscribeThemeSkin`; `lighter` only on
dark skins; grid and region rectangle from tokens; DOM label buttons positioned in px through refs;
loop stops when weights converge.

**Motion.** Intro back-out 1.25 s staggered per mood (first mount only), label clip reveal, weights
smoothing k = 7, readout scramble 360 ms, count-up 1.2 s; none under reduced motion (one static
draw per change).

**Accessibility.** Figure sentence ("Eight moods on an energy by valence plane, 39,876 analysed
tracks. Largest: Chill, 8,210 tracks"); canvas `aria-hidden`; labels in preset order with 44 px hit
areas; sr-only live region on commit only; forced colors on labels.

**Tests.** pytest (pg_db): counts equal the reference `count_mood_presets` on a fixture, mask bits,
plotted vs analysed, remote track, pool bounds and atomicity, single read per request, projector
triggers and trailing-edge coalescing with `MOOD_MAP_REFRESH_WINDOW_S` (a burst of analysis
events builds once, after the window, with the last change; nothing is dispatched at 360 s), an
unchanged rebuild broadcasts nothing. Vitest: model (decode, regions, nudge, pick), component
states, playback, `lib/cache.ts` (mood-map and explore-page resolve to `explore` and never to
`library`), `Explore.test.tsx` (its single `useApi` assertion changes), new Explore baseline with
a fixture.
Site drift test path changes to `app/crate/moods.py`; `scale.json` regenerates.

**Decisions and risks.** [D1]. `component-policy` raw-button budget is exact: CTA and fallback Play
use `@crate/ui/shadcn/button`.

---

### 4.11 `TransitionStrip`

| | |
| --- | --- |
| Site source | `viz/MixViz.astro`, `scripts/viz/mix-view.ts`, `mix-math.ts` (`equalPower`, `beatTimes`; not `waveform`) |
| Home | `app/listen/src/components/player/mix/{TransitionStrip,TransitionInstrument}.tsx`, `mix-model.ts`, `mix-math.ts`, `transition-clock.ts` |
| Priority · effort | P2 · L (full version blocked by `smart-mix-phase-1` [D19]) |

**Surfaces.** ExtendedPlayer `QueueTab` between current and upcoming; `FullscreenPlayerQueueTab`
(in `components/player/FullscreenPlayerTabs.tsx`) as a memoised prop-less island that reads
contexts itself (the tab re-renders every tick); `QueuePanel` compact variant (desktop only, or
accept the mobile sheet). Not in `PlayerBar`, not in Admin.

**Role.** "Next transition": a compact line (`NEXT TRANSITION · 7.7 s · 124 BPM · 8A → 9A`) that
expands into the instrument (deck lanes, fade zone, curves crossing at the nominal −3 dB, cue
markers, playhead, A/B meters).

**States.** Hidden (no next track, repeat-one, remote Connect, Cast, duration 0 and not gapless:
iOS and the Android stable pipeline), gapless ("Gapless · album sequence"), planning (Android, up
to 1 s), planned, live, ended (retarget), cancelled (playhead fades, retarget), degraded (server
fallback reasons and a local `missing_profile`: amber dot plus localized reason), local fallback
(`planner_timeout`, `planner_unavailable`, `offline`), partial (no ruler without a stable beat grid,
lanes only when an envelope exists). `album_sequence` maps to Gapless and `capability_unavailable` to
Hidden. Plans carry `source: "server" | "local"`.

**Data and timing.**

- Phase A (web and desktop, no backend): next edge from the queue and
  `getEffectiveCrossfadeSeconds`; during a live fade the edge is the `CrossfadeTransition`
  (Gapless-5 fires `onnext` at fade start, so the queue index already points at the incoming track).
  Clear `crossfadeTransition` on prev, jump and seek; freeze the playhead while paused (via a ref).
  Web curve law is `sqrt(p)` / `sqrt(1 − p)` (Gapless-5 "EqualPower"); no bars or ruler on web.
- Phase B (Android, after the merge): plans published from `installTransitionPlans` after the
  revision check; live clock from `resolveNativeCrossfadeTransition` resynced on
  `transitionProgress` (every 250 ms); `outgoingCueMs = 0` means the latest cue (port
  `NativeMixTrigger.effectiveCueMs`); Android curves are cos/sin with gain staging (label the
  crossing "nominal" or port the staging). `includeProfiles` on transition plans is gated by a
  server capability (the request model forbids extra fields, an old server would 422).
- Phase C (lanes): `track_mix_profiles.rms_envelope` (u8, 10 Hz), deferred by default, written by
  an envelope-only update guarded by `profile_revision`, backfilled throttled and resumable;
  windowed slices on request.

**Rendering.** Hand-built SVG built once per edge and size; per frame only clip width, playhead,
dots, lane opacity and meter transforms through refs; container queries for the 360 px drawer;
tokens only (`fill-accent-action/5` zone, `accent-action-hi` lit lanes, `currentColor` dims,
`text-label` tags); the disclosure is a `@crate/ui` `Button` with `aria-expanded`.

**Motion.** Playhead follows the real clock; reduced motion shows the planned state statically and
jumps to the end on `transitionEnded`.

**Accessibility.** Figure sentence; SVG `aria-hidden`; debounced polite announcements only for
Planned → Mixing → next edge.

**Honesty.** Never "beatmatch", "sync", "lock", "handoff" or "automix"; Android phase 1 applies
gain envelopes only, so beatmatch-mode plans read "Beat grid cues". A Vitest checks every mode and
reason string in all 7 locales with per-locale patterns.

**Tests.** Vitest: `mix-math` laws, `effectiveCueMs`, `buildMixVisualModel` fixtures per source,
clock (pause freeze, cancel on seek), strip states, honesty test. pytest (phase B and C): profile
summary, capability gating, envelope quantisation and window slicing, deferred column.

**Decisions and risks.** The per-frame `useCrossfadeProgress` in `FullscreenPlayer`,
`ExtendedPlayer` and `usePlayerBarController` is a separate fix; after the merge it re-renders the
fullscreen player during every Android mix.

---

### 4.12 `DeviceConstellation`

| | |
| --- | --- |
| Site source | `viz/Devices.astro` (CSS only) |
| Home | `app/listen/src/components/devices/{DeviceGlyph,DeviceConstellation,DeviceProgressLine}.tsx`, `device-family.ts`, `device-progress.ts`, `use-device-roster.ts` |
| Priority · effort | P2 · M |

**Surfaces.** Settings > Devices (new top-level section after Playback; promotes
`ConnectDevicesSection` out of `AccountSection`), `PlaybackTargetPopover` rows and
`PlaybackTargetIcon` (desktop player bar only; no mobile picker is added).

**Behaviour.** A band of line-art glyphs per device family (desktop, android, ios, cast while this
sender casts, subsonic, generic) with mono captions, then one `HairlineList` row per device.
Presence: active (Playing or Paused from the session status), online, recent (5 min), offline,
unavailable (reason), this device. Active device shows the session position; online devices show a
ghost line at the same position; others show their last checkpoint ("stopped at 2:14 · 3 h ago").
Actions (existing APIs): transfer by instance id ("Play on <device>"; "Play here" only on this
device through the local provider), Cast start and stop, Forget (confirm), Crate Connect toggle.
Subsonic is read-only. States: loading, empty ("Only this device so far"), Connect off, build flag
off (section not rendered), reconnecting (`StatusDot warn`, live instances treated as stale), list
unavailable (partial).

**Data.**

- `list_devices`: one `read_scope` LEFT JOIN on the `(user_id, device_id)` key with scalar checkpoint
  columns (never `queue_json`), raw checkpoint (`position_ms`, `updated_at`, no projection, no
  `playback_rate`); presence through a new `cache_store.get_cache_many` (L1 plus one `MGET`),
  fixing today's N+1 with nested Postgres reads.
- Connect WS heartbeat refreshes the presence key and hub instance keys (Redis only); disconnect
  touches `last_seen_at`. `PlayerConnectValue` gains the WS `status`.
- Client roster merges REST devices, `connectedInstances` and the active Cast session by device id;
  refetch on mount and, debounced 1 s, when device ids, `activeInstanceId` or paused/stopped status
  change. Capability keys `form_factor`, `os`, `display_mode` from `getListenDeviceCapabilities`.

**Rendering and motion.** Inline SVG glyphs (site geometry; `pathLength` draw once on first view
via `:nth-child` delays); picker uses a square mini glyph. Progress lines: on each server anchor a
ref writes `scaleX(p0)` then a CSS linear transition to 1 over the remaining time (no per-frame JS);
reduced motion steps on anchors. Bottom-aligned flex-wrap layout.

**Accessibility.** Figure sentence ("4 devices, 2 online, playing on Crate Desktop at 2:14 of
4:05"); glyphs `aria-hidden`; list and popover rows are the interactive surface with state in text.

**Tests.** pytest: checkpoint shapes, revoked excluded, presence via one `MGET`, Redis-down
fallback, heartbeat TTL refresh, disconnect touch. Vitest: `deviceFamily` table, progress
projection, roster merge (tabs collapse, WS offline, Subsonic never live, Cast only while active),
constellation label and reduced motion, `PlaybackTargetMenu`, `ConnectDevicesSection`,
`AccountSection`, `Settings`; Settings baselines and fixtures.

**Decisions and risks.** [D28] the Connect build flag defaults to off in every build; confirm before
investing. Legacy Connect transport is dead code (v2 transport hard-coded on).

---

### 4.13 `AccessTokensSection`

| | |
| --- | --- |
| Site source | `viz/TokenAllowlist.astro`, `scripts/viz/allowlist-view.ts` |
| Home | `app/listen/src/components/settings/access-tokens/{AccessTokensSection,AccessTokenRow,TokenReachList,MethodBadge,TokenSecretReveal}.tsx`, `use-access-token-policy.ts` |
| Priority · effort | P2 · M (blocked by the `smart-mix-phase-1` merge) |

**Surface.** Listen `/settings` "Access tokens" after the OpenSubsonic credentials (also on
Capacitor and Desktop). Not Admin: tokens are per user and require an interactive session.

**Behaviour.** Panel header `ACCESS TOKENS · n active` (expired excluded) / `crv_ · SHA-256 digest`.
Token rows (local `li`, not `HairlineRow`): name, 12-character prefix bright plus an `aria-hidden`
mask, scope chips, mono meta (created, expires, last used), `StatusDot` (on: used within 7 days;
off: never or idle; warn: expires within 7 days or expired). "Reach · N routes" disclosure (`Button`
with `aria-expanded`) lists routes grouped by scope with method badges (the stream route lists GET
only); routes the token cannot reach are muted with "needs <scope>". Create form: scopes as
`CratePill` toggles that light the draft's Reach list live; the secret shows once with copy
feedback; Rotate hidden on expired tokens; Revoke through `ConfirmDialog`. First-use confirmation:
refetch on focus or visibility at most every 30 s; a token whose `last_used_at` becomes non-null
pulses once and announces "<name> connected". Server without tokens (404): section hidden; server
without the policy route: list without Reach.

**Data.** Existing (after the merge) `GET/POST/DELETE /api/auth/access-tokens`, `POST …/{id}/rotate`.
New `GET /api/auth/access-tokens/policy` → `{token{prefix, secret_bytes, display_prefix_length,
digest}, scopes[{id, selectable, default, legacy}], routes[{key, methods[], label, scope,
pattern_index}]}` (14 display rows over 12 patterns; the route meta constant sits after
`def _is_vdj_access_token_request` so the site drift test keeps parsing the allowlist block). Server
flags come from `/api/capabilities`. Phase 1 also moves the `last_used_at` touch after the allowlist
check (a denied request counts as use today). Phase 2 (optional, migration): `recent request` and
`last_denied` with a Python-side throttle.

**Tests.** pytest: policy shape, 401 for a `crv_` token on `/policy` and 403 for an injected token
user, method-and-route parametrised scope test, touch after allowlist. Vitest: rows, Reach, draft
lighting, secret reveal, rotate hidden on expired, first-use pulse, server variants; Settings
baselines and `/policy` fixture.

**Decisions and risks.** Per-file exact budgets in Listen `design-token-policy` (no `text-[10.5px]`,
`rounded-[12px]`, `tracking-[.1em]`; `bg-card` counts as legacy: use `bg-surface-object`) and the raw
button budget. Settings sections should be restyled once through `SettingsPrimitives.Section` rather
than per section.

---

### 4.14 `HealthScan`

| | |
| --- | --- |
| Site source | `viz/HealthScan.astro`, `scripts/viz/health-view.ts`, `content/admin/viz.ts` (`RISK_LABELS`) |
| Home | `app/ui/src/components/health/{HealthScan,HealthScanRow,RiskMeter,HealthIssueDrilldown}.tsx`, `health-scan-model.ts`, `use-health-checks-surface.ts` (initial GET plus the `health` surface from `use-admin-live`) |
| Priority · effort | P0 · L |

**Surface.** `/health` (`pages/Health.tsx`): replaces the inline hero section (about line 680) and
the "Repair catalog" card (about line 863); the per-check, per-artist drill-down (about lines 960 to
1150) is extracted into `HealthIssueDrilldown` and kept below. Footer links to `/trash`.

**Content.** Header `HEALTH · last scan 3 h ago` with a live status line. Three numerals (`StatNumber
lg`): Open, Fix on their own (`totals.open_unattended`, "across N checks"), Ask first
(`totals.waiting`). Seventeen grid rows in catalog order: index, label and description, scope,
`RiskMeter` with its word, `auto` (accent-hi border, `unattended: true`) or `confirm` (amber
border) badge, result (`not run`, `clean`, `N found` with Fix, `N waiting` amber with Review,
`N fixed` accent hi, `failed` with `StatusDot warn`). Footer: "M track files in Library Trash →"
(link with `library.track.remove`) and "N albums quarantined" without a link (album quarantine is a
DB flag and `/trash` does not list albums).

**Behaviour.**

- Live scan: the cursor (2 px accent-hi bar plus wash) sits on the check that is actually running,
  driven by real `health-scan` events; minimum dwell 150 ms per row from a queue; elapsed time on
  the active row from a 1 s timer (1.8.4); artist-scoped revalidations only add a meta line; a scan
  started elsewhere appears through `running`.
- Status line: idle summary, `scanning 07/17 · Unindexed Files · 0:42`, `applying automatic fixes`,
  `syncing` (the pipeline's third phase), `2 checks failed`, `queued · waiting for resources` (console
  scans are governed; there is no manual bypass for `triggered_by="console"`).
- Actions: Run scan (deduplicated; a second click attaches to the running task); Fix chip on checks
  where `fix-type` works (deduplicated per check type, disabled while running; label "Fix 500 of N"
  when over the 500-issue cap or batch all); Review expands the drill-down (11 confirm checks repair
  per artist through `?repair=1` links and per-issue resolve or dismiss); keep the duplicate tracks
  "Run cleanup now"; new confirm dialogs for the `shadow_quality_tracks` fix-all and for
  dismiss-type; the server requires `confirm: true` for confirmation checks (409 otherwise). Toasts
  on surface transitions only.
- States: warming (catalog rows with `—`), never scanned ("Run first scan"), stale meta, offline with
  backoff, partial (failed checks flagged).

**Data.**

- Contract: `HealthChecksSurface` in product design 4.2 is canonical; this entry uses its names.
  `GET /api/admin/health-checks` (`library.repair.run`) reads `ui_snapshots('ops:health','checks')`
  by PK, written by workers on push (scan start and end, repair, pipeline) and by
  `refresh_admin_surface(surface="health")` after API mutations; stale rows are served with the
  `snapshot` block and schedule a coalesced refresh; cold returns `state: "warming"` with the
  catalog built from code. Field names: `checks[].unattended`, `checks[].fix_mode` (`global |
  bulk | per_artist`), `totals {checks, unattended, confirm, open, open_unattended, waiting,
  fixed_last_run}`, `last_scan {task_id, task_type, trigger, finished_at, failed_checks}`,
  `running {task_id, task_type, status: "queued" | "running", phase: "scan" | "repair" | "sync" |
  "revalidate", scope: "full" | "selected", index, total, check_type, check_started_at}`, `trash
  {track_files, albums_quarantined, updated_at}`. `unattended` follows the pipeline's real
  behaviour after PD24 / [D23].
- Live: the `health` surface on `/api/admin/live-stream` (3.9) delivers two event types: `health`
  (the surface, re-read by PK in `asyncio.to_thread` when `ui_snapshots` publishes a new version)
  and `health-scan` (`{task_id, index, total, check_type, phase: "started" | "completed" |
  "failed" | "fixed", found?, fixed?, duration_ms?, at}`, forwarded verbatim from
  `crate:sse:admin:health:scan` without DB reads). `health-scan` is an event type of the `health`
  surface, not a surface of its own; `fixed` is emitted by the repair phase per check. There is no
  separate health stream route. `open_pubsub` gains multi-channel support.
- `running` is a Redis key with a 90 s TTL, refreshed by each scan event and by a 30 s heartbeat
  thread for the whole task (scan events fire only at the start and end of a check), deleted in the
  task's `finally`, merged at read time and dropped when its task is no longer pending or running
  (product design 4.2 item 5); only full and selected scans write it
  (not artist rechecks). `queued` is written by a hook in the `actors.py` dispatch path (governor
  deferral and DB-heavy lock wait).
- Backend fixes: labels and descriptions as keyword arguments appended to each
  `RepairCatalogEntry` (replacing three client copies: `Health.tsx`, `ArtistRepairDialog.tsx:107`,
  Dashboard `prettifyHealthType`); a failed scanner no longer resolves its open issues or records
  `issue_count = 0`; per-check duration through `record_health_check_runs`; migration adds `task_id`,
  `last_error` to runs and `resolution`, `resolved_task_id` to issues; persistence in one
  repositories function (`ANY(:ids)` stale resolution, one transaction); repair item events only on
  the task channel (not `crate:sse:global`); the drill-down read below replaces
  `GET /api/admin/health-snapshot?check_type=`, which stays as a deprecated alias for one release
  (behaviour change: the old route is removed after that);
  `POST /health-check` deduplicates and returns the existing task; the worker writes the
  snapshot at start and end of `health_check`, `repair` and `library_pipeline`; API mutations
  schedule `refresh_admin_surface(surface="health")` (`quiet=True`, dedup key
  `admin-surface:health`) through the trailing-edge due-set recipe (3.9), with no generation
  counter (product design 4.2 item 6); `library_pipeline` runs health → repair → sync and
  closes the health part after repair; health and pipeline handlers publish (V10).
- Drill-down (`HealthIssueDrilldown`, the action surface for the 11 confirm checks):
  `GET /api/admin/health-checks/{check_type}/issues?cursor=&limit=` (`library.repair.run`), one
  read of open issues without snapshot building, keyset-paginated by artist so an artist's issues
  never split across pages (`groupIssuesByArtist` and the per-artist fix-all depend on that):
  `{check_type, total_issues, total_artists, artists: [{artist_id, artist, issues: [...]}],
  next_cursor}`. The client refetches it when a `health` live event changes that check's `open`
  count. The v2 page also opens `/api/admin/health-stream?check_type=` (`Health.tsx:404`, backend
  `_health_stream` in `api/management.py`); that route is deprecated with the snapshot alias (one
  release) and the page drops its `EventSource`, so `/health` holds only the provider's stream.

**Rendering.** Semantic HTML: `figure`, `dl` numerals, `ol` of grid rows
(`2.4ch minmax(0,1fr) 11ch 16ch 9ch 12ch`, gap 14 px), columns dropped at 1000 and 760 px container
widths. Risk meter 3 `aria-hidden` segments plus the word.

**Motion.** CSS transitions `ease-snap`; numeral count-up through a ref in a visible loop that stops
when it settles; the active row's elapsed time from a 1 s timer, so a running scan keeps no rAF
alive; no fake settle delays; first paint shows the snapshot.

**Mobile.** Under 1000 px container the scope and risk columns hide (`2.4ch minmax(0,1fr) 9ch
12ch`); under 760 px the index and description hide (`minmax(0,1fr) auto auto`), as on the site
and in product design 4.2.

**Accessibility.** Figure sentence; visible status `aria-hidden` with a separate polite region for
phase changes only; result text, not colour; action buttons named ("Fix 14 Stale Tracks issues");
drill-down toggles `aria-expanded`; forced colors.

**Tests.** pytest: surface payload (unattended set, cold, never run, failed), stale read schedules
without building, per-check events (`started`, `completed`, `failed`, `fixed`) and failure
handling, persistence with `ANY(:ids)`, pipeline unattended set, fix-type confirm (the existing
`artist_layout_fix` bulk test posts without a body), dedup returns, the live stream forwards
`health-scan` without DB reads, the drill-down read (keyset by artist: an artist's issues are
never split across pages; cursor round trip; permission), the deprecated `health-snapshot` and
`health-stream` aliases, OpenAPI, migration. Vitest: model reducer (dwell queue, reconnect,
overlay merge keyed by check type), component states, surface hook (subscribes through
`use-admin-live`, opens no EventSource), the Health page opens no stream of its own (no
`health-stream`, no `tasks-stream`), the drill-down refetches when that check's `open` changes,
the loop stops after the count-up while a scan is still running, 375 px render,
`Health.test.tsx` after extraction, `StatNumber xl`.

**Decisions and risks.** [D23]. Site drift test parses `CHECK_LABELS` in `Health.tsx`; the PR that
lands second updates it to read `repair_catalog.py` (6.5).

---

### 4.15 `HealthScanTile`

| | |
| --- | --- |
| Site source | `InsideCrate.astro` tile 04 |
| Home | `app/ui/src/components/health/HealthScanTile.tsx`, `check-tone.ts`; data hook shared with 4.14 |
| Priority · effort | P0 · M (Dashboard, product design 4.1) |

**Surface.** Dashboard first stat row (replaces the Health `OpsStatTile` and the hero "open issues"
chip); deep links `/health?check=<type>` (Health reads the filter from `useSearchParams`).

**Content.** `MonoLabel HEALTH · 17 checks`; `StatNumber md` with the waiting count and unit;
mono meta derived from `totals.unattended` and `totals.confirm` plus `last_scan`, never a literal
(`4 auto · 13 confirm · last scan 3 h ago` under the PD24 (a) / [D23] default; it reads
`5 auto · 12 confirm` only if PD24 (b) keeps `globally_runnable`); 17 bars (3 px, gap 3 px;
unattended 100% long, confirm 82%) whose tone is the check state (clean fg .16, open-auto accent .35, waiting amber .7,
never run dashed fg .08, failed amber outline); during a scan the current bar lights from
`health-scan` events (accent hi on unattended, amber on confirm); up to 3 rows of the
longest-waiting checks as full-row links (32 px or
more). The link to `/health` sits on the header, never wrapping the rows or the Scan pill (no nested
interactive elements). A Scan pill (deduplicated). Without `library.repair.run` the tile shows
`health_counts` from the ops snapshot.

**Layout decision.** Either restyle all four Dashboard tiles to the tile recipe in the same change,
or trim this tile (no title and body) so it fits the existing row.

**Tests.** `checkTone`, tile states, deep link, permission fallback; new `Dashboard.test.tsx`.

---

### 4.16 `PortableMetadataPanel`

| | |
| --- | --- |
| Site source | `viz/AlbumSidecar.astro`, `scripts/viz/sidecar-view.ts`, `src/lib/json-lines.ts` |
| Home | `app/ui/src/components/album/portable-metadata/{PortableMetadataPanel,SidecarTree,SidecarJson,SidecarFlow}.tsx`, `use-portable-metadata.ts`; `app/ui/src/lib/json-lines.ts`; `useAutoFollowScroll` |
| Priority · effort | P1 · M |

**Surface.** Admin album detail (`pages/Album.tsx`), a full-width band between `TrackTable` and
`RelatedAlbums`, shown when `canEditMetadata && !is_pre_release`; the `AlbumHeader` Metadata button
wires `onMetadataTaskQueued('portable', taskId)`. Fetches on first visibility.

**Content.** Header `PORTABLE METADATA · schema_version N` / sync status. Left (4fr): folder tree from
the real path segments (storage v2 uses UUID folders: show `relative_path` with the title as
secondary text), files as `<ul aria-label>` buttons with `aria-pressed`, `.crate/album.json` with a
status dot; identity tag chips (the 6 real keys with coverage, e.g. `crate_audio_fingerprint 8/10`)
and "tags written 10/10 · 0 errors". Right (8fr): object-card JSON preview (keys sorted server-side,
strings accent hi, comments fg-3 italic; the selected track rendered, others summarised by a
hand-added comment line). Rail: `01 write_portable_metadata` and `02 rehydrate_portable_metadata`,
each with a progress hairline and timestamp; Restore behind a `ConfirmDialog` that states it also
reverts names, artist, year, genre and track titles.

**States.** never, in_sync, drift (changed files marked, amber with text), unknown (written before
the migration), partial (tag errors, missing uids), queued (per-album tasks bypass the governor, so
"deferred" is rare), error (compact `ErrorState`).

**Data.** `GET /api/manage/albums/{id}/portable-metadata` and `/by-entity/{uid}/…`
(`library.metadata.write`, auth checked before resolving): one `read_scope` with album, artist,
tracks and lyrics, the state row and the active task found by `(type, dedup_key, status)`; previews
for all tracks (lyrics summarised); never `get_portable_metadata_status` (it counts
`library_tracks`). Migration on `album_portable_metadata` with `ADD COLUMN IF NOT EXISTS`:
`schema_version`, `payload_digest`, `section_digests` (tracks keyed by `relative_path`),
`artwork_files`, `rehydrated_at`, `last_task_id`, `last_error`, `catalog_changed_at`. Digests computed over
`get_portable_album_payload` output excluding volatile and local keys. `catalog_changed_at` is set by
the writers of tag edits, renames, repairs and rehydrate, with a nightly digest recompute as the
floor; drift is `catalog_changed_at > sidecar_written_at`, so the library-wide drift count (4.5) is
read in the 15 min analysis step and never builds a per-album payload. Enqueue with dedup key
`portable-metadata:album:{id}`; per-track `portable_track` task events in the tag loop (the sidecar
write is one atomic step); a separate rehydrate mark that leaves `sidecar_written_at`,
`tags_written` and `tag_errors` alone; rehydrate accepts `album_id` and resolves the path from the
DB. Site drift test literals in `portable_metadata.py` and `db/queries/portable_metadata.py` stay.

**Motion.** File stagger 45 ms once; auto-follow scroll during a task yields to user input; one 2.4 s
highlight sweep of changed sections after a write; rAF only during a task while visible.
`useTaskEvents` lives inside the panel so the page does not re-render per event.

**Tests.** pytest: digest stability and change, identity keys, view states, track selection, lyrics
summary, permissions and 404 order, task event, dedup, rehydrate keeps tag counts, migration and
head test. Vitest: panel, tree, JSON lines, flow, auto-follow hook; `Album.test.tsx` wiring.

---

### 4.17 `ReleaseRail`

| | |
| --- | --- |
| Site source | `viz/ReleaseTimeline.astro`, `scripts/viz/release-view.ts`, `content/admin/viz.ts` (`RELEASE_STAGES`) |
| Home | `app/ui/src/components/acquisition/{ReleaseRail,ReleaseRailCompact}.tsx`, `release-lifecycle.ts`; scramble from `@crate/ui/lib/scramble.ts` (moved there from `app/ui/src/lib/motion/scramble.ts` by plan Task 4.5) |
| Priority · effort | P1 · L |

**Surfaces.** `/new-releases` hero band (replaces `OpsPageHero` and four `OpsStatTile`s); list rows
get `ReleaseRailCompact` (5 dots plus the current stage label); grid cards get the stage dot;
`?release=<id>` deep links from Discover and Upcoming (unknown ids fall back to the focus).

**Content.** Header `ACQUISITION · release lifecycle` / `Artist · Title · type`; release clock in
`StatNumber xl` computed client-side from `release_date` (`T−N d`, `Day 0`, `Day +N`, `—`); "Now"
stage title in accent hi (scramble 380 ms on change) with its real task name (link to
`/tasks?task=`); five stages Detected, Release day, Fetched, Imported, Analysed with states done,
active, pending, failed, skipped; step chips are `CrateChip` tags from real data (Imported lists
the 9 real `process_new_content` phases); special states: detected after release (Release day
skipped), waiting for a source, already in library, download failed with the error, analysis N/M
with failed tracks counted as terminal. Actions unchanged (Download when `status === "detected" &&
tidal_url`, also for future pre-releases; Retry; Dismiss; Open album; Open task; Check now). The
focus button sits on the title or cover; links and actions are siblings (no nested interactives).

**Data.** Migration on `new_releases`: `library_album_id` (not `album_id`, which collides with
`nr.*` plus `alb.id AS album_id` in Listen queries), `download_task_id`, `download_queued_at`,
`import_task_id`, `imported_at`, `analysed_at`, `failed_stage`, `last_error`, `lifecycle_reason`,
`lifecycle_updated_at`; one-off backfill (link by name with `MIN(id)`, stamp legacy rows, fail rows
stuck in downloading). Atomic writers: `queue_release_download` (status, task id and the task in one
transaction) and `queue_release_import` (task created and stamped in one transaction, or
`process_new_content` stamps itself), `mark_download_failed`, `link_downloaded_albums`,
`mark_imported` (also on the `content_unchanged` early return). Every mutation, including detection,
dismiss and cover updates, emits `acquisition.release.updated` in the same transaction. A
reconciler every 60 s (only when rows are in flight) fails stages whose task is gone and stamps
analysis completion. Snapshot `acquisition:new_releases` built by the projector (cold uses the
repo's `pending` convention, max age about 3600 s), payload without tracklists, `focus_id`,
`catalog` of stages, `last_checked_at`, lifecycle per release with `updated_at`. `/stream` moves to
pubsub plus `asyncio.to_thread` (fixes V6). DB code in `db/jobs/acquisition.py`,
`db/repositories`, `db/queries/new_releases_surface.py`, orchestration in
`db/new_releases_surface.py`.

**Rendering and motion.** HTML rail per 3.2; `--p` written through a ref; vertical under 900 px
container; only the 380 ms scramble uses rAF; first paint final. Latency about 5 to 10 s (projector
polls every 5 s).

**Accessibility.** Figure sentence; `ol` rail with `aria-current="step"` and sr-only stage states;
"Now" polite on stage change; pending stages dim dots and lines only.

**Tests.** pytest: lifecycle derivation table, jobs (pg_db), builder, projector mapping, handlers,
API (snapshot never builds, stream forwards), OpenAPI, permissions, routing, ORM contract, migration.
Vitest: `NewReleases.test.tsx`, `ReleaseRail.test.tsx`, `release-lifecycle.test.ts`, scramble,
Discover deep link, Upcoming links.

**Decisions and risks.** [D33] non-Tidal acquisitions. The site's stage id is `release-day`; align
if the catalog feeds the site.

---

### 4.18 `EnrichmentOrbit`

| | |
| --- | --- |
| Site source | `viz/EnrichmentOrbit.astro`, `scripts/viz/enrichment-view.ts`, `pool-math.ts` |
| Home | `app/ui/src/components/artist/enrichment/{EnrichmentOrbit,PoolLanes}.tsx`, `orbit-math.ts`, `run-model.ts`, `orbit-frame.ts`; `app/ui/src/components/artist/ArtistEnrichmentPanel.tsx` (lazy) |
| Priority · effort | P2 · L |

**Surface.** Admin Artist page, new "Enrichment" tab before "About"; the hero Enrich action switches
to the tab and follows the run instead of reloading the page (it calls `refetch()` and
`refetchEnrichment()`).

**Content.** VizSplit 5fr/7fr: orbit (core with the artist, inner ring of 6 sources with TTL arcs and
states fresh, expired, error with a short code, empty, unconfigured with the env variable name,
disabled when the Settings toggle is off: the pipeline honours the toggles, PD29 / [D38], plan
Task 3.12c) and pool lanes of the last real run (wait and
fetch segments per source, cache hits as chips); outer dashed ring of 7 secondary sources showing
coverage with agnostic copy ("artist photo", "covers", "84 lyrics", "3 upcoming"). Right: panel
header, `StatStrip` (fresh 4/6, next expiry, last run), `HairlineList` of the 6 sources with state
in text and a Refetch button; hover or focus links row, node and bar. Actions: Refresh expired,
Refetch per source, link to Settings > Enrichment (only toggles, gated by `settings.manage`, needs
`?section=enrichment`).

**Data.** Migration: `artist_enrichment_sources` (PK artist and source). `GET
/api/admin/artists/{id}/enrichment/sources` (`library.view`; + by-entity; one CTE, lyrics `WHERE found` with
`lyrics_key()` computed in Python, Ticketmaster shows filtered by source and date, `configured` for
all 6 sources, missing row with `enriched_at` set means expired-estimated) plus `HGETALL` of the run
key. `POST /api/artists/{id}/enrichment/refresh` returns `TaskEnqueueResponse` (dedup or 409), with
a per-artist worker lock (`SET NX`) because dedup is per task type. `force_sources` bypasses the
min-age and clears provider caches. Signals `enrichment.source` (about 25 per artist) published to
the task channel only; run key as a hash with `EXPIRE 600`. Fix V7 (`GET /enrichment` calls
providers in the request; Listen's `use-artist-bio-enrichment.ts` also reads it). Close the
`cache_events.py:490` regex (`/enrich$`) so the new POST does not invalidate `library` for every
client. Drift test constraints: do not mention the enrichment constants above their definitions.

**Rendering and motion.** SVG viewBox 600 (radii 150 and 252; outer offset −π/2 + π/7) plus HTML
labels; per-frame writes (packet `cx/cy`, playhead, `--fill`) through refs; rAF only while a run is
active and visible; lane 0 when the pool runs inline. Client opens the SSE, then fetches status on
open (no gap); listens for `task_event` with `event_type === "enrichment.source"` via
`normalizeTaskEvent`; refetches on `run_done` or `task_done`. External runs detected best-effort
through `OpsSnapshotContext` (ops capabilities only, about 15 s late).

**Prerequisites.** `InstrumentPanel`, `StatStrip`, VizSplit recipe (2.3, 2.5). `backfill_enrichment_sources`
is a `notify=False` task type (3.9).

**Tests.** pytest: outcome classification, lane parsing, signal order, `force_sources`, upsert,
status derivation, no `library_tracks`, permissions, dedup, V7, signal channel isolation, migration,
regex. Vitest: orbit math, run model, frame writes, panel, hooks.

---

### 4.19 `QueueLanes`

| | |
| --- | --- |
| Site source | `viz/QueueLanes.astro`, `scripts/viz/queue-view.ts`, `scripts/viz/loop.ts` |
| Home | `app/ui/src/components/ops/{QueueLanes.tsx,queue-lanes-model.ts,use-queues-surface.ts}`; `AdminLiveProvider` |
| Priority · effort | P0 · L |

**Surfaces.** `/tasks` full-width band above GovernorGauges (replaces the `WorkerControlPanel` chips
and the `ActiveTaskCard` list as the live view); Dashboard compact strip later (no done zone, lane
click to `/tasks?queue=`), fed by the ops snapshot's `worker_live.queue_breakdown` and never by a
`queues` subscription, so the landing page does not hold the fast cadence (3.9).

**Content.** Five lanes (maintenance, default, fast, heavy, playback): queue name in mono accent hi,
live load numeral (running plus pending; type count in the meta line [D39]), consumers meta
(`worker ×3` from heartbeats; maintenance-worker ×1, worker ×3, fast-worker ×2 shared with fast,
analysis-worker for heavy with the analysis daemon status, playback-worker), "no consumer" warn
state. Track zones queued / running / done with chips of real tasks (raw type in mono, human label
in `aria-label`): queued shows a width-based fit of pending tasks ("priority, then age") plus `+N`;
running packs without overlap (indeterminate chips without fill show elapsed time in a fixed-width
tabular slot, written by a 1 s timer) plus `+N`; done shows the latest plus a count. Governed types dashed; deferred amber
"waits · 14:05" with the reason family in the title; chips have a max width with ellipsis. Chip
select opens the existing task detail (the only place a per-task stream opens). Header chips:
"restart crate-worker" and "cancel all" (states the cap); no slots stepper (it only affects the
legacy orchestrator); no `fresh=1`.

**Data.** `GET /api/admin/queues` (`ops.tasks.manage`, reads `ui_snapshots('ops:queues','global')`;
missing row → `warming`) and the `queues` surface on `/api/admin/live-stream` (re-reads the row on
each publish in `asyncio.to_thread`, skips seen versions). Payload (`QueuesSurface`, product
design 4.8) per queue: `task_types`, `consumers` (grouped by service, presence only in the hash),
`pending`, `running` (statuses `running`, `delegated`, `completing`, with status), `deferred`
(canonical progress prefix match), `oldest_pending_at`, `completed_5m`, `failed_5m`,
`running_tasks` (≤10, percent null when total ≤ 0), `pending_tasks` (top 5 per queue), `recent`
(`finished_at = updated_at`, duration from `started_at`).

Writer cadence. `publish_tasks_surface_signal` fires after every `update_task` commit, including
progress writes, so with any active task the dirty flag is always set; the service loop
(`stop_event.wait(2)`) is serial behind the scheduler and `ImportQueue.refresh_pending_state()`
(a filesystem walk). Therefore:

- The writer is a dedicated daemon thread in crate-worker, never a service-loop step.
- The dirty flag is honoured only while `admin:live:viewers:queues` exists (3.9), with a minimum
  rebuild interval of 3 s. Without viewers the thread rebuilds every 15 s, and only to write
  `worker_live`; the lanes row is not rewritten. The thread checks the viewer key once per
  second, so the first rebuild after a viewer arrives comes within about 1 s.
- Upsert the lanes row when the hash (without `generated_at`) changes, when the row is missing (a
  `*` invalidation hides rows), or every 30 s while viewers exist.
- `worker_live` is derived from the same query and stays a 15 s write.
- Pending top N: one `LATERAL` per pool (`WHERE status = 'pending' AND pool = :p ORDER BY
  priority, created_at LIMIT 5`, plus a `pool IS NULL` branch read as `default`) and per-pool
  counts, which use the partial index `(pool, priority, created_at) WHERE status = 'pending'`
  (`db/schema_sections/core.py:32`). No `ROW_NUMBER() OVER (PARTITION BY …)`: it sorts every
  pending row on each run (thousands during an import or enrichment backlog) and cannot use that
  index.
- Terminal-status counts need a partial index on `updated_at` (migration) or a `created_at` bound
  (check with `EXPLAIN`).

Heartbeats in `HSET crate:workers` plus a sorted set by last seen. Structured deferral progress
written only when family, reason or until changes; `start_task` clears it. Task catalog adds
`queue`, `priority`, `governed`,
`maintenance_window` (`"none" | "unscoped" | "unscoped_or_large_limit"`; `none` for the types the
window never gates, 4.20), `db_heavy` without reshaping `TASK_POOL_CONFIG` or
`RESOURCE_GOVERNED_TASK_TYPES` literals (site drift tests).

**Rendering and motion.** HTML lanes with absolutely positioned `<button>` chips moved by
`translateX` in one visible loop that runs only while chip positions are unsettled; exponential
follow k = 7; `--p` fill; chips leaving the snapshot stay mounted until their fade ends; elapsed
time from a 1 s timer, so a running task keeps no loop alive; reduced motion places chips at final
positions with CSS percentages and applies changes instantly.

**Mobile.** Under 760 px container each lane stacks: the meta row (queue name, load numeral at
1.6 rem, consumers; `auto auto 1fr`) above a full-width track; zone captions hide.

**Accessibility.** Figure sentence rebuilt per snapshot ("125 task types on five queues. 3 running,
14 queued, 2 deferred by the resource governor."); roving tabindex per lane; text for every state;
polite region only for failures and deferral start or clear (one per 5 s); zone captions decorative.

**Precondition shipped together.** Remove the per-card `useTaskEvents` fan-out on `/tasks` (N+2
EventSources; one Redis pubsub and sync reads each).

**Tests.** pytest: per-pool top N through `LATERAL` (not capped globally), dispatch order, recent
window, throughput, null pool → default, deferred parsing, governed flag, stale-row force write,
hash exclusions, delegated as running, percent null, catalog flags (window rule equal to
`_requires_maintenance_window` for all 14 types), live forwards without building, permissions,
OpenAPI, boundary tests; writer: a stream of `update_task` calls without viewers rebuilds only on
the 15 s tick, with viewers never faster than the 3 s minimum, and the viewer key appearing
triggers a rebuild within about 1 s. Vitest: `reconcileLanes`, component (classes, reduced motion,
chip select, the loop stops once chips settle while tasks keep running, 375 px render), the
provider's stream opens once across N snapshots, the provider closes it after 30 s hidden and
reopens on visible, the Dashboard strip reads the ops snapshot and never subscribes to `queues`,
client 403 gating.

---

### 4.20 `GovernorGauges`

| | |
| --- | --- |
| Site source | `viz/GovernorGauges.astro`, `scripts/viz/governor-view.ts`, `governor-math.ts` |
| Home | `app/ui/src/components/ops/GovernorGauges.tsx`, `governor-format.ts`, `governor-store.ts`; uses the shared `Meter` |
| Priority · effort | P1 · M |

**Surfaces.** `/tasks` embedded under QueueLanes; `/system` first panel of Resources (replaces the
"Resource Governor" `ResourceCard` and the "Batch open/deferred" chip); Dashboard status line (P2),
which reads `GET /api/admin/governor` at most once per 60 s while visible and never subscribes to
the `governor` surface (3.9).

**Content.** Header `RESOURCE GOVERNOR · sampled 5 s ago` / the real maintenance window
("window 02:00–07:00 Europe/Madrid · closed · opens in 4 h 12 m", or "window off" when
`CRATE_MAINTENANCE_WINDOW_ENABLED` is false: the code default is false, the compose files set it
true). Five `Meter`s: load ratio, iowait, swap (over only with the swap gate active), listeners,
"plays · 3 min" (the value is plays in the last 3 minutes; the site's "Streams" label is not
copied, and `active_streams` is an internal gauge id only); scale `max(base, limit * k)` sticky
upward per session; limit 0 reads "any listener defers". Status line: allowed, deferring (server
`reasons[]` joined by ` · `, retry seconds, tasks waiting), allowed with deferred tasks, disabled,
stale ("No sample for 2 min"), warming, partial (`n/a` per gauge). Secondary line: last deferral
(time, task label, family). Read-only. The window applies to 14 governed task types, all only when
unscoped (`_requires_maintenance_window` returns `not _has_specific_scope(params)` for the 11
`MAINTENANCE_WINDOW_TASK_TYPES`, `library_sync` and `repair`); `backfill_track_audio_fingerprints`
is also gated when its `limit` exceeds `CRATE_MAINTENANCE_WINDOW_FINGERPRINT_LIMIT`. No type is
gated "always": a scoped `write_portable_metadata` with `album_id`, for example, bypasses the
window. Two shapes follow (product design 4.8): the task catalog's `maintenance_window` covers
every task type and is `"none" | "unscoped" | "unscoped_or_large_limit"` (`none` for types the
window never gates); `GovernorSurface.window_rule` is a record of the 14 governed types whose
values are only `"unscoped" | "unscoped_or_large_limit"`.

**Data.** `GET /api/admin/governor` (`ops.health.view` or `ops.tasks.manage`): one Redis GET of
the runtime key `crate:runtime:governor` (the `crate:runtime:*` family of the other runtime
samples, product design 4.8), falling back to the PK row of
`ops_runtime_state('resource_governor')`, `warming`
without either; the `governor` surface on `/api/admin/live-stream` from `crate:sse:admin:governor`
(registered in `_build_sse_surface_catalog`). Sampler: a `governor-sampler` daemon thread in
crate-worker (the service loop is serial with slow steps), demand-gated (3.9): every 5 s while
`admin:live:viewers:governor` exists, every 60 s otherwise, checking the key once per second
in between. Each sample goes to the Redis runtime
key (TTL three intervals) plus a publish; the Postgres upsert happens only when the verdict or the
reason family changes, or at most once per 60 s (unwatched at 5 s it would be 17,280 upserts and
17,280 `count_recent_playback_activity` queries a day for the UI alone; dispatch evaluates
resources itself). Pure `evaluate_snapshot()` shared with `evaluate_resources()` so reasons have one source;
`record_decision` keeps the last deferral (read with `max_age_seconds=5`); `deferred_count` as a
`FILTER` in `get_task_activity_snapshot` (accepting the legacy text and the structured progress);
`count_recent_playback_activity` in `db/queries/management.py` (returns `None` on failure) reused by
the governor, `actors.py` and `build_runtime_payload`; index `user_play_events (ended_at DESC)`
(autocommit migration, fixes V8). `/api/admin/metrics/system` derives `resource_pressure` from the
sample and `analysis` from `build_analysis_payload()` (fixes V1, V2). History series: one metric
sample per sampler tick at the idle cadence (60 s), or rename the chart "Load at deferral".

**Rendering and motion.** HTML meters; values written imperatively from a store subscription onto
nodes React does not manage; `useSyncExternalStore` only for discrete state; springs 170/18 (1.8.4);
stale computed with a local clock (received time plus `age_seconds`), threshold 30 s or more;
re-GET when stale. No Nivo.

**Mobile.** Under 860 px container the five meters go to two columns with the first (load ratio)
spanning both, as on the site.

**Accessibility.** `role="meter"` with values updated once per sample; "over · max 0.85" text; polite
region only on verdict or reason-family changes; forced colors.

**Tests.** pytest: `evaluate_snapshot` parity, surface serialization (disabled, nulls, swap gate,
window on and off), last deferral kept, playback counts (pg_db), sampler writes the Redis key and
publishes, no Postgres write between verdict changes inside 60 s, cadence 60 s without viewers and
5 s once the viewer key appears (first sample within about 1 s), endpoint never samples (proc
patched to raise) and falls back to
the row, metrics/system no longer calls the evaluators, migration, window rule parity for all 14
types against `_requires_maintenance_window`. Vitest: format module, component states, settle,
store, gauge copy contains no "stream", 375 px render.

**Decisions and risks.** [D22]. The API container has no governor env today, so the current panel
shows wrong thresholds.

---

### 4.21 `FederationTopology`

| | |
| --- | --- |
| Site source | `viz/Federation.astro`, `scripts/viz/federation-view.ts` |
| Home | `app/ui/src/components/federation/{FederationTopology,TopologyInspector}.tsx`, `topology-layout.ts`, `topology-diff.ts`, `use-topology-animation.ts` |
| Priority · effort | P2 · L; the approve bugfix is P0 and ships alone first |

**Surface.** `/federation` Overview hero (replaces the Node identity, Trust and Streaming cards);
tabs move into the URL (`?tab=&node=`); Streams accepts a node filter.

**Bugfix first.** `PeersPanel.tsx:56` approves with `node_uid` while `approve_pairing` expects the
`pairing_uid` (always 404), and offers Approve on outbound pendings. Fix: approve with the pairing
uid, only on inbound `remote_pending` that has not expired; `approve_pairing` checks `expires_at`;
document or fix the pairing stuck in `accepted` after a remote failure; gate Sync on
`federation.catalog.sync.manage`.

**Content.** Your node at the centre (display name, short fingerprint), peers on an upper arc (at
most 9 plus `+N`), "your listener" phone below ("N listeners · never see the peer URL"). Peer
states: approved healthy (accent edge), approved unreachable (dashed amber, failure count), pending
inbound (amber core, Approve), awaiting peer, expired or failed ("Pair again"), disabled (meta only).
Relay sessions light peer → you → listener and show the "never" edge only when true; serve
sessions mark "serving N". Inspector rail: 01 Descriptor, 02 Pairing, 03 Grant, 04 Relay with real
values. Actions: Approve with preset chips, Change grant (warns that it revokes tickets), Sync
catalog, Disable (destructive confirm), View tickets. No optimistic animation: buttons stay pending
until the snapshot reflects the change (or a 10 s fallback refetch).

**Data.** `GET /api/admin/federation/topology` (`federation.nodes.view`, stale-first, never builds)
and the `federation` surface consumed from `AdminLiveProvider` (snapshot re-read in a thread on
publish, no build fallback; no separate stream route). Builder: one CTE over nodes,
last pairing and last completed pairing per node, active keys by `active_key_id`, grants (not
disabled or revoked, inside the validity window), tickets aggregated by node and direction
(sessions = `last_authorized_at` within 5 min), catalog cursors; `effective_state` derives
`expired`; never URLs, subject hashes or user ids. Catalog counts written by the sync worker
(`_sync_single_peer_catalog`) only on full syncs or non-empty deltas. Projector: the
`scope.startswith("federation.")` branch (`projector.py:234`) narrows to `federation.import`
(today each remote stream rebuilds ops/dashboard over `library_tracks`, B11), and the other
federation events map to `federation-topology` in two classes, so B11 does not come back as a
per-play topology rebuild:

- Structural events (pairing, approve and grant changes, peer and key changes,
  `federation.catalog.sync.completed`, `federation.health.polled`) rebuild with trailing-edge
  coalescing (3.9) over at least 5 s.
- Stream and relay events (`federation.stream.*`: `ticket.created` at `api/federation.py:2071` and
  `proxy.completed` at `api/federation_remote.py:858` fire on every remote track play) only set a
  dirty key. It is honoured while `admin:live:viewers:federation` exists, at most one rebuild per
  5 s; otherwise it waits for the 60 s health-poll floor.

Emit events after commit for
pairing, approve, disable, preset, key changes and rotations, base URL updates, ticket revoke,
subject block, relay ticket creation (wrapped so playback never fails) and health polls.

**Rendering and motion.** SVG viewBox 600 plus HTML labels; React re-renders only per snapshot;
packets animate from a diff of consecutive snapshots (at most one queued sequence per peer and type,
cap 8); first render static; the loop stops when the packet queue is empty. Stale amber only from
the server flag (singletons have no event floor).

**Mobile.** Under 760 px container the inspector rail goes to two columns and secondary peer label
text hides (the label keeps the name), as on the site.

**Accessibility.** Figure sentence; peer labels are `aria-pressed` buttons; polite announcements
throttled to one per 5 s; state in text.

**Tests.** pytest: approve fixes, builder cases, projector routing, event emission, migration,
stream events (N `federation.stream.*` events inside the window produce one build; with no viewer
they produce no rebuild until the health-poll floor).
Vitest: layout, diff, inspector, URL tabs, `PanelState` retry; mocks for `matchMedia` and
`IntersectionObserver`; `TEST_GAP` for rAF.

---

### 4.22 `StackMap`

| | |
| --- | --- |
| Site source | `architecture/SystemMap.astro`, `src/lib/system-map.ts`, `content/architecture/map.ts` |
| Home | `app/ui/src/components/ops/stack-map/{StackMap,StackNodeDetail}.tsx`, `system-map.ts`, `topology.ts`, `stack-map-model.ts`; `app/ui/src/hooks/use-snapshot-stream.ts` (absorbs `use-sse.ts`) |
| Priority · effort | P1 · L |

**Surface.** `/stack` hero (`pages/Stack.tsx`): map, selected-node detail, then "Other containers"
as a `HairlineList`. Replaces `OpsPageHero`, four `OpsStatTile`s and the service cards; drops the
hardcoded `SERVICE_URLS` and emerald/red state styles.

**Content.** Site topology (clients renamed `client:listen` and `client:admin`, `redis-durable`
key) with wide and tall layouts switched by an `@container` query near 1100 px (figure capped about
1320 px; tall worker rows re-spaced to 88 px when boxes grow to 84 px). Each container node:
`StatusDot` (running and healthy on; starting, unhealthy, restarting or OOM warn; exited off with a
dashed box), tech line, `412 / 1536 MB · /music ro · 2 restarts` plus a 2 px meter (amber at 85%).
Memory limits come from the sampler (the container's configured limit), never from the site's
`content/architecture/map.ts`, whose figures match `docker-compose.yaml` alone and not the
production overlay `docker-compose.project.yaml` (crate-api 1536m, readplane 256m, postgres 4g,
projector 768m).
Aggregates: frontends (worst state, `n/m up`), workers group (`n/6 up · X running · Y queued` from
the stack payload). Listen client: `N active · M plays/3 min` from the ops snapshot with its age. Not
deployed services are ghosts; unknown containers go to the list. Detail: image and digest, state,
uptime, "restarts since created" with the created date, last exit and OOM (carried across restarts
by the sampler), memory, mounts, ports, lazy logs, Restart through `ConfirmDialog`; actions and
their reasons come from the server policy.

**Data.** Where the sampler runs is decision [D43]. Default: crate-api, the only Crate service
that mounts the Docker socket (read-only; the Stack actions already run there through
`docker_ctl`). crate-api serves all Admin traffic and the Listen fallback, so the sampler must
never touch the event loop: `docker_ctl._request` is synchronous Unix-socket I/O with a 30 s
timeout, and stats without `one-shot` wait about 1 to 2 s per container for a second CPU sample
(15 to 20 containers do not fit a 10 s interval).

- A dedicated daemon thread, not an asyncio task, holding an owner-checked Redis leader lock with
  renewal (`api/jam.py` heartbeat pattern; 2 API workers), behind an env flag, with backoff when
  the socket is missing.
- Viewer key `admin:live:viewers:stack` (`EX 60`) through `app/crate/admin_viewers.py`, set by the
  Stack snapshot and stream endpoints in `api/stack.py` (product design 4.8, 5.3.1); the sampler
  checks it once per second. While it exists: every 10 s, container list plus
  `GET /containers/{id}/stats?stream=false&one-shot=true` with a 2 s per-call timeout on a bounded
  pool of at most 4; a total budget below the interval, and the remaining stats are skipped (and
  marked `n/a`) when it would be exceeded.
- Without viewers: only the container list, every 10 minutes, no stats.
- If [D43] moves the sampler to crate-worker behind a read-only docker-socket-proxy, the same
  cadence and viewer key apply and the actions move behind the proxy too.

Each sample goes to a Redis runtime key plus a publish, like the other runtime samples (3.9); the
stack stream forwards published payloads. `ui_snapshots('ops:stack','global')` (with
`warming: bool` and defaulted fields) is written only when a container's state changes or at most
once per 60 s, not on every 10 s sample. The payload embeds workers from
`get_worker_live_state()`. `docker_ctl.get_container()` extended (health, OOM, exit
code, mounts, labels); `_request` takes the per-call timeout and returns the HTTP status so timeouts
are not reported as success. Reads never build; SSE reads in a thread with server time per message. Action
policy by compose project and service label for restart, stop, start, detail and logs (the current
`librarian-` prefix list returns 403 for every crate container); actions keep returning 200.

**Rendering and motion.** SVG `role="group"` (never `role="img"` around interactive nodes); nodes
`<g role="button" tabIndex={0}>`; meters with `transform-box: fill-box`; tokens only; 1.2 s flash on
a real restart; a 1 s ticker isolated in its own component for "sampled N s ago" and "SAMPLER
STALLED".

**Tests.** pytest: stats parsing (cgroup v1, v2, unlimited), inspect parsing, policy (including logs
and detail), reads never call `docker_ctl`, stream never builds, lock and demand gating (no stats
call without viewers; the endpoints and the sampler use the same viewer-key constant; first
sample within about 1 s of the key appearing), no `ui_snapshots` write between state changes
inside 60 s, the stream forwards published samples, the sampler never runs on the event loop and
a stats call that sleeps past its timeout delays no request, the budget skips the remaining stats, boundary
(`db/admin_stack_surface.py` does not import `docker_ctl`). Vitest: `Stack.test.tsx` with a fake
EventSource (version guard, deps), model, `system-map` edge routing, compose drift test for the
topology.

**Decisions and risks.** Restart policy for stores, API and Traefik [D40]; sampler placement
[D43].

---

### 4.23 `EventPipelinePanel`

| | |
| --- | --- |
| Site source | `viz/OutboxSequence.astro`, `scripts/viz/steps-view.ts`, `src/lib/json-lines.ts` (`typedAt`) |
| Home | `app/ui/src/components/ops/event-pipeline/{EventPipelinePanel.tsx,trace-rows.ts}`, `app/ui/src/hooks/use-event-pipeline.ts` |
| Priority · effort | P2 · M |

**Blocking prerequisite.** `list_domain_events` (`db/domain_events.py:243-255`) never reads `>`
against real Redis (an empty PEL returns a truthy list), so the projector has consumed nothing since
2026-04-27; fix it reading the PEL and new messages in the same tick (deferred events must not block
the queue), with a test whose fake returns the real shape. Ship it with trailing-edge coalescing of
ops refreshes over 60 s (3.9; otherwise V5 fires once consumption works, and a leading-edge
debounce would drop the last change of a burst from the push-based ops views).

**Surface.** `/system` panel "Event pipeline" (`#event-pipeline`, scroll into view on a lazy route)
below Resources. Dashboard "Event Bus" and "Recent domain events" cards collapse into a summary
line (one fetch, link only with `ops.health.view`); the "SSE surfaces" tile is kept.

**Content.** Five lanes: writers (api · worker), postgres (`domain_event_outbox`), relay (a phase of
crate-projector, not a container), redis-durable (`crate:domain_events`), projector (group
`projector`), each with a readout (pending, leased, dead letters, oldest pending age; claimed,
delivered, failed, tick ms; latest sequence, length, DLQ; consumer pending and lag after the ack,
consumers, batch ms). Six trace rows for a real event (default the latest; selecting a row in the
12-event list pins it): enqueue, claim, `XADD` (new or deduplicated), `XREADGROUP`, projection (per
action type, batch timing labelled as batch), `XACK` with "enqueue → ack" time. State: unknown,
stalled (record older than max(90 s, 3 × heartbeat)), degraded (Redis down, dead letters, oldest
pending over 60 s, lag over the batch limit or no acks), flowing, idle.

**Data.** `GET /api/admin/event-pipeline` (`ops.health.view`): one GET of the runtime Redis key,
falling back to the PK row of `ops_runtime_state('domain_event_pipeline')`; no stream reads, no
build. The projector loop writes the record to the Redis key (TTL a few heartbeats) and publishes
the `pipeline` surface after an ack batch only while `admin:live:viewers:pipeline` exists
(checked at most once per second, so a new viewer sees the next batch within about 1 s); its
15 s heartbeat refreshes the key's `heartbeat_at` (no DB write); the Postgres row is written only
when the pipeline state changes (flowing, idle, degraded, stalled) or at most once per 60 s (3.9).
Trace data from an optional `trace=` collector passed to
`relay_domain_events` and `process_domain_events` (returns unchanged, existing tests assert exact
dicts); pure logic in `app/crate/event_pipeline.py`; counters reuse `get_domain_event_runtime`
(without `XREVRANGE`) and `get_outbox_runtime` rewritten as per-status subqueries on partial
indexes. Subjects and user ids are redacted before persisting (user scope, `home:discovery`,
`home:user:*`, snapshot subjects). Privacy fix independent of the panel: drop `payload_json` from
`recent_events` in the ops snapshot and SSE.

**Rendering and motion.** HTML grid lanes and rows (site recipe); one trace replay per new event or
selection (about 0.18 s per row, 60 characters per second typing only on selection); the full text
stays in an sr-only span. Data arrives through the `pipeline` surface from `AdminLiveProvider`
(the stream exists from plan Task 2.14 on); no polling.

**Mobile.** Under 760 px container the five lanes stack as rows (lane name over its readout, flow
order kept top to bottom) instead of shrinking the site's mono text below 10 px; trace rows keep
`3ch minmax(0,1fr)` and wrap.

**Tests.** pytest: consumption fix, collector rows, deduplicated flag, redaction, counts with
pg_db, endpoint (permission, shape, Redis key first then row fallback, no builder calls, status
thresholds), daemon writes the Redis key after the ack only while viewed (and within about 1 s of
the key appearing), heartbeat without a DB
write, Postgres write only on a state change or once per 60 s. Vitest: `trace-rows`, panel states,
reduced motion, 375 px render.

---

### 4.24 `RedisPair`

| | |
| --- | --- |
| Site source | `viz/RedisPair.astro`, `scripts/viz/redis-view.ts` |
| Home | `app/ui/src/components/ops/redis-pair/{RedisPair.tsx,redis-pair-model.ts,use-redis-runtime.ts}` |
| Priority · effort | P2 · M |

**Surface.** `/system`, a full-width band after Resources, before Metric Streams. Read-only; links
to Settings cache controls (`settings.manage`) and Stack (`ops.runtime.manage`), shown only with the
capability.

**Content.** Cache pane (`crate-redis`): live flags line, 10×4 waffle (filled cells =
`used/maxmemory × 40`, clamped; grey cells = keys without TTL, cyan = TTL share of keys, labelled as
a share of keys, not bytes; `maxmemory 0` shows an unbounded state), memory meter, RSS and
fragmentation, keys, hit ratio, ops/s, a 6-line log of sample deltas (never per-key: MONITOR and
keyspace notifications are banned). Durable pane (`crate-redis-durable`): flags, last 6 domain events
(newest last; example `XADD crate:domain_events · user.likes.changed · user:42`), broker queues
"waiting in Redis (not prefetched)" with delayed and dead counts, projector lag and dead letters,
memory meter amber at 75% (noeviction rejects writes at 100%), AOF status. The durable meter's
100% is the instance's `maxmemory` (384 MB, `--maxmemory 384mb` in both composes), not the
container `mem_limit` (512m in `docker-compose.yaml`, 384m in the home compose): `noeviction`
rejects writes at `maxmemory`. States: loading, empty
("No Redis sample yet"), stale (about 60 s), partial (one instance unreachable with the error kind),
single instance (one pane with an amber note).

**Data.** `GET /api/admin/redis`: one GET of the runtime Redis key, falling back to the PK row of
`ops_runtime_state('redis_runtime')`, `{available: false}` without either. Sampler
`app/crate/redis_runtime.py` with its own short-timeout clients (0.5 s; error kinds from redis
exceptions), `pipeline(transaction=False)` with `raise_on_error=False` (INFO sections plus
`CONFIG GET`, falling back to INFO), broker counts over a single `QUEUE_NAMES` tuple tested against
`TASK_POOL_CONFIG`, `get_domain_event_runtime(limit=6)` without payloads, hostname only. It runs in
its own daemon thread (not a service-loop step), demand-gated (3.9): every 15 s while
`admin:live:viewers:redis` exists, every 300 s otherwise, checking the key once per second in
between; each sample goes to the Redis key plus a
publish, and the Postgres row is written only when an instance's state changes or at most once per
60 s. It seeds counters from the runtime key or the row and nulls windows on `run_id` or uptime
change (deltas after an idle gap are labelled with their real window).
`config.get_broker_redis_url()` uses `urlsplit` (fixes URLs without a path) and replaces the inline
derivation in `broker.py` (update `test_redis_runtime_roles.py`).

**Rendering and motion.** HTML/CSS cells, meters and lists; data through the `redis` surface from
`AdminLiveProvider`, no polling; "out" flash 360 ms on eviction; reduced motion applies states
directly.

**Mobile.** Under 760 px container the two panes stack (cache above durable), as on the site.

**Tests.** pytest: parse and delta maths (resets), TTL share, unbounded memory, CONFIG denied, same
instance, error classification, no password in payload, broker keys and queue drift, cadence
(300 s without viewers, 15 s once the viewer key appears with the first sample within about
1 s, no Postgres write between state changes inside 60 s), the durable meter scales to
`maxmemory`, endpoint (Redis key first, row fallback). Vitest: model, component states,
capability-gated links, 375 px render; `SystemHealth.test.tsx` (new).

**Ops findings to raise.** `crate-redis` sets `--maxmemory 512mb` inside a 512 MB container (OOM kill
before eviction; PD45 lowers `maxmemory`, 6.5); volatile-lru plus growing no-TTL keys leads to OOM
errors; the durable 75% threshold needs confirming; `clear_cache type=all` runs a synchronous
`SCAN` in a request.

### 4.25 Site visuals with no product home

| Site visual | Decision |
| --- | --- |
| Hero particle mark, screencast, like trace (scroll story), roadmap cards | site only |
| `ApiTerminal` | site only; the terminal recipe is reused for Admin Logs and the task event log |
| `UuidDerivation` | recipe reused in the Global catalog duplicate review readout (optional) |
| `ScaleFigures` | recipe reused for library size strips (Dashboard, Global catalog) with `~` for estimates |
| `Explore` rows, `ChapterToc` | optional Admin Dashboard chapter index and long-page jump links [D37] |

---

## 5. Patterns

Patterns for surfaces without a site visual. Full per-screen notes are in `coverage.md` (A1 to
A26, L1 to L29); this section is the normative version.

### 5.1 Page skeleton

Shell (5.4) → page header (5.2) → panels and bands (3.1) → hairline lists, tables and grids (5.5).
No card, glow or icon tile on headers; the first panel below the header carries the top rule.
Sections are 32, 48 or 64 px apart.

### 5.2 Page header

- Optional back link: mono `← Artists` in `text-text-subtle`, `text-text-primary` on hover.
- Eyebrow: `MonoLabel size="eyebrow"`. Admin pages that back a site chapter carry its number
  (`<accent>03</accent> / Acquisition`: 01 Health, 02 Imports, 03 Acquisition, 04 Enrichment,
  05 Genres, 06 Analysis & Insights, 07 Operations); other pages carry context (`Collection ·
  Albums`, `Admin · Users`).
- Title: `font-display font-extrabold text-display-page leading-display tracking-headline
  text-balance`; entity pages use `text-display-entity`, at most two lines with ellipsis.
- Lede (optional): Bricolage 500, `text-text-muted`, 36ch.
- Meta row: a `MonoLabel` meta list (`12 albums · 143 tracks · added 3 d ago`) or a `StatStrip` of
  2 to 4 `StatNumber`s.
- Actions: desktop right-aligned on the title baseline (pill CTA plus ghost chips); mobile a wrapped
  row below.
- Entrance once per route (opacity plus 12 px, 500 ms `ease-out-expo`); none under reduced motion.
- Homes: Listen restyles `@crate/ui/domain/navigation/PageHeader` and `domain/hero/PageHero` in
  place; Admin gets `PageHeading` (replaces `OpsPageHero`, its three inline copies and seven ad-hoc
  `h1` recipes). Converge later if Admin adopts the shared header.

### 5.3 Section headers and content rails

- Data or instrument sections use `InstrumentPanel`.
- Content rails (Home, Artist, Explore; Admin discography and related albums) use the shared
  `SectionHeader` (`domain/lists`, 17 Listen files), restyled once: optional `MonoLabel` eyebrow,
  title `font-display font-bold text-subhead tracking-tight`, count in
  mono tabular `text-text-subtle`, "See all →" as an underline link (accent-hi underline drawn from
  the left, 450 ms `ease-snap`, 44 px hit area on coarse pointers).

### 5.4 Navigation chrome

Admin (`components/layout/{Shell,Sidebar,SearchBar,CommandPalette}.tsx`):

- Flat canvas, no glass; bottom hairline appears after scroll.
- Sidebar: group labels `MonoLabel`; items sans 14; active item = 2 px accent-hi bar on the left plus
  `text-text-primary` (replaces the filled `bg-white/10` pill); badges = mono tabular count plus
  `StatusDot` (`warn` issues, `on` running); the 72 px collapsed rail keeps dots only. Groups follow
  the site chapters (PD14 / [D18], plan Task 3.2); routes and capability gates do not change.
- Header: mono breadcrumb (`ADMIN · 07 / OPERATIONS · TASKS`, chapter number in accent hi); back and
  forward as ghost icon buttons without shadows; search per 5.6.
- Command palette: popover recipe, `MonoLabel` groups, hairline rows with the active bar, keyboard
  hints as mono tags, task actions show their queue (catalog flags from 4.19).
- Mobile: top bar plus a sheet that reuses the sidebar recipe.
- Skip link and route-change focus per 3.10 (both shells).

Listen (`components/layout/*`):

- Desktop sidebar: same item recipe; collection sections as hairline rows with mono counts; remove
  the Discovery-radio glow driven by `useAudioVisualizer` state.
- Top bar: keep the transparent-header pattern; gradient fade instead of blur where content scrolls
  under; search per 5.6; user menu per 5.9.
- Mobile tab bar (`MobileBottomNav.tsx`): icon (`@crate/ui/icons`, 22 px) plus mono 10 px label at
  `.08em`; active item accent hi plus a 2 px top bar drawn with `scaleX` `ease-snap`; inactive
  `text-text-subtle`; no filled pill; safe areas; 44 px targets.
- Mini player: display title 15 px weight 700, artist mono 11 px `text-text-subtle`, 1 px accent-hi
  progress line on its top edge written through a ref from a `usePlayerProgress` leaf, 36 px play
  disc.
- Page transition: opacity plus 8 px, 350 ms `ease-out-expo`, replacing `animate-page-in`; focus
  moves to the page `h1` when it ends (3.10).

### 5.5 Lists, tables, track rows, media grids

- Hairline list: `HairlineList` (2.2); hover `bg-accent-action/4`; active bar plus wash.
- Tables: semantic `<table>` when there are three or more comparable columns or sorting (Users,
  Roles, task history, reconcile runs, route latency, Federation streams, i18n bundles). No zebra
  stripes, no cell borders; `thead` mono 10.5 px `.14em` upper `text-text-subtle` with a bottom
  hairline; numeric cells right-aligned tabular mono; status cells `StatusDot` plus a word; sortable
  headers are buttons with `aria-sort` and a mono arrow; sticky header on the canvas; columns dropped
  at 1000 and 760 px; skeletons keep the geometry with `—`.
- Track row (Listen `domain/tracks/TrackList`, `AlbumTrackList`, `PlaylistTrackList`,
  `QueueTrackRow`, search; Admin `TrackTable`): index | title over artist | trailing meta | duration
  | actions. Index swaps to a play glyph on hover or focus; playing row = active bar plus title in
  accent hi; trailing mono `124 · 8A` on desktop from data already in the row; quality and explicit
  flags as mono tags; remote items carry `via <node>` (5.13); duration tabular, never re-rendered per
  tick.
- Media grid and rail (`MediaGrid`, `MediaRail`, `EntityCard`, `MediaCover`): square covers without
  shadow, 1 px inset hairline (`ring-1 ring-inset ring-border-quiet`), title sans 14/500 truncated,
  meta mono 10.5 px (`2019 · LP`); hover: hairline to `accent-action-hi/40`, title to accent hi, no
  lift or scale; play overlay = 40 px accent disc on hover or focus; placeholder `accent-action/16`
  with mono initials.

### 5.6 Forms

- Field: `MonoLabel` above (8 px gap); input 40 px tall (44 coarse), transparent on the canvas,
  `bg-input` (`--color-input`) on cards, `border-border-quiet`, `rounded-lg`, sans 15 `text-text-primary`,
  placeholder `text-text-subtle`; focus outline accent hi plus border `accent-action-hi/40`; helper
  text mono 11.5 px `text-text-subtle`; error = `StatusDot warn` plus the message in
  `state-warning-text` with `aria-invalid` and `aria-describedby`, no red border; validate on blur;
  field errors never raise toasts.
- Search (`SearchInput`, Admin `SearchBar`): same recipe, glyph in `text-text-subtle`, mono `⌘K` tag in
  Admin, ghost clear button; debounced queries (fix the Radio seed search, which fetches full
  `/api/genres` per keystroke).
- Select: 7 options or fewer become a chip group; more use a select whose trigger follows the field
  and whose list follows 5.9.
- Switch: 32×18 hairline track; off thumb `text-text-subtle`; on track accent hi with a canvas thumb.
- Segmented control: becomes a chip group.
- Checkbox and radio: hairline box; checked = accent-hi fill with a canvas mark.
- Textarea: field recipe; mono for code (playlist rules, JSON).
- Slider (crossfade seconds, path steps, volume, EQ bands): 2 px track, accent-hi fill through
  `--v`, 14 px ring thumb, tabular mono value, keyboard steps.
- Submit: keeps its label width and shows an inline busy glyph with `aria-busy`.

### 5.7 Buttons

- Primary CTA: pill, accent fill, canvas text, sans 500 13 px, 36 px tall, 16 px horizontal
  padding; hover `scale(.975)`, press `scale(.95)` in 80 ms (longhand spring with fallback); focus
  offset 4. Listen radius per [D2].
- Secondary: `CratePill variant="action"` (ghost chip, no `aria-pressed`) or shadcn ghost `Button`.
- Round play (`domain/media/PlayButton`): 40 px in rows and tickets, 56 to 64 px in heroes and
  fullscreen; accent disc with a canvas triangle.
- Icon button: ghost, no tile, no shadow, hover `bg-accent-action/4`, 32 px (44 coarse).
- Link: underline link (5.3).
- Destructive: neutral in place; the confirm button inside the destructive dialog is the only red
  control and states the consequence [D4].
- Spinners only inside buttons. `animate-spin` elsewhere is migrated to reserved geometry or
  `ProgressHairline` (about 48 Listen and 51 Admin files, gradually).

### 5.8 Tabs and filters

- Switching panels: `role="tablist"`, mono 11.5 px `.14em` upper text tabs, active tab with a 2 px
  accent-hi underline; Admin Federation, Download, Artist, Settings sections, i18n panes; Listen
  Library, Extended and Fullscreen player tabs.
- Filtering a list: a `CratePill` group with `aria-pressed`.
- Selected tab or filter lives in the URL (`?tab=`, `?section=`, `?queue=`, `?check=`, `?release=`,
  `?genre=`).
- Mobile: one horizontally scrolling row.

### 5.9 Dialogs, sheets, popovers, menus, tooltips

- Modal: `bg-surface-popover` (or object) with a hairline and `rounded-panel` (the Listen 12 px
  pin is aligned [D2]); scrim `bg-surface-scrim` (canvas at .72, 1.9.4) without blur, never the
  overlay or popover fill; header `MonoLabel` eyebrow plus a
  Bricolage 700 title (1.4 to 1.6 rem, `-0.03em`); body `text-text-muted`, 60ch; footer with a top
  hairline, ghost cancel and CTA confirm on the right; widths 420, 560, 760 px; entrance `popIn` or
  `sheetUp` with longhand easing; 200 ms fade under reduced motion.
- Confirm dialog: one implementation (`@crate/ui/composites/ConfirmDialog`; Admin's local copy with
  15 consumers migrates, which makes the composite legitimately shared); a mono consequence line
  (`12 files · 1.4 GB · moves to Library Trash`); typed confirmation for wipe and rebuild.
- Sheets: 36×4 grabber in `border-border-quiet`, hairline rows; remove `listen-mobile-eq-glass`.
- Popovers and menus: popover surface, hairline, `rounded-panel`, one soft shadow; `MonoLabel`
  groups; items sans 14, 36 px tall (44 coarse); hover `bg-accent-action/4`; checked item accent-hi
  text plus `StatusDot`; separators `border-border-quiet-subtle`; shortcuts as mono tags.
- Tooltip: object card, hairline, mono 11 px `text-text-muted`, 28ch max, 400 ms delay.

### 5.10 Toasts and inline feedback

- Inline first: when the control is still on screen, feedback happens in place (scrambled label swap
  such as "Copied", the panel readout, a `StatusDot` change). A toast only when the outcome outlives
  the control (navigation away, a background task finishing, a network error) [D10].
- Skin: drop `richColors` in both apps (`app/ui/src/App.tsx:466`,
  `app/listen/src/main.tsx:71`); object card, hairline, `rounded-panel`, 12/16 px padding, 380 px max;
  message sans 14; the type is a `MonoLabel` key word (`SAVED`, `QUEUED`, `FAILED`) in accent hi for
  success and info, `state-warning-text` for warning and error; description mono 11.5 px
  `text-text-muted`; action as a ghost chip; icons optional through the app's icon set.
- One config in `@crate/ui/lib/toaster-config.ts`, mounted by both apps in the same change.
- Admin task toasts carry the task id in mono and "Open task →" (`/tasks?task=`).
- Listen keeps `notify` and its `toast-policy`.

### 5.11 Empty, loading, error, stale, warming, offline

Reserve the real geometry; never a spinner inside an instrument; never a dashed box with a big icon.
States are the table in 3.4. Component changes:

- `LoadingState`: section variant = final layout with `—`; route variant = `MonoLabel` `LOADING`
  over a 120 px indeterminate hairline, shown only after 200 ms (replaces `CrateLoader` in panels).
- `EmptyState` (`domain/lists`): `inline` is the default, no icon; `panel` and `dashed` deprecated.
- `ErrorState` (`primitives/ErrorState`): page variant = eyebrow (`ERROR · 503`, `NOT FOUND`),
  Bricolage 800 title around 2.5 rem, `text-text-muted` body, Retry CTA, Back link, no red icon;
  compact variant for panels (Admin's `components/ui/error-state.tsx` is dead and is deleted).
- Offline (Listen `domain/offline/OfflineBadge`): mono `OFFLINE` tag with a ring dot; disabled
  actions explain why in text.

### 5.12 Progress

- Determinate and indeterminate: `ProgressHairline` (2.3).
- Task progress (Admin tasks, health, sidecar, enrichment; Listen ZIP download, remote import,
  upload): progress hairline plus a mono phase line from `TaskProgress` (`phase · item ·
  done/total`) plus elapsed time.
- Fixed phase sequences (`process_new_content` 9 phases, `library_pipeline` health → repair → sync,
  write then rehydrate, setup steps): `StepRail`, drawing a stage only for a phase the handler
  actually emits through `TaskProgress`.
- Staged imports (`/imports`, product design 4.3) run `import_queue_item` / `import_queue_all`
  (`worker_handlers/acquisition.py:2597`), which emit only info events, never call
  `process_new_content` and end with `start_scan()`; `import_queue_items` has no `task_id`. Until
  that handler emits real phases and rows link to their task, an import row shows a `StatusDot`
  with its status word (pending, queued, importing, imported, failed), not a phase rail.

### 5.13 Remote provenance (Listen; Admin global catalog)

- Mono 10.5 px tag `via north.crate` in track rows, search results and Admin global catalog sources,
  with a ring `StatusDot` when `availability.stale` or not `healthy`.
- Listen Info tab "Source" section: static mini route `north.crate → your node → this device ·
  relayed` from `Track.remote` and `lib/playback-provenance.ts`.
- The full federation diagram stays in Admin (4.21) [D27].

### 5.14 Player surfaces (Listen)

- Player bar (`components/player/PlayerBar.tsx`, `bar/*`): display title 15 to 16 px; artist and
  album sans `text-text-muted`; tabular mono time codes written through refs; seek = 1 px hairline
  growing to 3 px on hover with an accent-hi fill; round play disc; ghost secondary controls; volume
  per the slider recipe; `QualityBadge` becomes a mono tag (`FLAC · 24/96`); `WaveformCanvas` and
  `SpectrumPlayButton` only where an analyser exists, colours from tokens; mobile shows the hairline
  only. Fix in the same pass: `usePlayerBarController` re-renders every tick and
  `useAudioVisualizer` writes arrays into state at 20 fps (move both to refs). Real loudness
  envelope on the seek track only after `rms_envelope` exists (4.11); nothing synthetic before.
- Fullscreen player: artwork without shadow plus inset hairline; title Bricolage 700
  `clamp(1.6rem, 6vw, 2.2rem)` two lines; artist and album mono; 44 px seek hit area; 64 px play
  disc; text tabs; EQ sheet without glass.
- Extended player: header `MonoLabel NOW PLAYING · from <source>` from `playSource`; text tabs;
  Suggested tab rows with mono `92% · 124 BPM · 8A` from the similarity distance.
- Queue: header `QUEUE · 24 tracks · 1 h 42 min` (summed client-side), source line, track rows, past
  tracks `text-text-subtle`, transition strip (4.11).
- Lyrics: synced lines in Bricolage 700 (active `text-text-primary`, past `text-text-subtle`, future
  `text-text-muted`), active line underline at `scaleX(lineProgress)` through a ref from a leaf;
  footer `LYRICS · synced · lrclib`; only the active-line leaf subscribes to `usePlayerProgress()`
  (today the whole list does).
- Visualizer family: accent palette by default (album palette opt-in [D16]); `data-crate-effects`
  `off` shows a static frame.

### 5.15 Mobile layouts (Capacitor and narrow web)

- Single column under 760 px, visual before text, secondary labels hidden, chip rows scroll.
- 44 px targets; `--listen-safe-*` for full-bleed bands; status bar overlays the webview.
- Data-driven visuals only (no analyser on the stable pipeline); point budgets halved; no blur
  entrances; DPR 2.
- Mono uppercase labels wrap or truncate with `title`; never size to English.

### 5.16 Desktop shell (Tauri)

- Same Listen code; any Listen visual change also runs Desktop typecheck and tests.
- `backgroundThrottling: "disabled"`: loops must stop themselves when hidden (3.8).
- CSP `default-src 'self'`, `font-src 'self' data:`, no `blob:` workers: fonts stay bundled; an
  OffscreenCanvas worker must be a Vite-emitted file.
- macOS uses the native title bar. Linux frameless titlebar: mono window title, `@crate/ui/icons`
  window controls, hover `bg-accent-action/4`, close hover neutral.
- Linux GTK accent handling [D17].

---

## 6. Governance

### 6.1 Token policy

- Colour values change only in `app/shared/ui/lib/appearance-token-registry.ts`; `tokens/themes.css`
  is generated (`npm run design-system:tokens:generate`) and checked
  (`npm run design-system:tokens:check`, `appearance-theme-css.test.ts`).
- Non-colour tokens live in `tokens/{typography,radius,animations,semantic,surfaces}.css` `@theme`
  blocks; `cn.ts` registers new font-size, tracking and leading keys.
- No literal colours in Listen or `@crate/ui` (drift `actionableRawColors` is 0): SVG through
  `currentColor` and token utilities, canvas and WebGL through `readCssColorToken`, Nivo through a
  resolved theme. Admin is outside the drift inventory; its literals are removed screen by screen
  (1.9.3).
- Arbitrary values (`text-[..]`, `tracking-[..]`, `rounded-[..]`, `shadow-[..]`, `z-[..]`) are
  budgeted per file by `design-token-policy.test.ts` (shared and Listen, exact counts). New
  recurring values become tokens (1.9.4); one-off instrument micro sizes live in app recipe CSS.

### 6.2 Drift budget

Current state of `node scripts/design-system/drift-inventory.mjs --check` on `feat/crate_v3`
(fails the CI step "Check design-system drift budget"):

| Metric | Actual | Ceiling | Fix |
| --- | --- | --- | --- |
| `totals.inlineStyles` | 93 | 91 | `EqBands` geometry to SVG attributes and classes (4.1): 93 → 89 |
| `totals.legacySemanticUtilities` | 1 | 0 | `app/listen/src/components/upcoming/ShowCard.tsx` `bg-card` → `bg-surface-object` |
| `semanticTokens.definitions` | 138 | 134 | raise the ceiling deliberately, listing the v3 tokens in the commit |
| `semanticTokens.foundationDefinitions` | 95 | 91 | same |
| `totals.arbitraryUtilities` | 61 | 64 | lower the ceiling to 61 |

Rules:

- Fix the overruns before the next screen lands.
- Token ceilings rise only by the number of tokens added in the same commit, each referenced
  (`unreferencedTokens` stays 0).
- Data-driven geometry never adds `style={{}}`: SVG attributes, refs, `:nth-child` recipes.

### 6.3 Policy tests

| Test | Enforces | v3 action |
| --- | --- | --- |
| `app/shared/ui/export-usage-policy.test.ts` | each `@crate/ui` module imported by an app (or allowlisted) | both-apps rule is review-only; no parking in the allowlist |
| `app/shared/ui/design-token-policy.test.ts` | arbitrary value budgets, icon sizes | update when `ShowCard` is deleted |
| `app/shared/ui/lib/color-contrast.test.ts` | AA pairings per skin | add `--text-subtle` on canvas, object, popover; `--accent-action-hi` on canvas, object; `--state-warning-text` on canvas, object |
| `npm run design-system:layers` | primitives/composites/domain layering | |
| Listen `design-token-policy`, `radius-policy`, `badge-policy`, `genre-pill-policy`, `toast-policy`, `layout-policy` | Listen conventions | `radius-policy` learns the `data-slot="chip"` exemption [D2] |
| Listen `component-policy.test.ts` | raw `<button>` budget (exact, 110), local copies of shared names | new instruments use primitives or shadcn `Button`; budget changes are explicit |
| Listen `AppRouter.bundle.test.tsx` | lazy boundaries, no `lucide-react` | add assertions for new heavy surfaces |
| Listen `catalogs.test.ts`, `i18n:check` | key parity, placeholders, localized prefixes | add `stats.heatmap.`, `stats.headline.` to `fullyLocalizedStatsPrefixes` when touched |
| `appearance-token-registry.test.ts`, `tokens/runtime-contract.test.ts` | registry outputs | cover new tokens and the warning hue; assert `--surface-popover` resolves to `--crate-token-surface-popover-*` and `bg-surface-popover` / `bg-surface-scrim` exist (1.9.2) |
| pytest `test_openapi_contract.py`, `test_db_facade_exports.py`, `test_db_access_boundaries.py`, `test_runtime_boundaries.py`, `test_listen_read_latency_contract.py` | API and DB rules | every new route and surface asserts its contract; latency contract asserts no `library_tracks` and no in-request builds |

### 6.4 Placement and exports

Section 2.1 rules, plus:

- A shared module lands in the PR where both apps import it directly.
- `.ts` modules outside `lib/` need explicit `exports` and `publishConfig.exports` entries.
- Shared components never import icons, i18n, toasts, router hooks, API clients or player contexts.
- Admin duplicates are consolidated, never tripled (three `ShowCard`s today; two `ConfirmDialog`s;
  Settings' local `StatusDot`).

### 6.5 Site drift coupling

The site's Vitest suite (`app/web/src/content/*/viz.test.ts`, `src/lib/source-drift.ts`) reads product
files from its own worktree root. `app/web` exists only on `feat/website`, so the PR that merges
second updates the site test or regenerates `src/data/scale.json`.

| Product file | Pinned shape | v3 rule |
| --- | --- | --- |
| `app/ui/src/pages/Health.tsx` | `CHECK_LABELS`, `CHECK_DESCRIPTIONS` literals | labels move to `repair_catalog.py` keyword arguments appended after the positional strings; site test switches to the catalog |
| `app/listen/src/lib/equalizer.ts` | `EQ_PRESETS` block, `label: "…"` entries, `EQ_GAIN_MAX = 12;` | do not move or reshape; preset labels go to `lib/equalizer-labels.ts` |
| `app/crate/repair_catalog.py` | positional `RepairCatalogEntry(` strings | append keyword arguments only |
| `app/crate/genre_taxonomy.py` | `_RAW_GENRE_DEFINITIONS`, `GenreDefinition(`, `eq_gains=_EQ_X`, `_EQ_X = (…)` | keep literals; core changes need a signed release |
| `app/crate/db/repositories/genres_taxonomy_edges.py` | `VALID_RELATION_TYPES = {…}` | four types; suppression as a column |
| `app/crate/data/taxonomy/crate-core-1.0.0.json` | id, version, digest, released_at | signed artefact |
| `app/crate/enrichment.py` | fetch order, TTL dict, interval dict, `raw = config.get("enrichment_parallelism", 3)` | keep literals; do not mention the constants above their definitions |
| `app/crate/resource_governor.py` | `DEFAULT_*`, `RESOURCE_GOVERNED_TASK_TYPES = frozenset(` | pure helpers added around them, not reshaping them |
| `app/crate/actors.py` | `"name": TaskPoolConfig("queue"` entries | new tasks require regenerating `scale.json` |
| `app/crate/portable_metadata.py`, `db/queries/portable_metadata.py` | sidecar keys, `PORTABLE_SCHEMA_VERSION = 1`, identity tag literals, `"bpm": track.get("analysis_bpm")` lines | keep literal lines; new view functions go beside them |
| `app/crate/audio_analysis.py` | `LoudnessEBUR128` | keep |
| `app/crate/api/browse_media.py` | `MOOD_PRESETS = {…}` | moves to `app/crate/moods.py`; site test path changes |
| `docker-compose.yaml` | redis flags | PD45 lowers `crate-redis` `maxmemory` (plan Task 5.4); the branch that lands second updates the site test (plan Task 7.6) |
| `app/crate/api/auth.py`, access tokens repository, capabilities schema | skipped on main | allowlist meta constant after the matcher function |

Site claims checked against the code. Correct, and not to be "fixed": the Radio weights panel
(discovery profile, 4.9; only "Camelot" → "Key"), the Paths costs (parent, child and influence 1.0,
fusion 1.6, related 2.5, as in `db/paths_scene._genre_neighbors`), `NIGHT_HOURS` (`[22, 23, 0..5]`,
as `_NIGHT_HOURS` in `db/queries/user_library_stats_signal.py`), and the `redis-durable` flags.
Two settings are easy to mix up there: crate-redis-durable has container `mem_limit 512m` in
`docker-compose.yaml:167-176` (384m in the home compose) and `--maxmemory 384mb` in both. The site
test (`content/architecture/viz.test.ts`) reads the `redis-server` flags, so it pins
`--maxmemory 384mb` and the policy (`content/architecture/viz.ts:10`), not the 512m container
limit; the memory figures in `map.ts` are not tested at all. RedisPair's durable meter uses
`maxmemory` (4.24). Not backed by the product, so never copied as fact: the system map memory
limits for production, which
deploys `docker-compose.yaml` plus the `docker-compose.project.yaml` overlay (`scripts/deploy.sh`):
crate-api 1536m (site 768 MB), readplane 256m (site 128 MB), postgres 4g (site 1 GB), projector 768m
(site 512 MB). The Stack map reads limits from its sampler, never from the site's `map.ts` (4.22).
Also unchecked: `genreRoute` parity and the mix numbers.

### 6.6 Visual baselines

- Listen: `npm run test:listen-visual` (Chromium, 1480×900 and 375×812, reduced motion, animations
  disabled, strict API fixtures that throw on unknown paths, darwin and linux baselines). All 44
  existing PNGs are stale after the token commit. Re-baseline per screen, intentionally, in the
  Playwright container CI uses. Fixtures first: Radar with setlist data, an EQ panel state, Explore
  landing with the mood map, `/paths/:id`, Settings with devices and the Connect flag.
- The reduced-motion contract makes captures deterministic. WebGL canvases are masked or render
  their static fallback.
- The P0 Listen instruments (player bar with the EQ glyph, EQ panel, Stats heatmap band) are also
  captured in `light` and `crateRed` [D41], the variants
  `docs/technical/listen-design-system-visual-qa.md` treats as release gates.
- Admin: a small capture set (Dashboard, Tasks, Health, Genres, Album, Settings, System) from plan
  Task 0.11, recorded before Task 1.0 and extended by each P0 page task; the Admin bundle ceiling
  from plan Task 0.12 (PD48 / [D25]).
- `npm run test:appearance` covers token contracts (Chromium in CI).

### 6.7 Bundle and performance budgets

- Listen initial JS: 300 KB gzip (`scripts/check-bundle-budget.mjs`); about 198 KB used. Run
  `check:bundle` on every Listen change that adds a visual or dependency; add it to
  `test-frontend.yml` (today only `build-android.yml` runs it).
- Lazy chunks are not budgeted, so lazy boundaries are the real budget (3.8).
- Admin has no budget today; Nivo's `charts-vendor` is about 138 KB gzip. An Admin
  `check:bundle` lands with Listen's in plan Task 0.12, at today's measured number plus a small
  margin, so a regression shows up in the PR that causes it rather than against a baseline that
  already includes it. Each Phase 3 and Phase 5 PR records its delta and raises the ceiling
  deliberately, and each instrument route gets a lazy-boundary assertion (Admin's equivalent of
  `AppRouter.bundle.test.tsx`).
- Fonts: no new weights or families; `check:bundle` does not see fonts, so the Capacitor asset list
  is checked when fonts change.
- CSS has no budget; visual-specific CSS lives in the app, not in shared `recipes.css` (which
  already carries Listen-only recipes that Admin downloads). `.stats-heatmap*`
  (`app/shared/ui/tokens/recipes.css:2440`, Listen-only today) moves to Listen CSS in plan
  Task 4.6 and back to the shared file in plan Task 5.12, when Admin adopts the heatmap; the
  setlist ticket recipe follows the same rule (Listen in 0.9, shared in 4.7b). No new Listen-only
  recipe goes into the shared file.
- Backend: no request-time aggregates over `library_tracks`, `ANY(:ids)` batching, one CTE per
  surface, no in-request snapshot builds, SSE reads off the event loop.

### 6.8 Testing

- Vitest uses jsdom everywhere: `canvas.getContext()` is `null`, `IntersectionObserver` is missing,
  `ResizeObserver` and `matchMedia` are polyfilled only in Listen, SVG geometry APIs are missing.
  Guard with `typeof … === "undefined"`, use `pathLength`, spy on `getContext`, and mark the rAF
  scheduling with `TEST_GAP:` comments when it is covered by Playwright instead.
- Unit-test the pure math (layout, springs, projections) with table tests and shared fixtures with
  Python where parity matters (Camelot, EQ templates, bliss projection, `eq.path`).
- Test the static and reduced-motion render, interactions, and lifecycle (loop stops on unmount and
  when hidden; streams open once).
- Vitest workers time out at start on the external disk (`START_TIMEOUT` 60 s); the hand patch in
  this worktree's `node_modules` is lost on `npm ci`. Run suites in CI or from an internal-disk
  clone; locally run single files.
- Backend: pytest per changed public function, pg_db for queries, OpenAPI and permission tests for
  routes, migration head tests, Go table tests and contract smoke for read-plane changes.

### 6.9 Adding a new visual

Checklist for the PR description:

1. Site source cited (`app/web/src/components/viz/<Name>.astro` and its script) with the site SHA
   it was copied from (pinned `258bbaee` unless a reviewed re-sync moved the pin; header), and what
   is not ported (demo loops, synthetic data).
2. Placement justified (2.1): both apps in this change, or app-local.
3. Data from a precomputed payload or an existing stream; no per-request aggregate, no in-request
   build, no stream opened inside the visual; backend preconditions listed and merged first.
4. Real state on first paint; only real transitions animate; final state under reduced motion,
   `effects=off`, no WebGL and in tests.
5. Renderer per 3.5; Nivo only for standard charts; rule amendment [D1] referenced for instruments.
6. Tokens only, no literal colours; works under solid and glass and the three accents; light mode
   and Crate Red meet the v3 minimum bar [D41] (contrast tests green, canvas and WebGL re-read
   tokens on appearance change with a test that fires the resolver event, P0 Listen instruments
   captured in `light` and `crateRed`); no light or Crate Red redesign (product design §7).
7. Copy through props (shared) or `t()` in 7 catalogs; German and Basque fit; Listen relative
   time, dates and weekdays through `Intl` and counts through ICU plurals, with new count prefixes
   added to `plural-counts.test.ts` (1.2.5).
8. Accessibility per 3.10, including forced colors, keyboard and route-change focus; narrow-width
   behaviour stated and a 375 px render test (1.3.3).
9. Tests per 6.8; page-level test for new Admin pages; fixtures and intentional baselines.
10. Budgets: `check:bundle`, drift `--check`, layers, policy tests, Admin, Listen and Desktop
    typecheck.
11. Site drift coupling (6.5) checked.

### 6.10 Deprecations and removals

| Item | Replacement | When |
| --- | --- | --- |
| `components/lab/viz` references | `components/viz` | this document |
| `app/shared/ui/domain/stats/{OpsPageHero,OpsPanel,OpsStatTile}.tsx` (unused) | delete | first Admin shell commit |
| Admin `OpsPageHero`, `OpsPanel`, `OpsStatTile` (`components/admin/ops-surfaces.tsx`) | `PageHeading`, `InstrumentPanel`, `StatStrip` | per screen |
| Admin Settings local `StatusDot`, `StatTile`, `PanelCard`, `Section` | shared primitives | Settings screen |
| `app/shared/ui/domain/shows/ShowCard.tsx` (unused) and Admin `ExpandedShowCardBody` | `SetlistTicket` | 4.6 |
| Admin `components/ui/error-state.tsx` (dead) | `ErrorState` | anytime |
| Admin orphans `pages/Shows.tsx`, `pages/Profile.tsx` | delete or route (decision) | Admin shell |
| `EqualizerModeBadge` | header meta | 4.1 |
| `MOOD_COLORS`, Info tab `tone="warm"`, profile badge tones | status policy | 4.10, 4.5, social screen |
| `richColors` toasts | `toaster-config` | 5.10 |
| `listen-glass*`, panel `backdrop-blur`, `listen-mobile-eq-glass` | flat surfaces | per screen |
| `CrateLoader` and `animate-spin` inside panels | reserved geometry, `ProgressHairline` | gradual |
| `EmptyState` `panel` and `dashed` variants | `inline` | gradual |
| `focus-visible:shadow-focus` | global outline | token commit |
| `tracking-eyebrow` and wider for new code | `tracking-caps`, `tracking-kicker` | immediate |
| `GenreNetworkGraph` | `GenreWheel` locator [D21] | after 4.3 |
| `react-force-graph-2d` sky/slate literals (`ArtistNetworkGraph`) | token-resolved colours | Artist screen |
| Unused deps: Admin `@nivo/bump`, `chord`, `geo`, `heatmap`, `network`, `gl-matrix`; Listen `leaflet`, `react-leaflet`, `@nivo/core`, `@nivo/line` (if no adoption) | remove after a build check | cleanup commit |
| `SpectrumRibbonCanvas` (no production importer) | remove or adopt (decision) | cleanup |
| `use-audio-visualizer.ts` setState at 20 fps, `use-crossfade-progress.ts` setState per frame | ref-based sampler | player pass |
| Six copies of the EventSource reconnect effect in Admin, `useSse` | `AdminLiveProvider` / `use-snapshot-stream` | Admin ops pass |
| `?fresh=1` refreshes and `get_or_build_ui_snapshot` in requests | serve stale and schedule | backend preconditions |
| `GET /api/admin/health-snapshot?check_type=` | paginated drill-down read of open issues (4.14) | deprecated alias for one release, then removed |
| `primitives/RadioGroup.tsx` (no importer) | candidate for the PD47 unused-code cleanup (decision) | cleanup |

### 6.11 Rollout

The order is the implementation plan's phases (0 to 7) and named release groups (R0, Foundation, Genres, Listen player and EQ, Ops, Health, Stats, P1/P2, Smart Mix), and nothing
else; this document does not keep its own list. Its constraints on that order:

- Commits stay small: one recipe, one screen or one instrument per commit, behaviour-identical for
  Track A, with tests and intentional re-baselines.
- A backend precondition (the entry's "Blocked by") merges before its instrument: for example the
  health surface (plan Task 2.17c) before the Dashboard tile (3.3), and plan Tasks 2.18a–e (the
  wheel snapshot plus G1, G2, G3, G7 and edge suppression) before the read-only wheel (3.7), in
  the same Genres release; 3.8 is frontend only. Core-genre EQ writes are never disabled in a
  release.
- A shared module lands in the change where both apps import it (2.1).

### 6.12 Decisions register

"Default" is what this document assumed before the decision session. Every row was decided on
2026-10-15 (plan Task 0.3); the reconciled list is `2026-10-15-crate-v3-decision-register.md`.
Where the Status differs from the Default (D3, D18, D29, D38), the Status wins.

| # | Decision | Default in this document | Status |
| --- | --- | --- | --- |
| D1 | Amend "charts use Nivo" (`AGENTS.md:69`, `app/ui/AGENTS.md:28`, `app/listen/AGENTS.md:60`, `app/shared/AGENTS.md`) so instruments (wheel, EQ, crossfade, orbit, lanes, gauges, maps, heatmap, ticket) are hand-built; Nivo stays for standard charts | amend | decided 2026-10-15: amend (PD1; plan 0.5) |
| D2 | Listen pill radius: exempt chips via `data-slot="chip"` (b), keep CTAs at 6 px for now; align modals to 14 px | (b) | decided 2026-10-15: (b) (PD3) |
| D3 | Brand display font in the product (1.2.1). Cabinet Grotesk's ITF Free Font License forbids distribution through a public repository and availability to third parties through an application, so it cannot ship in a public, self-hosted product | an OFL display face | decided 2026-10-15: Bricolage Grotesque (SIL OFL 1.1) in every runtime and on cratemusic.app; no Cabinet anywhere; `d9df9d51` rewritten (PD4) |
| D4 | Status colours: cyan on, amber warn, grey off; failed = amber plus word; red only on the destructive confirm button | as stated | decided 2026-10-15: as stated (PD10) |
| D5 | Warning hue `#fbbf24` (site amber) instead of `#f59e0b` | change | decided 2026-10-15: change (PD11) |
| D6 | Keep the `#0d0e14` card and require a hairline on every card fill; Admin moves screen by screen | keep | decided 2026-10-15: keep (PD6) |
| D7 | No auto-cycling or scripted loops in the product; idle shows the real summary | no cycling | decided 2026-10-15: no cycling (PD7) |
| D8 | `StatNumber` gains `xl` and weight 800 on `lg`/`xl` | yes | decided 2026-10-15: yes (PD8) |
| D9 | Shared motion gate in `@crate/ui/lib`; Admin honours the OS setting and applies `data-crate-motion` later if it adopts the resolver | shared gate | decided 2026-10-15: shared gate |
| D10 | Toasts: drop `richColors`, one shared config, inline feedback first | yes | decided 2026-10-15: yes (PD12) |
| D11 | iOS deployment target 15.0 → 16.4 (Tailwind 4's floor). Below 16.2 every token opacity modifier is transparent (1.1.2); below 16 `cqi`, container queries and subgrid are missing (1.2.2, 1.3.3, 4.7); `linear()` still degrades below 17.2 | raise (Podfile, `project.pbxproj`, release note). Whatever the answer: no subgrid, rem fallback before every `cqi` size, narrow-first layouts. If 15.0 is kept: literal `rgba()` tokens for the four alpha steps, and Checkpoint 4 names a real iOS 15 device (CI cannot test it) | decided 2026-10-15: raise to 16.4; iOS 15 users stay on v2 (PD42; plan 0.13) |
| D12 | No grain texture in the apps | none | decided 2026-10-15: none |
| D13 | No glass on panels; Admin `data-surface` solid by default; Listen keeps the material setting | yes | decided 2026-10-15: yes |
| D14 | App display scale: page titles up to 3.75 rem, entity titles up to 4.4 rem | yes | decided 2026-10-15: yes (PD9) |
| D15 | Sync Listen `<html lang>` with the active locale | yes | decided 2026-10-15: yes (PD49) |
| D16 | Album palette tint of player surfaces: opt-in, accent by default | opt-in | decided 2026-10-15: opt-in (PD40) |
| D17 | Linux GTK accent: derive `accent-action-hi` from it, or ignore it | ignore (brand accent) | decided 2026-10-15: ignore (PD39) |
| D18 | Admin sidebar regrouped by site chapters | keep current groups | decided 2026-10-15: regroup by site chapters (PD14 wins the conflict; the default here is superseded) |
| D19 | Merge order of `smart-mix-phase-1` relative to `feat/crate_v3`. Smart Mix changes no Listen player file or hook; its overlap is the Phase 2 backend (`actors.py`, `task_registry.py`, `worker.py`, `resource_governor.py`, `browse_media.py`, `bliss.py`), the 7 catalogs plus `.metadata`, `SettingsPrimitives.tsx`, `Settings.tsx` and Admin `Analysis.tsx` | `main` is canonical for migration numbers, so the merge order does not gate the first v3 migration: whichever branch is unmerged renumbers its revisions and `schema_sections/*_vNNN.py` each time it merges `main` (renumber script plus an `alembic stamp` recipe for the dev and lab databases at 114); merging only Smart Mix's migrations is ruled out (110 and 113 are VirtualDJ and access-token schema for features not on `main`); `smart_mix/camelot.py` moves to `app/crate/camelot.py` in a small `[MAIN]` PR both branches use (4.5); catalog keys merged by hand, `.metadata` regenerated with `i18n-check --write-metadata`, never hand-merged | decided 2026-10-15: Smart Mix first, whenever ready (PD2) |
| D20 | Genre overrides model (G1): local edits on core persist in `local_*` + `eq_override` columns the pre-v3 seeder never writes (rollback-safe, 4.3) with "reset to core"; locked core edges cannot be removed but can be hidden on this server through a suppression column (`edges[].suppressed`, 4.3) | persist + reset; hide, never delete | decided 2026-10-15: persist + reset; hide, never delete (PD18) |
| D21 | Wheel as default Admin Genres view; retire `GenreNetworkGraph`; Listen wheel scope (Explore, genre page, Paths) | yes; Listen phase 2 | decided 2026-10-15: yes; Listen phase 2 inside v3 (PD19, PD20) |
| D22 | Governor defaults: compose 0/0 vs code and site 10/10 listeners and streams | show the real configured values | decided 2026-10-15: product default 10/10, compose 0/0 documented as an operator override, site copy "default 10/10, configurable" (PD33) |
| D23 | `shadow_quality_tracks` runs unattended in the daily pipeline although it requires confirmation; route hard deletes through Library Trash; console scans apply safe fixes | gate on confirmation; trash routing; no | decided 2026-10-15: gate on confirmation (PD24, own PR to `main`); trash footer factual in v3 and routing as a separate fix after 2.17e (PD28); console scans apply no fixes |
| D24 | One genre count definition (read-plane thresholds .70 / .45) everywhere | adopt | decided 2026-10-15: adopt (PD21) |
| D25 | Admin screenshot coverage for instruments | functional tests only for now | decided 2026-10-15: Listen and Admin `check:bundle` from Phase 0; Admin gets a small capture set from plan Task 0.11, extended by each P0 page task (PD48) |
| D26 | Tighten `/api/acquisition/snapshot` and `/stream` to acquisition capabilities | tighten | decided 2026-10-15: tighten; behaviour change, own PR to `main` (PD46) |
| D27 | Federation in Listen: provenance tag only, no network view | tag only | decided 2026-10-15: tag only |
| D28 | Crate Connect production build flag (off by default everywhere) | confirm before building 4.12 | decided 2026-10-15: build Devices in v3 although Crate Connect is off in production; "review Crate Connect" is the next initiative after v3 (PD38) |
| D29 | EQ while Smart is resolving: audio stays flat (today) or holds the last gains | flat (today) | decided 2026-10-15: hold the last gains (PD32 wins the conflict); behaviour change, own PR to `main` |
| D30 | Hide the instance heatmap below 3 listeners | hide | decided 2026-10-15: hide, server-side (PD43) |
| D31 | Display face `tnum` support | reserve width until verified | decided 2026-10-15: closed by [D3]; Bricolage Grotesque has `tnum`, no reserved width needed |
| D32 | Setlist: a federated copy counts as "in library" | no (local only) | decided 2026-10-15: local only (PD5) |
| D33 | Release timelines for non-Tidal acquisitions: link at import by release group or name | link by release group, then name | decided 2026-10-15: link by release group, then name (PD27) |
| D34 | Track loudness labels: generic `dB` until Smart Mix LUFS; optional `analysis_method` column | generic `dB` | decided 2026-10-15: generic `dB` (PD25) |
| D35 | Admin "Generate with AI" EQ as an unsaved draft (`apply=false`) | draft | decided 2026-10-15: draft |
| D36 | Paths: the planning task route (former phase C) ships with phase A (plan Task 4.9a); new Listen builds and the route map's Regenerate use only the task route; the synchronous routes keep a deprecation date, a per-user rate limit and no LLM refinement (4.8) | ship together | decided 2026-10-15: ship together (PD36) |
| D37 | Admin Dashboard chapter index (site `Explore` rows) next to the sidebar | no | decided 2026-10-15: no |
| D38 | Wire Settings > Enrichment toggles into the pipeline (`setlistfm` alias, add `discogs`) | not wired; no "disabled" state | decided 2026-10-15: wire them (PD29 wins the conflict); behaviour change, own PR to `main` |
| D39 | Queue lane big numeral: live load (product) vs task-type count (site) | live load | decided 2026-10-15: live load (PD35) |
| D40 | Stack actions: deny restart for postgres, redis, redis-durable, api and traefik; stop/start only for non-core containers | deny as listed | decided 2026-10-15: deny as listed; behaviour change, own PR to `main` (PD44) |
| D41 | Minimum v3 bar for light mode and Crate Red (product design §7 puts their redesign out of scope; the visual QA doc treats them as release-gate variants) | on-token only: no literal colours, contrast tests green per skin, canvas and WebGL re-read tokens on appearance change (tested), P0 Listen instruments captured in `light` and `crateRed`; no redesign | decided 2026-10-15: on-token bar (PD53) |
| D42 | `StatusDot on` under non-cyan accents (with Crate Red it reads red next to the destructive confirm); product design PD53 together with [D41] | follows the accent (one-accent rule); on vs destructive stays distinguishable by shape and word. A fixed hue would need PD53, this row and 1.1.4 changed together plus a non-accent "on" token | decided 2026-10-15: follows the accent (PD53) |
| D43 | Stack sampler placement (4.22): (a) a daemon thread in crate-api behind a Redis leader lock, or (b) crate-worker behind a read-only docker-socket-proxy | (a): crate-api already mounts the socket and runs the Stack actions, so (b) only pays off if the actions move behind the proxy too and the API drops the socket; (a) keeps the sampler off the event loop with per-call timeouts and a budget. Plan Task 5.5's files follow the answer | decided 2026-10-15: (a) (PD54) |

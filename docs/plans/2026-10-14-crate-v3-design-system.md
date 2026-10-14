# Crate v3 design system

Status: in progress on `feat/crate_v3`. Source of truth for the visual language:
the marketing site (`app/web/src/styles/tokens.css`, `base.css`,
`components/lab/viz/*.astro` in the website worktree) and its two reference
visuals (upcoming show ticket, EQ panel).

## Goal

Make Listen and Admin read as the same product as the new site: near-black
canvas, one cyan accent, hairline structure instead of filled boxes, a tight
display face for names and numbers, and mono uppercase labels for metadata.
Behaviour does not change; this is a presentation layer migration.

## Audit of the current system

- Tokens live in `app/shared/ui/tokens/*.css`. Runtime values are generated from
  `lib/appearance-token-registry.ts` into `tokens/themes.css`
  (`npm run design-system:tokens:generate`); presets `default` and `crateRed`,
  each with dark and light modes, plus user overrides (accent, material, radius,
  typography, effects). Every colour change must go through the registry, not
  the CSS.
- Colour is already close: `#0a0a0f` canvas, `#f1f5f9` foreground, `#06b6d4`
  accent. Gaps: muted text is slate-blue (`#94a3b8`) instead of neutral
  foreground opacity steps; borders are opaque purple-grey (`#252535`) instead of
  `rgba(241,245,249,.1)` hairlines; cards are lifted (`#16161e`) instead of the
  site's barely-raised `#0d0e14`; there is no bright accent (`#67e8f9`) for
  labels, curves and active chips.
- Type: one family (`--font-brand`, Poppins on web, system font on Capacitor and
  for `typography: system`). No display face, no mono stack (87 `font-mono`
  usages fall back to the browser default). Tracking tokens for caps labels
  already exist (`tracking-caps` .14em, `tracking-kicker` .16em).
- Radius: preset scale is 2/4/6/8 px (`subtle`) or 4/8/12/16 (`rounded`);
  `rounded-panel` is 12 px. The site uses 14 px cards and pill controls.
- Motion: only `--motion-duration-fast|normal` and ad-hoc cubic-beziers. No
  spring tokens.
- Governance: `design-token-policy`, `export-usage-policy`, Listen
  `badge-policy`, `radius-policy`, `component-policy`, contrast tests over every
  skin. All stay green; budgets are not widened.

## Tokens

### Colour (default preset, dark)

| Role | Token(s) | v2 | v3 |
| --- | --- | --- | --- |
| Canvas | `--surface-app`, `--color-background` | `#0a0a0f` | unchanged |
| Foreground (fg) | `--text-primary` | `#f1f5f9` | unchanged |
| fg-2, body secondary | `--text-muted` / `--color-muted-foreground` | `#94a3b8` | `#999ca0` (fg at .62 over canvas) |
| fg-3, labels/meta | `--text-subtle` | `#94a3b8` | `#7e8084` (fg at .5 over canvas) |
| Hairline | `--color-border`, `--border-subtle`, `--border-quiet` | `#252535`, white .1 | `rgba(241,245,249,.1)` |
| Row divider | `--border-quiet-subtle` | white .06 | `rgba(241,245,249,.06)` |
| Card | `--color-card` solid | `#16161e` | `#0d0e14` |
| Accent | `--accent-action` | `#06b6d4` | unchanged (fills, play button, focus) |
| Accent hi | `--accent-action-hi` (new) | none | `#67e8f9` (labels, curves, active chip) |
| On accent hi | `--accent-action-hi-foreground` (new) | none | computed AA foreground |
| Status | `--state-warning` | amber | amber, status only |

fg-2/fg-3 are stored opaque so the AA contrast tests can verify them; they
match the site's alpha values over the canvas. Light mode and `crateRed` keep
their own values except shared hairlines; light v3 is a later pass.

### Type

| Token | Value | Use |
| --- | --- | --- |
| `font-display` (`--font-display-stack`) | Cabinet Grotesk 500/700/800, falls back to `--font-brand` | artist names, page titles, numerals |
| `font-sans` / `--font-brand` | Poppins (web), system (native, `typography: system`) | body |
| `font-mono` (`--font-mono-stack`) | JetBrains Mono 400, then `ui-monospace`/SF Mono | labels, indices, frequencies |
| `text-label` | 11 px | mono label size |
| `leading-display` | .9 | display headlines |

`typography: system` also switches the display stack to the system font so
`crateRed` keeps its native look.

Mono label recipe: `font-mono text-label uppercase tracking-caps text-text-subtle
tabular-nums`; key word in `text-accent-action-hi`; metadata parts joined with
` · `.

Display recipe: `font-display font-extrabold tracking-display leading-display`.

### Spacing, radius, borders

- Spacing stays on the Tailwind scale and the density metrics; v3 uses more air
  (rows 9-12 px vertical, card padding 20-30 px).
- `--radius-panel` 12 px -> 14 px (the site's card radius); pills use
  `rounded-full`. The preset radius scale is not changed in this pass (see
  risks).
- Borders are 1 px hairlines. Dashed hairline (`border-dashed`) marks the ticket
  perforation.

### Motion

Added to the theme: `ease-snap` (.22,1,.36,1), `ease-out-expo` (.16,1,.3,1),
`ease-dramatic` (.77,0,.175,1), `ease-spring-snappy`, `ease-spring-smooth`
(`linear()` springs copied from the site). Existing `ease-out` is untouched.
Reduced motion keeps using `data-crate-motion="reduced"` and
`motion-reduce:` variants.

## Component inventory

New in `@crate/ui/primitives` (both apps consume them):

| Primitive | Replaces | Notes |
| --- | --- | --- |
| `MonoLabel` | hand-rolled `uppercase tracking-eyebrow` headings | `accent` key word + `meta[]` joined by `·`; `as` for headings |
| `StatusDot` | `size-[6px] rounded-full bg-accent-action` dots, status badges | tones `on` (filled cyan), `off` (ring, fg-3), `warn` (amber); optional mono label |
| `StatNumber` | ad-hoc bold numbers | display numeral + optional mono caption, tabular |
| `HairlineList` / `HairlineRow` | bordered row cards | numbered rows (`01`), hairline dividers, trailing slot |

Restyled in place (no new component, avoids a third chip copy):

- `CratePill` is the v3 chip: mono text, hairline border, transparent idle,
  solid `accent-action-hi` with dark text when active.
- `EqBands` (shared by Listen EQ and Admin genre EQ editor): hairline grid,
  glowing cyan curve, bars from 0 dB, display numerals with mono frequencies.
  Pointer drag behaviour unchanged.

Later passes: buttons (pill CTA with round play button), cards (`rounded-panel`
hairline card as default), section headers (`SectionHeader` eyebrow ->
`MonoLabel`), page headers (display face).

## Migration strategy

1. Token layer first (this branch): registry values, fonts, display/mono/motion
   tokens. Most of both apps shift at once because they already consume
   semantic tokens (`text-text-muted`, `border-border-quiet`, `bg-card`).
2. Primitives in `@crate/ui` with tests, adopted by at least one surface in each
   app in the same change.
3. Per-screen work in the rollout order below, replacing hand-rolled labels,
   dots and boxes with primitives; one screen per commit, behaviour-identical,
   tests updated.
4. Visual snapshots (`npm run test:listen-visual`) are re-baselined per screen,
   intentionally.

## Risks

- Capacitor/iOS fonts: Listen skips Poppins on native for a system feel. v3 loads
  Cabinet Grotesk (3 x ~21 KB woff2) and JetBrains Mono (latin + latin-ext,
  400) on every runtime because they carry the brand. Fonts are bundled assets
  (no network), `font-display: swap`. Decision to confirm with Diego; the
  alternative is SF Mono / system display on native only.
- Bundle size: fonts are separate assets, not JS; CSS grows by a few
  `@font-face` blocks. `check:bundle` must stay green.
- Poppins vs Cabinet: Cabinet only for display sizes (>= 20 px) and numerals.
  Body, controls and long text stay Poppins; Cabinet at small sizes hurts
  legibility.
- Contrast AA: fg-3 (`#7e8084`) is ~4.9:1 on the canvas and ~4.7:1 on cards,
  enough for AA but not for text on raised popovers; use fg-2 there. Cyan hi on
  canvas is ~12:1. Active chip text uses the computed foreground.
- Card value `#0d0e14` makes borderless cards almost disappear; surfaces that
  rely on fill contrast need a hairline border. Audit per screen.
- Radius: moving the default preset from `subtle` to `rounded` would change
  every control (Listen pins buttons to `radius-lg`). Deferred; only
  `rounded-panel` moves now.
- Pills: the site uses pill chips and CTAs, but Listen deliberately pins text
  controls to `radius-lg` (`index.css` rule for `[data-slot="button"]` and
  `button.rounded-full[class*="px-"]`, guarded by `radius-policy.test.ts`).
  `CratePill` therefore renders 6 px corners in Listen and pills in Admin.
  Lifting that rule is a product decision for the next pass.
- Light mode and `crateRed` are not redesigned in this pass; contrast tests
  guard them.

## Rollout

Listen:

1. Radar / upcoming show ticket and probable setlist (done in this slice).
2. Equalizer panel (done in this slice).
3. Player bar and fullscreen player (mono time codes, display track title).
4. Artist page hero and setlist modal (display name, `HairlineList`).
5. Album page track list (`HairlineRow`, mono indices).
6. Home sections (`MonoLabel` eyebrows, `SectionHeader`).
7. Stats (`StatNumber`, mono axes).
8. Settings and appearance editor.
9. Library, search, playlists.

Admin:

1. Genre EQ editor (shares `EqBands`; header and status moved to primitives in
   this slice).
2. Dashboard and ops tiles (`StatNumber`, `StatusDot`).
3. Health and tasks (status dots, hairline rows).
4. Library tables (mono metadata, hairlines).
5. Shows (drop the local `ShowCard` copy for the shared one).
6. Settings, users, federation.

Follow-up data work: the reference ticket marks each setlist song as
"in library" or "missing". The upcoming payload carries only titles and
frequency; adding a precomputed `in_library` flag to `probable_setlist` in the
upcoming snapshot (not a per-request match) unlocks that status.

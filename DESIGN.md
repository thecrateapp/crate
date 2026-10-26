# Crate Design System

The visual language shared by Listen (`app/listen`), Admin (`app/ui`) and the shared library
`@crate/ui` (`app/shared/ui`). This file is the working reference: what the system is, which
component to reach for, and what is not allowed. It describes the system as implemented in code.

## Precedence

When sources disagree, the higher one wins:

1. Diego's approved persistent mockup (`localhost:5186`) plus his later confirmed adjustments.
2. Code in `app/shared/ui/tokens/` and `app/shared/ui/lib/appearance-token-registry.ts`.
3. This file.
4. `docs/plans/2026-10-14-crate-v3-design-system.md` (the long-form spec and decision log), read
   together with `docs/plans/2026-10-19-crate-v3-current-state.md`, which supersedes older entries.

Doubts, visual deviations or mobile sizing conflicts are resolved with Diego before changing the
criterion. The historical `app/web@258bbaee` pin stays; do not silently replace it.

---

## 1. Identity

**One identity for Listen and Admin.** The same tokens, primitives, recipes and interaction rules
apply to both apps. Only domain components and workflows differ. There are no themes, skins, light
mode, user accents or app-specific foundation variants. Artwork and visualizer colours are content;
they never tint the chrome.

The feel is a **dark, quiet instrument**: typographic, ruled with hairlines, one cyan accent, mono
captions and display numerals. Data surfaces read like hardware readouts, not marketing dashboards.

### Principles

1. **One accent.** Cyan is the only identity colour. Amber is reserved for warning.
2. **Hairlines, not boxes.** A panel is a top rule plus a header row. Only standalone objects get a
   filled, bordered card: dialog, popover, toast, ticket, terminal/JSON card.
3. **Display plus mono.** Bricolage for names, titles and numerals; JetBrains Mono for labels,
   units, indices and readouts; Roboto for everything else.
4. **Real state on first paint.** Nothing animates from zero to fake a story. No demo data and no
   auto-cycling.
5. **Animate only real transitions.** The final state must render correctly without motion.
6. **Colour is never the only signal.** A state also changes a word, a shape or a count.
7. **Honest copy.** Say what the system actually measures (`dB` until LUFS is measured; "Key", not
   "Camelot").
8. **Placement follows use.** Primary actions sit where the eye already is.

---

## 2. Colour

Generated from `app/shared/ui/lib/appearance-token-registry.ts` into `tokens/themes.css`. To change
a foundation value, edit the registry and run `npm run design-system:tokens:generate`. Never edit
`themes.css` by hand; `lib/appearance-theme-css.test.ts` fails on drift.

Components consume **semantic tokens** (`tokens/semantic.css`), never hex values and never
`--crate-token-*` primitives.

### Surfaces

| Token                                           | Value       | Use                                     |
| ----------------------------------------------- | ----------- | --------------------------------------- |
| `--surface-canvas` / `--surface-app`            | `#0a0a0f`   | Page background, shells                 |
| `--surface-object` / `--surface-panel` / card   | `#0d0e14`   | Solid object cards                      |
| `--surface-raised`                              | `#0f1016`   | Raised tiles, table headers             |
| `--surface-popover` / `--surface-modal` / input | `#111218`   | Overlays, menus, inputs                 |
| `--color-secondary`                             | `#15161d`   | Secondary fill                          |
| `--surface-scrim`                               | canvas 72%  | Modal scrim (never blurred)             |
| `--surface-chrome`                              | canvas 68%  | Headers and docks over scrolled content |
| `--surface-control` / `-hover`                  | fg 5% / 10% | Outline button and control fills        |
| `--surface-placeholder`                         | fg 5%       | Missing artwork                         |

Utilities: `bg-app-surface`, `bg-panel-surface`, `bg-raised-surface`, `bg-modal-surface`,
`bg-popover-surface`, `bg-surface-object`, and the Tailwind colours `bg-surface-canvas`,
`bg-surface-chrome`, `bg-surface-scrim` and so on.

### Text

| Token              | Value                   | Use                                                 |
| ------------------ | ----------------------- | --------------------------------------------------- |
| `--text-primary`   | `#f1f5f9`               | Titles, values, body on canvas                      |
| `--text-secondary` | `rgba(241,245,249,.62)` | Secondary copy                                      |
| `--text-muted`     | `#999ca0`               | Descriptions, helper text; small text on popovers   |
| `--text-subtle`    | `#7e8084` (fg 50%)      | MonoLabel default; lowest tone for informative text |
| `--text-faint`     | fg 20%                  | Decorative only; always `aria-hidden`               |
| `--text-accent`    | accent 82% over fg      | Accent-tinted copy                                  |

Contrast floor (enforced by `lib/color-contrast.ts` tests):

- Informative text never goes below `text-subtle` on canvas (4.99:1).
- On popover and secondary surfaces, small text uses `text-muted`, because `text-subtle` drops to
  about 4.6:1 there.

### Lines

| Token                   | Value            | Use                               |
| ----------------------- | ---------------- | --------------------------------- |
| `--border-quiet`        | fg 10%           | The hairline: rules, card borders |
| `--border-quiet-subtle` | fg 6%            | Row dividers inside lists         |
| `--border-subtle`       | `--color-border` | Tabs baseline, separators         |
| `--border-interactive`  | fg 20%           | Hover border on interactive rows  |
| `--border-accent*`      | accent 15–40%    | Accent outlines                   |

Every border is 1px. Hairlines (about 1.24:1) carry structure only, never state on their own.

### Accent

| Token                        | Value     | Use                                                             |
| ---------------------------- | --------- | --------------------------------------------------------------- |
| `--accent-action`            | `#06b6d4` | Fills, primary outline buttons, play button, focus ring         |
| `--accent-action-hi`         | `#67e8f9` | Strokes, active bars, key words, active chips, hover foreground |
| `--accent-action-foreground` | `#0a0a0f` | Text on an accent fill                                          |

Common alpha steps:

| Step  | Use                                 |
| ----- | ----------------------------------- |
| `/4`  | Track row hover wash                |
| `/8`  | Active row gradient start           |
| `/10` | Active and chip backgrounds         |
| `/16` | Artwork placeholder                 |
| `/25` | Badge border                        |
| `/40` | Cover hover hairline, active border |

Interactive state tokens (`tokens/interactive.css`) all derive from the accent:

- `--active-*`
- `--hover-*`
- `--chip-*`
- `--pill-*`
- `--status-*`

`::selection` uses the accent background with canvas text.

Glow tokens (`--accent-action-glow-soft|medium|glow|strong`) scale with the user's effects
preference, `data-crate-effects` (`off`, `subtle` or `expressive`). Glow is an effect, never a
state carrier.

### Status

| Meaning                                | Treatment                                                                                                                                                                 |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| On, ok, active, live                   | `StatusDot tone="on"` with accent-hi text                                                                                                                                 |
| Warn, waiting, stale, degraded, failed | `StatusDot tone="warn"` with `--state-warning` (`#fbbf24`) and a word ("failed", "stale")                                                                                 |
| Off, never, idle                       | Ring dot (`tone="off"`) with `text-subtle`                                                                                                                                |
| Severity                               | `SeverityMeter`: a dot plus the uppercase mono word, coloured by level (debug grey, info cyan, warn amber, error red, critical red with a ring)                           |
| Destructive                            | Neutral control everywhere, except the confirm button inside a destructive dialog, which uses `--state-danger` (`#ef4444`) and states the consequence ("Delete 12 files") |

Severity and log levels are the one place red marks status (Diego, 2026-10-26); `status-colour-policy.test.ts` allows it only in `components/admin/status-indicators.tsx`. Otherwise there are no green or blue status colours. `--state-success` (`#22c55e`) and `--state-info`
(`#3b82f6`) exist for legacy and product slots (mix indicator, genre tones), not for status.
`app/ui/src/status-colour-policy.test.ts` enforces this in Admin.

`InfoBadge` keeps its six tones: `neutral`, `accent`, `info`, `success`, `warning`, `danger`
(Diego, 2026-10-25).

Charts use accent-hi, accent and foreground steps, with amber only for thresholds.

### Product slots

`tokens/product.css` holds named roles for specific product surfaces; reuse them instead of
inventing new mixes:

- play button rim and aura
- visualizer ribbon stops
- genre tones
- hero artwork gradients
- `--artwork-scrim` and `--artwork-foreground` (black and white over artwork)
- jam surfaces

Canvas, WebGL and Nivo read colours at runtime with `readCssColorToken`
(`lib/read-css-color.ts`), never with literals.

---

## 3. Typography

Three families, bundled on web, Tauri and Capacitor from `app/shared/fonts/`:

| Family                  | Token / utility             | Role                                                       |
| ----------------------- | --------------------------- | ---------------------------------------------------------- |
| **Bricolage Grotesque** | `font-display`              | Page and entity titles, section titles, numerals           |
| **Roboto**              | `--font-brand`, `font-sans` | Body, controls, inputs, buttons, card titles               |
| **JetBrains Mono**      | `font-mono`                 | Labels, units, indices, dates, IDs, readouts, badges, tabs |

Rules:

- **Mono is always weight 400.** Emphasis in mono is colour (accent-hi), never weight.
- **Bricolage only at 20px or larger** for titles and 16px or larger for numerals. The one
  exception is player and mini-player titles at 15–16px / 700.
- No new families or weights. Do not set `opsz` by hand.
- Every number that changes uses `tabular-nums`.

### Scale (`tokens/typography.css`)

| Utility                               | Size                  | Use                                     |
| ------------------------------------- | --------------------- | --------------------------------------- |
| `text-body`                           | 15px, line-height 1.6 | Body copy, form fields                  |
| `text-caption`                        | 13px                  | Captions                                |
| `text-sm`                             | 14px                  | Descriptions, entity titles (14/500)    |
| `text-xs`                             | 12px                  | Hairline row text (12/18)               |
| `text-info-badge`, `text-filter-chip` | 12/16                 | InfoBadge, FilterChip, SegmentedControl |
| `text-eyebrow`                        | 11.5px                | Eyebrows, tabs, readouts                |
| `text-label`                          | 11px, line-height 1.4 | MonoLabel                               |
| `text-meta`                           | 10.5px                | Card metadata (`crate-media-meta`)      |
| `text-badge`, `text-counter`          | 10px, 8px             | Inside instruments and counters only    |

Below 11px only inside instruments, via recipe classes.

**Numerals** (`StatNumber`) scale with their container:

| Utility           | Size                            |
| ----------------- | ------------------------------- |
| `text-numeral-sm` | `clamp(1.1rem, 2.1cqi, 1.9rem)` |
| `text-numeral-md` | `clamp(1.6rem, 2.6cqi, 2.4rem)` |
| `text-numeral-lg` | `clamp(2.8rem, 5.6cqi, 5.4rem)` |
| `text-numeral-xl` | `clamp(3.2rem, 8.4cqi, 8.4rem)` |

Numerals use `leading-numeral` (.85) and `tracking-numeral` (−0.05em).

### Tracking

| Token                        | Value            | Use                |
| ---------------------------- | ---------------- | ------------------ |
| `tracking-display*`          | −0.04 to −0.08em | Display titles     |
| `tracking-chip`              | .04em            | Chips              |
| `tracking-label`             | .12em            | Tags               |
| `tracking-caps`              | .14em            | MonoLabel          |
| `tracking-kicker`            | .16em            | Eyebrows and tabs  |
| `tracking-eyebrow` and wider | ≥ .18em          | Banned in new code |

### Headings

| Element            | Treatment                                                                                                   |
| ------------------ | ----------------------------------------------------------------------------------------------------------- |
| Page title (h1)    | Bricolage 800, `clamp(2.25rem,4vw,3.75rem)`, `leading-display`, −0.045em, `text-balance`; MonoLabel eyebrow |
| `SectionHeader`    | Bricolage 700 at 18/24/30, mono count (including 0)                                                         |
| `PageHero` compact | 24px mobile, 36px desktop                                                                                   |
| Overlay title      | Bricolage 700, `clamp(1.4rem,2.5vw,1.6rem)`, −0.03em                                                        |
| Card title         | Roboto 16/24                                                                                                |

The 800 page-title scale is the standard for both apps (Diego, 2026-10-25). Admin already uses it
through `OpsPageHero` (26 pages, plus a hand copy in Dashboard and Genres). Listen `PageHeader`
(600, `text-2xl`/`text-3xl`) and Admin PlaylistEditor have not migrated yet (see §14).

### Casing and typographic conventions

- `MonoLabel` is always uppercase through CSS. Source strings keep their natural case.
- All form field labels are uppercase in both apps, including checkbox, switch and radio captions.
  Values, names, bios and titles keep their case (`data-slot="form-field-value"`).
- Short metadata is sentence case. Genre names are lowercase.
- `·` separates metadata (`aria-hidden`); use a real minus `−`, `→` for flows, `…` for
  truncation and `~` for approximations.
- Indices are zero-padded (`01`); progress reads `07 / 17`.
- Units are lowercase mono on the same baseline (`41 min`). Durations are `m:ss` or `h:mm:ss`.
- Relative times are mono, with the absolute time in the tooltip.

---

## 4. Space, layout, radius, density

### Rhythm

- 32 / 48 / 64px between page sections.
- Panel rule to header: 22px (`pt-5.5`). Header to content: 20px.
- Hairline row: 10px vertical padding, 12px inset, 14px gap. Minimum height is 32px on fine
  pointers and 44px on coarse pointers.
- Chip gap: 8px. Header action gap: 8px.
- **The 8px label rule.** Every stacked label sits exactly 8px above its control, through
  `FormField` or `.crate-form-field`. Never use `mb-*` or `space-y-*` to space a label. Inline
  layouts (checkbox, switch) use a 16px horizontal gap.

### Hit targets

- 44px minimum on coarse pointers only (`pointer-coarse:min-h-11 min-w-11`, built into the shared
  controls). On fine pointers, controls keep their own size: 32px (`sm`) or 40px (default).
  - Never add `min-h-11` or `h-11` in a caller to force 44px on fine pointers (Diego, 2026-10-25).
  - This applies to Admin too: it is not a mobile app.
- Inputs and selects are 40px on fine pointers and 44px on coarse pointers, and controls in the
  same row match heights.
- Chips, `FilterChip` and `SegmentedControl` are 32px fine and 44px coarse.
- Icon actions (`ActionButton`) are 44px (`icon-lg`).

### Radius (`tokens/radius.css`)

| Token / utility | Value | Use                                                          |
| --------------- | ----- | ------------------------------------------------------------ |
| `rounded-full`  | —     | Chips, pills, badges, status dots, avatars, icon buttons     |
| `rounded-panel` | 14px  | Object cards, dialogs, sheets, popovers, toasts, player dock |
| `rounded-xl`    | 8px   | Entity cards (rounded shape)                                 |
| `rounded-lg`    | 6px   | Inputs, selects, square covers, entity rows; Listen buttons  |
| `rounded-md`    | 4px   | Shared `Button` and action buttons, thumbnails in rows       |
| `rounded-sm`    | 2px   | Bars                                                         |

### Layout

- Content max width is `max-w-content` (1480px) in Listen and 1880px in the Admin shell.
- Body text measure is 60–62ch; ledes are 36ch.
- Splits:
  - visualization and copy: `5fr / 7fr`
  - master/detail inspector: about `7fr / 4fr`
- **Instruments and headers respond to their container**, not the viewport.
  - `InstrumentPanel` and `PageHeaderLayout` are `@container`.
  - Write them narrow-first.
  - They collapse at 760px and 1000px of container width.
- App shells keep viewport breakpoints. `useIsDesktop()` is `min-width: 768px` (always true under
  Tauri).
- `MediaGrid` comfortable layout is 2/3/4/5 columns with a 16px gap, capped at 5 columns. The
  crate index grid is 2/3/6 columns with a 20px gap.
- Mobile:
  - Under 760px, use a single column with the visual before the text.
  - Chip rows scroll horizontally.
  - Mono labels wrap, or truncate with a tooltip. Never size a panel to the English string; German
    and Basque run longer.
- Hero heights come from `--hero-h-*` tokens (`min-h-hero-sm` … `min-h-hero-3xl`).

### Density

`data-crate-density="comfortable|compact"` on `<html>` changes content spacing only
(`--content-card-gap`, `--content-grid-gap`, `--content-row-padding-y` and so on, in
`tokens/metrics.css`). Controls keep their hit targets. The JS mirror is
`lib/content-density.ts`, which also provides the virtual-list row estimates.

### Z-index (`tokens/z-index.css`)

Use the `z-app-*` utilities, never `z-[…]`, except local stacking `z-[1-9]`.

| Layer                      | Value     |
| -------------------------- | --------- |
| header                     | 30        |
| sidebar                    | 40        |
| player                     | 1350      |
| fullscreen player          | 1420      |
| player overlay and popover | 2210–2220 |
| modal                      | 2400      |
| popover                    | 2450      |
| dropdown                   | 2500      |
| context menu               | 2550      |
| drag overlay               | 2600      |

---

## 5. Surfaces and elevation

The system is **flat**. The canvas is the page.

| Surface       | Recipe                                                                                                                                       |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Ruled section | `InstrumentPanel`: `border-t border-border-quiet` plus a MonoLabel header, with no fill. The first section under a tab uses `ruled={false}`. |
| Object card   | `Card`: `rounded-panel border-border-quiet bg-surface-object`, no shadow, no blur                                                            |
| Overlay       | `crate-overlay-panel`/`-surface`: popover surface, quiet border, 14px radius, `--menu-shadow`                                                |
| Chrome        | Solid `bg-app-surface` (Admin) or `bg-surface-chrome` after scroll (Listen); transparent at the top of hero routes                           |

Rules:

- **Never stack two rules.** A ruled container (`HairlineList`, `InstrumentPanel`, `OpsPanel`)
  that opens a modal body or a tab panel sits under a rule that already exists (the modal header
  border, the tabs baseline). Pass `ruled={false}` to that first container; never hide the rule
  with CSS selectors.
- **Every filled card has a hairline.** `#0d0e14` on `#0a0a0f` is 1.07:1 contrast, so a borderless
  card disappears.
- **Only overlays cast shadows**: popover, menu, dialog, sheet and toast. Panels, cards and covers
  have none. Artwork in the player stage uses `--shadow-player-artwork`.
- **No glass.** No `backdrop-blur`, no blur in overlays, no grain textures. The only exception is
  `InfoBadge surface="overlay"` over artwork.
- Labels over artwork use the `--artwork-*-shadow` text halos, never a box.
- SVG instrument strokes come from the ladder 1, 1.25, 1.5, 1.75, 2 and 2.25, with
  `vector-effect="non-scaling-stroke"`. Dash patterns are `2 4`, `3 5`, `2 6`, `3 4`, `4 5` and
  `2 5`.

---

## 6. Motion

Defined in `tokens/animations.css`.

### Easing

| Token                  | Curve                            | Use                                          |
| ---------------------- | -------------------------------- | -------------------------------------------- |
| `--ease-snap`          | `cubic-bezier(.22,1,.36,1)`      | State, colour, hover, overlay enter and exit |
| `--ease-out-expo`      | `cubic-bezier(.16,1,.3,1)`       | Draws, page transitions                      |
| `--ease-dramatic`      | `cubic-bezier(.77,0,.175,1)`     | Reserved                                     |
| `--ease-spring-snappy` | `linear()` spring, ~9% overshoot | Tabs indicator, chip press                   |
| `--ease-spring-smooth` | `linear()` spring, ~4% overshoot | Softer settles                               |

Do not use `ease` or `ease-in-out`. Use the `linear()` springs only in longhand
`transition-timing-function` behind `@supports`, never inside the `transition` shorthand.

### Duration

| Duration  | Use                                                            |
| --------- | -------------------------------------------------------------- |
| 80ms      | Press                                                          |
| 150ms     | Hover and colour (`--motion-duration-fast`)                    |
| 200ms     | Overlay open and close; reduced-motion fades; view transitions |
| 300ms     | State changes                                                  |
| 350–450ms | Route entrance (350ms, +8px); tabs indicator (450ms spring)    |
| 500–600ms | Panel entrance, hairline draws, focus ring                     |
| 700–900ms | Row and cell entrances, long draws                             |
| 1.2–1.6s  | Path route draw, count-up                                      |

### Patterns

- **Entrances.** A panel enters with opacity plus a 12px rise. A route enters with opacity plus 8px
  and then moves focus to its `h1`. Stagger items by 70ms, at most 8 items, under about 800ms in
  total. Entrances run once per mount, never on refetch.
- **Overlays.** Popovers and dialogs pop in from scale .98. Sheets enter 16px from their side. Exits
  are a 200ms fade.
- **Focus ring.** A global 2px `--focus-ring` outline, flush (offset −2px inside rows through
  `crate-focus-inset`). `lib/focus-ring-motion.ts` animates it (500ms overshoot); components never
  add their own focus rings.
- **View transitions.** `VtNavLink` wraps navigation in `document.startViewTransition` (root fades
  ±6px over 200ms). It is disabled on transparent Linux window chrome.
- **Data motion.** JS springs default to 170/18 (EQ uses 120/14). Re-target a running spring; never
  restart it. Loops stop when they settle. Clocks use 1s timers, not `requestAnimationFrame`.
  Per-frame values live in refs.

### Reduced motion

There are three inputs: `prefers-reduced-motion`, `data-crate-motion="reduced"` (user preference)
and a hidden tab. `lib/motion-gate.ts` combines them in `isMotionBlocked()` and
`useMotionAllowed()`, and every continuous animation must check one of them.

Under reduced motion:

- No springs, scrambles, count-ups, entrances or draws.
- Fades become 200ms.
- The final state never depends on an animation having run.

---

## 7. Iconography

- **Solar** (`@solar-icons/react-perf`), always through `@crate/ui/icons`. Use Outline by default
  and the `*Bold` exports for active or filled states. Play and Pause are Bold.
- Exports keep Lucide-compatible names that map to Solar glyphs (`X`, `Plus`, `Search`,
  `MoreHorizontal`, `Loader2`). `icons/index.test.tsx` locks the mapping.
- **Sizes come from `CRATE_ICON_SIZE`**, never literal numbers:

  | Key         | Size | Use            |
  | ----------- | ---- | -------------- |
  | `nano`      | 10px | Instruments    |
  | `micro`     | 12px | Badges, chips  |
  | `xs`        | 14px | Dense meta     |
  | `sm`        | 16px | Rows           |
  | `md`        | 18px | Default        |
  | `lg`        | 20px | Header actions |
  | `nav`       | 21px | Sidebar        |
  | `navMobile` | 22px | Mobile tab bar |
  | `xl`        | 24px | Overlay close  |

- Icons have no stroke-weight prop; the weight is fixed by the Solar style.
- AI uses the Solar Bot outline (`icons/bot.tsx`), never Sparkles.
- **Listen** is Lucide-free (bundle test). **Admin** is almost icon-free by design: keep UX glyphs
  (back, forward, collapse, menu, close, search) and basic item actions. Registered Lucide sites
  migrate by reviewed scope; all new glyph work uses Solar.
- No decorative icons beside headings, no icon tiles in headers, no icons in empty or error states.

---

## 8. Components

Import modules directly by subpath (`@crate/ui/primitives/MonoLabel`, `@crate/ui/shadcn/button`,
`@crate/ui/domain/entity`); there is no root barrel. Each part sets `data-slot="<name>"`. State is
exposed through `data-*` attributes (`data-state`, `data-active`, `data-tone`, `data-variant` and
so on); boolean attributes are omitted when false.

A component goes into `@crate/ui` only when **both** apps use it
(`export-usage-policy.test.ts`).

### Which component to use

| Need                          | Use                                                                                   | Not                                          |
| ----------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------- |
| Uppercase caption or label    | `MonoLabel` (`tone`, `accent`, `meta[]`)                                              | Ad-hoc `uppercase tracking-wider`            |
| Big number                    | `StatNumber` (`sm`–`xl`, `unit`, `label`)                                             | Raw `text-4xl`                               |
| Live value                    | `Readout` (aria-live), `InstrumentPanel status`                                       |                                              |
| Ratio or capacity             | `Meter` (limit tick, over state), `ProgressHairline`                                  | Local gauges                                 |
| Data section                  | `InstrumentPanel`                                                                     | Card-per-section                             |
| Simple list                   | `HairlineList` / `HairlineRow`                                                        | `divide-y` by hand                           |
| Entity list row               | `EntityRow`; tracks use `TrackList` and `.track-row`                                  |                                              |
| Entity tile                   | `EntityCard` in `MediaGrid` or `MediaRail`                                            |                                              |
| Artwork                       | `MediaCover` (48px minimum), `PlaylistArtwork`                                        | Raw `<img>` smaller than 48px                |
| Static metadata, state, count | `InfoBadge` (`variant="counter"` for counts)                                          | `CrateBadge`, shadcn `Badge`, coloured pills |
| Toggle or filter              | `FilterChip`                                                                          |                                              |
| Exclusive mode or window      | `SegmentedControl` (`as="radio"` or `"tabs"`)                                         |                                              |
| Categorical form field        | `Select` (even with few options), `AdminSelect` when searchable                       | Chips in forms                               |
| Genre identity                | `GenrePill` / `GenrePillRow`                                                          |                                              |
| Status                        | `StatusDot` plus a word                                                               | Coloured badges                              |
| Form field                    | `FormField` wrapping `Input`, `Select`, `Switch` and so on                            | Local label and margin                       |
| Search                        | `SearchInput` (debounced, clearable)                                                  | Icon plus `Input pl-9`                       |
| Text action                   | `Button`                                                                              |                                              |
| Icon action (header or row)   | `ActionGroup` / `ActionButton`, `ActionIconButton`                                    | Bare `<button>` with an icon                 |
| Tooltip                       | `TooltipHint`, or the `title` prop on shared components                               | Native `title=`                              |
| Page header                   | `PageHeader` / `PageHeaderLayout`, `BackLink`                                         |                                              |
| Section header                | `SectionHeader` (count, accent "View all")                                            |                                              |
| Hero                          | `PageHero` plus `HeroActionBar`                                                       |                                              |
| Tabs                          | `Tabs` (single text-tab recipe; state in `?tab=`)                                     | Pill tabs                                    |
| Modal                         | `AppModal` (a sheet on mobile) or `Dialog`                                            |                                              |
| Destructive confirmation      | `ConfirmDialog tone="danger"` with `consequence`, typed confirmation for wipe/rebuild |                                              |
| Menu                          | `ContextMenu` / `ItemActionMenu` (desktop menu, mobile sheet), `DropdownMenu`         |                                              |
| Loading                       | `LoadingState`, `GridSkeleton`, `CardSkeleton`, `TableSkeleton`                       | Spinners in panels                           |
| Empty                         | `EmptyState`                                                                          | Dashed box with an icon                      |
| Error                         | `ErrorState` (`compact` or `page`, `onRetry`)                                         | Red icons                                    |
| Toast                         | Listen: `notify`. Admin: `sonner`. Both use `toasterConfig`                           | `richColors`, icons                          |

### Usage norms (measured)

These norms are derived from how both apps use the shared components today. They were measured on
2026-10-25 with an AST scan of every production `.tsx` file in `app/listen/src` and `app/ui/src`.
Counts are JSX sites, written as Listen / Admin.

"Caller overrides" counts the call sites that add their own geometry classes; layout classes such
as `w-full` and `min-w-0` are not counted. A repeated override means the shared component lacks
that option.

`npm run design-system:overrides` measures overrides per shared component and category, and CI fails
if any count rises above `scripts/design-system/override-budget.json`. Lower the budget whenever a
count drops. Several shared recipes in `tokens/recipes.css` (overlay sizes, `crate-empty-state`) are
unlayered, so they beat any Tailwind utility a caller adds for the same property: such overrides
are dead code, not adjustments. Use the component option instead. Gaps marked "fixed" were closed in the override normalization plan
(`docs/plans/2026-10-25-crate-v3-component-override-normalization.md`).

| Component                                | Measured usage | Norm                                                                                                                                                  | Repeated caller overrides (gap)                                                                                   |
| ---------------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `Button`                                 | 124 / 301      | See the table below                                                                                                                                   | Fixed: the 82 Admin `min-h-11` overrides were removed                                                             |
| `ActionButton`                           | 56 / 62        | Every icon-only header and row action. Never style it                                                                                                 | None (0 overrides)                                                                                                |
| `ActionIconButton`                       | 2 / 18         | Admin row actions (`variant="row"`), with `tone="danger"` for remove                                                                                  | Hover-reveal classes repeated by hand (2)                                                                         |
| `IconButton`                             | 14 / 0         | Listen-only player, hero and jam controls                                                                                                             | 10 of 14 restyled through product recipes (`home-hero-nav-control`, `jam-*`), including one `backdrop-blur-sm`    |
| `InfoBadge`                              | 51 / 294       | Every piece of static metadata, state and counts (`variant="counter"`). Tones by meaning: `warning` most common, then `success`, `accent`, `danger`   | Fixed: hand-written tone colours replaced by `tone`. Some Admin badges still dim text with `text-text-muted` (5)  |
| `Badge` (shadcn)                         | 0 / 0          | Compatibility only; no consumers. Use `InfoBadge`                                                                                                     | Fixed: the 43 Admin uses migrated to `InfoBadge` tones                                                            |
| `FilterChip`                             | 6 / 22         | Toggles and filters, always with `active`                                                                                                             | Fixed: Admin `min-h-11` (4) removed                                                                               |
| `SegmentedControl`                       | 3 / 24         | Exclusive choice, `as="radio"` (23 of 27). `as="tabs"` only when it switches panels                                                                   | One `rounded-md` item override                                                                                    |
| `MonoLabel`                              | 184 / 330      | Every caption, eyebrow and section heading (`as="h2"`/`"h3"`). Admin section captions use `tone="accent"` (106). Admin uses `size="eyebrow"` (48)     | Accepted: margins between sibling labels (46) are caller layout and stay (Diego, 2026-10-26); `text-inherit` (13) |
| `StatNumber`                             | 24 / 12        | `size="sm"` (20) or `"md"` (12); `lg`/`xl` only for hero readouts                                                                                     | None                                                                                                              |
| `StatusDot`                              | 15 / 14        | Always next to a word; `tone` derived from data                                                                                                       | None                                                                                                              |
| `Card`                                   | 28 / 28        | Standalone objects only. Listen pads with `p-5` (12 sites)                                                                                            | Fixed: redundant `border-border-quiet bg-card` removed from 12 Admin cards                                        |
| `InstrumentPanel`                        | 4 / 26         | The Admin section shell (`as="section"`, `headingLevel` passed)                                                                                       | `pt-0` (3)                                                                                                        |
| `HairlineList` / `HairlineRow`           | 3 / 18         | Simple lists; rows normally `truncate` with a `trailing` slot                                                                                         | None meaningful                                                                                                   |
| `EntityRow`                              | 25 / 6         | Every entity list row; never restyled. Admin always uses `menuButton="none"`                                                                          | None (0 overrides)                                                                                                |
| `EntityCard`                             | 9 / 6          | Grid tiles (`layout="grid"`)                                                                                                                          | Product hook classes only                                                                                         |
| `MediaCover`                             | 20 / 16        | Use `size` (48, 56, 64, 80, 88, 96 or `fill`); 48px is the row default                                                                                | Fixed: caller `size-*` classes replaced by `size`. Admin adds `border-border-quiet rounded-none` (3)              |
| `PageHeader`                             | 23 / 0         | Listen page header (`size="md"` on 7)                                                                                                                 | Admin uses `OpsPageHero` instead                                                                                  |
| `SectionHeader`                          | 49 / 0         | Listen section header                                                                                                                                 | Fixed: the container spaces it (`space-y-*`/`gap`); no `mb-*` on the header                                       |
| `PageHero`                               | 5 / 2          | Album, artist and editorial heroes                                                                                                                    | Heavy `contentClassName`/`artworkClassName` overrides on every use                                                |
| `FormField`                              | 68 / 68        | Every labelled control. `kind="group"` for multi-control groups (Listen 26)                                                                           | None meaningful                                                                                                   |
| `Input`                                  | 23 / 100       | Through `FormField`                                                                                                                                   | Fixed: the 15 hand-built Admin search fields now use `SearchInput`. Heights still set locally (11)                |
| `SearchInput`                            | 10 / 1         | All search fields                                                                                                                                     | Listen jam restyles it (`h-12`, `rounded-lg`, `backdrop-blur-none`)                                               |
| `Switch`, `Checkbox`, `Slider`, `Select` | 17 / 21        | Used as-is                                                                                                                                            | Checkbox `mt-0.5` alignment repair in Admin (4)                                                                   |
| `Tabs` (`TabsList`)                      | 3 / 10         | Text tabs. The list already fills the `Tabs` column and scrolls horizontally                                                                          | Fixed: no-op `w-full max-w-full min-w-0` removed (5)                                                              |
| `AppModal`                               | 10 / 6         | Listen modals and mobile sheets; width only through `size` (sm to 3xl)                                                                                | Fixed: the panel is a flex column and `ModalBody` the scroll region; `maxWidthClassName` removed                  |
| `DialogContent` (shadcn)                 | 0 / 22         | Admin dialogs; width only through `size`                                                                                                              | Fixed: class widths replaced by `size`                                                                            |
| `ConfirmDialog`                          | 14 / 24        | Every confirmation; destructive ones use `tone="danger"` in both apps. Admin adds a `consequence` line (19)                                           | Fixed: the legacy `variant="destructive"` alias is gone                                                           |
| `EmptyState`                             | 54 / 32        | Every empty result, centred in its container. `title` is a short state without a period; `message` one sentence with a period that does not repeat it | Fixed: dead `py-*`, `min-h-*` and alignment classes removed (the recipe wins)                                     |
| `ErrorState`                             | 53 / 62        | Every failed read, with `retryLabel`/`onRetry`; `variant="page"` for routes                                                                           | None                                                                                                              |
| `LoadingState`                           | 36 / 41        | Every section and route load                                                                                                                          | None meaningful                                                                                                   |
| `Meter`, `ProgressHairline`              | 9 / 19         | Ratios and progress, always with `valueText`                                                                                                          | None (0 overrides)                                                                                                |

Components with zero caller overrides are the reference for how a finished shared component
behaves: `ActionButton`, `EntityRow`, `Meter`, `ProgressHairline`, `ConfirmDialog`, `ErrorState`,
`Switch` and the tab triggers.

#### Button norm

| Role                                        | Variant and size                                                        | Measured usage (L / A) |
| ------------------------------------------- | ----------------------------------------------------------------------- | ---------------------- |
| Primary action of a region (one per region) | `default` (accent outline), default size                                | 43 / 75                |
| Standard command                            | `outline`; `size="sm"` in toolbars and dense rows                       | 28 / 157               |
| Low-emphasis, inline or navigation          | `ghost`                                                                 | 35 / 46                |
| Quiet filled alternative                    | `secondary` (rare)                                                      | 11 / 13                |
| Destructive                                 | `danger-soft` outside dialogs; `destructive` only on the dialog confirm | 5 / 0                  |

- Size is default (40px) in Listen (85 of 124) and `sm` (32px) in Admin (134 of 301). Both get
  44px on coarse pointers automatically.
- Do not force 44px with `min-h-11`. `size="lg"` (44px, wider padding) is a deliberate larger
  command, not a hit-target fix.
- `loading` is the only spinner position.

### Buttons and actions

- `Button` variants:

  | Variant       | Appearance                                                       |
  | ------------- | ---------------------------------------------------------------- |
  | `default`     | Accent outline: transparent, `border-accent-action`, accent text |
  | `outline`     | `surface-control` fill with an inset shadow                      |
  | `secondary`   |                                                                  |
  | `ghost`       | The most common variant                                          |
  | `link`        |                                                                  |
  | `destructive` | Only inside destructive dialogs                                  |
  | `danger-soft` |                                                                  |
  - Sizes: `xs` (24px), `sm` (32px), `default` (40px), `lg` (44px) and `icon*`.
  - Shape is `rect` or `pill`. The shared Button uses `rounded-md` (4px). Listen renders 6px
    instead (see Known drift).
  - `loading` shows the only allowed spinner position: inside the button.

- **Icon-only hover changes the foreground to accent-hi only**, with no background fill.
  `IconButton` adds a drop-shadow glow and a 1px lift.
- Header actions sit at the upper right as an `ActionGroup` of 44px ghost icon buttons. Each has a
  verb-only tooltip and an aria-label that names the object. Back stays outside the identity block.
- Ambiguous domain operations and final confirmations keep a text label.

### Rows

- **No hover background on list rows.** `row-hover-policy.test.ts` enforces this over
  `scripts/design-system/row-hover-scope.json`. Hover changes foreground or border only. The
  documented exceptions are:
  - `.track-row`: a 4% accent wash, on fine pointers only;
  - playlist list rows.
- Active, selected or current rows show a 2px `accent-action-hi` left bar and the
  `crate-row-highlight` gradient (8% accent to transparent). The current track's title turns
  accent-hi.
- Selection never implies current playback.
- Track rows are 56px (52px compact) and flat, with a hairline bottom border and radius 0.
  - The leading slot shows the mono index, which swaps to a white play glyph on hover.
  - Metadata columns (quality, BPM, key, duration) are always reserved, so a missing value leaves
    an empty slot.
- Row actions reveal on hover on fine pointers only
  (`pointer-fine:opacity-0 group-hover/row:opacity-100`, plus `focus-within`).

### Images

- Standalone album, track and artist art is **never smaller than 48px**
  (`media-thumbnail-policy.test.ts`). Smaller containers need `crate-media-thumbnail`.
- Covers have no shadow and no lift. A 1px inset hairline turns `accent-action-hi/40` on hover.
- Avatar sizes are 24, 28, 32, 40, 56 and 80px. Compact artist identity is 24px (album byline) or
  28px (player).
- Hero art is dimmed artwork plus the `--hero-artwork-gradient-*` scrims. Use the `PageHero`
  `background.treatment` instead of inline brightness and opacity classes.

### Forms

- There are twelve form families, all on the `crate-form-*` recipes.
- Inputs are 15/21 weight 400 (16px on iOS to avoid zoom). `Select` defaults to a stable 12rem
  width.
- `Switch` is 32×18, the checkbox is 18px, and `Slider` has a 2px rail, an 8px thumb and a
  40/44px target.
- **Errors:**
  - `StatusDot warn` with the message in `state-warning-text`
  - no red border
  - validate on blur
  - never a toast
- A required marker is `*` in warning text.

### Overlays

- One contract for both apps, `crate-overlay-*` in `tokens/recipes.css`, enforced by
  `overlay-recipes.test.ts`.
- Scrim: `--surface-scrim`, no blur.
- Panel widths are 420, 560, 760 and 896px (`data-overlay-size` `sm`–`xl`).
- `OverlayCloseButton` is a 40px control with a 24px glyph, top-right, 16px inset.
- Menu items are 36px (44px coarse). Hover, highlight, focus and open submenu all use the
  neutral `--hover-bg` fill (foreground 5%) with an accent-hi foreground, and no border change.
  This includes MonoLabel options. The same recipe covers ContextMenu, DropdownMenu, Select and
  AppPopover in both apps (`overlay-recipes.test.ts`, since `cb812597`).
- Menu labels are 11px mono uppercase in `text-subtle`.
- Tooltips are mono 11px, max 28ch, on the object surface, with a 400ms delay.
- On mobile, `AppModal` and `ContextMenu` become bottom sheets with a 36×4 grabber and drag to
  dismiss (`use-sheet-drag`).

### Feedback states

- **Loading** reserves the real geometry, using `—` for unknown values. Instruments never show a
  spinner or shimmer. Route loading shows a `LOADING` MonoLabel over a 120px hairline after 200ms.
- **Empty** is inline: an uppercase mono title and a muted line, with no icon.
- **Error**: a page error has an eyebrow with the code and a status dot
  (`Service error · 503`), a Bricolage 800 title and no red icon.
- **Stale or warming** data shows amber `StatusDot` words; Admin uses `OpsRefreshNotice` for this.
- **A failed read never masquerades as empty or zero.**
- **Toasts** come after inline feedback, never instead of it. They are unstyled `crate-toast*`
  with no icons and a 4s duration. Listen places them bottom-centre above the dock; Admin places
  them bottom-right. Listen copy never shows task IDs.

---

## 9. Data visualization

| Kind                                                                                                                                        | Tool                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Statistical charts (bar, line, scatter, heatmap)                                                                                            | **Nivo** with the token-resolved theme        |
| Instruments (EQ curve, genre wheel, readouts, rails, lanes, gauges, maps, mood map, heatmap band, ticket, crossfade strip, orbit, topology) | Hand-built SVG, HTML/CSS, Canvas 2D or WebGL2 |

No new chart libraries; recharts stays out. See design-system plan §3.5.

The Nivo theme (`app/ui/src/components/charts/InstrumentChart.tsx`, `useChartColors`):

- Text is mono 11px. Axis domain lines and ticks are transparent; there is a y-grid only, in
  `border-quiet`.
- The crosshair is accent, dashed `2 4`.
- The tooltip is a flat surface with a 1px border, no radius, no shadow and mono 11px text.
- The primary series is accent-hi. The comparison series is the secondary tone, dashed.
- Area fills are at most .08. No pies, no radars, no points by default, three y-ticks.
- Companions: `InstrumentChartPoint`, `InstrumentChartReadout` and `InstrumentChartLegend`.

Choose the renderer by mark count:

| Marks                | Renderer                       |
| -------------------- | ------------------------------ |
| Regular cells        | HTML/CSS                       |
| A few hundred        | SVG                            |
| About 1K soft points | Canvas 2D                      |
| More than about 10K  | WebGL2, always with a fallback |

Every instrument has an `aria-label` summary with the real numbers. Under forced colours it keeps a
`CanvasText` border and a `Highlight` active state.

---

## 10. App shells

Both apps share the identity. Their shells differ by job.

### Listen: a listening product

- **Desktop**
  - The sidebar is `w-52` open and `w-14` collapsed. Items are MonoLabel; the active item has a 2px
    accent-hi left bar.
  - The `h-16` top bar holds back/forward, search and the avatar. It is transparent at the top of
    hero routes and becomes `bg-surface-chrome` after 96px of scroll.
  - Content is `max-w-content px-6 py-6`.
  - The player is a floating dock inset 12px, `rounded-panel`, 82px tall (104px on coarse
    pointers).
- **Mobile**
  - One `rounded-panel` dock slab holds the mini-player (66px) above the 76px tab bar.
  - Safe areas, keyboard and clearances come from `listen-shell-metrics.css` (`--listen-safe-*`,
    `--listen-*-clearance`). Never hardcode player offsets.
- **Product moments**
  - The artwork-led hero (Home carousel, Album, Artist).
  - The player stage (CD, Cover or Visualizer).
  - Lyrics with a progress underline.
  - The mix indicator.
  - Stats as an editorial "dossier".
  - Paths cover journey.
  - The show ticket.
- **Native shells.** Capacitor reuses the mobile shell with a transparent status bar. Tauri on
  Linux draws a 36px custom title bar; its 28px window controls are the one accepted exception to
  the 44px target rule.
- **Copy and toasts.** Every string goes through `t()` in seven catalogs (en, es, fr, de, it, ca,
  eu) with ICU plurals and `Intl` formatting. Product terms stay in English
  (`i18n/product-terms.ts`). Toasts use `notify`.

### Admin: an operations instrument

- **Sidebar**: 240px expanded, 144px collapsed, no icons. Items are MonoLabel; section captions are
  accent MonoLabel. Counters use `InfoBadge variant="counter"`. Active is a 2px accent-hi left
  rule; hover changes the foreground only.
- **Top bar**: `h-16`, solid `bg-app-surface` with a hairline. `⌘K` opens the command palette and
  `?` opens shortcuts.
- **Content**: up to 1880px wide.
- **Page archetype** (the Dashboard grammar):
  1. `OpsPageHero`: title, subtitle, freshness and live-state `InfoBadge`s, and header actions.
  2. An optional `OpsRefreshNotice`.
  3. A vertical stack of numbered `InstrumentPanel`/`OpsPanel` sections (`01 System`,
     `02 Work in progress` …).
- **Pieces within that archetype:**
  - Stat tiles: `OpsStatTile` with mono numerals.
  - Lists: hairline lists rather than tables.
  - Charts: Nivo instrument charts.
  - Severity: monochrome meters.
  - Typography carries the UI: text, numerals, rules, and a dot plus a word.
- No glows, blur, gradients or local backgrounds to fake a "dashboard" look.
- **Copy**: English (`en-US`). Toasts use `sonner`.
- Listen is the primary visual reference for Admin (`app/ui/ADMIN_UI_REVIEW_CHECKLIST.md`).

---

## 11. Copy and labels

- **No emojis** anywhere in the UI, including task icons.
- Actions are short and sentence case: "Album saved", "Link copied".
- Empty states are warm and specific, not generic ("Your stats are waiting for signal").
- Do not describe audio features as "beatmatch", "sync", "lock", "handoff" or "automix" unless the
  feature really does that.
- Use honest units. Uppercase comes from CSS (`MonoLabel`, form labels), never from the source
  string.
- Live regions and aria-labels are translated like visible copy.

---

## 12. Accessibility

- Focus is global and is never removed. Components do not add `focus:ring*` or `focus:shadow*`
  (`design-token-policy.test.ts`).
- Icon-only controls require a `label`/`aria-label`; the same text becomes the tooltip.
- Use 44px targets on coarse pointers.
- Live values use `aria-live="polite"` (`Readout`, `InstrumentPanel status`). Meters and progress
  bars expose full ARIA value attributes.
- Do not convey information through colour alone (§2). Decorative text is `aria-hidden`.
- Forced colours: focus uses `Highlight` and status dots get a `CanvasText` border.
- Reduced motion is honoured through the motion gate (§6).
- Every route has a `SkipLink`, and the route entrance moves focus to the `h1`.

---

## 13. Banned patterns

| Banned                                                                                     | Instead                                                                                       |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| Raw hex, `rgba()`, `text-white/N`, `border-white/N`, Tailwind palette colours (`cyan-500`) | Semantic tokens                                                                               |
| `rounded-[…]`, `z-[…]`, `shadow-[…]`, `text-[Npx]`, `tracking-[…]`                         | Token utilities (`rounded-panel`, `z-app-*`, `shadow-popover`, `text-label`, `tracking-caps`) |
| Literal icon `size={N}`                                                                    | `CRATE_ICON_SIZE.*`                                                                           |
| `backdrop-blur`, glass, grain, shadows on panels or cards                                  | Flat surfaces with hairlines                                                                  |
| Hover background fills on rows and icon buttons                                            | Foreground or border change                                                                   |
| Green, red or blue status colours; coloured severity ramps                                 | Accent, amber and neutral, plus a word                                                        |
| Native `title=` tooltips                                                                   | `TooltipHint`                                                                                 |
| Local focus rings                                                                          | Global focus ring                                                                             |
| Per-caller margins or size repairs on shared components                                    | Fix the shared component                                                                      |
| App-specific foundation overrides                                                          | Converge in `@crate/ui`                                                                       |
| Spinners in panels or instruments                                                          | Reserved geometry with `—`                                                                    |
| Dashed boxes with big icons as empty states                                                | `EmptyState`                                                                                  |
| `richColors` toasts, toasts for form errors                                                | Inline feedback                                                                               |
| `tracking-eyebrow` or wider                                                                | `tracking-caps` / `tracking-kicker`                                                           |
| Auto-cycling, demo data, animating from zero                                               | Real state on first paint                                                                     |
| `style={{}}` for data geometry                                                             | CSS variables (`--v`, `--p`) consumed by recipes                                              |
| `lucide-react` in Listen; new Lucide in Admin                                              | Solar through `@crate/ui/icons`                                                               |
| New chart libraries, recharts, pies, radars                                                | Nivo or hand-built instruments                                                                |
| Raw `<input>`/`<select>`/`<textarea>` in review scenes                                     | Shared form components                                                                        |

---

## 14. Governance

### Making a change

1. **Change foundations** only in `lib/appearance-token-registry.ts`, then run
   `npm run design-system:tokens:generate`.
2. **Add or change a shared visual component**: update its entry in
   `tools/crate-ui-showcase/catalogue.json`, its story or MDX and its tests in the same change.
   - Run `npm run design-system:showcase:refresh -- <id>`, then
     `npm run design-system:showcase:check`.
   - New entries cannot be `pending`, and documented entries cannot be downgraded.
   - Complete legacy pending coverage before changing a component; do not refresh hashes alone.
3. **Review.** Each checkpoint gets a small standalone review page that shares a scene with
   Storybook (`:6006`), next to the mockup host (`:5186`), Listen (`:5174`) and Admin (`:5173`).
   Stop for Diego before committing visual changes.

### Policy tests

| Test                                                                                                                 | Enforces                                                      |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `app/shared/ui/design-token-policy.test.ts`                                                                          | No local focus rings, zero arbitrary-value budget, icon sizes |
| `app/shared/ui/row-hover-policy.test.ts`                                                                             | No row hover fills, outside the documented exceptions         |
| `app/shared/ui/media-thumbnail-policy.test.ts`                                                                       | 48px minimum artwork                                          |
| `app/shared/ui/native-tooltip-policy.test.ts`                                                                        | No native `title`                                             |
| `app/shared/ui/overlay-recipes.test.ts`                                                                              | One overlay contract, no blur                                 |
| `app/shared/ui/export-usage-policy.test.ts`                                                                          | Shared exports are used by an app                             |
| `app/shared/ui/showcase-policy.test.ts`, `showcase-staged.test.ts`                                                   | Catalogue coverage of the staged index                        |
| `app/shared/ui/preview-component-policy.test.ts`                                                                     | No raw controls in review scenes                              |
| `app/ui/src/status-colour-policy.test.ts`                                                                            | Admin status palette                                          |
| Listen `radius-`, `badge-`, `genre-pill-`, `toast-`, `layout-`, `component-` and `context-menu-surface-policy` tests | Listen adoption; raw-button budget                            |
| `npm run design-system:drift`, `design-system:layers`                                                                | Drift and layer inventories; ceilings only go down            |

Bundle budgets are 300 KB gzip of initial JS for Listen and 520 KiB for Admin.

### Known drift

Inventory from the 2026-10-25 audit. Fix within reviewed scopes; do not copy these patterns.

**Shared and Listen**

- Button radius differs between apps.
  - The shared `shadcn/button.tsx` uses `rounded-md` (4px), and Admin renders that.
  - `app/listen/src/index.css` forces every `[data-slot="button"]`, and every `rounded-full`
    button or link with horizontal padding, to `--radius-lg` (6px). In Listen this includes
    `shape="pill"` and the hero primary action.
  - No decision yet; callers never set a button radius themselves.- Listen has dead glass CSS (`.listen-*-glass`, `.listen-glass-panel--dock`) and a
    `data-crate-motion="off"` selector that never matches.
- Listen hardcodes player offsets (`pb-[94px]`, `md:bottom-[92px]`, `pt-[92px]`) instead of the
  clearance variables.
- Listen uses ad-hoc uppercase labels instead of `MonoLabel` in the full-screen player tabs, the
  jam room and the mobile nav. Mobile nav labels (10px, not uppercase) differ from the sidebar.
- Listen-only product recipes (`.stats-*`, `.jam-*`, `.home-*`, `.radio-*`) live in the shared
  `recipes.css`.

**Admin**

- Admin has about 40 Lucide import sites, raw `white/N` alpha in the shell and in `UserMap`,
  `GenreTaxonomyTree` and the AI model panels, and arbitrary `text-[8–11px]` sizes (QueueLanes,
  GenreWheel, Settings).
- Admin mixes three dialog systems (`Dialog`, `AppModal`, `ConfirmDialog`) and two section styles
  (shadcn `Card` in Users, Roles, Settings and Federation vs ruled `InstrumentPanel`).
- `GovernorGauges` rebuilds `Meter`. Local `star-rating`, `image-lightbox` and `QrCodeImage` are
  unused duplicates.

### Open questions for Diego

1. The row and date contract (`RowLayout`, `EventRow`, `CalendarDate`) is still a proposal
   (`docs/plans/2026-10-19-crate-v3-row-normalization-proposal.md`). Only the HairlineRow part
   (12px inset, left alignment) is approved and applied.

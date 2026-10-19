# app/shared — @crate/ui design system and shared web code

Scope: `app/shared/ui/` (npm workspace `@crate/ui`) and `app/shared/web/` (plain TS modules imported by relative path). `app/shared/cast/` (`@crate/cast-protocol`, used by listen + cast-receiver) and `app/shared/fonts/` are not covered here. Platform rules live in the root `AGENTS.md`.

## Consumers (verify before changing any export)

| Consumer               | Uses                                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------------------- |
| `app/listen`           | `@crate/ui` heavily (~360 files), `shared/web/{api,use-api,utils,library-routes,sentry,artist-hero-contract}` |
| `app/ui` (admin)       | `@crate/ui` (~100 files), `shared/web/{api,use-api,utils,library-routes,sentry}`                              |
| `app/listen-desktop`   | shared identity/preferences and Listen code it pulls in; tsconfig includes `../shared/web/**`                 |
| `app/site`, `app/docs` | `shared/web/sentry` only                                                                                      |
| `app/cast-receiver`    | none of these (only `@crate/cast-protocol`)                                                                   |

Find real usage with `git grep -n "@crate/ui/<path>" -- app/ui/src app/listen/src app/listen-desktop/src` and `git grep -n "shared/web/<file>" -- app`.

## Directory map

```
ui/tokens/        CSS tokens: index.css (entry), surfaces.css (fixed solid), themes.css (one generated identity), semantic, colors, radius, z-index, typography, animations, recipes
ui/lib/           Hooks + utils: cn, use-breakpoint (useIsDesktop), use-dismissible-layer, use-sheet-drag, crate-identity, interface-preferences, appearance-token-registry, notify, offline
ui/icons/         Icon catalogue (Solar icons wrapped as CrateIcon, CRATE_ICON_SIZE scale); import from "@crate/ui/icons"
ui/shadcn/        19 curated shadcn/Radix components (button, dialog, select, sheet, table, tooltip, ...)
ui/primitives/    App-level building blocks: AppModal, AppPopover, ActionIconButton, CrateBadge, IconButton, VtNavLink, ...
ui/composites/    Composed blocks: ConfirmDialog, AdminSelect, Card/Grid/TableSkeleton
ui/domain/        Music-domain UI: actions, auth, brand, entity, filters, genres, hero, lists, media, navigation, player, playlists, shows, states, stats, user
ui/*.test.ts      Package policy tests (export-usage-policy, design-token-policy)
web/api.ts        createApiClient({ base, credentials, defaultHeaders, onUnauthorized, onError }) + ApiError; dedupes in-flight GETs
web/use-api.ts    createUseApi(reactHooks, apiFn) factory; catalog-warming retry
web/library-routes.ts  Canonical page/API/asset path builders for artists, albums, tracks, genres
web/utils.ts      Formatters (formatDuration, formatSize, timeAgo, ...) and encPath
web/sentry.ts     Shared Sentry scrubbing + API error reporter
web/artist-hero-contract.ts  Artist hero composition contract types (versioned)
```

## Hard rules

- A component goes in `@crate/ui` only when BOTH admin and listen use it. Single-app components stay in that app. `export-usage-policy.test.ts` fails if a `@crate/ui` module is not imported by `app/listen/src` or `app/ui/src`, unless it matches a base-system prefix (shadcn, tokens, icons, composites) or is listed in `UNUSED_EXPORT_ALLOWLIST` with a reason.
- Domain components take data and callbacks via props (`onPlay`, `onClose`, `onToggle`, ...). Do not read app contexts (auth, player, router state, i18n) or call app API clients inside `@crate/ui`; apps inject behavior through thin wrappers (see `app/ui/src/components/auth/OAuthButtons.tsx`).
- `shared/web` factories stay framework-injected: `createUseApi` receives React hooks and an `api` function; `createApiClient` receives callbacks. Do not hardcode app behavior (redirects, token storage, Sentry init) here.
- Use tokens, not raw values. `design-token-policy.test.ts` budgets arbitrary `rounded-[..]`, `z-[..]`, `shadow-[..]`, `text-[..px]`, `tracking-[..]` per file, and icon sizes must come from `CRATE_ICON_SIZE`.
- Every stacked form label has an 8 px gap to the component below it, in both apps. Use the
  shared `.crate-form-field` grid recipe (also used by FormField), not per-caller label margins
  or `space-y-*`. It aligns content to the start so adjacent wrapping groups cannot stretch
  that gap. Preserve horizontal rows; their vertical gap is 8 px when they wrap.
- Listen and Admin share one V3 identity, tokens, primitives, recipes and interaction rules.
  Surfaces are fixed solid; read `--color-card` / `--surface-*`, never branch on app identity.
  `lib/crate-identity.ts` removes legacy visual overrides at startup; functional motion/effects/
  density live in `lib/interface-preferences.ts`. No selectable skins/modes or app-specific
  foundational styling. Domain components/workflows may differ; migrate legacy local duplicates.
- Peer deps only (react 19, react-router 7, radix-ui, sonner, cva, clsx, tailwind-merge, @solar-icons/react-perf). Do not add runtime dependencies without updating `package.json` peers and the `external` list in `tsup.config.ts`.
- Charts: Statistical charts (bar, line, pie, scatter, heatmap, radar) use Nivo with the app's token-resolved theme. Instruments (EQ curve, genre wheel, readouts, rails, lanes, gauges, maps, mood map, heatmap band, ticket, crossfade strip, orbit, topology) are hand-built SVG, HTML/CSS, Canvas 2D or WebGL2, following `docs/plans/2026-10-14-crate-v3-design-system.md` §3.5. No new chart libraries; recharts stays out.
- No emojis in UI text.

## How apps import

- `@crate/ui` resolves through the npm workspace symlink (`node_modules/@crate/ui` -> `app/shared/ui`). The `exports` map points at SOURCE `.ts/.tsx` files, so apps compile the source directly; `dist/` (tsup + tsc) is only used by `publishConfig`. A shared edit is live in every consumer immediately.
- Subpath imports only: `@crate/ui/shadcn/button`, `@crate/ui/primitives/AppModal`, `@crate/ui/composites/ConfirmDialog`, `@crate/ui/lib/cn`, `@crate/ui/domain/genres/GenrePill`, `@crate/ui/icons`. CSS: `@import "@crate/ui/tokens/index.css"`.
- Wildcard subpaths (`./domain/*`, `./primitives/*`, ...) map to `*.tsx` only. Folder barrels (`index.ts`) and `.ts` modules (`domain/actions`, `domain/media/MediaEntity`, `domain/shows/show-types`, ...) need an explicit entry in BOTH `exports` and `publishConfig.exports`; `lib/*` maps to `*.ts`.
- `shared/web` is not a package: import by relative path (`../../../shared/web/api`). Admin and listen wrap it in `src/lib/api.ts`, `src/hooks/use-api.ts`, `src/lib/utils.ts`, `src/lib/library-routes.ts`; app code should import those wrappers.
- Consumers scan shared classes via Tailwind `@source "../../shared/ui"` in their CSS entry. A new consumer must add it or shared component classes will be purged.

## Adding a component

1. Confirm both apps need it now. Otherwise keep it in the app.
2. Pick the layer: shadcn (unchanged Radix wrapper) < primitives (app-agnostic) < composites (composed blocks) < domain (music concepts, props/callbacks only).
3. Add `Thing.tsx` + `Thing.test.tsx` next to it. If it is a `.ts` module or a barrel outside `lib/`, add explicit `exports` + `publishConfig.exports` entries.
4. Replace the app-local copies in the same change so the export-usage policy stays green and no duplicate survives.
5. During development, typecheck and run focused tests for shared changes and affected callers
   in BOTH apps. Run full suites once when development or the phase closes.

## Commands

```bash
npm run --workspace=app/shared/ui typecheck   # tsc --noEmit
npm run --workspace=app/shared/ui test        # vitest (jsdom); includes policy tests
npm run --workspace=app/shared/ui build       # tsup ESM + tsc declarations into dist/
npm run design-system:tokens:check            # theme token CSS snapshot (root script)
npm run design-system:drift                   # drift inventory (scripts/design-system)
# Phase-close validation only (once); use file-scoped tests during development:
npm run --workspace=app/ui typecheck && npm run --workspace=app/ui test
npm run --workspace=app/listen typecheck && npm run --workspace=app/listen test
npm run --workspace=app/listen-desktop typecheck
```

`shared/web/*.test.ts` run under the listen suite (`app/listen/vitest.config.ts` includes `../shared/web/**/*.test.ts`), not under `@crate/ui` or admin. Run `npm run --workspace=app/listen test` after touching `shared/web`.

## Pitfalls and breaking changes

- Renaming or removing a prop, export, token or CSS variable breaks listen, admin and listen-desktop at once. Grep all consumers first and say so explicitly in the PR; prefer additive changes plus a follow-up removal.
- Changing a token value in `tokens/` changes both apps. Check Listen and Admin together on the fixed V3 surfaces.
- `library-routes.ts` builds URLs the backend and readplane serve; changing a path shape is a cross-stack change.
- `api.ts` in-flight GET dedupe and abort semantics are relied on by both `useApi` instances; keep behavior stable.
- AdminSelect and Admin card/grid/table skeleton subpaths are compatibility re-exports of shared implementations; loading/empty/error state foundations are shared (1b.4). Admin still keeps other local duplicates of composites/primitives (`app/ui/src/components/ui/`); consolidate instead of adding a third copy. Show cards and Ops surfaces remain app-local; the unused shared copies were removed in Task 1.12. Shared `domain/shows/show-types.ts` remains consumed by Admin.

## Informative labels and controls — local 1AQ

New consumers use `primitives/InfoBadge` for metadata/state/inline counts and
`primitives/FilterChip` for toggle filters or explicit actions. InfoBadge: Mono40012/16,
24px high, border1px, padding3px8px, capsule, semantic tone/surface; its counter variant uses
6px horizontal inset for balanced numeral ink. FilterChip/SegmentedControl/GenrePill use12px
and32px fine/44px coarse minimums. GenrePill remains the domain component with percentages,
provenance and independent select/remove actions. CrateBadge/Chip/Pill and shadcn Badge are
compatibility adapters/recipes, not separate foundations. No local typography/geometry overrides.
See docs/plans/2026-10-19-crate-v3-ui-labels.md. Generic text-badge/text-label and the player queue
counter keep their separate roles; do not change their global values to resize the collection.

## Mandatory showcase maintenance — 1AQ

Visual source of truth: Diego's approved persistent mockup (5186), with his later confirmed
adjustments. The component catalogue documents the implementation of that reference. Flag doubts,
drift or mobile sizing conflicts and resolve them with Diego; do not invent a competing reference.

HairlineList/Row: the shared row owns 12 px horizontal inset, 10 px vertical padding and left text
alignment, including asChild native links/buttons; gap14px and min32/44 remain. Long unbroken
text wraps with truncate=false. Text owns Poppins400 at12/18 on desktop AND mobile, matching the
mockup with Diego's confirmed mobile adjustment (the old11px reduction is retired);
the previous inherited typography was confirmed as drift. Native refs/semantics/handlers remain
unchanged. Do not restore geometry or font-size fixes in consumers or the historical mockup.
Current production consumer is Listen's expanded show setlist; Admin adoption is still pending.

Every added or changed visual component updates its entry in
`tools/crate-ui-showcase/catalogue.json` and its contract/story evidence in the same change.
Complete pending entries before modifying their component; new entries must be documented.
Run `npm run design-system:showcase:refresh -- ID`, `design-system:showcase:check` and affected
story/consumer tests. The staged hook and shared policy test enforce correspondence; semantic
review remains required. Do not refresh pending hashes to bypass coverage. See the showcase
README and AGENTS. Keep stories/docs outside shared tsup entry folders and app runtime imports.

## Complete form family — local 1AR

Each review step uses a small standalone page at5186 and a matching Storybook review story,
sharing one scene from `tools/crate-ui-showcase/reviews`. Do not grow the historical main mockup.
This supplements, rather than replaces, mandatory component entry maintenance in Storybook.
The isolated review must cover the full approved checkpoint scope and agreed states; compare
its inventory with the plan before handing it over. Current1AR includes all12form families.

Use FormField stacked for ordinary fields (Mono 400 uppercase caption, 8 px actual gap), or
layout="inline" for Checkbox/Switch (control first, the same MonoLabel to the right,
16 px horizontal gap). Layout changes placement only: every caption, including radio options,
uses MonoLabel (Mono 400 uppercase11/15.4, caps tracking and subtle color). Hint/error stay associated below the caption. Group controls use kind="group" so their caption does not point a native label at a div.
Composite controls use the render prop and forward all supplied id/ARIA attributes to their actual trigger/group.
AdminSelect now forwards these attributes in both plain and searchable modes.

Input/Select use the existing 40/44 px recipe and Poppins 400 15/21. Input preserves native
number/date/time/file controls; Textarea owns its multiline geometry. SearchInput clears only
editable queries and waits for IME composition to finish before emitting a debounced query.
Checkbox/Switch/RadioGroup share high accent/warning and 44 px coarse hit areas; radio choices
reserve enough space to avoid overlapping targets. SegmentedControl and FilterChip remain
12/16 Mono 400; categories use Select, filters/modes use their appropriate controls. Slider
is a native general form range (2 px rail, 8 px thumb, 40/44 px target), used in both apps'
settings. Preserve specialized player/EQ progress, beam and volume behavior.

All twelve forms have live Storybook entries and Patterns/Forms composes them. New samples
belong only in Storybook. Existing persistent mockup controls, including fixture helpers,
must import these components; preview-component-policy.test.ts rejects raw form copies.

## Shared action family — 1AS

Button is the text-action foundation. ActionGroup/ActionButton/ActionLink compose the approved
Button ghost/icon-lg plus Tooltip recipe for conventional header/row actions;44px, short tooltip,
contextual accessible name, native group/Tab semantics. Disabled/loading discovery uses a stable
wrapper and preserves the native control. Admin PageHeader names are compatibility adapters.
IconButton retains compact round/glow controls; ActionIconButton/ActionIconLink remain legacy
row/card compatibility. Coarse targets reserve44px in layout, not overlapping pseudo-elements.
Do not use an icon-only control for ambiguous domain operations or final confirmations. AI
availability, BackLink/navigation and specialized PlayButton/progress remain separate contracts.


## Headers — local 1AU

PageHeader owns ordinary title/context/subtitle/meta typography and delegates positioning to
PageHeaderLayout, also used by the Admin compatibility adapter. Keep Back outside identity;
container width determines action wrapping/placement. SectionHeader is the content/rail role,
not an InstrumentPanel caption. PageHero preserves its four roles and compact-title option;
height="content" is the shared contract for content-sized CrateHero, without per-caller min-height
repairs. HeroActionBar preserves playback/menu semantics and bounds long labels within its
available width. Preserve existing native Album/safe-area composition until its owning phase.

## Image and identity — local 1AV

MediaCover owns the media frame, clipping and technical fallback; renderImage injects an app's
managed renderer without moving authentication, srcSet/sizes or credential recovery into shared.
Managed transports retain fallback/ready artwork and own retry; do not report transient recovery
as a final native image error. Avatar/EntityAvatar retain person size/shape/ring/badge roles and
React19 native refs. PlaylistArtwork owns native cover/collage/generated fallback and named
collage/placeholder semantics; app buildCoverUrl/renderImage remain transport boundaries. Brand
logos are assets, not avatar variants. All six have live English catalogue entries; outer
placement/dimensions remain composition, not a reason to override internal typography or states.

## Entities, tracks and collections — local 1AW

MediaCover owns a48px minimum in both dimensions for standalone track/album/artist thumbnails,
including compact rows. The shared `crate-media-thumbnail` recipe gives legacy managed/raw
frames the same minimum until their owning page adopts MediaCover; user avatars, logos and
internal collage tiles keep their separate roles. New media consumers use the component.
EntityRow/Card own14px/500 body titles and technical mono metadata; HairlineRow remains12/18.
Selection does not imply current playback. Optional full text wraps inside the frame. EntityCard
profileSize owns the existing finite artist widths; do not restore local width maps.
TrackList keeps injected virtualization at80 and stable entry keys; Grid/Rail retain native
navigation and reserve geometry. Listen playback remains local: white18px glyph in a24px visual slot over48px cover,
40px active ring with aura/core/effects, real coarse hit area and progress-only leaf subscriptions.
No row hover background. Do not replace the specialized player/EQ controls.

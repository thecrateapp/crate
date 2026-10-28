# 1AY — Listen Shell, search and basic collection

Base `5bc683d8` (1AX published). Diego approved this scope and requested hero-background
investigation first. Preserve the approved mockup and amendments, all existing checkpoints,
the fixed historical reference, and active previews5186/6006/5174. Stop uncommitted at1AY.

## Ordered work

1. Hero framing investigation completed. Top anchoring was rejected. Diego subsequently
   approved the real-photo comparison: desktop artist backdrop100px lower, original gradient
   and hero geometry. The final amendment supersedes the first rollback; no top anchoring or
   shortened fade survives. Preserve mobile/genre defaults.
2. Reconcile desktop/mobile Shell and navigation to the approved flat chrome, hairlines,
   44px controls and active markers. Keep Solar glyphs, safe areas, with/without player,
   transparent hero header and scroll threshold. Remove Sidebar's audio-driven brand glow.
   Preserve access/PublicShell routes and the actual player rather than rebuilding them.
3. Reconcile TopBar/search composition using existing shared forms, actions, layers, feedback
   and entity contracts. Preserve IME, recents, preload, managed artwork, keyboard and history.
4. Library artists/albums/liked adopts approved typography, filters and shared text Tabs.
   Extend the Listen URL helper for `/collection/:section` without changing Admin's helper;
   preserve other query parameters, hash, location state, unknown values and back/forward.
   Keep all seven collection destinations and existing sorting/refresh/virtualization.
5. One small review scene in Storybook and5186, composing actual view components. No new main
   mockup sections, duplicated markup, local internal CSS repairs or fabricated production
   data. Add/update affected contracts and catalogue entries, including pending before edits.
6. Focused serial tests, affected typechecks/lint, builds/bundle checks and browser geometry/
   interaction checks. One fresh source review for this checkpoint, fix confirmed findings,
   document concrete limits, and stop for Diego before commit/push.

## Boundaries

No player/engine rewrite (1AZ), Album/native redesign (1BA), Smart Mix, broad Admin migration,
full suites/CI, canonical baseline refresh, PR/merge/rebase/deploy/release. Shared components
remain framework/context-free; Listen-only composition stays in Listen. New hooks do not
subscribe large trees to playback progress. No API writes from review scenes.

## Decisions

- Hero framing: desktop ArtistHeroSection uses `center calc(50% + 100px)` on its actual
  managed image, as approved live. The [investigation](2026-10-19-crate-v3-hero-framing-investigation.md)
  retains the rejected trials and final ruling. Original fade and geometry remain.
- Diego's collection amendments: totals beside tabs (real values only,0 visible); Play All
  bottom-aligned with labelled search/sort; Select has a stable12rem base width capped by
  container, with explicit form widths retained. Labels and dimensions remain shared.
- Diego's Tabs amendment: one decorative cyan underline travels using spring-snappy450ms,
  with acceleration/overshoot. Initial selection has no entrance flight. CSS handles repeated
  retargeting, OS/Crate reduced motion and forced colors; measurements handle resize, label/count
  changes, fonts, vertical lists and RTL. Semantics and URL state remain Radix/app owned.
- Source review and validation belong to the whole checkpoint; don't repeat full checks for
  each component. Existing single-app views do not become shared without two real consumers.


## Implemented for review — 1AY

Desktop/mobile shells now use actual API-free presentation views in both app and review scene.
Flat chrome, scroll hairlines, stable branding,44px navigation, expanded/collapsed Collection
and its portalled narrow-viewport surface preserve destinations and native links. Mobile uses
AppModal for the seven destinations; player controls/engine remain outside route transitions.
Focus moves to a newly settled page heading, waits for lazy content, and cancels after user
interaction. Collection section changes retain tab focus instead of claiming a new page.

Search composes actual forms/feedback and shared entity/list primitives. The review uses the
same SearchAlbumResultsView/SearchTrackResultsView/LibraryLikedView as production. It includes
sort/search/actions, tracks, album results, no-results/error states and the existing search-layer
keyboard fixture. I18n in the scene uses local English resources only, with no remote provider.
Live app artwork transport, queues, IME/recents and virtualization remain app controlled.

The fresh source review identified route-tab focus theft and incomplete scene coverage (Important),
plus reserved sort geometry and short-viewport popover clipping (Minor). All four are corrected.
Browser checks additionally caught sub44px collection links and delayed scroll dismissal; the
actual icons now use the24px catalogue size and the popover repositions without dismissing on
its own focus scroll. The complete view and keyboard paths are tested in both hosts.

Guards ratchet raw controls110→102buttons and7→6inputs; removed arbitrary value/icon exceptions
are deleted. Layout policy follows the moved canonical metrics CSS. The short-select guard now
classifies the existing private/public form field and typed collection Sort adapter according to
the approved categorical Select rule. Three stale row-hover selectors follow their actual migrated
owners (EntityRow, playlist row and EventRow); no production hover-fill exemption is added.

Review URLs: `http://127.0.0.1:5186/review-1ay-shell.html` and
`http://127.0.0.1:6006/?path=/story/reviews-1ay-shell--complete`.
Focused validation and exact remaining limits are consolidated in current-state. Stop without
commit/push. 1AZ player scope begins only after Diego's next approval.

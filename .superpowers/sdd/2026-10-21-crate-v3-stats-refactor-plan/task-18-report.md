# Task 18 report: Movement section

Status: DONE (with concerns below).

## Implemented
- `StatsMovementView.tsx` (pure): section `id="movement"` (`@container`), SectionHeader `stats.movement.title`, three Card columns Rising / New / Back (container-query `@3xl:grid-cols-3`, stacked when narrow). `scope="global"` renders Rising only. Exclusion: Set of trimmed names, case-sensitive; 5 rows per column. Row = Link + injected artist avatar + name + body copy. Empty state per column: `noSurge`/`noNewObsession`/`noComeback` plus the matching `*Fallback`.
- `StatsMovement.tsx` (adapter): `StatsMovement({ story, exclude, scope })`; owns `artistPagePath`, `artistPhotoApiUrl`, CrateImage (48px circular `crate-media-thumbnail`).
- Stats.tsx: Movement placed after the editorial stack (artist + highlights), before top listeners/tracks; `movementExclusions(page)` = hero + top-3 artist names. Scope from `isUserStats`/`isGlobalStats`. Music age card now sits alone in its own StatsReveal.
- Removed `StatsDiscoveriesCard`, `StatsDiscoveriesCardView`, now-unused helpers/imports, controller field `discoveries`, and keys `stats.discoveries.{title,since,empty}` (no other refs) in all 7 catalogs; added `stats.movement.title` in all 7 (Movement/Movimiento/Moviment/Bewegung/Mugimendua/Mouvement/Movimento). Metadata regenerated.
- Showcase `StatsOverviewReview.tsx` now uses `StatsMovementView` (movers/comebacks fixtures added, scope follows the review's scope control).

## Tests
- `StatsMovement.test.tsx`: `excludes the hero and top three artists`, `shows only rising on global`, `shows empty copy per column`, plus a link test.
- TDD: RED = suite failed (module `./StatsMovement` missing), then GREEN after implementation.
- Green: `vitest run src/components/stats src/pages/Stats.test.tsx src/i18n` (32 files / 175 tests), policy tests (token, component, radius, i18n), listen + listen-desktop typecheck, eslint on touched files, i18n check, `design-system:showcase:check`, `design-system:storybook:typecheck`.

## Decisions
- `visibleTopArtists` is not exported and is rank-based, so the trim comparison was reimplemented (same semantics: trimmed, case-sensitive).
- Rows use the previous discoveries row shape (not TopArtistCard, which is rank/photo-card specific).
- New/Back rows show `discoveryBody`/`comebackBody` (play_count), Rising shows `risingBody` with `delta_play_count`.
- The view is app-local to Listen, so no shared showcase registry entry is needed; the review host covers it.

## Concerns
- Row meta uses the long sentence copy, which may wrap on 375px; no visual browser check was done (no servers started).
- `stats.story.*` copy for "New blood"/"Comeback" are headings reused as column titles as instructed.
- Global scope: relies on the instance payload carrying `story.movers`; not verified server-side.

## Fix round 1
- Rising now keeps only `delta_play_count > 0` (null/zero/negative dropped); none left shows the column empty copy.
- Row captions are short: Rising `+` + `stats.explorer.plays`, New/Back `stats.explorer.plays` (play_count). Removed `stats.story.{rising,discovery,comeback}Body` from all 7 catalogs (no other refs) and from `plural-counts.test.ts`; metadata regenerated.
- Tests: unit tests for zero/negative/null deltas and all-non-positive empty copy; `Stats.test.tsx` page-level wiring test (personal + global): hero + top-3 excluded inside `#movement`, global renders Rising only.
- Verified: vitest stats + Stats page + i18n (179 tests), listen/desktop typecheck, eslint, i18n:check, showcase:check, storybook typecheck all green.

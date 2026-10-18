# New Releases icon retirement — checkpoint 1AJ

> Execute inline with superpowers:executing-plans and focused TDD. Diego approved/published
> 1AI and authorised one further bounded Admin group, preserving functional UX glyphs.

**Goal:** Remove redundant New Releases glyphs, preserving release data, streams, capabilities,
acquisition, dismissal and check-task contracts. **Base:** published 1AI
`a304ecf9c41bc254dab98b9f52668e18f4d87852`. **Spec:** DS §1.7 and the reviewed 1V/UX amendment.
**Production scope:** `app/ui/src/pages/NewReleases.tsx` only, including its private components.
Retire labelled view/download/idle-check glyphs, summary icons, artwork placeholders and empty
illustration. Retain six concrete UX sites: search, initial loading, check loading, downloading
indicator, timeline dismiss and grid dismiss. Existing ErrorState/AdminSelect remain bounded shared controls. Dismiss keeps X and its
callback/title/name through the shared Button icon variant (no dynamic icon wrapper). Search/type labels use `.crate-form-field`, actual8px gap;
controls retain keyboard behavior and44px targets. No new foundation, dependency or data redesign.

## Review focus

- Preserve snapshot URL, SSE URL/effect/cleanup, malformed-message behavior, latest valid surface,
  filtering/sorting, date/unknown handling, summary counts and dynamic types.
- Preserve two capability checks and separate write/acquisition eligibility, GET/POST paths,
  task id/300000ms wait and completed/failed/rejected outcomes; local status/dismiss updates and
  current timeline/grid eligibility differences. No worker/API/auth/permission change.
- Preserve canonical artist/album helpers, raw cover URLs and empty reserved artwork areas.
  No artwork recovery redesign or invented release stages/statuses. This does not implement
  ReleaseTimeline/B6/A10/phase6.5 or complete1b.8.
- Six exact retained source sites, aria-hidden glyphs and accessible dismiss/search/loading;
  real Bricolage/Poppins/Mono typography, existing shared controls and recipes.
- Actual persistent specimen with page-import-only API/task aliases and a specimen-local SSE
  double, local fixtures/assets/destinations and capability switches. No backend/external traffic.
  Tests exercise actual useApi, task handlers, capabilities and cleanup at external boundaries.
- Preserve all prior checkpoints, canonical1M captures and app/web@258bbaee pin. InitialAdminJS
  <=532480Bgzip. Scoped serial Vitest/Playwright only. Stop1AJ uncommitted for Diego.

### Task 1: Presentation, behavior contracts and review

- [x] Add response-shaped fixture and focused tests for retired glyphs/labels/targets/loading,
      filters, date/order, view/capability action branches, API/task/SSE/navigation and errors;
      observe expected RED. Expand policy to the whole NewReleases file.
- [x] Minimal rendering-only changes; preserve data/hooks/handlers and retain six marked sites.
      Scoped Vitest --maxWorkers=1 GREEN, affected Ops/policy tests included.
- [x] Add isolated actual-page preview and persistent checkpoint; scoped Chromium at1440/768/390
      --workers=1 for filters, select/portal, views, task/action/SSE/permissions, geometry/fonts.
      BuiltAdmin route tests cover canonical hrefs and actual hook/action wiring.
- [x] Scoped types/lint/format, literal-preserving AST contract comparison, Admin/preview builds
      and bundle gate. Update active plans/handover, restore generated cache, record limits.
- [x] One fresh read-only review of complete pending diff; one tested Important/Critical fix pass,
      Minor deferred. Actual IAB screenshot, serviceHTTP200; stop1AJ without commit/push/nextgroup.

No full suites/CI/canonical refresh, SmartMix, PR/merge/rebase/deploy/release or other checkout.

Verification before review:47 scoped unit cases/3files,3standalone+1persistent preview and3builtAdmin browser cases pass;2strict TS configs,scoped lint/AST andAdminbuild pass. InitialJS526574/532480Bgzip,5906Bmargin. Final closure/review follows in the handover; no publication.

1AJ pre-review closure: Admin build/types and all15 preview HTML entries pass (14 specimens plus
the retired Timeline redirect). Scoped lint exit0, both strict TS configs pass. Generated Admin
tsbuildinfo restored from published1AI. Actual IAB review inspected the ready page and portalled
type selector above release actions, closed with Escape and retained focus. Review proof:
.artifacts/review/checkpoint-1aj-new-releases.jpg (1300×1413). Preview service active/HTTP200.
Source freeze and one fresh complete pending-diff review follow;1AJ remains uncommitted.

Final actual fresh review covers20files/13source hashes:Critical0/Important0/Minor1. No repair or re-review. Deferredminor: shared AdminSelect visible Release type caption/accessiblename All types association. All review rulings and pending QA in main handover. Task1 implementation complete; Diego visual approval stillpending.1AJ remains uncommitted.

## 1AJ approval and publication — 2026-10-18

Diego approved1AJ and explicitly authorised commit/push to feat/crate_v3 plus one further
bounded Admin icon group, preserving functional UX glyphs. Previous local-only1AJ stops are
superseded. The deferred shared Select label association remains recorded; no unreviewed fix.
Next checkpoint1AK covers Global Catalog and stops before publication for Diego. No full
suites/CI/canonical refresh, PR/merge/rebase/deploy/release; prior checkpoints remain intact.

# Crate V3 — headers (1AU)

Spec: approved mockup5186 and Diego's subsequent confirmations; reconciliation R1 and the
checkpoint-groups proposal. Base:1AT published67486e4c7414d7c6bca7a6701b35c73440f0dfce.
Stop before1AU commit/push. Keep5186and6006active; no new large-mockup section.

## Contract and scope

- PageHeader owns the ordinary h1, uppercase MonoLabel text eyebrow, subtitle, optional artwork,
  metadata, back and action slots. Keep existing24/30px sizes; use Bricolage and the approved
  PlaylistEditor600weight for this ordinary page role. Rich badge eyebrows retain their own
  semantics/case. Captions/title/subtitle use component-owned grid gaps; preserve footer children.
- Extract the already approved container-aware PageHeaderLayout into the same shared module,
  consumed by PageHeader and the thin Admin compatibility adapter. Preserve upper-right actions,
  real44px action targets, wrapping,112px editor artwork and Back outside identity. No viewport
  breakpoint may force a wide row inside a narrow container.
- PlaylistEditor adopts PageHeader's title/subtitle/metadata composition and BackLink with the
  same label/destination, capability gates, dynamic names, callbacks and badges. No payload,
  API, state, generation or artwork contract changes. Other Admin headers keep their content
  through the compatibility layout; do not mass-migrate pages or OpsHero/tiles.
- SectionHeader owns Bricolage titles with the existing18/24/30size roles, Mono count including0,
  optional MonoLabel eyebrow, title/subtitle association and accessible text action. Long content
  and actions wrap without truncation/overflow; general section rules remain InstrumentPanel.
- PageHero retains media/artist/editorial/card roles, artwork/background renderers, separators,
  action placement and app-specific composition. Titles use Bricolage; a finite compact title
  option replaces AlbumHero's local size override (24mobile/36desktop). Default sizing remains
  compatible. Default hero heights become minimums to keep long titles/content readable. Explicit height=content preserves CrateHero auto sizing, including empty collections; its title adopts the compact role. Image
  identity, motion, native safe areas, existing caller overrides and playback stay separate.
- HeroActionBar retains playback primary/secondary/menu semantics,48px primary and56px secondary
  controls. Reserve long-label width and wrapping; do not truncate translated actions. Existing
  menu portal, callbacks, loading/disabled/pressed and reduced-motion contracts stay intact.
- BackLink preserves router link vs button semantics, label and destination. Both variants
  reserve44px coarse targets in actual layout, instead of a pseudo-element overlap. Preserve
  text label and14px body role; no arrow-only redesign.

## Task 1: Shared contracts and consumer adoption

Before implementation, write meaningful regressions for native attrs/naming, rich eyebrows,
0metadata/counts, footer vs identity slots, back keyboard navigation and empty action bars.
Watch failures, then implement the smallest shared change and adapters. Characterize retained
hero/menu behavior with existing tests. Add consumer regressions for Admin composition/editor
and Listen AlbumHero with real components. New shared exports must be used by both apps.

Expected: focused shared/Admin/Listen tests green, one Vitest worker. No public removal.

## Task 2: Catalogue and review composition

Complete all five pending entries: PageHeader (including Layout), SectionHeader, PageHero,
HeroActionBar and BackLink. English docs/stories cover all roles, sizes, native links/buttons,
long/unbroken text,0/absent metadata, empty/busy/disabled actions and fine/coarse layout.
One HeadersReview scene serves Storybook Reviews/1AU/Headers and review-1au-headers.html.
Use actual components; sample captions use FormField kind=group and real8px gaps. No repair CSS.

Expected: catalogue33documented/93entries/120sources; scoped types/lint/builds green.

## Task 3: Validation, review and handover

Browser checks in both hosts at390/1200fine/coarse, plus narrow container on wide viewport:
actual type/font roles, caption gaps, upper-right actions, no overlap/overflow, long hero title,
back routing/keyboard, loading/disabled/pressed/menu and callbacks. Check the real editor and
reference approved header geometry independently. Preserve canonical PNGs/manifest and pin.
Run only affected tests, Playwright workers1, relevant app/tool typechecks/builds and budgets.
One fresh final reviewer, one focused fix pass if necessary. Update current state/handover and
record limits; no full suite/CI/native/live-backend certification. Keep1AU uncommitted for Diego.

## Evidence

-1AT was committed/pushed as67486e4c7414d7c6bca7a6701b35c73440f0dfce.1AU remains an uncommitted working-tree checkpoint for Diego.
- Five family entries completed:33documented/93entries/120sources;60pending. One real HeadersReview scene serves both hosts, including content-sized empty media and long/compact variants. Historical mockup and earlier review URLs stay intact.
- Shared/native/consumer regressions were observed RED before implementation; focused final verification:74shared,51Admin,33Listen tests GREEN (158total). Includes the real AlbumHero, empty CrateHero and existing Crate-page contracts. Native router/Back attributes,0content, empty action bars and metadata/action-slot associations are covered.
- One fresh final reviewer found two Important issues: default minimum heights broke content-sized empty crates, and unconstrained desktop action groups overflowed narrow containers. Both reproduced RED, then fixed through shared height=content plus CrateHero adoption and bounded/wrapping action groups/buttons. An unbroken secondary-label regression reproduced right591px against296px bound; fixed in the same shared bounding contract. Root also reproduced missing action-fragment8px and metadata-error16px gaps and moved both into the shared slots. No remaining Critical/Important finding; no deferred Minor.
-20browser cases GREEN across both hosts,390/1200fine/coarse, narrow desktop containers, native font-variable resolution, all five families and their interactions, portal uniqueness, empty/content height, slots and long actions. Two existing real-editor workflow/geometry cases at1440/390also GREEN. No canonical PNG recording or baseline change.
- All five relevant typechecks(shared/Admin/Listen/Desktop/Storybook), scoped lint, catalogue and four builds(Admin/Listen/preview/Storybook) GREEN. Admin527180/532480Bgzip,5300Bmargin; Listen200109/307200B. No runtime dependency added.
- Existing AlbumHero fixed-height/safe-area/image transforms are intentionally preserved; long real/native album composition remains owning-phase qualification, not certified here. Broader page restyling, icons, profile/media identity, SmartMix, backend/AT/native/full-phase QA and canonical comparison stay outside this checkpoint. Earlier native browser protocol denial is respected; no manual capture workaround.
- Both systemd previews active on5186and6006. Stop1AU before commit/push.

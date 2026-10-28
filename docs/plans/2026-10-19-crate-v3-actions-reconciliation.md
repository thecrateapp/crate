# Crate V3 — actions reconciliation (1AS)

Spec: approved persistent mockup and Diego's confirmed adjustments; component-reconciliation-audit R1; admin-header-actions contract. 1AR approved and published at a3ba497d. Stop at 1AS before commit/push.

## Scope and decisions

- Button remains the text-action foundation: existing finite variants/sizes, Poppins and native form semantics. Fix disabled/loading link activation without changing enabled routing or inventing another button recipe.
- IconButton remains the compact round/glow control for playback and utility controls; document its sizes/tones/states and use actual non-overlapping 44px coarse targets. Specialized PlayButton/progress remain outside this checkpoint.
- ActionGroup composes the approved upper-right/row action pattern. ActionButton and ActionLink are named compositions of Button ghost/icon-lg plus Tooltip, not another visual foundation. Both own 44px geometry, short tooltips, contextual accessible names and disabled discovery. Admin PageHeader exports become compatibility adapters; adopt the same composition for Listen's conventional server Remove action. No app-specific foundational variants.
- ActionIconButton/ActionIconLink remain legacy compatibility controls with explicit finite row/card geometry. Preserve appearance; correct coarse targets and disabled link activation. Broader replacement is consumer-by-consumer, not a mass migration.
- AIButton remains the Admin availability adapter with Solar Bot; BackLink stays in Navigation; menu/play/follow/auth actions retain domain contracts. No new glyph inventory or broad page/header restyle.
- Surface/card variants are documented as existing behavior; their solid-surface reconciliation belongs to the next R1 group. No silent redesign here.

## Task 1: action contracts and foundations

Files: shared shadcn/button, primitives/IconButton, ActionIconButton, new ActionGroup and adjacent tests.
Write focused regressions first: disabled/loading links cannot activate via mouse/keyboard or caller handlers; preserve refs/form submit/pressed/busy/tooltip identity. Add shared named action composition and prove grouping/disabled tooltip/focus/availability changes. Match existing approved header geometry.
Verify shared affected unit tests and export/token policy with maxWorkers=1. No full suites.

## Task 2: real consumers and catalogue

Files: Admin layout/PageHeader + tests; Listen settings/ServersSection + tests; Storybook entries/stories/docs/catalogue.
Move the existing header action/tooltip composition into shared ActionGroup; preserve wrapper exports and all callbacks, capability/busy/dynamic labels. Replace Listen's local Remove geometry with the same composition and context-specific name. Update live entries for all four families before changing their hashes; no pending-hash refresh.
Verify affected Admin/Listen tests, typechecks, catalogue guard and app build budgets. Expected Admin <532480 B gzip, Listen <307200 B gzip.

## Task 3: isolated review and handover

One ActionsReview scene imported by review-1as-actions.html and Storybook Reviews/1AS/Actions. Include every scoped family, all text variants, compact controls, grouped button/link actions, keyboard tooltip, disabled/loading/pressed, long names and narrow layout. Retain old checkpoints; do not append main mockup sections or component repair CSS.
Run scoped Playwright workers=1 on both hosts with fine/coarse pointers, plus tool typecheck/lint/build. Inspect diff and one final fresh review; record deferred limits. Both previews stay active. No canonical baseline, full CI, PR, merge, rebase, deploy, release or 1AS commit.

## Evidence and limits

Automated browser tests cover isolated fixtures, not live backend, AT or native platforms. The prior URL-policy rejection is respected; no new manual capture.

## Completed evidence — local review stop

1AR is published at `a3ba497ddfdf05835441686fbd8c874c07e4cea6`. 1AS stays uncommitted for Diego.

- Foundations and compositions implemented; shared actual coarse targets replace overlapping pseudo areas. Enabled routing/form behavior stays native. Disabled/loading asChild and compatibility links block activation, including capture handlers; descriptions survive tooltip attachment.
- Admin PageHeader is a compatibility adapter, including existing asChild links. Listen Servers Remove uses the same composition and retains revoke-before-remove. Conventional action names/tooltips retain context. Solar Eye Outline added to the shared catalogue with an SVG-path mapping test.
- Four action families documented; 25 documented /93 total entries,120 source modules. Existing 1AR documentation now records Diego's approval. One ActionsReview scene serves the standalone page and Storybook. No main-mockup section or component-repair CSS.
- Focused unit validation:83 shared tests across9 files (includes export/token/catalogue/preview policy),32 Admin tests across4 affected files plus7 AIButton tests,3 Listen server tests. **125/125**; Vitest maxWorkers1.
- Browser:9 action/Storybook-doc cases plus6 actual Upcoming/PlaylistEditor header cases. **15/15**, workers1. Covers390/1200 fine/coarse and header1440/768/390,44px non-overlap, actual font/radius/glyph geometry, keyboard/focus/tooltip/disabled/busy/pressed/reduced-motion, form and link navigation, wrapping and no overflow. Earlier REDs are recorded in the ledger; initial missing Eye import and incorrect assumed6px test radius were corrected before the genuine32px-coarse RED.
- Shared and Storybook types, scoped lint23files, preview and Storybook production builds pass. Both app builds include TypeScript checks. Fresh budget evidence: Admin **527150/532480 B gzip**, margin5330; Listen **200102/307200 B**. Existing chunk-size advisories remain; budget checks pass.
- One independent final review found no blocking runtime issue and one documentary mismatch (catalogue6px vs actual4px). Corrected to the approved4px in the inventory. No re-review loop or extra runtime change.

Exact logs: `.artifacts/review/1as-{shared,admin-consumers,listen-consumers,ai-consumer,browser,header-browser,lint,shared-types,storybook-types,admin-build,admin-budget,listen-build,listen-budget,preview-build,storybook-build}.log`.

Review URLs: `http://127.0.0.1:5186/review-1as-actions.html` and `http://127.0.0.1:6006/?path=/story/reviews-1as-actions--complete`. Previous pages remain available. Both user services remain active.

Limits: isolated fixture coverage is not backend-live, assistive-technology, native, alternate-engine or full-phase QA. Existing card surfaces belong to the next R1 surface group. No new manual screenshot (prior URL-policy denial respected), canonical baselines, full suites or manual CI dispatch. No1AS commit/push, PR, merge, rebase, deploy or release.

## Approval

Diego approved1AS and authorized commit/push. This supersedes earlier local review stops; all evidence and deferred QA remain as recorded. Continue to1AT surfaces and stop for review before its commit.

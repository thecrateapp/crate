# Users list and icon retirement — checkpoint 1AM

Execute inline with superpowers:executing-plans and scoped TDD. Diego approved1AL publication
and the next bounded Admin group; his accepted Users amendment removes the map, uses a list
with principal available user data/state per row, and keeps detail in a modal.

Base: published1AL `d72232e9ef581248ae59a1289bd357dec0629db1`. Spec: DS§1.7/table recipes,
reviewed1V/UX amendment and accepted Users amendment in PD/decision/handover.
Production scope: Users.tsx rendering and removal of its map-only wiring. Existing modal,
API/auth/effects/actions remain. No backend/presence-query rewrite, role editor or new data.

## Review focus

- Replace repeated user cards/map with semantic table: identity/email/roles, account+activity
  state, presence and existing Inspect/Delete controls. At narrow widths presence moves into
  identity; no loss of account state or actions. Secondary data remains in actual detail modal.
- Diego additionally requests larger avatars and viewport-wide detail:56px row avatars on all
  widths,72px in detail; detail uses shared chrome/portal/motion with the existing size-attribute
  opt-out for custom width (no shared variant). Preserve small viewport margins and wrapping.
- Remove UserMap lazy import/mount/capability variable and map-only inspect adapter. Preserve
  actual users.view router/sidebar gate and all other capability checks. Do not remove unrelated
  map source/utilities or rewrite presence backend in this group; A18/B17/phase6.6 stay pending.
- Preserve GET list/detail, ?inspect= and other URL params, search/filter/sort/page20, detail
  AbortController cleanup, role/status/session/password/create/invite/delete handlers, payloads,
  validation, disabled/confirmation and toast behavior. No real credential/access mutations.
- Remove decorative/label-redundant glyphs throughout Users.tsx. Keep search, pagination,
  loading and shared dialog/confirmation close glyphs as individually bounded UX sites. No
  blanket module/wrapper exemption. Fonts Bricolage/Poppins/JetBrains; actual vertical pairs8px
  via .crate-form-field, including modal readouts/forms. Native action buttons>=44px; shared selectors preserve existing fine32/coarse44px recipes.
- Test real Users with external API/auth boundary fixtures: list/row/state, search/filter/page,
  modal/deep link/close/abort, read-only capability behavior and representative existing
  mutation success/pending/failure/confirmation with unchanged bodies. Fixture schemas complete.
- Add real standalone/persistent specimen with page-import-only API fixtures and actual auth
  context value, response-shaped fictional data, safe local actions and manual pending/failure
  controls. No backend/external traffic/preferences/real invite delivery or clipboard writes.
- Scoped serial Vitest --maxWorkers=1 and Chromium --workers=1 at1440/768/390, including actual
  built Admin and view-only user. Strict types/lint, AST contract audit, builds and bundle ceiling
  532480Bgzip; no new dependencies/shared/Listen changes. Keep earlier checkpoints/canonical1M/
  app/web@258bbaee. Stop1AM uncommitted for Diego before publication or another group.

### Task 1: Users rendering, contracts and review

- [x] Complete response fixtures, failing focused row/modal/permissions tests and whole-file
      policy. Expected RED: no semantic compact table/map remains/redundant icons/field semantics.
- [x] Implement list and rendering-only glyph/typography/spacing changes. Scoped existing/new
      Users and policy tests GREEN; preserve business logic except obsolete map adapter.
- [x] Real standalone/persistent preview and scoped browser checks for layout/keyboard/modal/
      action boundaries in preview and built Admin. All prior checkpoints retained.
- [x] Scoped types/lint/format, literal-preserving AST audit, Admin/preview builds/bundle and
      generated-cache restoration; plans/handover scope, evidence and limits updated.
- [x] One fresh read-only full pending-diff review, one tested Important/Critical fix pass if
      needed; actual IAB screenshot/service200. Stop uncommitted for Diego.

No full suites/CI/baseline refresh, SmartMix, PR/merge/rebase/deploy/release or other checkout.

Completion:30unit/3files,9preview/6builtAdmin, scoped types/lint/AST/builds/format pass.
InitialJS526482/532480Bgzip. Fresh review21files/14hashes found2Important/2Minor; executor
regraded pending name to Important and resolved all3 in one tested RED→GREEN pass, no re-review.
Direct label gaps8px, active nested sample completion and stable pending password name verified.
Sticky-header minor and previous1AJ Select-label association deferred; full rulings/limits in
handover. Original/final source freezes preserved. **Stop1AM uncommitted; previewactive.**

### 1AM approval and publication — 2026-10-18

Diego approved the final Users checkpoint, including enlarged avatars and the wider detail
modal, and explicitly authorized commit/push on feat/crate_v3 and the next bounded Admin
icon group. Approved source14 hashes match the post-fix freeze. Only publication labels
change before committing; existing scoped verification and deferred minors remain recorded.
Next stop is 1AN, uncommitted for review. Preview stays active5186; preserve UX glyphs and
all prior checkpoints. No PR, merge, rebase, deploy, release or broad CI.

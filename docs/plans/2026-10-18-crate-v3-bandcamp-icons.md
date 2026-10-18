# Bandcamp icon retirement — checkpoint 1AH

> Execute inline with superpowers:executing-plans and focused TDD. Diego approved/published
> 1AG and authorised the next bounded Admin icon group, preserving functional UX glyphs.

**Goal:** Retire redundant Bandcamp glyphs and use existing Admin presentation recipes while
preserving every data/action contract. **Base:** published 1AG e5b9f087935f790d4ae2d7950dd9d52c59f7e658.
**Spec:** DS §1.7, product design §4.4, approved 1V inventory and Diego's UX-glyph amendment.
**Scope:** production pages/Bandcamp.tsx only, including private MetricCard/Panel rendering;
source icon policy, focused tests, real isolated specimen and current records. Replace private
metric/header/panel styling with existing Ops surfaces and MonoLabel; counts come from the same
payload fields. No new shared component, dependency, data model, permissions or backend work.
No full Bandcamp/A10 migration: confidence meter/connection instrument/data-error redesign are
not introduced by this icon group. Preserve existing connection/error/empty semantics honestly.

## Review focus

- All eight useApi URLs, query parameters, refetches, task POSTs, match confirm/reject POSTs,
  success/error toast strings, busy locking and connection eligibility stay unchanged.
- Keep counts, candidate/confirmed filtering and existing 5/8-item limits, metadata precedence,
  import states and cover rendering. External opening retains raw URL, target and security args.
- Retain only six concrete UX glyph sites: three loading and three external-opening cues;
  mark them aria-hidden. No glyph in labelled idle sync/radar/backfill/confirm/reject or metrics.
- Typography/display/labels and 8px metric label/value gap use existing shared recipes; preserve
  actual control labels, keyboard and 44px targets without changing action/data contracts.
- Preview mounts the real page with an exact page-only API/hook alias, local response-shaped
  fictional data and deterministic completion. External sample destinations are local and clearly
  labelled. No actual API/write/external asset requests. Earlier checkpoints stay available.
- No auth/backend/native/AT/full-data certification. Preserve reference pin and canonical 1M;
  Admin initial JS must stay <=532480 B gzip. No publication or next group at 1AH.

### Task 1: Bandcamp presentation, contracts and review

- [x] Add response-shaped fixture, render/action/error/busy/external/data tests and extend source
      policy. Run scoped Vitest --maxWorkers=1; expected RED on redundant glyphs/display/targets.
- [x] Remove redundant icons/private icon props, reuse Ops surfaces, mark six retained glyphs,
      preserve all data/actions; scoped tests GREEN.
- [x] Add real persistent specimen, exact alias and local controls, plus preview and built-Admin
      browser checks at1440/768/390 with --workers=1; expected keyboard/busy/reading/overflow pass.
- [x] Scoped strict TS/lint/format, Admin and preview builds, bundle gate; restore generated cache.
      Update implementation/product/DS/decision/handover and preserve historical evidence.
- [x] One fresh read-only complete pending-diff review; one tested Important/Critical repair pass,
      Minor deferred. Actual IAB inspection/proof, preview service HTTP200, stop uncommitted1AH.

No full suites/CI/canonical refresh, new branch/worktree, SmartMix, PR/merge/rebase/deploy/release.

## Evidence before final review

RED7 expected retirement/accessibility assertions /23 green; label regression separately RED1
for an accidental MonoLabel prefix, then corrected to the actual count. Final task unit gate:
40 Vitest/3files (14 Bandcamp,16 policy,10 affected Ops surfaces). Preview3 + built-Admin3
Chromium at1440/768/390 pass serially. Mobile grid overflow reproduced and corrected by explicit
zero-minimum columns in specimen shell/page content; no hidden overflow or timeout change.

Two scoped strict TS configs, scoped ESLint, AST contract audit, Admin build/types,13-entry
preview build (12 specimens + static retired-URL redirect) and bundle pass. InitialJS
526656/532480B gzip,10assets,5824B margin. Generatedcache restored. No full suites/CI/canonicals.

Actual IAB inspected and proof saved .artifacts/review/checkpoint-1ah-bandcamp.jpg; preview active.
All logs use .artifacts/review/1ah-\*, final unit gate in this plan's SDD task-1-tests.log. Fresh
read-only review completed across all20 pending files: Critical0 / Important0 / Minor0 requiring
action. All13 source hashes match; no repair or second review. Final rulings and remaining QA
are recorded in the handover. Only1AG published; stop uncommitted1AH, no nextgroup.

## Approval — 2026-10-18

Diego approved 1AH and authorised commit/push and the next bounded Admin icon group with UX
glyphs preserved. Publication labels are updated. Historical local stops are superseded;
the next group must stop at 1AI for review before its commit/push.

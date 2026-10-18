# Global Catalog icon retirement — checkpoint 1AK

> Execute inline with superpowers:executing-plans and focused TDD. Diego approved/published1AJ
> and authorised one further bounded Admin group, preserving functional UX glyphs.

**Goal:** Retire Global Catalog's redundant action/read-model glyphs while keeping its data,
capability, local view selection and reconciliation contracts. **Base:** published1AJ
`235b892f5dadab07faf3ae7a1a1727864b7a06c9`. **Spec:** DS §1.7, reviewed1V/UX amendment.
**Production scope:** `app/ui/src/pages/GlobalCatalog.tsx` and its private rendering only.
Retain exactly two marked busy glyph sites, one per reconciliation mode. Read-model status uses
existing StatusDot with state words in content, not a title ornament. Four readouts reuse the
existing OpsStatTile recipe (.crate-form-field8px); display headings/readings and mono technical
metadata keep the shared fonts. Native view buttons retain local state, gain explicit type,
pressed state and44px targets; do not introduce URL tabs or migrate other pages.

## Review focus

- Preserve the three GETs, exact query limits25/50, response shapes, fallback/null/error semantics,
  independent refresh (status only), run/source rendering and formatter inputs/order.
- Preserve federation.policy.manage check, both POST mode bodies and one shared reconciliation
  lock through the POST, dispatch of asynchronous status/runs refetches, success/failure handling
  and unlock when queued (refetch returns void; it does not await reads or task completion).
  No task polling/SSE/backend/auth/permissions or actual merge/rebuild behavior is added.
- Preserve overview/runs/duplicates local state and selected view during requests. No invented
  lifecycle/data or duplicate-resolution workflow. Retained loading glyphs are aria-hidden;
  busy buttons expose aria-busy and accessible names. This does not complete B17/A24/phase6.7/1b.8.
- Actual page in isolated persistent preview with page-import-only API/useApi aliases, sample
  AuthContext and response-shaped data. Manual request/refetch steps and failure demonstrate
  UI only. No live network, external assets, real federation/reconciliation or preferences writes.
- Scoped TDD with actual useApi and page handlers, API boundary double; viewport1440/768/390,
  keyboard,44px,8px,fonts,read-only permissions and no overflow. Existing GlobalCatalog/Ops and
  policy tests remain affected consumers. InitialAdminJS<=532480Bgzip.
- Preserve published checkpoints, Select-label deferred minor, canonical1M and pinapp/web@258bbaee.
  Serial scoped Vitest/Playwright only. Stop1AK uncommitted for Diego before next group/publication.

### Task 1: Global Catalog rendering, contracts and review

- [x] Response-shaped fixtures and focused render/permissions/view/read/action/failure/locking
      tests plus whole-file icon policy. Observe RED for glyphs/typography/targets/busy/8px recipes.
- [x] Minimal presentation-only implementation, two exact retained glyphs, standard readouts,
      state word/dot and fonts. Preserve handlers/data; scoped Vitest --maxWorkers=1 GREEN.
- [x] Real isolated specimen plus persistent checkpoint; scoped preview and builtAdmin Chromium
      at1440/768/390 --workers=1. Verify actual hooks/actions, POST lock/asynchronous refetch/failure and keyboard,
      word states,8px/44px/fonts/no overflow/no backend traffic in the specimen.
- [x] Strict scoped types/lint/format, literal-preserving AST contract comparison, Admin/preview
      builds and bundle gate; restore generated cache. Update plans/handover/evidence/limits.
- [x] One fresh read-only review of complete pending diff; one tested Important/Critical repair
      pass if needed, Minor deferred. Actual IAB proof, serviceHTTP200, stop1AK uncommitted.

No full suites/CI/canonical refresh, SmartMix, PR/merge/rebase/deploy/release or other checkout.

Verification before review:42 scoped unit cases/4files,4preview+3builtAdmin browser,strict unit/preview TS/finalpreviewTS/scopedlint/AST/Admin+16-entrypreviewbuild pass. InitialJS526533/532480Bgzip5947Bmargin. ActualIAB proof checkpoint-1ak-global-catalog.jpg1310×1424. Main handover owns finalreview andremainingQA. No1AK publication.

Final fresh review20files/13source hashes:C0/I0/M1. No repair/re-review. Deferredminor: persistent explanatory copy still says lock until reads finish; actual POST-only lock and asynchronous reads are preserved. Mainhandover records precise correction/limits/rulings. Task1 implementationcomplete; Diego reviewpending,1AKuncommitted.

## 1AK approval, requested copy correction and publication — 2026-10-18

Diego approved1AK and explicitly requested correcting its persistent specimen text before
commit/push, then one further bounded Admin icon group. The stale lock-copy minor is resolved:
"bloqueo durante el envío y lecturas posteriores asíncronas". The production POST-only lock and
void-refetch handler remain unchanged. Earlier1AK local/Minor-deferral stops are superseded by
this instruction. Shared Select label minor from1AJ remains separate and deferred.
Next stop1AL covers Roles & Permissions; preserve UX, preview and all checkpoints. No full
suite/CI/canonical refresh, PR/merge/rebase/deploy/release or other checkout.

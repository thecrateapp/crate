# Roles & Permissions icon retirement — checkpoint 1AL

> Execute inline with superpowers:executing-plans and focused TDD. Diego approved/published1AK,
> requested its specimen-copy fix and authorised one further bounded Admin group.

**Goal:** Retire the Roles decorative header glyph and use the existing shared typography for
this read-only catalog, preserving all data and authorization boundaries. **Base:** published1AK
`44d5f16a1eb20d6b7c89e6b22aee768d86c5bac2`. **Spec:** DS§1.7, reviewed1V/UX amendment.
**Production scope:** `app/ui/src/pages/Roles.tsx` only. No functional glyph exists here to remove;
loading stays textual and gains status semantics. No new action, editor, shared contract or API.
Display font for headings/role names; MonoLabel/mono for group/slug/capability metadata, with
wrapping for narrow widths. Body font remains Poppins. Role-name/slug and group/capability
readouts reuse .crate-form-field8px; no interactive form or foundation variant is introduced.

## Review focus

- Preserve GET /api/auth/roles, response interfaces, one mount effect and state transitions,
  grouped-capability sort, per-group API order, role order, counts and null/empty behavior.
- Preserve roles.view router/sidebar gates and read-only page (no POST, permission mutation or
  custom-role editor). No auth/backend/dependency/shared/Listen change. This does not complete
  A19/phase6.6 or global1b.8. No URL/view migration.
- Whole-file source policy: no runtime glyph entry and no new exception. Loading text gets
  role=status and an accessible name; no invented spinner. Keep real backend capability strings.
- API rejection currently has no catch/error surface; leave that unchanged and document it as
  a pre-existing integration/error limit. Do not create an unhandled rejection in the specimen
  or claim successful error recovery. No async cancellation/lifecycle improvement is claimed.
- Actual isolated page and persistent checkpoint use page-import-only API alias, response-shaped
  fictional data and manual pending-read completion. No backend/external traffic, real auth or
  persisted preferences. Ready/loading/empty/null states only; no fake editing capabilities.
- Scoped Vitest --maxWorkers=1 for new/existing Roles and source policy; scoped Chromium at
  1440/768/390 --workers=1 verifies data/text/status/fonts/wrapping/read-only behavior, preserving
  existing checkpoints. Types/lint/AST/Admin+preview builds and initialJS<=532480Bgzip.
- Keep corrected1AK text, previous Select-label minor, canonical1M and app/web@258bbaee pin.
  Stop1AL uncommitted for Diego before publication or another group.

### Task 1: Roles rendering, data contract and review

- [x] Add complete fixture and focused render/loading/group/order/count/null/empty/read-only
      tests plus whole-file policy; expected RED for header glyph/typography/status semantics.
- [x] Minimal rendering-only implementation, remove decorative glyph tile, reuse typography
      and wrap metadata without changing data/effect/helpers. Scoped Vitest GREEN.
- [x] Add real standalone/persistent specimen and scoped preview/builtAdmin browser checks at
      1440/768/390 workers1, including actual read-only user where the app allows it.
- [x] Strict scoped types/lint/format, literal-preserving AST audit, Admin/preview builds and
      bundle gate; restore generated cache. Update active plans/handover/evidence/limits.
- [x] One fresh read-only complete-diff review; one tested Important/Critical fix pass if needed,
      Minor deferred. Actual IAB proof/serviceHTTP200 and stop1AL before commit/push/nextgroup.

No full suites/CI/canonical refresh, SmartMix, PR/merge/rebase/deploy/release or other checkout.

Completion evidence:23Vitest/3files,4preview+6builtAdmin Chromium, scoped strict types/lint,
AST/builds/format pass. InitialJS526505/532480Bgzip. Fresh independent review20files/13hashes:
Critical0/Important0/newMinor0. Main handover records all executor rulings/QA limits. Existing
Select-label minor stays deferred. Source frozen; previewactive; **1AL uncommitted for Diego**.

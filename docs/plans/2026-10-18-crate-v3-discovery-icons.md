# Discovery icon retirement — checkpoint 1AI

> Execute inline with superpowers:executing-plans and focused TDD. Diego approved/published
> 1AH and authorised one further bounded Admin group, preserving functional UX glyphs.

**Goal:** Remove redundant Discovery glyphs, keeping data, task lifecycle and navigation intact.
**Base:** published 1AH `58b2695b39bbd91c477a968192ff74332a220e71`. **Spec:** DS §1.7, PD §4.4 and 1V inventory/UX amendment.
**Production scope:** pages/Discover.tsx only (private opportunity/radar/presentation included).
Retire action/summary glyphs and decorative artist/album placeholders; preserve actual image
calls/handlers and reserved dimensions. Retain exactly four UX sites: search field, initial
loading, recomputation loading, release-check loading. Existing ErrorState remains bounded.
Use existing typography and controls, label search visibly with .crate-form-field 8px gap,
44px controls and aria-busy. No shared export, dependency, backend, data, permission or task-hook
rewrite. This does not complete B5/discovery redesign, A11 or phase6.5.

## Review focus

- Preserve all three GET URLs/params and refetches; both POSTs, exact task-id/timeout handling,
  full/partial/skipped/cache-failed/task-failed outcomes and independent busy states.
- Preserve filter/sort/summary semantics, existing limits, canonical artist/album/acquisition/
  full-radar destinations and asset helper inputs/image onError. No first-party data mutation.
- Retain four marked aria-hidden UX glyph sites only. Open artist/full radar are internal
  labelled navigation, so their decorative search/external glyphs retire. Image content stays.
- Visible search label/Input and metric readouts use existing 8px recipes; keyboard/touch and
  Bricolage/Poppins/Mono stay shared. No page-specific foundation or complete layout redesign.
- Preview mounts actual Discover via page-only API/useApi/useTaskPoll aliases, fake responses,
  local task completion/failure and local assets/destinations. Unit tests retain real hooks,
  stubbing only API/waitForTask boundaries. No live API/SSE/external assets or permissions claim.
- Preserve earlier checkpoints, reference pin258bbaee and 33 canonical1M captures. Admin initial
  JS <=532480B gzip. Scope validation only, serial Vitest/Playwright. Stop1AI uncommitted.

### Task 1: Discovery presentation, contracts and review

- [x] Response-shaped fixture and focused render/data/navigation/task/error/keyboard tests plus
      expanded whole-file policy; expected RED on glyphs/labels/44px/aria, existing contracts green.
- [x] Minimal presentation removal, mark four retained sites, label search with8px pair and
      preserve all data/hooks/handlers; scoped Vitest --maxWorkers=1 GREEN.
- [x] Real isolated persistent specimen and preview/built-Admin Chromium at1440/768/390,
      --workers=1; task lifecycle, search/navigation, actual fonts/gaps/targets/overflow verified.
- [x] Scoped strict TS/lint/format/AST contract audit, Admin and preview builds, bundle budget;
      restore generatedcache. Update current plans/handover and preserve published checkpoints.
- [x] One fresh complete pending-diff read-only review; one tested Important/Critical repair
      pass, Minor deferred. Actual IAB proof/serviceHTTP200; stop1AI before commit/push/nextgroup.

No full suites/CI/canonical refresh, SmartMix, PR/merge/rebase/deploy/release or other checkout.

## Evidence before final review

Observed RED10expected/22pass. Final43 scoped Vitest/4files,4preview+3builtAdmin Chromium at
1440/768/390 workers1, two strict TS configs, scoped lint/format/literal-preserving AST audit,
Admin build/types and14-entry preview build pass. JS526617/532480Bgzip10assets5863Bmargin;
generatedcache restored. No full suites/CI/canonical change. All logs .artifacts/review/1ai-\*.

ActualIAB proof .artifacts/review/checkpoint-1ai-discovery.jpg1310×1424; preview active. Earlier
checkpoints/pin1M unchanged. Fresh read-only review covered all21 pending files and verified
14 frozen source hashes: Critical0 / Important0 / Minor0. No repair or second review. Final
executor rulings and remaining QA are recorded in the handover. Only1AH published; stoplocal1AI.

## 1AI approval and publication — 2026-10-18

Diego approved Discovery checkpoint 1AI and explicitly authorised commit/push to the existing
feat/crate_v3 branch plus the next bounded Admin icon group, preserving functional UX glyphs.
The previous local-only 1AI stops are superseded by this approval. Discovery presentation,
data/task/navigation contracts and earlier checkpoints remain as reviewed. No full suites/CI,
canonical refresh, PR/merge/rebase/deploy/release. The next group stops at 1AJ before publication.

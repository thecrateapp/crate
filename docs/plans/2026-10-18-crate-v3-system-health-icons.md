# System Health icon retirement — checkpoint 1AC

> Execute inline with `superpowers:executing-plans`, TDD and one fresh read-only review of
> the final checkpoint. Diego approved/published 1AB and authorised one more bounded group.
> Stop at 1AC for visual review before commit/push. Existing V3 worktree only.

**Goal:** Remove redundant System Health glyphs while keeping its measurements, controls and
Nivo instruments. **Base:** published `2d047fecd4721ac4575faadbf9bd8781eec37c5b`.
**Spec:** DS §1.2/1.7, Task 1b.8 and the reviewed 1V operations/settings inventory, superseded by
Diego's explicit retention of functional UX glyphs. Node 22, existing shared components, no deps.

## Constraints and review focus

- Scope: `app/ui/src/pages/SystemHealth.tsx`, its tests, source policy, isolated persistent
  preview and focused actual Admin checks. No shared contract or other page workflow edits.
- Keep metrics URL/window math, refresh callback, task catalogue, score/summary/error-rate,
  playback statistics, route ordering, progress/elapsed calculations, Nivo props/data and meters.
  Existing System Health default/score interpretations are not new health guarantees or a
  redesign of Task 3.4; unknown runtime authority remains a later data/phase concern.
- Retire Gauge/Clock/header chip decoration and ResourceCard icon prop with its six local
  callers. Refresh gets visible text; the two-value window adopts shared radio chips, preserving
  minute/60 and hour/1440 queries. Keyboard arrows, selection and refresh remain accessible.
- Resource/score readings use Bricolage numerals, Mono labels and `.crate-form-field` real 8 px;
  labelled progress and vertically stacked route readings also use the shared 8 px recipe.
  Local titles use Bricolage20+, body/actions Poppins; refresh 44 px and shared radio chips 32 px fine pointer / 44 px coarse pointer. Preserve functional UX glyphs
  and all instrument vectors; no new permanent icon exemption is needed for this page.
- Long route/task/pressure strings, incomplete system payload and coarse-pointer controls need
  scoped coverage. Existing partial-data branches/measurements must survive this presentation change.
- Preview imports the actual page, redirects only its useApi/task-catalog dependencies to a
  fictional existing-shaped fixture; no API/EventSource or production operations. Keep all prior
  checkpoints and restart-on-failure preview service at 127.0.0.1:5186.
- Scoped serial Vitest--maxWorkers=1 / Playwright--workers=1 only. Admin gzip ceiling 532480 B;
  full suites/CI, canonical recording, native/AT/other-engine QA, backend and pin changes excluded.

## Task 1 — production page and contracts

- [x] Add failing tests for text-only measured readings, named radio window/keyboard and refresh,
      unchanged measurements/meter, missing system and source-policy rejection of remaining glyphs.
- [x] Observe RED; remove only the retired contract/glyphs, apply shared controls/typography/8px
      geometry. Route readouts use a compact2-column mobile grid with stacked 8 px fields.
- [x] Run SystemHealth and policy tests serially; compare calculations/request/hooks/instrument
      ASTs with the published base. Keep all existing behavior tests green.

## Task 2 — persistent real-page preview and scoped validation

- [x] Add an eighth isolated preview entry and section 30 `#sistema-admin`, fictional metrics and
      pressure sample, local refresh/window outcome, existing task-catalog semantics; observe RED
      for the absent embedding before implementation.
- [x] Test 1440/768/390, genuine fonts, 8 px field boxes, shared chip targets and 44 px refresh, radio keyboard/window and
      refresh; preserve Nivo/chart/meter vectors and exact readings, prevent horizontal overflow
      and API traffic. Check actual built Admin at the same widths using intercepted data.
- [x] Scoped types/lint, Admin build/budget and preview build. Restore only generated tsbuildinfo.
      Update authoritative handover/status/publication and review limits without altering history.

## Task 3 — review stop

- [x] One fresh-context read-only checkpoint reviewer; rule on findings and declined judgements.
      Critical/Important receive one RED→GREEN repair pass; Minor stays recorded unless required.
- [x] Save visible advisory screenshot from public preview, verify service HTTP200 and leave 1AC
      uncommitted for Diego. No further group, PR/merge/rebase/deploy/release.

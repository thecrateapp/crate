# Artist Stats and System Health Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development. Steps use checkbox syntax.

**Goal:** Apply the approved analytical-console design and genre-wheel visual language to Artist Stats and System Health.

**Architecture:** Keep the current APIs and Nivo statistical renderers. Compose a local Admin chart theme, point, legend and readout from shared tokens/primitives; each domain owns its data normalization and selection. Independent domain implementations run in parallel with disjoint file ownership.

**Tech Stack:** React 19, TypeScript, Nivo, shared Crate V3 primitives, Vitest/Testing Library, Playwright.

**Spec:** [Approved design](./2026-10-24-artist-stats-health-visual-design.md), approved by Diego on 2026-10-24.

## Global Constraints

- Work only in `/home/diego/.codex/worktrees/crate-v3-1q/crate`, branch `feat/crate_v3`.
- Preserve unrelated pending changes and the local development stack; do not touch production or Genres.
- Open plots, 1–1.25 px traces, hollow contextual nodes, accent selected nodes, mono annotations, no pie/radar/area fill.
- No new dependency, endpoint, stream or request-time aggregate. Shared primitives are reused; new chart composition stays Admin-local.
- Null remains unavailable; measured zero remains zero. Missing time buckets create gaps.
- Preserve ArtistDetailSection first-header geometry: 44 px minimum header and 12 px body gap.
- Every behavior change has focused tests. Run full validation once after this phase is stable.
- No commit/push is requested for this phase.

## Review Focus

- Same-year, undated and duplicate-name releases retain distinct selectable observations.
- Missing audio measurements do not imply silence/zero or complete analysis coverage.
- Rankings never mix listeners and popularity in one scale; format shares name their denominator.
- Sparse and same-minute metric timestamps remain distinct and do not form fabricated zero values.
- Keyboard/touch selection reveals the same precise values as pointer inspection; mobile labels do not clip.

## Task 1: Common Admin instrument recipe

**Owner:** Root.

**Files:** Create `app/ui/src/components/charts/InstrumentChart.tsx`, `InstrumentChart.test.tsx`, `instrument-chart.css`.

**Interfaces produced:**

- `useInstrumentChartTheme()` returns `{ colors, theme }`, token-resolved, using existing `useChartColors`. Colors include `accent`, `primary`, `secondary`, `subtle`, `border`, `surface`, `warning`.
- `InstrumentChartPoint({ x?, y?, size?, color, selected?, ...SVGAttributes<SVGGElement> })`: hollow 7 px node, selected 10 px filled accent/halo, 1.25 px stroke; adapters own semantics/events/hit areas.
- `InstrumentChartReadout({ label, items })`, items `{ label: string, value: ReactNode, unit?: string }[]`: compact mono definition list, stable wrapping geometry.
- `InstrumentChartLegend({ items })`, items `{ id: string, label: string, color: string, dashed?: boolean }[]`.

- [x] Write failing tests for point styling, token theme, readout semantics and legend distinction.
- [x] Implement the recipe with existing primitives and shared token colors; inspect Listen instrument usage.
- [x] Run the focused recipe test and lint.

## Task 2: Artist analytical console

**Owner:** Artist implementation agent.

**Files:** Modify `ArtistStats.tsx`, `ArtistStatsSection.tsx`, related `ArtistStats.test.tsx` and `ArtistSecondarySections.test.tsx`; create focused `artist-stats-model.ts/.test.ts` and optional domain plot components alongside them. Modify `Artist.tsx` only to pass already-loaded catalogue identity if useful.

**Consumes:** Task 1 recipe; existing stats endpoint and ArtistDetailSection. No dependency on Task 3.

- [x] Write failing model/component tests for dates, duplicates, null/zero, ranking unit isolation, format shares, selection and removal of redundant network.
- [x] Implement catalogue readout, chronological release nodes/inspector, BPM-energy observation map/inspector, separate rankings and formats band; remove the final Genre Profile per the latest refinement.
- [x] Use local payload observation identities; no unsafe album-name merge. Expose graph node selection by hover, click/touch and keyboard, initially selecting the newest valid date; preserve incomplete observations in compact secondary rails. Remove redundant album selectors per Diego’s latest refinement. Preserve unavailable observations in inspector.
- [x] Remove pie, radar and network duplicated from Similar Artists; preserve loading/error/empty states and common tab geometry.
- [x] Run focused Artist suites and format/lint owned files; report evidence and limitations. Do not run full suite or commit.

## Task 3: System Health instrument streams

**Owner:** Health implementation agent.

**Files:** Modify `SystemHealth.tsx`, `SystemHealth.test.tsx`; extract `components/system-health/MetricChart.tsx/.test.tsx` and `metric-stream-model.ts/.test.ts` to keep the page focused.

**Consumes:** Task 1 recipe; current page-owned dashboard and range. No dependency on Task 2.

- [x] Write failing tests for counter/measurement fields, numeric timestamps, sparse gap segmentation, null/zero and keyboard/touch inspection.
- [x] Extract MetricChart with open surface, fine line/active nodes, shared legend/readout, unit/granularity captions, actual timestamp scale and no area fill.
- [x] Implement the 13-series table from the approved design. Counters use count; Errors (5xx), Stream Requests, Load Ratio at Deferral carry accurate captions/provenance.
- [x] Preserve existing page structure, summary percentage, range controls, data fetching/ownership and error states.
- [x] Run focused Health suites and format/lint owned files; report evidence and limitations. Do not run full suite or commit.

## Task 4: Integration and review

**Owner:** Root plus fresh read-only reviewer.

- [x] Inspect both task diffs against the design; resolve issues before final validation.
- [x] Extend `tests/admin-e2e/artist-layout.spec.ts` or add a focused spec to verify both surfaces at desktop and narrow touch widths with representative sparse/duplicate/null fixtures.
- [x] Check actual local pages in browser; verify selection/readout, no console errors, no overflow and unchanged Artist first-section frame.
- [x] Final stable Admin suite passed: 207 suites / 2,105 tests. Typecheck/build, lint and four focused desktop/touch browser checks pass; no shared foundation changes were made.
- [x] Record evidence and remaining limitations in a resolution note, leaving the branch uncommitted for review.

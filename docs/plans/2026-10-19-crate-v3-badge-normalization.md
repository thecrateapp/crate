# Crate V3 — legible reusable badges — Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline. Stop at local 1AQ for Diego; no commit/push.

**Goal:** Normalize the approved informative 24px/12px and filter/genre 12px recipes in Admin and Listen.
**Architecture:** `InfoBadge` owns static information with semantic tone/surface variants; `FilterChip` owns toggle/action buttons. Existing `GenrePill` and `SegmentedControl` keep their domain/keyboard contracts. CrateChip/CrateBadge/CratePill and shadcn Badge are compatibility adapters using the same recipes, not parallel foundations. New apps use descriptive subpath imports.
**Tech Stack:** React19, TypeScript, Tailwind4 tokens, Vitest/Testing Library, Playwright.
**Spec:** docs/plans/2026-10-19-crate-v3-badge-legibility-audit.md (approved by Diego 2026-10-19).

## Global Constraints

- Informative: JetBrains Mono12px/16px,24px high, border1px, padding3px8px, capsule, secondary text or semantic tone.
- Filters/genres:12px,32px minimum fine pointer/44px coarse; preserve all callbacks, radio/tabs/toggle semantics, percentages and native disabled state.
- Keep generic typography tokens unchanged; queue overlay counter remains its explicit14px/8px context.
- Preserve all existing1AQ work, identity and pinned app/web@258bbaee. No backend/data/API change.
- Preview5186 remains active. Targeted serial tests only, no full suites/CI/baselines. No commit until review.

## Review Focus

- Long metadata and localized text: readable full title, wraps between capsules without horizontal page overflow.
- Static vs selected vs disabled: information never gains toggle semantics; filters remain keyboard accessible.
- Genre0/100/missing percentages and independent select/remove controls retain behavior.
- Artwork overlays and icon-only offline status retain readable surfaces and accessible labels.
- Existing dense sidebar/headers and badge children with controls must not clip or change navigation.

### Task 1: Shared recipes and descriptive components

**Files:** shared primitives/InfoBadge.tsx, FilterChip.tsx, CrateBadge.tsx, SegmentedControl.tsx; shadcn/badge.tsx; GenrePill.tsx; tokens typography/recipes; adjacent tests.
**Produces:** InfoBadge(props: span attributes + tone/active/icon/surface), FilterChip(props: native button attributes + active/tone/icon/variant toggle|action); role-specific typography tokens. Compatibility adapters preserve legacy props including Badge asChild/variants, CrateBadge size accepted but same24px geometry.
- [ ] Add tests for24px recipe markers and static semantics; run RED.
- [ ] Implement shared components/recipes/adapters, selection and genre typography; run focused shared tests GREEN.

### Task 2: Consumers and override cleanup

**Files:** actual Admin+Listen imported badge/filter consumers, Sidebar, OfflineBadge, badge/icon/token policies and affected tests.
**Consumes:** Task1 components and stable legacy adapters.
- [ ] Assert both apps use named components and no informative size/font overrides; run RED.
- [ ] Adopt descriptive InfoBadge/FilterChip imports; classify static pills, remove local geometry/type overrides, retain actual behavior. Keep32/44 hit targets; existing reviewed44 minimums remain.
- [ ] Run selected consumer/policy tests, type/lint and both app bundle builds. Expected: no failures and budgets pass.

### Task 3: Persistent review and handover

**Files:** tools/design-system-preview/badge-normalization-checkpoint.tsx/spec.ts, main.tsx; this plan, current-state, DS/PD/decision/implementation/handovers and source inventories.
- [ ] Add actual canonical specimens with long labels, tones/counters/overlays, filters/radios and0/100/missing genre percentages; browser RED→GREEN at narrow/wide/coarse.
- [ ] Check real Admin playlist/sidebar and Listen consumers; preserve prior checkpoints, refresh affected source anchors.
- [ ] Final fresh read-only review, fix material findings; update evidence and stop in1AQ before commit.

### Task 4: Additional approved Incoming rows and date language

Diego explicitly extends1AQ (2026-10-19): Incoming release row actions become icon-only; dates use month/day/weekday from his screenshot. His later clarification is binding: ShowCard stays unchanged with its expansion and information; only the Incoming release row adopts its88px avatar style, with every badge including quality below the text. Reuse Admin action composition, native links and44px controls. EventDate/EventRow stay Admin-local; NewReleases adopts the date format only, without redesigning its rows.
- [ ] RED date validation, quiet matching rows, icon actions and existing callback contracts.
- [ ] Implement EventDate/EventRow for Incoming releases and EventDate for NewReleases; preserve ShowCard unchanged, expansion/calendar/native destinations.
- [ ] Focused unit/browser checks at narrow/wide, no hover background, route/download/dismiss/keyboard and date semantics.

### Task 5: AI glyph restored

Diego confirmed the official Solar Bot at https://solar-icons.vercel.app/icons?search=robot&icon=bot. Installed Solar2.1.1 predates that recently added icon; the exact official Outline paths are incorporated in the shared catalogue without dependency changes. New icon work uses Solar; legacy Lucide sites retain bounded owning-phase migration. The Bot is visually20px with a16px layout slot (scale125), preserving button geometry. Preserve LLM availability/loading/disabled behavior and existing44px target.
- [ ] Resolve exact icon with Diego, RED glyph/availability/loading tests, implement and register the explicit glyph exception.

### Task 6: Uppercase form labels in both apps

Diego explicitly requests all input labels uppercase, including Upcoming's Artist/Genre/City. Centralize text-transform for semantic native labels and explicitly marked local field captions; preserve values, copy, fonts, association and8px geometry.
- [ ] RED actual computed case on the three reported labels and source inventory of local captions.
- [ ] Shared recipe + bounded semantic markup adoption in both apps; focused forms/accessibility tests and narrow layout checks.
- [ ] Refresh evidence/docs/budgets and final review for this additional scope; same1AQ stop, no commit/push.

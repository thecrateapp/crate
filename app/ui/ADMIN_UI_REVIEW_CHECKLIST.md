# Admin UI visual review guide

Use this guide before implementing or reviewing visible changes to an Admin page. Its purpose is
to catch visual drift early and make reviews repeatable across pages and agents. Apply the
page-specific checklist only when the relevant surface is in scope.

## Rules for agents

- **Listen is the primary visual reference.** Inspect the equivalent live component or pattern in
  Listen for typography, color, controls, surfaces, hover/focus states and interactions. The
  Admin Browse and Discovery pages remain references for Admin page-header composition. Adapt
  patterns to the Admin workflow; do not copy a Listen layout where its context does not fit.
- **Look in `@crate/ui` first.** Reuse an existing shared component or recipe when available. Add a
  new component to `@crate/ui` only when both Admin and Listen use it. Keep an Admin-only component
  in `app/ui` and compose it from shared primitives and tokens. Do not copy styles or create a
  parallel foundation component.
- **Keep icons functional and sparse.** Do not add decorative icons to headings, labels, metrics,
  statuses or content. For reviewed page content, use icons only on icon-only action buttons;
  provide the shared tooltip and descriptive accessible name. Preserve the already-approved
  shell/navigation glyphs and exceptions documented in `app/ui/AGENTS.md`.
- **Follow existing patterns before proposing new ones.** Search both apps and `@crate/ui` for
  the relevant component, including its tests and usage examples. If no suitable pattern exists,
  explain why before adding a new variant.
- **Keep scope deliberate.** Fix the requested page and its directly related components. Do not
  use a page review as permission for a blanket migration of unrelated Admin surfaces.

## Review checklist

### Structure and hierarchy

- [ ] The page header follows the shared Admin composition: title, concise subtitle, actions and
  relevant metadata/pills. No unexplained numbering, duplicate headings or orphaned actions.
- [ ] Section order reflects the user workflow; primary information and actions are easy to find.
- [ ] Labels have consistent roles and semantic tones. MonoLabels use established typography and
  the correct accent, neutral or supporting color; no one-off label styles.
- [ ] Typography follows the shared roles: Bricolage Grotesque for titles, Roboto for readable
  interface text, and JetBrains Mono for MonoLabels and compact technical information.

### Components and visual language

- [ ] Buttons, icon-only actions, selects, tabs, menus, tooltips, badges and chips use established
  shared components/recipes wherever possible.
- [ ] Informational chips use the approved `InfoBadge` or domain component; labels are not
  hand-built to resemble a shared badge.
- [ ] Hover, focus, selected, disabled and danger states match the corresponding Listen or shared
  component pattern. No ad hoc accent borders or fills.
- [ ] Surfaces use shared tokens and the current Crate visual language. No unexplained legacy
  cards, nested boxes, hard-coded backgrounds or double borders/dividers.
- [ ] Rules and separators clarify section boundaries without producing duplicate horizontal
  lines or accidental visual gaps.
- [ ] Icon-only actions have a tooltip, accessible name, keyboard focus and the shared target
  size. Text actions do not gain redundant icons.

### Layout and content

- [ ] Related controls share a row and align by edge and height; counters, titles and visual
  instruments line up as intended.
- [ ] Spacing is consistent between peer sections and leaves enough room for chips, labels and
  controls. No overlaps, clipping or unexplained empty space.
- [ ] Data is accurate, useful in this view and not repeated elsewhere without a clear reason.
- [ ] Empty, loading, error, stale and live-update states use consistent copy, typography and
  spacing, and keep their actions beside the relevant status.

### Behaviour and accessibility

- [ ] Each action's target and effect are clear. Filters, tabs and selectors behave consistently
  with their labels and preserve the selected state.
- [ ] No native browser `title` tooltip is used where the shared Tooltip component is required.
- [ ] Keyboard use, focus visibility, accessible names, contrast and reduced-motion behaviour are
  preserved.
- [ ] The page remains usable at narrow and wide viewport sizes; controls wrap without breaking
  the title or creating misaligned rows.
- [ ] Tests cover changed behaviour or component contracts, and the relevant suite/typecheck/lint
  is run according to the scoped instructions.

## Tasks page checklist

Use this subsection when changing `Tasks` or its related components.

- [ ] Worker Runtime, Operations lanes, Resource Governor, DB-heavy Gate and Task Desk have a
  clear hierarchy and consistent section spacing.
- [ ] Concurrency controls, task counts and lane contents align; lanes have enough height for
  their task chips.
- [ ] Worker actions use the approved icon-only treatment and tooltips. Restart makes its target
  clear; refresh follows the same convention as other Admin panes.
- [ ] Resource Governor and DB-heavy Gate use matching typography and empty-state sizing. Retry
  information belongs in the Governor status label, not as a detached message.
- [ ] Worker logs are accessed through the Logs pane; no unlabelled log container appears among
  the Tasks sections.
- [ ] Task Desk search, family and type filters form one aligned control row. Use selectors for
  family/type rather than wrapping filter chips beside form inputs.
- [ ] Tabs, task rows and attention/history states remain readable and do not repeat runtime
  information unnecessarily.

## Review report for agents

Return a short checklist with each item marked **Pass**, **Needs change** or **Not applicable**.
For each item needing change, identify the page/component, the Listen or `@crate/ui` reference,
the observed drift, and the smallest correction. After implementation, list the files changed and
the checks run. Record any intentional exception and its reason; do not silently invent a new
pattern.

---
title: Listen design system visual QA
summary: Repeatable visual and computed-style checks for appearance, density, logo and artist hero contracts.
section: developer
audience: [developer, reviewer]
status: canonical
order: 98
verified: 2026-10-16
sources:
  [
    app/shared/ui/lib/crate-identity.ts,
    app/shared/ui/lib/interface-preferences.ts,
    app/shared/ui/domain/ArtistHeroFrame.tsx,
    app/shared/ui/tokens,
    tests/appearance,
    tests/listen-visual,
    playwright.appearance.config.ts,
    playwright.listen-visual.config.ts,
  ]
---

# Listen design system visual QA

This gate combines computed-style contracts with deterministic screenshots of the real apps.
V3 has one identity shared by Listen and Admin. Legacy light/system/skin preferences must resolve
to the same identity while motion, effects, density and OS accessibility remain functional.

## What is covered

| Contract | Evidence |
| --- | --- |
| Fixed palette, actual surface/control AA contrast | registry tests and `contracts.spec.ts` |
| Legacy preference migration, invalid/future versions, failed writes | shared preference tests and `settings.spec.ts` |
| Independent density/motion/effects without palette changes | `settings.spec.ts`, `scopes.spec.ts` |
| One fixed solid recipe across consumers | `contracts.spec.ts`, `materials.spec.ts` |
| Logo, keyboard focus, forced colors, reduced motion | logo/focus/TopBar browser tests |
| Comfortable/compact metrics and 72→64 row estimates | `density.spec.ts` and Listen tests |
| Hero geometry, bounds and overlay content | `hero.spec.ts` and shared/Admin/Listen hero tests |
| Real routes, players, cards, Settings, legacy startup | `tests/listen-visual/listen-pages.spec.ts` |
| Real Admin pages, dialogs, toasts and overflow | `tests/admin-e2e` |
| Native fixed identity, Linux buttons, Cast v1 compatibility | platform unit tests and native device QA |

The contract harness uses actual shared tokens, identity/preferences modules, logo and hero
components with deterministic artwork. Real-page suites start the apps and replace API/media/time/
streams with fixtures. Legacy startup cases verify migration without generating variant PNGs.
Browser errors, React nesting errors and unregistered endpoints fail the real-page gate.

## Browser matrix

The contract configuration is `playwright.appearance.config.ts` with projects
named `chromium` and `webkit`. The real-page configuration is
`playwright.listen-visual.config.ts` with `desktop` and `mobile` Chromium
projects. The fixture catalogue records the review viewports:

| Viewport  | Use                                 |
| --------- | ----------------------------------- |
| 375×812   | mobile layout and touch affordances |
| 430×932   | large mobile layout                 |
| 1024×900  | tablet/compact desktop transition   |
| 1200×900  | desktop shell                       |
| 1480×900  | canonical artist hero canvas        |
| 1920×1080 | ultrawide content gutters           |

CI runs Chromium contracts and both desktop/mobile real-page projects. WebKit remains a
release/review gate for shared surfaces and hero changes. Consult the handover for actual
current results; local Chromium success does not certify WebKit or native devices. Canonical
PNG baselines are recorded in the pinned Linux Playwright image, reviewed, and imported with
the original manifest. Old variant PNGs are retired explicitly after checkpoint approval.

## Commands

From the repository root:

```bash
npm run test:appearance -- --project=chromium
npm run test:appearance -- --project=webkit
npm run test:listen-visual
npm run --workspace=@crate/ui typecheck
npm run --workspace=@crate/ui test
npm run --workspace=app/listen typecheck
npm run --workspace=app/listen i18n:check
npm run --workspace=app/listen test
npm run --workspace=app/listen build
npm run --workspace=app/ui typecheck
npm run --workspace=app/ui test
npm run --workspace=app/ui build
npx --yes react-doctor@latest --scope changed --base origin/main --project app/listen,app/ui,app/shared/ui --no-supply-chain --no-score
node --test scripts/design-system/*.test.mjs
npm run design-system:layers
npm run design-system:drift
git diff --check
```

Install the local browsers once with `npx playwright install chromium webkit`.
CI installs only Chromium with system dependencies. Reports and traces belong
to `playwright-report/appearance/`, `playwright-report/listen-visual/`,
`test-results/appearance/` and `test-results/listen-visual/`; all are ignored
and uploaded only for failed CI jobs.

## Manual review checklist

- Compare Listen and Admin together: identical tokens/primitives/interaction rules, with domain
  composition differences only. Legacy local duplicates converge through planned migrations.
- Seed legacy skins/modes/overrides and confirm the same V3 identity on first paint and reload.
- Check motion, effects and compact density independently. OS reduced motion must always win;
  hit targets, virtualized anchors, player geometry and safe areas must remain stable.
- Check AA text/accent/warning and destructive controls on actual solid/popover/modal surfaces,
  keyboard focus and forced colors.
- Review desktop/mobile hero bounds with clear and dark artwork, crop/extend compositions.
  Legitimate black in the photo is not padding drift.
- Verify native status bars, Linux button placement and older Cast peers on actual devices.

## Review policy

Do not update screenshots to hide a regression. Review the expected, actual and
diff images before accepting a baseline. Prefer a focused computed-style
assertion when the contract is a token, scope, geometry or accessibility
invariant, and add a real-route screenshot when the risk spans application
composition. A failure is triaged in this order:

1. confirm `data-crate-identity="v3"` and functional `data-crate-*` attributes;
2. inspect the computed custom property and the consuming utility;
3. check that the portal inherits the shared fixed tokens;
4. compare both apps and the reviewed baseline before changing a token or layout;
5. only then update the implementation and its test.

Settings exposes only typed motion/effects/density choices. Static favicon/PWA/launcher assets
are not recolored at runtime. Artwork-derived visualizer palettes remain content.

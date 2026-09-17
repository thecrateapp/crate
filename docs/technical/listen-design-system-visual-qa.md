---
title: Listen design system visual QA
summary: Repeatable visual and computed-style checks for appearance, density, logo and artist hero contracts.
section: developer
audience: [developer, reviewer]
status: canonical
order: 98
verified: 2026-09-08
sources:
  [
    app/shared/ui/lib/appearance-resolver.ts,
    app/shared/ui/primitives/ThemeScope.tsx,
    app/shared/ui/domain/ArtistHeroFrame.tsx,
    app/shared/ui/tokens,
    tests/appearance,
    tests/listen-visual,
    playwright.appearance.config.ts,
    playwright.listen-visual.config.ts,
  ]
---

# Listen design system visual QA

This is the release gate for the appearance engine. It combines computed-style
contracts with deterministic screenshots of the real Listen application. The
default `dark + default` appearance remains the visual baseline; `light` and
`crateRed` are explicit variants of the same layout and interaction model.

## What is covered

| Contract                                                                  | Evidence                                          |
| ------------------------------------------------------------------------- | ------------------------------------------------- |
| `dark`, `light`, `system` mode resolution                                 | resolver tests and `contracts.spec.ts`            |
| `default` and `crateRed` in both concrete modes                           | resolver tests and `contracts.spec.ts`            |
| Accent, surface tone, material, radius, typography and effects            | `settings.spec.ts` plus computed CSS              |
| Apply, Cancel and Reset without cross-scope contamination                 | `settings.spec.ts`, `scopes.spec.ts`              |
| Portal content and secondary scope isolation                              | `contracts.spec.ts`, `scopes.spec.ts`             |
| Solid/glass surface recipes                                               | `contracts.spec.ts`, `materials.spec.ts`          |
| Dynamic logo geometry, paint and reduced motion                           | `logo.spec.ts`                                    |
| Comfortable/compact content spacing and 72→64 row estimate                | `density.spec.ts` and Listen density tests        |
| Desktop/mobile hero frame, scrims, crop/extend bounds and overlay content | `hero.spec.ts` and shared/Admin/Listen hero tests |
| Real Listen shell, routes, player, cards, rows and settings               | `tests/listen-visual/listen-pages.spec.ts`        |
| Browser runtime free of React render, nesting and page errors             | automatic real-page console error gate            |

The contract harness uses the real `@crate/ui` token barrel, resolver, logo and
hero components. It has deterministic inline artwork and no product API calls.
The harness intentionally isolates shared component contracts from Admin and
Listen layout.

The real-page suite starts the actual Listen Vite application and exercises its
authentication gate, providers, router, shell and full Tailwind stylesheet.
API responses, media, time and the SSE transport are replaced with
deterministic fixtures. Authentication, appearance and restored-player state
are seeded through the same local-storage contracts consumed at bootstrap. It
takes viewport screenshots of Home with a restored player, Artist, Genre,
Radar and Settings. The content-rich Artist route covers every supported
skin/mode combination, including Crate Red light. The suite also fails on
browser console errors, uncaught page errors and unregistered JSON endpoints.

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

The deterministic contract suite contains 13 Chromium tests and 13 WebKit
tests. The real-page suite adds 20 screenshot checks across 1480×900 desktop
and 375×812 mobile viewports. Full matrices should not be replaced with skips.
CI runs Chromium contracts and both real-page projects; WebKit remains the
release/review gate for scopes, materials and hero changes.

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

For a visual change, review the default baseline first, then the smallest
directed variant that exercises the changed axis:

- Compare `dark + default` against the current production Listen shell,
  player/dock, home hero, cards, rows, settings and overlays.
- Switch to `light + default` and verify that text, borders, focus rings,
  destructive states and glass surfaces retain contrast without changing
  geometry.
- Switch to `dark/light + crateRed` and verify that accent, brand logo,
  surfaces, radius and typography change while navigation and component
  structure remain unchanged.
- Test `system` with both `prefers-color-scheme` values and test explicit
  reduced motion independently of the system preference.
- Apply compact density and confirm that rows/cards/gaps tighten but controls
  keep their 40px minimum hit target and the virtualized list anchor remains
  stable.
- Review artist hero desktop and mobile compositions with clear and dark
  artwork, explicit bounds, crop and extend. Legitimate black in the photo is
  not padding drift.

## Review policy

Do not update screenshots to hide a regression. Review the expected, actual and
diff images before accepting a baseline. Prefer a focused computed-style
assertion when the contract is a token, scope, geometry or accessibility
invariant, and add a real-route screenshot when the risk spans application
composition. A failure is triaged in this order:

1. confirm the active scope and resolved `data-crate-*` attributes;
2. inspect the computed custom property and the consuming utility;
3. check whether a portal escaped the intended `ThemeScope`;
4. compare the default variant with `main` before changing a token or layout;
5. only then update the implementation and its test.

Appearance controls are intentionally bounded. Users can select typed accent,
surface, material, radius, typography, effect and density values; they cannot
inject CSS or arbitrary hex values. Static favicon/PWA/launcher assets are not
recolored by the runtime logo recipe.

# Crate v3 visual progress preview

A local review surface for the real `@crate/ui` components and current tokens. It uses fictional
music/library data, bundled brand fonts and the existing workspace tooling. No backend or login
is needed. It is separate from the Listen and Admin production entries.

From the repository root, after `npm install`:

```bash
npm run design-system:preview
```

Open <http://127.0.0.1:5186/#primitivas>. The preview adapts to desktop and mobile. Buttons pause
motion and move the StatNumber caption. System reduced-motion preferences are respected.

```bash
npm run design-system:preview:build
```

The optional static build is written to this directory's ignored `dist/` folder.

## Keep it current

- Extend this same page at each review checkpoint, using the actual component subpath imports.
- Add each new component's source file to the Tailwind `@source` list in `style.css`.
- Show useful states and working controls, with representative fictional data.
- Keep the approved specimens alongside additions so progress remains visible.
- Do not override a specimen's typography or state styling to improve the mockup.
- Check desktop/mobile layout, interactions and browser errors; record the checkpoint and pending
  CI/device QA in the handover. This preview does not replace production visual baselines.

Current: Checkpoint 1A approved by Diego on 2026-10-15: MonoLabel, StatusDot and StatNumber.
Checkpoint 1B approved by Diego on 2026-10-15: HairlineList / HairlineRow and CratePill / CrateChip.
Jump directly to <http://127.0.0.1:5186/#filas-y-chips> for the additions. Row selection and genre
filters are interactive; the reset action clears filters without toggle semantics.

## Browser smoke checks

```bash
npm run design-system:preview:test
```

Uses the installed Playwright Chromium by default. For a local Chrome installation instead:

```bash
PLAYWRIGHT_CHANNEL=chrome npm run design-system:preview:test
```

The checks cover desktop/mobile layout, real typography, 44px touch targets, row selection,
filter semantics and held-pointer reduced-motion behavior (both system and Crate preferences).
They run without screenshots or backend access; they do not approve the Linux CI visual baselines.

## GenrePill / Checkpoint 1C

Open <http://127.0.0.1:5186/#genre-pill> to review the retained genre component with percentages.
Uses the real GenrePill/GenrePillRow: artist profile, missing/0/100%, long names, selection and
independent removal. Removing a label leaves the other percentages unchanged. The v3 visual
treatment was approved by Diego on 2026-10-15; approved 1A/1B examples stay on the page.

## Keyboard focus / Checkpoint 1D

The next local review is <http://127.0.0.1:5186/#foco>. Use Tab / Shift+Tab to traverse standard,
primary, field and row controls; selecting the example text exercises the shared selection colours.
The mockup uses the same token/component focus rules as the apps. Following Diego's feedback,
the ring now matches the existing Listen search: 2px action cyan flush to controls and CTAs,
with an inset ring on clipped rows and menus. It animates on and off over 500 ms using the same
curve as the real search: fade plus expansion/contraction, without a delay. Rapid refocus reverses
from the current state. Reduced motion (system/Crate) and forced colours keep static focus.
Existing component shadows and hover/press transitions stay intact. Browser checks cover
initial/intermediate/final frames, exit after settled focus, interruption and preference changes,
alongside keyboard/pointer behaviour, offsets, real Select options, selection and touch targets.
Local verification and the pending visual/CI/device reviews are tracked in the handover.

Diego accepted the current 1D implementation provisionally to keep moving on 2026-10-15.
Further visual polishing of the focus fade is deferred; this is not final visual approval of
parity with Listen. Keep this specimen and revisit it in a later pass.

## Admin capture preparation / Checkpoint 1E

Open <http://127.0.0.1:5186/#base-admin> for seven current Admin scenes before its card/panel
adoption. These are optional local references with Linux baselines still pending. The approved
1A–1C and provisional 1D specimens remain visible. This checkpoint does not change Admin styling.

Generate the local references from the deterministic fixtures, then copy the ignored outputs:

```bash
CRATE_VISUAL_SMOKE=1 PLAYWRIGHT_CHANNEL=chrome npm run test:admin-e2e -- --workers=1
mkdir -p tools/design-system-preview/.artifacts/admin-captures
cp test-results/admin-e2e/captures-*/admin-*.png tools/design-system-preview/.artifacts/admin-captures/
```

Each thumbnail opens its full-page image. Clones without local assets show an explicit pending
state; the preview still builds. Regenerate/copy after fixture or Admin changes, then reload.

Listen's advisory capture check is:

```bash
CRATE_VISUAL_SMOKE=1 PLAYWRIGHT_CHANNEL=chrome npm run test:listen-visual -- --workers=1
```

Smoke mode writes only to ignored test results and does not compare or approve baselines. Both
capture configurations default to comparison-only mode; recording is rejected outside the pinned
Linux amd64 CI runtime. To record canonical PNGs after publication approval, dispatch **Frontend
Tests** on the published branch with **update_visual = true**. Review the `visual-baselines-<sha>`
artifact and its commit/image/platform/architecture manifest before importing PNGs and running
comparison CI. Admin 1.0 / InstrumentPanel 1.7 wait for this review. See the handover for gate status.

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

## Linux Admin reference captures / Checkpoint 1E

Open <http://127.0.0.1:5186/#base-admin> for the seven committed Linux CI Admin references,
before card/panel adoption. The gallery uses the actual baseline PNGs, so it works on a clean
clone. Each thumbnail opens its full-page image. Approved 1A–1C and provisional 1D remain visible.

Source: workflow run `38807507930`, renderer `c7e9e961`, Playwright 1.63.0 Noble on Linux x64.
The handover records the artifact digest and image review; `tests/visual/capture-manifest.json`
retains its original provenance. These are baseline references, not approval of a future restyle.

For advisory local rendering without changing baselines:

```bash
CRATE_VISUAL_SMOKE=1 PLAYWRIGHT_CHANNEL=chrome npm run test:admin-e2e -- --workers=1
CRATE_VISUAL_SMOKE=1 PLAYWRIGHT_CHANNEL=chrome npm run test:listen-visual -- --workers=1
```

Smoke mode writes only to ignored test results and does not compare or approve baselines. Both
capture configurations default to comparison-only mode; recording is rejected outside the pinned
Linux amd64 CI runtime. After publication approval, dispatch **Frontend Tests** on the published
branch with **update_visual = true**, review its artifact and manifest, then import the PNGs and
run comparison CI. Keep each checkpoint's new changes separate from the reviewed references.

## Admin card contrast / Checkpoint 1F

Open <http://127.0.0.1:5186/#contraste-admin> for the two real Admin surfaces changed by Task 1.0:
four Audio Profile KPI boxes and the image-crop modal. Each has a local **Before / With border**
comparison. The only product change adds `border border-border-quiet` to these two callsites.
The 1E gallery remains the committed Linux reference; it passes comparison CI in run `38808354069`.

Local comparison PNGs are optional, ignored review assets under
`.artifacts/admin-contrast/{before,after}/`. A clean clone displays explicit missing-image
placeholders until they are supplied. The before images were preserved before adding the borders. Canonical 1F captures are now imported and comparison CI passes in
run `38860652793`; these optional comparison assets remain advisory local renders.
Regenerate advisory after images from the current real components with:

```bash
CRATE_VISUAL_SMOKE=1 PLAYWRIGHT_CHANNEL=chrome npm run test:admin-e2e -- --workers=1 --grep 'quiet hairline'
```

Copy the resulting `admin-audio-profile-kpis.png` and `admin-image-crop-modal.png` from the two
ignored `test-results/admin-e2e/` test directories into `.artifacts/admin-contrast/after/`.
Do not overwrite the preserved before images with renders of the changed components. The tests
open deterministic analysis data and a synthetic crop image, then cancel without submitting an
upload. They check actual rendered borders against the quiet token.

The 1F canonical Linux review and comparison CI are complete, along with the local route
walkthrough recorded in the handover. The optional local comparison images remain advisory.
InstrumentPanel 1G below is approved and published as `473604f7`; its Linux captures are reviewed.

### Audio Profile target clarified — 2026-10-16

The existing 1F KPI comparison is a temporary repair to the legacy component, not the final design.
`#audio-profile-objetivo` shows Diego's supplied site reference, copied without alteration into
`references/admin-track-readout.png`. This is a visual reference, not a generated baseline or a
working TrackReadout. The final Task 3.9b component has large figures above rules, five feature
bars and a bipolar Bliss strip, without metric cards or icons, and uses the existing V3 tokens.
The image's LUFS label does not override the app's `dB` contract before validated integrated LUFS.

Admin V3 removes almost all icons, including redundant icons beside text actions/navigation;
Task 1b.8 plans the reviewed migration and limited functional exceptions. Listen/desktop icons
remain under their existing convention. The mockup retains the 1E Linux references and 1F local
comparisons without presenting either as the final Audio Profile design.

## InstrumentPanel / Checkpoint 1G

Open <http://127.0.0.1:5186/#paneles>. The specimen imports actual InstrumentPanel, the real Listen
Settings Section/ToggleRow, StatNumber and StatusDot. It shows a figure with readings, technical
metadata and a live/pause status; a working Settings switch; and a named section without a rule.
All specimen values are fictional and local. Resources/Settings are the first real app adopters.

Panels are open, with a top rule and typography. The old Settings fill/full-border recipe was
removed after spec review and Diego's spacing feedback. The preview checks computed transparency
and absence of side/bottom borders on the actual Section, plus mobile wrapping, status changes,
headings, the switch and overflow. Readings stay outside the polite status region. Compositions
leave space between measurements, explanatory text and controls. The primitive preserves its
parent's vertical spacing; a real Admin browser regression verifies the Resources/Metric Streams
24px gap so removing the old box does not collapse neighbouring sections.
The status slot shares the header's MonoLabel metrics in a flex wrapper, so it does not raise
the title baseline. Desktop/mobile checks compare rule-to-heading offsets; both remain 22px.

At 1G the cumulative browser suite had 28 checks. Two cases attach advisory `checkpoint-1g.png` images
under the ignored `.artifacts/design-system-preview/` output (desktop and 390px); they are not
canonical baselines. 1F is published with 33 reviewed Linux PNGs and green comparison CI in run
`38860652793`. Its local before/after gallery remains explicitly local. 1G is published as `473604f7`; its 33 Linux images from run `38864631250` are reviewed (seven
expected changes, 26 byte-identical). Full comparison CI passes in run `38865107324`. Preserve all earlier specimens.


## Meter / Checkpoint 1H

Open <http://127.0.0.1:5186/#meters>. Actual Meter/InstrumentPanel specimens show offline counts,
transcoding capacity with a limit tick, a working over-limit toggle, missing data and 1–4px
tracks. All values are fictional. Browser coverage checks desktop, 390px and forced colors;
`checkpoint-1h.png` attachments remain advisory, never committed Linux baselines.

Both apps adopt the real primitive: Offline count/byte readings and Admin Transcode Slots.
Their rows retain useful track width rather than squeezing into the old metric tiles. Missing
quota or native filesystem storage retains the byte readout; an unknown runtime never invents
capacity. Missing values use a labelled group with a described reading; valid meters expose
bounded range values and retain the actual reading in text.

1G is published with reviewed Linux images and green comparison CI. 1H is published as `6a5b3366`, with 35 reviewed Linux PNGs/provenance in `ef5e7f52`;
comparison/full frontend CI passes in run `38869556811`. Preserve earlier checkpoint examples.


1H local verification passes: 31 cumulative preview checks, including desktop/mobile/forced
colors, and real app browser checks (Admin 17, Listen 40 with four existing skips). The full frontend
unit/type/lint/build gates pass; see the handover for counts and unchanged bundle ceilings.
On this host, run full workspace unit suites sequentially with `--maxWorkers=2` and browser suites
with one worker; concurrent unrestricted runs saturated the machine. The mockup remains at :5186.


## Readout / Checkpoint 1I

Open <http://127.0.0.1:5186/#readout>. The actual primitive reserves 32ch while preview/confirm/reset
buttons distinguish visible text from its committed announcement. A second specimen has no
automatic announcement. All data is fictional; previous checkpoint examples remain.

The 33 cumulative browser checks include desktop/mobile width measurements, stable live markup
before confirmation and no horizontal overflow. `checkpoint-1i.png` attachments are advisory.
Listen adopts the EQ header and Admin the synchronization line; committed external modes also
end a pending manual preview. All 3,937 frontend unit tests, types/lints/builds/gates and bundle
budgets pass; spec/quality reviews approve. Full results are in the handover.
Diego approved 1I on 2026-10-16 and authorised publication/Linux captures and ProgressHairline 1.10.
Published `a80f396b`; 36 Linux images from run `38871597394` are reviewed/imported (33 unchanged,
two EQ headers changed, one new editor scene), published in `dd71eb72`. Comparison/full frontend
CI passes in run `38872274120`; preserve this specimen.

## ProgressHairline / Checkpoint 1J

Open <http://127.0.0.1:5186/#progreso>. Actual components show 1/2px traces, confirmed progress
with advance/reset controls and an indeterminate preparation that can be completed/restarted.
The 36% block follows the pinned site's 2.4s easing while onscreen and motion is allowed; it stays
static with reduced motion or unavailable observation. All data is fictional and prior examples remain.

The two new browser checks verify physical thickness/scale, width, overflow, completion/reset and
OS/Crate/intersection motion gates at desktop and 390px. `checkpoint-1j.png` attachments are advisory.
The percentage text aligns with the full track's right edge while keeping Readout's reserve;
the tests measure the actual text boundary at 50% and 75%, including Diego's alignment correction.
Real Tasks and Upload browser checks add four captures for the next approved Linux run. Scanner
progress is unit-tested; its existing component has no production route to capture in this tree.
Uploads show confirmed file bytes only for successful chunks; direct fetch requests remain
indeterminate rather than estimating a percentage. Existing upload requests and task streams remain.

All 3,962 unit tests, 35 cumulative preview checks, Admin 20 and Listen 42 browser checks pass
(four existing Listen skips). All type/lint/build/bundle/tooling gates and spec/quality reviews pass;
full results are in the handover. Capture the pending file queue rather than the tall Upload page
to keep fixed mobile chrome outside the focused progress image.
Diego approved 1J on 2026-10-16 and authorised publication/Linux captures and shared toasts 1.11.
Published `0660fbd2`; 40 Linux images from run `38876594597` are reviewed/imported (35 unchanged,
Tasks changed, four new progress scenes), published in `3f470ec6`. Comparison/full frontend CI
passes in run `38877216337`; preserve this specimen.

## Shared toasts / Checkpoint 1K

Open <http://127.0.0.1:5186/#toasts>. Actual Sonner uses the shared app config inside a locally
positioned stage. Saved, queued and failed examples are manual, use fictional copy and perform
no API requests; retry changes local feedback. These review examples persist until cleared;
production keeps the existing four-second default and per-call overrides.
`Probar pila` adds two examples so collapsed/expanded content can be reviewed; `Limpiar avisos`
dismisses both. Keyboard focus stays visible on cards and actions.

The shared card has a quiet border, panel radius, 380px maximum width, 12/16px padding, sans 14px
message and muted mono 11.5px description. Actions are ghost chips and default icons are absent.
Both real app mounts consume it without richColors, preserving positions and Listen's theme,
native-mode synchronization and mobile offset. `notify` remains Listen's API.

DS §5.10's contextual MonoLabel type words, task links and inline-first feedback remain pending
screen migrations. This is the configuration checkpoint. Browser checks cover the showcase at
desktop/390px and real Admin-save/Listen-Upload outcomes, including late Sonner colour/focus resets
and collapsed-stack visibility. All 3,971 units, 37 cumulative preview checks, Admin 21 and Listen
42 browser checks pass (four existing Listen skips); type/lint/build/budget/tooling gates and
spec/quality reviews pass.
Advisory PNGs are not canonical baselines; three toast scenes join the next approved Linux run.
Diego approved 1K on 2026-10-16 and authorised commit/push, Linux captures and cleanup Task 1.12.
Final verification and review results live in the handover. Preserve this specimen.

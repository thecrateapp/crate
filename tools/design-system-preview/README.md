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
Advisory PNGs are not canonical baselines. Three toast scenes are reviewed/imported from Linux run
`38880022435`, source `7b46021d`: all 43 PNGs/original manifest, including 40 unchanged images.
Diego approved 1K on 2026-10-16 and authorised commit/push, Linux captures and cleanup Task 1.12.
Published `7b46021d`, Linux references `181ca4d4`; comparison/full frontend CI `38880774591` passes.
Final verification and review results live in the
handover. Preserve this specimen.

## Unused shared components / Checkpoint 1L

Open <http://127.0.0.1:5186/#limpieza>. This checkpoint records a cleanup rather than a screen
redesign. Four shared components with zero production consumers are retired: OpsPageHero, OpsPanel,
OpsStatTile and ShowCard. Their app-local counterparts and the shared show types remain active.
Current InstrumentPanel, StatNumber and HairlineList render the inventory; retired components are
not imported into the showcase. Every earlier approved specimen remains available.

Desktop/390px checks verify the four entries, named panels/headings and no overflow. They caught
an ignored panel title prop; the showcase now uses the real label/heading API. Spec/quality reviews
pass. Preview 39 / Admin 21 / Listen 42 browser checks, types/lints/builds/budgets and design gates
pass. Unit verification and its focused stale-policy rerun are recorded precisely in the handover.
The 43 reviewed Linux PNGs/manifest stay unchanged. Diego approved 1L on 2026-10-16 and authorised
commit/push, Linux captures and continuation to Task 1.13. Preserve this specimen.
Published `2c90a6f2`; Linux recording `38883592145` confirms all 43 PNGs byte-identical to 1K.
The original manifest is imported; comparison CI is pending.

## Shared identity / Checkpoint 1M (local review)

Open <http://127.0.0.1:5186/#identidad>. Listen and Admin share the same identity and primitives;
only domain components/workflows differ. The sample uses real Settings controls and the real
functional preference migration against isolated memory. “Cargar preferencias antiguas” restores
reduced motion, disabled effects and compact density without changing the palette or writing to
localStorage/API. All previous approved specimens remain. 1M is uncommitted pending Diego's review.

1L is published as `2c90a6f2`; its 43 Linux PNGs are byte-identical to 1K. The original manifest
is imported in `bf1fa793`; comparison/full CI passes in `38885478542`.

1M verification: 41 cumulative preview browser checks pass, plus final desktop/390px advisory
section captures with actual controls. `checkpoint-1m-{desktop,mobile}.png` in ignored `.artifacts/`
records the complete section. Appearance passes 41 Chromium and 41 WebKit cases; WebKit tests use
macOS keyboard navigation and actual CSS capability checks without dropping outline assertions.
Spec/quality reviews approve. Native device QA and new Linux production captures remain pending.

Diego approved 1M on 2026-10-16 and authorised publication/Linux recording and continuation
with Task 1b.1. The next overlay/menu checkpoint will extend the same preview.

### Checkpoint 1M — publication and Linux capture verification

Published and pushed as `21873d24997ca53ca3218c891a8d70fae296cc78`. Linux recording
[38888497469](https://github.com/thecrateapp/crate/actions/runs/38888497469) passes. Artifact
`12040079621` has verified SHA256 `4fdf97def687772a3830bb34671a79d944fc6530f498470b7743edef38940731`.
The original manifest identifies that production SHA, Linux x64 and the pinned Playwright
`v1.63.0-noble` image. Of 33 PNGs, 31 are byte-identical; only desktop/mobile Settings change
to the approved three functional preferences. Both changed images are reviewed and imported.
The ten obsolete skin/light captures were explicitly retired in the production commit.
Capture/provenance commit `297daaa1` is pushed. Full Frontend Tests and Linux visual comparison
pass in [38889352392](https://github.com/thecrateapp/crate/actions/runs/38889352392).
Next assigned task: 1b.1 / Checkpoint 1N, shared overlays/menus and one ConfirmDialog; preserve
its visual review/publication stop.

## Checkpoint 1N — Shared overlays, local review

Open `http://127.0.0.1:5186/#capas`. The examples use real shared AppModal, nested ConfirmDialog,
Sheet, DropdownMenu, Popover and Tooltip. Confirmations accept the exact sample word VACIAR;
all changes stay in local sample state, with no API/localStorage writes. Prior specimens stay.

The close is one shared base in all four dialog/sheet routes: 40 px control, 24 px icon,
transparent hover and common keyboard focus. It sits 16 px from top/right and never overlaps
long titles. The sample input uses FormField with an 8 px label gap. Full forms remain 1b.2.

Focused tests cover keyboard/pending/typed/stacked focus, desktop/390 px close geometry,
identical size/hover, menus, long Sheet titles and absence of horizontal overflow/external
writes. Advisory section and open modal/confirm captures use `checkpoint-1n-*.png` in ignored
`.artifacts/`; canonical Linux images remain the 33 approved 1M references. SPEC and QUALITY
reviews pass. The later 1N–1P publication cut supersedes this local-only stop; new Linux
recording remains pending.

During development run focused tests only. Full validation runs once when development/the
phase closes, per Diego's 2026-10-16 instruction.

## Checkpoint 1O — Form foundations, local review

Open <http://127.0.0.1:5186/#formularios>. The sample uses actual shared Input, Textarea,
Select, Switch, Checkbox, SearchInput, FormField, SegmentedControl and AdminSelect. Edit the
collection name and blur for validation, try the debounced search and immediate clear,
keyboard selection, mixed checkbox and disabled/read-only fields. All values stay in sample
state; no library, API or localStorage writes. The section stacks its heading on mobile.

Admin's local AdminSelect now re-exports the shared implementation, preserving its callers.
Both variants expose a stable accessible name; search supports IME composition and resets
on close. Typed confirmations use the same FormField label recipe. SPEC/QUALITY pass.

Only the two `shared forms` preview cases run for this checkpoint's browser verification;
advisory images live in ignored `.artifacts/checkpoint-1o-{desktop,mobile}.png`. The approved
Linux references stay unchanged. 1N and 1O are included in the later 1N–1P publication cut;
the current status and verification record are in the main handover.

## Checkpoint 1P — Short choices and shared field spacing

Open <http://127.0.0.1:5186/#seleccion>. Actual CrateForm, Jam playback options and Player
view mode use the shared chips, isolated Spanish translations and sample state. Try keyboard
selection, the Auto DJ permanence behavior, the Crate form lock and external submit button.
Admin's specimen exercises the same shared radio group. No API/localStorage writes occur.

All vertically stacked labels have 8 px before their control through `.crate-form-field`.
This is applied throughout both apps, including existing forms; horizontal rows retain their
layout with an 8 px vertical gap when wrapping. The preview keeps earlier specimens and
checks actual label/control geometry at 1440/390 px, not just class names. Advisory images
use ignored `checkpoint-1p-{desktop,mobile}.png`; canonical Linux references are unchanged.

Diego authorised closing 1N–1P through commit/push and transfer to a Linux Codex agent.
Continue from Task 1b.3 / checkpoint 1Q using
`docs/plans/2026-10-16-crate-v3-linux-handover.md`. Preserve future review stops and focused tests.

The combined checkpoint commit is `feat(ui): unify v3 overlays, controls and field spacing`.
Final focused verification passes: six desktop/mobile browser cases for 1M/1O/1P, Shared 22,
Listen 38 and Admin 74 cases in affected files, four typechecks, scoped lint, both app builds
and bundle gates, preview build, drift/layers and Listen i18n. Batches overlap earlier records;
these are not additive full-suite totals. No full suites or new Linux recording ran in this cut.
The main handover records remaining canonical/native QA and Admin's narrow bundle headroom.


## Text tabs / Checkpoint 1Q — local Linux review

Open <http://127.0.0.1:5186/#pestanas>. Both samples use actual shared Radix Tabs and the
separate app-local URL hooks. Try arrows/Home/End, direct and unknown links, previous/next,
and browser back/forward. Admin uses `tab`; Listen's `listenTab` is a second isolated sample
parameter. Unknown values display Resumen while the unknown URL remains visible. Each
horizontal list scrolls on mobile; disabled tabs are skipped and active panels are named.
All earlier specimens remain; these samples make no API/localStorage writes.

Run only `npm run design-system:preview:test -- tabs-checkpoint.spec.ts --workers=1` for this
block's browser checks. They cover actual typography, 2px accent underline, 44px targets,
keyboard/ARIA, URL/history, 8px label/readout geometry and responsive heading/overflow.
The attached `checkpoint-1q-{1440,390}.png` files are ignored local advisory images, never
canonical baselines. Linux 1N–1P recording/comparison, native QA and phase-close full validation
remain pending. Preserve all 33 canonical 1M PNGs and original manifest. Stop at Diego's review
before 1b.4, commit or push; final scoped results are in the main handover.


Diego approved 1Q on 2026-10-16 and authorised commit/push and continuation to 1b.4.
This supersedes the local-only stop above. Keep this specimen and the preview active;
stop for the next visual review at checkpoint 1R. Baselines/native/phase-close QA remain separate.


## Shared states / Checkpoint 1R — local review

Open <http://127.0.0.1:5186/#estados>. Real LoadingState, EmptyState, ErrorState, Card/Grid/Table
Skeletons, StatusDot and ProgressHairline show static reserved layouts, the delayed 120px route
indicator, errors and Retry/Back. Manual sample modes cover loading/building/ready/stale/error/
empty/offline. The same readings remain in loading/ready, last data survives retry/error/offline,
and disabled refresh explains why. Loading/empty have no header status. There are no API or
storage writes and every earlier checkpoint remains.

The page error marker sits beside its eyebrow/code, as Diego approved, with a clean display
title. Media examples compare placeholder geometry against actual shared EntityCard shells,
including capped artist circles and album padding. Library also reserves the mobile sort row;
Home/Radio use real rail columns and user rows reserve their avatar/text shape. Complex legacy
page layouts and remaining direct CrateLoader users retain their page-phase work.

Run `npm run design-system:preview:test -- states-checkpoint.spec.ts --workers=1` for this
checkpoint. Browser checks cover 1440/390 px, live labels, keyboard Retry, retained readings,
actual card/row geometry, 8px field gaps, indicator delay/cancellation, reduced motion, no overflow
or writes and the approved marker placement. Advisory `checkpoint-1r-{1440,390}.png` images
are ignored local review material. Preserve all canonical 33 PNGs and the original 1M manifest.
Stop at 1R for Diego's review; no commit/push or advance to 1b.5 is implied by marker approval.


Diego approved complete 1R on 2026-10-16; published as `093dcb1f`. This supersedes the
local-only stop above. The next stop is 1S, before another publication or 1b.6.

## Track rows and media / Checkpoint 1S — local review

Open <http://127.0.0.1:5186/#pistas>. Real TrackList, TrackRowContent/PlaybackControl,
MediaGrid, EntityCard, MediaCover, PlayButton and table recipes use fictional data/actions.
The active Listen play preserves its halo/layers/advancing ring. The actual PlayerSeekBar
retains its luminous trail, with a 2 px comfortable / 1 px compact stroke and 40/44 px interaction
area. Both follow the same local demonstration clock; no audio, library request or saved setting.
Try play/pause, seeking by pointer/keyboard, density, like and menus. Earlier specimens remain.

The Admin specimen demonstrates the actual shared table recipe with sample actions; it does
not mount the management controller or invent a player. Production TrackTable retains its real
permissions, mutations, download/lyrics/retry and analysis popovers. Columns drop at 1000/760 px.
Narrow row containers preserve title and controls before hiding optional metadata. Artist circles
and native artwork behavior remain. Existing numeric/analysis data and initials fill missing art.

Scoped browser checks:

```bash
npm run design-system:preview:test -- tracks-checkpoint.spec.ts states-checkpoint.spec.ts --workers=1
```

They cover 1440/390 px, narrow 300/360 px rows, coarse 1024 px menus, typography, real 8 px form gaps,
1–2 px seek/2 px ring, active bar, keyboard/scrub/advance/pause/motion/effects, sticky/numeric table,
no overflow or API/storage writes. Advisory PNGs stay ignored beneath `.artifacts/design-system-preview/`.
Preserve all 33 canonical 1M PNGs and manifest. Final checks/budgets and unresolved pin/native QA are
in the main handover. Stop at 1S for Diego; no 1S commit/push or 1b.6 is authorised yet.


1S review follow-up: the seek head and beam now share the same motion timing. Two browser
regressions sample their rendered positions throughout forward/backward seeks, pointer drag and
live demonstration ticks at 1440/390 px; both head variants remain within 0.75 px of the beam end.
Reduced motion removes movement transitions from both. Keep this correction local for 1S review.


Latest 1S review correction supersedes the equal-timing fix above: natural uninterrupted dragging
still separated the independently animated head and beam. `PlayerProgressBeam` now owns one moving
edge in both real player consumers. The point is 4 px idle / 6 px engaged, the trail envelope 8 px,
and the core stays 1–2 px. The two regressions now sample real rAF frames during continuous forward,
reverse and repeated drags, seeks and live ticks without pausing or changing animation clocks.


## Admin status colour / Checkpoint 1T — local review

Diego approved 1S on 2026-10-16; it is published as `124b36a8`. That supersedes the local-only
1S stops above. The next stop is **1T**, before commit/push or Task 1b.7.

Open <http://127.0.0.1:5186/#estado-admin>. Real Admin OpsStatTile, SeverityMeter and IssueList
show active, waiting, failure and neutral severity/risk/log readings. The shared StatusDot state
control and ConfirmDialog are interactive; the trigger is neutral and only its confirmation is
destructive. The sample action updates fictional local text. It makes no API requests and writes
no preferences. Existing specimens, including the approved Listen play/ring and seek beam, remain.

Focused browser checks use `status-colour-checkpoint.spec.ts` with `--workers=1`, at desktop and
390 px touch widths: real colour values, words and neutral segments, keyboard selection, focus
return/cancel/confirm, actual 8 px field gap, overflow and no API/storage writes. Their captures
are advisory ignored artifacts. Do not regenerate the 33 canonical 1M captures or dispatch full
CI while iterating. Canonical Linux recording/comparison, real-data Admin geometry, native/AT QA
and the unavailable `app/web@258bbaee` fidelity comparison remain pending.


## Skip navigation / Checkpoint 1U — local review

Diego approved 1T on 2026-10-17; it is published as `5308c391`. This supersedes its local-only
stop above. Task1b.7 is local at <http://127.0.0.1:5186/#saltar-contenido>; stop at **1U** before
commit/push or 1b.8. All earlier specimens remain.

The shared SkipLink appears in both isolated sample documents. Use Mostrar enlace, or enter
with Tab, then Enter to focus main and Tab to reach its first action. The outer demo button
waits for the document/link to be ready. Listen's label comes from the real catalogs; actual
Shell order and focus are covered separately by app tests. The isolated entry avoids nested
main landmarks and mounts no production API-dependent chrome.

`skip-link-checkpoint.spec.ts --workers=1` covers desktop/390 px layouts, first Tab, Enter,
subsequent Tab, pointer activation, URL query/hash preservation, forced colours/reduced motion,
44 px target, no overflow/API errors and both embedded examples. Its PNGs are advisory ignored
artifacts. The preview static build includes `index.html` and `skip-link-demo.html`. Native/AT,
cross-engine checks and canonical Linux CI capture/import/comparison remain pending; do not
regenerate 1M baselines or dispatch full CI during iteration.


## Admin icon inventory / Checkpoint 1V — local review

Diego approved 1U, published as `afed5a3c` on 2026-10-17. This supersedes its local-only stop above.
Open <http://127.0.0.1:5186/#iconos-admin>. Task 1b.8 requires this inventory review before deletion;
1V changes no production icon rendering or shared contract. The proposed first later group is
Sidebar/CommandPalette/Shell, after Diego's inventory review.

The real shared Button/StatusDot/StatNumber/Input specimens use local fictional callbacks. Search
142 source files (90 with indexed references; 72 have glyph imports), expand per-file categories
and inspect 25 compact/shared/content proposals. Static categories overlap and conditional routes
are not counts of visible icons. Zero permanent action-glyph exceptions are proposed. The full
report/generator and limitations are in `docs/plans/2026-10-17-crate-v3-admin-icon-inventory.md`.

Focused serial tooling tests cover the scanner and report freshness;
`admin-icon-checkpoint.spec.ts --workers=1` covers desktop/390 px interactions, actual 8 px field spacing, 44 px controls, keyboard,
overflow, URL preservation and no API errors. Local PNGs remain advisory. Canonical 1M captures,
CI/native/AT and pinned-site fidelity limits remain as documented. Keep all previous specimens,
the two-entry static build and :5186 active. Stop at 1V before commit/push or migration.

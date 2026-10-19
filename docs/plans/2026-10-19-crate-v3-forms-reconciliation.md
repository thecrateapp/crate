# Crate V3 — complete form family and typography roles (1AR)

> REQUIRED SUB-SKILL: superpowers:executing-plans, inline. Diego explicitly authorizes implementation of the whole form family in one checkpoint; no additional planning approval or per-component stops. No commit/push of 1AR before his review.

**Goal:** Finish the shared form components as a coherent, documented and tested family, using the approved persistent mockup as the visual reference.

**Architecture:** Existing shared components retain their APIs and native/Radix behavior. Fix confirmed gaps in the owning recipe/component, not in stories. A lightweight native Slider covers general form ranges in both apps; player/EQ transport remains specialized. Storybook is the only destination for new examples. Do not add specimens to the historical mockup.

**Spec:** Diego's instructions in this conversation; approved mockup at 5186; design-system §§1.2/5.6 and the component reconciliation audit, R1. Root/scoped AGENTS apply. The mockup plus subsequently confirmed user adjustments prevail over historical plan notes.

**Global constraints:** Preserve actual 8 px label/control gaps; input/select 40 px fine and 44 px coarse; 32/44 px chips; existing checkbox 18 px and switch 32×18 px visuals with 44 px coarse hit areas; one identity and native font exceptions. Native date/file/number semantics stay with Input. Forms use Select for categorical values, chips for filters and SegmentedControl for exclusive modes. No new dependencies, backend, bulk page migration, canonical baselines or full suites/CI. Previews 5186/6006 remain active. Source baseline is published 1AQ, da8a43586e800164e3111ba74fa4d22c087c3eb1.

## Task 1: Contracts and regressions for the entire family

**Files:** tools/crate-ui-showcase/stories/{FormField,Input,Textarea,SearchInput,Select,AdminSelect,Checkbox,Switch,RadioGroup,Slider,Readout}.stories.tsx and matching docs; existing SegmentedControl/FilterChip/Fundamentals/StatNumber entries; forms-contract.spec.ts.
**Interfaces:** Real shared imports; stable story IDs and functional categories. Actual component props/controls, disabled/invalid/readonly states, text wrap, portals and keyboard. Catalogue records coverage, adoption and review separately.

- [x] Inventory actual consumers and compare computed mockup styles before source changes.
- [x] Add unmodified real component examples and browser regressions at 390/768/1200 px, fine/coarse. Expected RED: inherited bold control/helper/readout text, FormField association lost through AdminSelect, readonly SearchInput clear, RadioGroup target/invalid style. Native slider is missing initially.
- [x] Document all listed components in English and include a complete form composition in Storybook. Input includes text/number/password/date/file; no bespoke date/file widget is invented.

## Task 2: Minimal shared corrections and general Slider

**Files:** app/shared/ui/{primitives/FormField,SearchInput,RadioGroup,Readout,SegmentedControl,StatNumber,Slider}.tsx; composites/AdminSelect.tsx; tokens/recipes.css; focused neighboring tests.
**Interfaces:** FormFieldControlProps gains optional aria-labelledby and forwards associations; kind="group" uses a group caption, layout="inline" owns option placement. AdminSelect accepts native trigger id/ARIA props without changing option/value semantics. Slider accepts native input props except type and forwards refs/change/commit events. Recipes own their roles and geometry.

- [x] Write failing behavior tests first for each confirmed contract gap; run relevant Vitest files with maxWorkers=1 and observe the expected failure.
- [x] Fix label/description propagation and readonly behavior; preserve external IDs/descriptions, refs, controlled/uncontrolled values and callbacks.
- [x] Guarantee Mono 400 labels/helpers/readouts and Poppins 400 control/value roles under surrounding typography. Preserve sizes from the mockup, including 11/15.4 px labels, 11.5/16.1 px helpers, 15/21 px controls, 12/16 px chips. StatNumber keeps its existing numeral tiers; labels must not inherit bold.
- [x] Add native Slider using a 2 px rail / 8 px thumb, 40/44 px target and common focus/disabled/invalid recipes; browser-native keyboard and native form values. No player beam or playback behavior change.
- [x] Make RadioGroup match existing checkbox/switch state/focus/hit-target language; preserve native Radix semantics. Run scoped tests and browser contract matrix GREEN.

## Task 3: Affected consumer adoption and verification

**Files:** app/ui/src/pages/{Settings,Playlists}.tsx; app/listen/src/components/settings/SettingsPrimitives.tsx; their focused tests.
**Interfaces:** Both apps adopt Slider for an existing general settings range. Admin's simple playlist identity fields adopt FormField; remaining page-specific grouped builders stay for their later migration.

- [x] Prove callback/value/disabled/ARIA contracts in the actual affected consumers; preserve request payloads and persistence timing. Native slider commit handlers remain unchanged.
- [x] Run shared family tests, affected consumer tests, showcase guard/types/browser tests serially. Check shared/consumer types and builds, app budgets and scoped lint. No complete suite reruns.
- [x] Compare the historical form mockup with isolated Storybook calculated styles. Add no mockup samples or compensation CSS.

## Task 4: Review and 1AR handover

**Files:** catalogue.json, README/maintenance guidance if needed; docs/plans current-state, masters and handovers; this plan and its execution ledger.
**Interfaces:** 1AQ remains published; 1AR local for review, both services active. New or changed entries record pending visual review for 1AR; previous approvals remain explicit.

- [x] One fresh read-only final review of this delta. Fix Important/Critical with RED→GREEN in one pass; record minors and scope limits. No repeated reviewer loops.
- [x] Update plan/handover, capture Storybook proof and leave relevant tab open. Confirm preview services/HTTP and unchanged published HEAD. Stop before commit/push.

## Review focus

FormField nested native/Radix controls, required/invalid/external descriptions and hint changes; search IME/debounce/readonly clear; Select portals inside narrow/scrolling containers, unknown/empty values and keyboard return focus; RadioGroup roving keyboard and coarse target; segmented tabs versus radio modes; generic slider native range constraints, change and mouse/touch commit events. Existing native form exceptions and player/EQ specialized controls remain intact. Page header restyling and global page adoption remain separate families; no claim that this closes all typography debt in the application.

User amendments: all twelve form components are one review block; new examples only in Storybook. Existing mockup fixture controls were subsequently authorized for normalization after Diego identified raw native checkboxes. Eighteen checkboxes plus one text input now use shared components; no new sample or section was introduced. A TypeScript AST guard rejects new raw input/select/textarea nodes in these runtime scenes; 14 browser scene tests preserve existing state callbacks.

## Review disposition and known limits

One fresh independent review found no Critical or Important issue. One Minor remains explicitly tracked: a checked RadioGroupItem with item-level aria-invalid uses the accent border instead of warning because of selector ordering. Group-level invalid styling is correct. Owner: shared Forms maintainer; closure requires a checked+invalid browser regression and recipe priority fix. This uncommon combined item state is not certified by 1AR.

The reviewer also caught stale Textarea documentation (actual minimum7rem/112px) and README counts; both descriptions are corrected without changing geometry. Page-wide adoption/header typography, specialized playback/EQ controls, backend-live behavior, AT/native platforms and canonical/global phase QA remain separate work. A documented family is not a claim that every application consumer is migrated.

The ledger records all rulings: one batch of12forms; Storybook-only new specimens; mockup-based font/geometry; inline binary captions; group caption ARIA; native general Slider; scoped validation; deferred header/global adoption; normalization of existing fixture controls and AST guard; tighter Listen raw-input budget; realistic Radix keyboard dispatch; one final review and recorded Minor; retain local evidence and stop before commit. See `.superpowers/sdd/2026-10-19-crate-v3-forms-reconciliation/progress.md`.

## Final checkpoint evidence — 2026-10-19

- Shared:140/140 tests in21files; Listen:22/22 in7files; Admin:45/45 in5files. Admin Playlists2/2 rerun after removing an unsupported Testing Library getByRole option caught by TypeScript. No runtime workaround.
- Storybook:36/36 initial scoped catalogue cases, then22/22 form cases including four supplemental contracts;40distinct catalogue cases covered. Existing mockup scenes14/14 plus affected editor2/2 and controls4/4;60distinct browser cases across the two previews. All Vitest maxWorkers1 / Playwright workers1.
- Typechecks: shared, Listen, Admin, Desktop and Storybook pass. Shared, Listen, Admin and Storybook production builds pass. Scoped lint52changed TypeScript files passes. Catalogue guard:21documented/92entries/119sources.
- Initial JavaScript gzip: Admin526410/532480 B (6070 B margin, +27 B from1AQ); Listen199942/307200 B. Build output retains the existing chunk-size advisory; the actual initial-JS budgets pass. No Storybook runtime import or dependency was added to either app.
- Both user services active and HTTP200: preview5186, Storybook6006. Storybook composition proof `.artifacts/review/checkpoint-1ar-forms.png`; complete composition at `http://127.0.0.1:6006/?path=/story/patterns-forms--complete`. Exact logs `.artifacts/review/1ar-*.log`; generated Admin tsbuildinfo restored to its baseline after validation.
- Published1AQ remains `da8a43586e800164e3111ba74fa4d22c087c3eb1`.1AR is local, unstaged, uncommitted and unpushed for Diego. No baseline regeneration, full suites/CI, PR, merge, rebase, deploy or release.

## Diego label feedback — supersedes the initial inline typography ruling

Diego identified that the checkbox caption was not the same label as the rest of the fields. The initial1AR Poppins14/20 inline-caption exception was an implementation mistake, not an approved new role. FormField now renders the same MonoLabel for stacked and inline layouts: Mono400 uppercase11/15.4, caps tracking and subtle color. Only placement differs. Checkbox, Switch and RadioGroup option captions follow this contract. Diego explicitly confirmed: MonoLabel is always uppercase. Field values, hints and ordinary body text retain their own roles and case.

The existing1O sample still had3hand-composed binary captions; its two checkboxes now compose FormField, while the switch uses the same MonoLabel and preserves its original right-hand control placement. No new specimens. A computed-style regression compares the complete typography/color of inline choices with an ordinary field caption at390/768/1200px fine/coarse. Initial failure reproduced Poppins14/20/primary versus Mono11/15.4/subtle; the owning FormField correction removes the typography branch. No story CSS fix or new visual variant. The earlier Poppins inline-caption ruling is superseded, not a second supported standard.

Label-correction verification: 29 shared family tests + 9 MonoLabel tests, 4 Listen settings tests and 2 Admin playlist tests pass. Storybook forms 22/22 and preview scenes 15/15 pass; the original sample was rechecked after preserving switch placement. Shared/Storybook types, Listen/Admin/Storybook builds, scoped lint and catalogue guard pass. Current budgets supersede the earlier checkpoint figures: Admin 526402 / 532480 B gzip (6078 B margin), Listen 199955 / 307200 B. Proof: `.artifacts/review/checkpoint-1ar-mono-captions.png`. Both previews active, 1AR still local before Diego's approval.

### Uppercase ownership

Diego asked whether case is forced by the component. MonoLabel already applied CSS uppercase, but caller `className` could replace that utility through cn/tailwind-merge. Six failing regressions (normal-case/lowercase/capitalize in both sizes) reproduced this gap. The component now resolves its uppercase utility after caller classes. It preserves the original child/metadata text rather than mutating strings. Storybook includes an explicit Uppercase Contract specimen and updated entry; no mockup specimen is added.

Validation: MonoLabel/FormField27/27 unit tests,7/7 focused browser cases (including the six typography viewport/pointer combinations), Storybook typecheck, scoped lint and catalogue guard pass. One initial browser run had a failed Vite dynamic import for Forms.stories.tsx at1200coarse; the page error, not a component assertion mismatch, explained the missing textbox. The same seven cases passed on stable source without retries/skipped assertions. Both previews remain available,1AR local without commit/push. No imports, dependencies or typography dimensions changed in this ownership fix; the prior app bundle measurements remain the latest build evidence.

## Isolated reviews — Diego's workflow amendment

From this step onward, generate a small standalone mockup for each review step, containing only its current scope. Do not grow the large historical mockup. This supersedes the earlier Storybook-only rule for new review specimens; mandatory Storybook component entry maintenance still applies. Share one scene between the standalone page and a Storybook review story to avoid separate implementations. No Storybook runtime in app or standalone code, no backend, no local widget copies or repair CSS. Preserve older checkpoints and canonical evidence.

Current step: `http://127.0.0.1:5186/review-1ar-labels.html`; same scene at Storybook `Reviews/1AR/Field labels`. It shows Input, Checkbox, Switch and RadioGroup with real FormField/MonoLabel, including the exact “First Song · FLAC” caption and a mixed-case editable value. Bootstrap/CSS stay separate from the large mockup stylesheet.

Root cause of the remaining lowercase checkbox: the historical badge fixture marked caption text as `form-field-value`, whose legitimate value recipe preserves case. The previous test asserted this nested value exception; checking only the outer caption was insufficient. The new regression first failed on the visible text's text-transform:none. The fixture now supplies the literal label without the value marker, and the actual caption is uppercase while Input retains “First Song”. Real value slots in RangeRow and Album remain unchanged.

Evidence: original caption regression1/1GREEN after expectedRED; isolated page/Storybook at390coarse and1200fine4/4GREEN, including caption font/case, mixed-case editing, label activation, keyboard checkbox, radio selection, no overflow, no iframe and no API calls. Preview AST policy now covers review scenes too;1/1GREEN. Storybook types and scoped lint GREEN. Preview and Storybook production builds GREEN; new standalone page registered as a build entry. No app runtime imports/dependencies changed. Screenshot `.artifacts/review/checkpoint-1ar-isolated-labels.png`. Both previews stay active;1AR remains before commit/push.

## Full 1AR scope in the isolated review

Diego's preview feedback clarified a scope omission: the new isolated page covered only the last label adjustment, while1AR is the full family of12forms plus the agreed typography roles. The scene is now `reviews/FormsReview.tsx` with all12shared form families, invalid/disabled/readonly/indeterminate states and Readout/StatNumber. No new app components, consumer migration or historical main section. Each future isolated review must be checked against its complete approved checkpoint inventory.

Canonical page: `http://127.0.0.1:5186/review-1ar-forms.html`. The prior labels URL remains a working alias. Both pages and the Storybook review import the same scene. Title becomes `Reviews/1AR/Forms`; stable `meta.id=reviews-1ar-field-labels` is retained for existing links. Both HTML pages are build entries.

RED: the new coverage test could not find Crossfade Slider on the previous view. GREEN:5/5focused browser cases cover the old alias and both hosts at390coarse/1200fine, checking every family, native slider keyboard/value updates, debounced search/clear, both select menus and their callbacks, radio/segmented/filter state, disabled/readonly/invalid/mixed states, real8px gaps,40/44px target geometry, no overflow, iframe or API calls. Preview AST policy1/1, Storybook typecheck, scoped lint and preview/Storybook builds pass. App production imports/budgets were not changed by this preview-only amendment.

Manual screenshot limitation: after automated validation, the computer-use tool rejected acquiring the existing review tab under its URL protocol policy. No alternate browser/surface or screenshot workaround is attempted. No new visual capture is claimed. The earlier label-only capture remains historical, not evidence of the expanded page.1AR remains local for Diego; previews active, no commit/push.

## Approval

Diego approved 1AR and authorized commit/push on 2026-10-19. This supersedes the earlier local review stops; evidence and deferred QA remain as recorded. Proceed to actions at 1AS and stop before its commit.

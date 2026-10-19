# Crate V3 — Linux continuation

> Estado vigente: [tabla única de continuación](2026-10-19-crate-v3-current-state.md).
> Los registros cronológicos conservan sus estados históricos; las aprobaciones posteriores los sustituyen.

Prepared 2026-10-16 for a Codex agent starting without a local V3 checkout or branch.
This document travels with the checkpoint that closes 1N, 1O and 1P. Read the latest
publication/verification record in `2026-10-15-crate-v3-handover.md` before making changes.

## Active Linux workspace — 1AO published; 1AP System Playlists local

Use /home/diego/.codex/worktrees/crate-v3-1q/crate, feat/crate_v3 tracking origin.
PublishedHEAD/origin `ba63836d2a23bb774832c1703eab4e4116e1468f` (1AO), original53177736ancestor retained.
Leave /home/diego/Code/Ninja/crate(feat/crate_mcp) alone. Node22.23.3/dependencies prepared.

Diego approved1AO; metadata400 and title-right List/Calendar icon-only controls are published.
Local1AP retires System Playlists icons and the Admin artwork fallback glyph. Shared/default
and Listen artwork retain their behavior. Diego additionally requests uniform playlist row
chips, no pointer-hover background illumination on content rows across both apps and shared
bases, and standard Operator selects in both Admin smart-create/editor. Preserve state,
keyboard focus, playback essence and all requests/data/gates. Actual specimen:
http://127.0.0.1:5186/admin-playlists-demo.html or /#playlists-admin. Full fictional response
boundaries and manual local actions; no backend/library writes or preferences. Preview stays
active via crate-v3-preview.service. Main handover owns final scoped evidence, reviewer rulings,
bundle and limits. All previous checkpoints, canonical1M33PNG/manifest and pin258bbaee stay.
Users stickyheader/sharedSelect-label minors remain;1AO metadata Minor is resolved. Fullphase,
Linux canonical/native/live QA and global1b.8/A20/phase6.8 remain pending. **Stop1AP uncommitted
for Diego before nextgroup/publication.** Historical bootstrap below does not replace thisworktree.

## Prepare the checkout

Repository: `git@github.com:thecrateapp/crate.git` (HTTPS equivalent:
`https://github.com/thecrateapp/crate.git`). Working branch: **`feat/crate_v3`**.
Use a dedicated local clone on the Linux machine; the Mac path is not available there.

If `$HOME/Code/crate-v3` does not exist:

```bash
mkdir -p "$HOME/Code"
git clone --branch feat/crate_v3 git@github.com:thecrateapp/crate.git "$HOME/Code/crate-v3"
cd "$HOME/Code/crate-v3"
git fetch origin --prune
git status --short
git branch --show-current
git log -5 --oneline
```

The clone is the dedicated V3 working directory; no additional Git worktree is needed.
Do not create another feature branch or start from `main`. If that directory already
exists, inspect it first instead of replacing it. If reusing a different existing Crate
clone and V3 has no local branch/worktree, fetch `origin`, then use:

```bash
git worktree add --track -b feat/crate_v3 "$HOME/Code/crate-v3" origin/feat/crate_v3
```

Run that command from the existing repository, only after confirming the destination and
local branch are absent. Never reset, force checkout, overwrite files or delete an existing
worktree to make setup succeed. If authentication fails, report that exact blocker; do not
create an empty substitute repository. Verify that HEAD contains the checkpoint SHA supplied
with the transfer prompt (`git merge-base --is-ancestor <checkpoint-sha> HEAD` must succeed),
then use the current fast-forwarded branch tip. The checkpoint commit subject is
`feat(ui): unify v3 overlays, controls and field spacing`. Do not rebase.

## Dependencies and preview

Use Node **22**, as in `.github/workflows/test-frontend.yml`, with npm. Install from the root
workspace lockfile:

```bash
node --version
npm ci
npm run design-system:preview
```

The persistent preview listens on `http://127.0.0.1:5186`. Keep the process alive while Diego
reviews. On a remote host, make this loopback port available through the existing development
port-forwarding mechanism. Do not copy Mac `node_modules`, ignored artifacts or runtime paths.
Shared UI exports point at source; a separate shared `dist` build is not required for Vite.
The component preview and next foundational task do not need production credentials or a
running backend. Use mocked providers and fixtures for focused tests.

Install the matching Playwright Chromium on Linux when browser tests need it:

```bash
npx playwright install --with-deps chromium
```

Omit `PLAYWRIGHT_CHANNEL=chrome` unless Chrome is actually installed. That variable was a Mac
runner choice, not a repository requirement. Default Playwright Chromium is suitable for local
advisory checks. Canonical PNGs still come from the approved Linux CI job, not local screenshots.

## Read before editing

1. Root `AGENTS.md`, then `app/shared/AGENTS.md`, `app/listen/AGENTS.md`, `app/ui/AGENTS.md`.
2. `docs/plans/2026-10-15-crate-v3-handover.md` — latest state, authorisation and QA gaps.
3. `docs/plans/2026-10-14-crate-v3-implementation-plan.md` — Task 1b.4 / 1R at review stop.
4. `docs/plans/2026-10-15-crate-v3-decision-register.md`.
5. `docs/plans/2026-10-14-crate-v3-design-system.md` and product design from the same date.
6. Historical evidence under `docs/plans/crate-v3-analysis/` only when needed.

The visual site reference is **`app/web` at `258bbaee` on `feat/website`**. Use `git show`
against that pinned commit; neither current website HEAD nor discarded `vnext` replaces it.
If the object is missing, fetch the website branch without switching this checkout. Smart Mix
integration/rebase remains governed by the plan; do not merge it merely to begin the next task.

## Checkpoints already implemented

- **1N / Task 1b.1:** shared solid overlays/menus and one ConfirmDialog. Every built-in close
  reuses OverlayCloseButton: 40 px target, 24 px icon, transparent hover, inset 16 px from the
  top/right, reserved title space. Preserve async/typed/stacked focus and worker callbacks.
- **1O / Task 1b.2 foundations:** nine shared controls, AdminSelect consolidation, common form
  labels/errors/focus, 40/44 px fields and existing 6 px radius. Keep the iOS 16 px exception,
  code-field monospace, searchable Select IME behavior, refs, debounce and immediate clear.
- **1P / Task 1b.2 callers:** 28 short choices become shared radio chips (22 Admin, six effective
  Listen controls). Keep 17 genuinely dynamic selectors and two fixed 15-option field lists.
  `short-select-policy.test.ts` scans both apps with exact dynamic exceptions. Existing panel
  tabs in Library/ExtendedPlayer remain for the next task; Player view mode is a radio group.
  Rule rows keep identity while operators change, preserving keyboard focus and value resets.
  Radio search waits 300 ms, clears immediately below two characters, cancels timers and
  ignores obsolete responses after edits, seed selection or unmount. It does not abort an
  already dispatched network request.

The current cut also fixes label spacing globally: every stacked label is **8 px** above
its component through `.crate-form-field`, including existing auth, profile, metadata,
search, read-only, slider and chip controls. Seven local FormField gap overrides retire.
Keep horizontal rows; their vertical gap is 8 px when they wrap. Section headings and
result-list rhythm are separate. Do not reintroduce margins or `space-y-*` for these pairs.

Typography stays shared: Bricolage Grotesque for display, Poppins for body/controls and
JetBrains Mono for labels/chips/technical metadata, with the existing native body-font fallback.

One Crate V3 identity is shared by Listen and Admin. Crate Red and selectable themes are gone;
only domain components/workflows differ. Admin's broad icon retirement and functional site
instruments remain later tasks; do not silently mark those migrations complete.

The live page retains all specimens: `#capas` (1N), `#formularios` (1O), `#seleccion` (1P),
`#identidad` and earlier sections. 1P uses real CrateForm, Jam playback options and Player mode
with isolated Spanish translations and local state. It makes no API/localStorage writes.
Extend this same page for future review; do not replace earlier specimens with another app.

## Historical transfer assignment — completed by published 1Q

The original transfer assigned **Task 1b.3 / checkpoint 1Q** below. It is now approved and
published. The active stop is **Task 1b.4 / 1R**, described at the top and in the final main
handover record; do not repeat 1Q or advance to 1b.5. Original scope:

- Shared text tabs in `app/shared/ui/shadcn/tabs.tsx`, with the specified 2 px accent underline.
- Separate URL-param helpers in `app/ui/src/hooks/use-tab-param.ts` and
  `app/listen/src/hooks/use-tab-param.ts`; the apps retain their router conventions.
- Tests for tab ARIA/keyboard and URL round-trips, unknown values, preservation of unrelated
  parameters and navigation behavior. Review real callers before changing public contracts.
- Show the actual components/helpers in the persistent preview, with local sample navigation.
  Do not migrate every page ahead of its assigned phase or turn filter radios back into tabs.
- Update plan, decision register and handover; preserve a review checkpoint before moving to
  Task 1b.4 or publishing further implementation without Diego's direction.

Keep the application shells separate. Do not deploy, merge/rebase, open a PR, tag a release or
publish unrelated changes as part of this transfer. Conventional commits have no attribution
footer and a first line shorter than 72 characters.

## Verification and outstanding QA

Diego's rule: **only tests scoped to changed behavior and affected callers during development**.
Full validation runs once at development/phase close, not after each shared edit. Keep test,
browser and build chains serial while the preview is live; use Vitest `--maxWorkers=1` and
Playwright `--workers=1`. Do not increase timeouts or weaken assertions to hide contention.
Run the focused tests for new work, then relevant types/lint and build checks. Preserve
unrelated failures as explicit evidence rather than silently skipping them.

Published canonical references are still the **33 Linux PNGs and original 1M manifest** from
production commit `21873d24997ca53ca3218c891a8d70fae296cc78`; comparison CI `38889352392` passed
for that historical checkpoint. Those references are not proof of current 1N–1P visual parity.
New canonical Linux recording/comparison and native QA remain pending. The recording entry is
`test-frontend.yml`, dispatch input `update_visual=true`, job `update-listen-visual`, pinned
image `mcr.microsoft.com/playwright:v1.63.0-noble`. Keep the original artifact/manifest and review
changed images before importing them. Do not fabricate provenance or regenerate these PNGs
locally just because this development machine is Linux. Do not trigger a full workflow during
ongoing iteration merely to obtain a green badge.

Both app builds/bundle gates pass. Admin initial JS is 526,386 B gzip against 532,480 B
(only 6,094 B headroom); Listen is 200,232 B against 307,200 B. Avoid adding shared imports
without checking the appropriate app budget.

The latest local focused results, fixes and final publication pointer are in the main handover.
Ignored `/tmp` patches, preview advisory PNGs and Mac process IDs are not transferred and must
not be prerequisites for continuing.

## 1R review readiness

The final main handover records 309 focused Vitest cases, three Chromium cases, four app/package
typechecks, scoped lint, builds and budgets. Admin is now **529,065 / 532,480 B gzip**, leaving
**3,415 B**; Listen is **199,908 / 307,200 B**. The page error marker sits beside its eyebrow,
with Diego's placement approval; the whole checkpoint remains at review stop. The preview was
restarted with forced dependency optimisation after a stale HMR module left the IAB tab blank;
rendering and the final browser replay are verified. Use Node 22 and keep :5186 running.

## Latest approval — 2026-10-18

Diego approved 1AG removal and authorised commit/push, correction of the obsolete StatStrip
reference and the next bounded Admin icon group. The reference is corrected. Earlier 1AG
local-stop notes are historical; stop the next group at 1AH before its commit/push. Keep the
same worktree and active preview; preserve UX glyphs and all published checkpoints.

## Historical 1AH — Bandcamp icon group (superseded)

1AG commit e5b9f087935f790d4ae2d7950dd9d52c59f7e658 is published; stale StatStrip reference
corrected. Continue only local 1AH: Bandcamp redundant icons/private metric/header/panel recipes,
retaining six loading/external UX sites, all eight reads and unchanged action/data contracts.
Scope policy16 files/52 exact retained sites. Real isolated sample:
http://127.0.0.1:5186/admin-bandcamp-demo.html or /#bandcamp-admin. Main handover owns final
evidence/review/limits. Keep Node22, existing worktree and preview service active. Stop before
1AH commit/push or next group; no full suites/CI/canonical refresh or release operations.

1AH current checks:40 scoped Vitest,3preview+3built-Admin Chromium at1440/768/390, two strict
configs, scoped lint/AST audit and Admin/13-entry preview builds pass. InitialJS526656/532480B
gzip,5824B margin. Advisory actualIAB proof `.artifacts/review/checkpoint-1ah-bandcamp.jpg`.
Native/live integration/phase QA remain pending; main handover owns finalreview/stop.

1AH final fresh review: all20 pending files/13source hashes checked, Critical0/Important0/Minor0
requiring action. No repair/re-review. Actual persistent mockup inspected with1AF/1AG/1AH status;
preview active/HTTP200, withdrawn1AG archive23hashes intact, HEAD/origin still published1AG.
Only closure records/proof changed afterward. **Stop1AH uncommitted for Diego.**

## Latest approval — 1AH

Diego approved Bandcamp 1AH and authorised commit/push followed by the next bounded Admin
icon group. Earlier 1AH local stops are superseded. Keep preview and existing isolated
worktree; preserve UX glyphs, stop at 1AI before another commit/push.

## 1AI approval and publication — 2026-10-18

Diego approved Discovery checkpoint 1AI and explicitly authorised commit/push to the existing
feat/crate_v3 branch plus the next bounded Admin icon group, preserving functional UX glyphs.
The previous local-only 1AI stops are superseded by this approval. Discovery presentation,
data/task/navigation contracts and earlier checkpoints remain as reviewed. No full suites/CI,
canonical refresh, PR/merge/rebase/deploy/release. The next group stops at 1AJ before publication.

Final1AJ actual fresh review:20files/13source hashes verified; Critical0/Important0/Minor1.
Minor deferred: shared Select visible "Release type" caption/accessiblename "All types" association.
Main handover records every executor ruling/limit. No repair/re-review; stoplocal1AJ with previewactive.

## 1AJ approval and publication — 2026-10-18

Diego approved1AJ and explicitly authorised commit/push to feat/crate_v3 plus one further
bounded Admin icon group, preserving functional UX glyphs. Previous local-only1AJ stops are
superseded. The deferred shared Select label association remains recorded; no unreviewed fix.
Next checkpoint1AK covers Global Catalog and stops before publication for Diego. No full
suites/CI/canonical refresh, PR/merge/rebase/deploy/release; prior checkpoints remain intact.

Final1AK fresh review20files/13source hashes matched:Critical0/Important0/Minor1.
Deferredminor: persistent checkpoint copy says lock lasts until reads finish; actual buttons
unlock after enqueue. Correct contract/tests/limits and all executor rulings are in mainhandover.
No repair/re-review; sources frozen, stoplocal1AK with previewactive.

## 1AK approval, requested copy correction and publication — 2026-10-18

Diego approved1AK and explicitly requested correcting its persistent specimen text before
commit/push, then one further bounded Admin icon group. The stale lock-copy minor is resolved:
"bloqueo durante el envío y lecturas posteriores asíncronas". The production POST-only lock and
void-refetch handler remain unchanged. Earlier1AK local/Minor-deferral stops are superseded by
this instruction. Shared Select label minor from1AJ remains separate and deferred.
Next stop1AL covers Roles & Permissions; preserve UX, preview and all checkpoints. No full
suite/CI/canonical refresh, PR/merge/rebase/deploy/release or other checkout.

## 1AL approval and publication authorization — 2026-10-18

Diego approved1AL and explicitly authorized commit/push on feat/crate_v3 followed by one further
bounded Admin icon group, preserving functional UX glyphs and the persistent preview. Previous
local1AL stops are historical and superseded by this approval. Approved production source and
all13pre-publication source hashes were verified; only specimen/footer publication labels and
the affected persistent check change for publication. No full suites/CI/canonical refresh,
PR/merge/rebase/deploy/release. Next stop is1AM, uncommitted for Diego before publication.

### 1AM review steering — larger avatars and wider detail

Diego requests larger user avatars and more viewport width for the detail modal. Row avatars
are56px, also visible on narrow layouts; detail avatars72px. The old sm:max-w-6xl utility was
constrained by the shared default md size (560px). Users detail explicitly opts out of that
size attribute and uses its existing viewport width minus32px, with shared chrome, animation,
focus trap, close behavior and scroll intact. No new shared variant or other modal change.
A browser regression assertion observed560px before the fix; final geometry must exceed90%
of the viewport at1440/768/390. No canonical images are regenerated.

1AM final review: one fresh reviewer, one tested fix pass; actual label gaps8px, nested pending
sample and accessible password action fixed.30unit/9preview/6builtAdmin plus types/lint/AST/
builds green. Sticky-header minor and earlier shared Select-label minor remain deferred.
Main handover has full rulings/costs, evidence and limits. Stop1AM uncommitted for Diego.

### 1AM approval and publication — 2026-10-18

Diego approved the final Users checkpoint, including enlarged avatars and the wider detail
modal, and explicitly authorized commit/push on feat/crate_v3 and the next bounded Admin
icon group. Approved source14 hashes match the post-fix freeze. Only publication labels
change before committing; existing scoped verification and deferred minors remain recorded.
Next stop is 1AN, uncommitted for review. Preview stays active5186; preserve UX glyphs and
all prior checkpoints. No PR, merge, rebase, deploy, release or broad CI.

### 1AM published; 1AN Translations local — 2026-10-18

Diego approved1AM, including larger avatars and the viewport-wide User Detail modal.
Published1AM is `b0f20194fb364e24cd3edb18e9b1c6084cb34f96`, origin/feat/crate_v3 matches.
Publication-only label regression passed1case; approved14source hashes matched before publish.
Previous local1AM stop is superseded by that explicit approval. Deferred Users sticky-header
and shared Select-label minors remain; no hidden fixes were included in publication.

Next bounded group1AN is actual Admin Translations (I18nReview.tsx), admin.access gated through
App and Sidebar. CommandPalette maintains a separate list without a Translations entry;
leave that inherited navigation scope unchanged. Profile
redirects to Users and was not restyled. Remove redundant Languages/Clock/RefreshCw/CheckCircle2/
XCircle glyphs in headings, states and labelled actions. Preserve8concrete Loader2 UX sites;
whole-file policy now22files/84UX sites. Inventory /icon/i matches the boolean aiConfigured:
a single exact page/component/prop/initializer exception is bounded and negative-tested.
No shared foundation variant, dependency, Listen/backend/auth/capability/API change.

Bricolage headings, Poppins body and JetBrains metadata; actual8px native-filter, editor-field
and metadata readouts through crate-form-field. Editor rows stack on narrow screens, action
buttons wrap and remain44px minimum. Original tab state/native-select and all request/effect/
filter/sort/count/payload/validation/disable/feedback contracts remain; phase6.8 page-tab/URL
adoption is separate. Correct inherited Import/Export prose to describe the existing Editor
export and unavailable import, without adding tooling.

Review http://127.0.0.1:5186/admin-translations-demo.html or persistent /#traducciones-admin.
Real page, importer-only API fixture, full fictional response data; manual loading, failures,
AI-draft/save/publish/reject/export and dev-workspace JSON simulation. Only the specimen's exact
Listen dev-catalog fetch URLs are intercepted locally; no real dev catalog, backend, auth,
external traffic, preferences or translation files. BuiltAdmin checks use actual route and
boundary fixtures; no real publishing occurs. Existing1AM and all previous checkpoints remain.

Evidence before final review:28scoped Vitest/3files (new3, existing8, policy17);5preview and
3builtAdmin Chromium cases at1440/768/390, workers1. Strict scoped unit/preview TS, Admin build/
types, scopedESLint, AST70data/type/function declarations and33event/state/validation bindings
unchanged,19-entry preview build and diffcheck pass. InitialJS526475/532480Bgzip,9assets,
6005Bmargin (7B below1AM526482). Tracked buildcache restored. Logs .artifacts/review/1an-\*.
Browser RED detected inherited4px Meta margin (12px actual), corrected to8px. Browser export
assertion caught a specimen-only regex capture error (undefined key), fixed to preserve actual
edited key. No production handler was altered to satisfy fixtures. Existing chunk/NO_COLOR
warnings only. One fresh complete-pending-diff review and actual IAB proof follow.

Keep preview serviceactive5186. Canonical33PNG/manifest remain1M and app/web@258bbaee pinned.
No broad suites/CI/baselines/native/live server certification. A21/phase6.8 and global1b.8 remain
pending. **Stop1AN uncommitted for Diego before next group, commit/push, PR/merge/rebase/deploy/
release.** Historical local stops above are superseded only by their recorded user approvals.

### 1AN final independent review, tested boundary fix and review stop

One fresh gpt-6-astra high read-only review checked all20pending files, including9untracked,
and all13source hashes; each matched. Report .artifacts/review/1an-final-review.md:
Critical0/Important1/Minor1. Executor keeps Important severity: an environment override could
bypass the specimen interceptor and reach a real Listen dev catalog. One tested fix pass,
no re-review: derive exact simulated catalog endpoints from the same effective
VITE_LISTEN_DEV_ORIGIN/default and trailing-slash normalization as the actual unchanged page.
New boundary tests observe RED2fail/1pass (alternate localhost and path-prefixed origin escaped
to the mocked original503), then GREEN3/3 proving both GET and PATCH stay simulated and other
resources retain original fetch. No real server/file was contacted or changed by those tests.

Final evidence:31scoped Vitest/4files,5finalpreview Chromium cases, strict scoped TS and scoped
ESLint pass.19-entry preview rebuild passes. Earlier3builtAdmin Chromium and Admin build/types/
AST70declarations/33bindings/bundle526475/532480Bgzip remain applicable: production source did
not change in the fix pass.6005Bmargin,9initialassets. Only specimen interceptor changed plus
one boundary regression file; final pending21files/14source hashes saved separately from the
original reviewed13hash freeze. All checks serial; final logs 1an-review-{origin-red,unit,types,
lint,preview,preview-build,format}.log. ActualIAB editor proof checkpoint-1an-translations.jpg.
Preview serviceactive5186. No further implementation or publication after this closure.

New Minor deferred: French fictional summary/detail reports2messages but contains1editor row.
This is a specimen discrepancy, not a production-data change. Earlier Users sticky-header and
shared Select-label minors also remain deferred. Full phase/native/live QA and global1b.8/A21/
phase6.8 are not completed. **Stop1AN uncommitted for Diego on published1AM b0f20194.**

### 1AN approval, French count correction and publication — 2026-10-18

Diego approved1AN and explicitly requested correction of the French fixture counter before
commit/push and the next bounded Admin group. Approved14hashes matched before changes.
French summary and detail now report1message, matching their actual single editor row;
fixture coherence regression observed RED1fail/3pass before correction. No production-data
or action change. Publication labels updated; next stop1AO uncommitted, UX/preview retained.
This resolves the French specimen Minor; earlier Users stickyheader/Selectlabel minors remain.
No PR/merge/rebase/deploy/release, broadCI or canonical refresh.

### 1AN published; 1AO Upcoming and show cards local — 2026-10-18

Diego approved1AN and requested the French counter fix. Published1AN is
`2df63f31177da67b48eec11c5da575b76d17d394`, origin matches. French fictional summary/detail
now report1message and match the single editor row: focused fixture test RED1fail/3pass→GREEN4/4,
plus2targeted preview checks (French row and published persistent label) pass. That Minor is
resolved. Previous local1AN stop is superseded by Diego's explicit approval; earlier Users
sticky-header/sharedSelect-label minors remain.

Local1AO covers actual Upcoming.tsx and Admin ShowCard.tsx only. Remove redundant title/metric/
location/labelled-action glyphs; Download and Clear caches are text. Keep8Upcoming UX sites:
search,4busy/loading sites, dismissX and calendar previous/next. ShowCard retains external-ticket
link and closeX sites; its labelled/location glyphs retire.24whole-file policy/94UX sites. Two
AdminSelect and two ShowCard mounts remain bounded. Existing Leaflet default marker config
stays: its2icon-property scanner matches are accepted only as exact original static literals at
L.Icon.Default.mergeOptions, with negative tests. No general icon-slot whitelist.

Bricolage titles/Poppins body/JetBrains metadata, actual8px labelled fields through crate-form-field.
Release actions wrap; controls44px; seven-day calendar geometry is bounded by local horizontal
scroll on narrow views. All input types/normalization/helpers/state/effects/filters/grouping/
counts/status/API/mutations/toasts/timer/refetch gates stay. AST74declarations/21event bindings
for Upcoming and36/3 for ShowCard match published1AN. Internal ActionButton's icon-only parameter
and calls retire; exported ShowCard props/compact/static/controlled variants remain. No shared,
Listen/backend/auth/dependency/map/library-writing change, or A9/phase6.5 feature completion.

Review http://127.0.0.1:5186/admin-upcoming-demo.html or persistent /#proximamente-admin. Real
components/router/AuthContext value, full fictional response data and importer-only API/image
helpers. Manual loading/failure/download/dismiss/sync/clear samples. The actual sync handler's
10second wait after response remains and is tested. Internal destinations retain real paths
and land in local sample placeholders; tickets are localized, images dataURI only. No backend,
external request, real worker/library operation or preference persistence.

Before final review:30scoped Vitest/4files (9new UI/3existingfilter/18policy),5preview+6builtAdmin
Chromium at1440/768/390 workers1. Actual admin and acquire-only route/context/gates/payloads,
calendar/detail popovers, expansion keyboard, closed/expanded/static/compact cards, filters,
empty/loading/failure/sync timer and font/8px/overflow checks. Strict scoped unit/preview TS,
Admin build/types, scoped ESLint,20entry preview build and AST/diffchecks pass. InitialJS526437/
532480Bgzip,9assets,6043Bmargin,38B below1AN526475. Logs .artifacts/review/1ao-\*; actualIAB proof
checkpoint-1ao-upcoming.jpg. Generated buildcache restored. Existing chunk/NO_COLOR warnings only.

Test adaptations were boundary corrections, not production logic repairs: shared searchable
Select keeps its placeholder accessible name after selection; JSON fixture string type narrowed
at the test; acquire-only auth must omit admin.access because the actual context derives isAdmin
from it. Demo Admin includes admin.access consistently. Real gates stay unchanged. Fixture lineup
artists include the known primary id to avoid duplicate primary as support, using existing data.
One fresh full pending review follows. Stop1AO uncommitted for Diego; previewactive5186. Keep all
previous checkpoints, canonical33PNG/manifest at1M and sitepin258bbaee. No fullsuite/CI/baseline
refresh/native or live certification. Global1b.8/A9/phase6.5 stay incomplete. No nextgroup,
commit/push/PR/merge/rebase/deploy/release before review.

### 1AO final independent review and stop

One fresh gpt-6-astra high reviewer checked all22pending paths,10untracked files and15source
hashes against published1AN2df63f31; all matched. Full report .artifacts/review/1ao-final-review.md.
Critical0/Important0/Minor1. Executor agrees with Minor severity: inconsistent metadata family/
weight affects visual consistency, without a functional regression. No source repair pass or
re-review is needed. Final source15freeze remains unchanged, pending22filemanifest matches,
indexempty and HEAD=origin1AN.30unit/4files,5preview+6builtAdmin Chromium, scopedtypes/lint,
AST74/21+36/3, Admin/20entrypreviewbuilds and526437/532480Bgzip6043Bmargin remain applicable.
Actual IAB list and expanded card inspected; proofs checkpoint-1ao-upcoming.jpg and
checkpoint-1ao-show-card.jpg. Preview serviceactive5186/HTTP200; generatedcache restored.

New Minor deferred: finish metadata typography in ShowCard/Upcoming. New font-mono+font-black/
font-bold dates should use DS400; adjacent time, release-popover date and downloading status
still use body font. A later focused typography pass needs family/weight geometry assertions.
Earlier Users sticky-header/sharedSelect-label minors stay. French fixture Minor was resolved
before1ANpublication and is not pending. No fullsuite/CI/canonical/native/live certification or
phase/global completion claim. All previous checkpoints and pin258bbaee/canonical1M preserved.
**Stop1AO uncommitted for Diego before next group, commit/push, PR/merge/rebase/deploy/release.**

### 1AO approval amendments and publication — 2026-10-18

Diego approved1AO, requested the metadata correction and explicitly authorized commit/push and
next Admin group. Approved15source hashes matched before changes. Date/month/day/weekday/time
and downloading metadata now use JetBrains Mono400; remove introduced bold/black/medium mono
weights and complete the adjacent popover/status families. Browser RED observed500 instead400,
then computed family/weight checks cover list, collapsed/expanded show and release popovers.
The metadata Minor is resolved; Users stickyheader/sharedSelectlabel remain deferred.

Diego additionally requested List/Calendar as icon-only buttons to the right of the card title.
Use existing shared Button44px, lucide List/CalendarDays, accessible names List/Calendar, titles
and aria-pressed. Preserve setView callbacks/state; buttons align beside Upcoming at1440/768/390
and native Enter/Space switches views. This explicit functional UX amendment adds2bounded
reviewed sites, now10Upcoming/2ShowCard and96totalUX across24checked files. It does not restore
redundant content/action glyphs elsewhere. Source types/effects/requests/gates stay unchanged.

The first targeted view test was outside its describe fixture setup and failed before its
assertion; move it into the actual setup. Reproduce text-control failure with only those local
button children temporarily changed, restore exact source in finally, then GREEN. No gitreset
or user changes overwritten. Targeted computed typography/placement/keyboard tests pass.
Publication labels updated; retain previewactive5186 and stop next1AP uncommitted for review.
No PR/merge/rebase/deploy/release, broadCI or canonical refresh.

Publication validation:28affected unit cases/3files,9preview+6builtAdmin Chromium, scoped types/lint and unchanged AST contracts pass. Actual bundle in1ao-publication-bundle.log; generatedcache restored, source15publicationfreeze retained.

### 1AO published; 1AP System Playlists and row amendments local — 2026-10-19

Diego approved1AO; published `ba63836d2a23bb774832c1703eab4e4116e1468f` includes metadata
JetBrains Mono400 and title-right List/Calendar icon-only44px UX controls. The metadata Minor
is resolved. Earlier Users stickyheader/sharedSelect-label issues remain deferred.

Local1AP retires redundant System Playlists title/empty/labelled-action glyphs, preserving6UX
sites (search,3loaders,2closeX), actual data/requests/rules/actions/navigation and route capability
`curation.playlists.write`.26whole-file icon policy/102UX sites,4bounded AdminSelect calls.
Shared PlaylistArtwork adds optional showFallbackIcon defaulttrue; Admin pinsfalse after spread
and omits it from its public type. Gradients/covers/collages/Crate mark/URL helpers/renderImage
stay. Existing Listen/default consumers retain the glyph. PlaylistEditor receives only this
artwork behavior, the explicit operator amendment and quiet-row styles; its icon group is next.

Diego additionally requests uniform playlist row chips, no row hover background illumination,
and Operator chips replaced with standard selects. Remove local11px chip overrides. Quiet
content-list/table row surfaces apply to both apps/shared foundations, with45inventoried roots
across33TSX files, the offline-row helper and4CSS recipes. Active/selected/offline surfaces,
focus, playback halo/ring/trail and internal button/menu/grid-card interactions remain. Operator
selects in create and editor retain the exact ops arrays and reset callbacks, with no clear
option. This explicit2field amendment overrides the short-selector-chip policy there. Every
label/component remains8px via crate-form-field; three-font identity retained.

Review actual page at <http://127.0.0.1:5186/admin-playlists-demo.html> or persistent /#playlists-admin.
Response-shaped fictional data, manual read/mutation/failure states, local route placeholders,
shared row specimens and copied existing brand bytes. No backend/external media/library writes
or persistence. Latest handover and `.superpowers/sdd/2026-10-18-crate-v3-playlists-icons/progress.md`
record final scoped evidence, review and executor rulings. **Stop1AP uncommitted for Diego.**
A20/phase6.8/global1b.8 incomplete. Keep canonical1M33PNG/manifest/pin258bbaee; no fullsuite,
CI/baseline refresh/native/live certification, PR/merge/rebase/deploy/release or nextgroup.

### 1AP pre-review validation — 2026-10-19

Scoped Admin87cases/13files, shared45/6, Listen65/5 and Desktop-alias40/3 pass, all maxWorkers1.
The final small-heading correction has10affected Admin cases/3files plus9preview/6builtAdmin
Chromium checks at1440/768/390, workers1. Bricolage stays on20px+ titles; compact headings
and row names use Poppins, metadata JetBrains Mono400. A primary-family browser RED catches
the compact-display mismatch before correction; checking a fallback family substring was too
loose. Shared/base row hover stays visually quiet; selected/active/playback state remains.

Strict scoped Admin/shared/Listen/preview/Desktop types and50changed TS/TSX ESLint pass.
Playlists73declarations/63bindings and Editor115/66 remain, with onValueChange→onChange widget
callback equivalence explicitly audited. Thirty additional TSX files differ only in reviewed
row hover/background classes; exact shared artwork opt-out and underlying image helpers remain.
Admin/21entrypreview builds pass. Initial JS526371/532480Bgzip,9assets,6109Bmargin. Generated
buildcache restored. Logs `.artifacts/review/1ap-*`, full ledger under the1APplan workspace.
One fresh read-only pending-package review follows; source remains uncommitted on published1AO.
Diego additionally requests an audit of any plan deviation, not just visual examples. Its
read-only findings will separate approved amendments, inherited/unmigrated scope, involuntary
drift and outstanding QA. No further implementation or publication is authorized by that audit.


### 1AP final local stop and broad plan audit — 2026-10-19

One fresh read-only review verified all 65 pre-repair pending paths, 58 source/asset hashes and
full diff against published 1AO. Critical 0 / Important 0 / Minor 4. One focused repair pass
closed all four directly requested gaps: preserve two menu-action hover surfaces, quiet three
omitted content rows, support actions on newly created preview playlists, and complete the
filter-options fixture with all seven actual response fields. No second review was opened.
Final row scope is **45 roots / 33 TSX files**, plus the offline helper and four CSS recipes;
32 additional TSX files are audited as style-only. Active/selected/focus/playback state remains.

Post-repair checks pass: 13 affected Admin cases / four files, four shared row-policy cases,
actual Pydantic response validation, five strict scoped type configurations, changed-source
lint and AST contracts, nine preview + six built-Admin Chromium checks at 1440/768/390, workers 1.
Admin and 21-entry preview builds pass. **526379 / 532480 B gzip**, nine assets, **6101 B margin**.
Generated build cache restored; initial reviewed and final post-repair freezes remain separate.
Actual IAB proof: `.artifacts/review/checkpoint-1ap-operator.jpg`. Preview stays active at :5186.

Diego requested an audit of **any** plan deviation after this group. The
[read-only audit](2026-10-19-crate-v3-plan-audit.md) records confirmed contrast, typography,
chip geometry, copy, documentation and enforcement gaps; approved product amendments,
unmigrated scope and QA debt are classified separately. Forty browser observations at 1440/390
show 303 visible field pairs at 8 px, all three fonts available and no horizontal overflow.
This is sampled evidence, not a whole-product accessibility or native certification.
The audit does not silently repair earlier published checkpoints or start the next group.

**1AO remains published as ba63836d2a23bb774832c1703eab4e4116e1468f. Stop at local 1AP, without
commit/push, for Diego's review.** Canonical 1M images/manifest and pin 258bbaee remain intact.
A20, phase 6.8, global 1b.8, full-phase CI and native/live QA remain pending.


### Executor rulings for behaviors the independent review did not certify

| Behavior | Ruling | Concrete cost / limit |
| --- | --- | --- |
| Remaining PlaylistEditor icons and typography | Next bounded group; 1AP reviews only its changed operator/artwork/row contracts. | Editor remains partially migrated; no claim of page completion. |
| Existing Playlists read-error presentation and concurrent mutations | Preserve existing handlers/state/requests; affected tests and AST show no introduced contract change. Future page-state adoption remains separate. | A read error can resemble empty data after its toast; no new concurrency guarantees. |
| Earlier Users sticky header and shared Select visible-label association | Carry both known Minors without unrelated source changes. | Sticky overlap and complete combobox label/AT qualification remain unresolved. Native-input names sampled by the audit do not close the Select issue. |
| Live image auth, retries and native transport | Existing helpers and delegation unchanged; shared/Admin/Listen consumer tests plus Desktop aliases pass. | Real authenticated media, runtime retries and native-device behavior remain uncertified locally. |
| Full suites, CI, canonical/native/AT certification | Defer under Diego's scoped serial testing policy and documented phase-close procedure. | Forty diagnostic views and focused tests cannot qualify all data/states/devices. Canonical evidence remains 1M. |
| Broad plan deviations and incomplete Smart Mix/A20/6.8/global 1b.8 | Execute a separate read-only audit and persist findings; do not turn it into another implementation group. | Confirmed historical typography/contrast/geometry and adoption debts remain listed until a correction iteration; no global completion claim. |
| Inherited solid-surface/token drift beyond changed rendering | Additional row files are style-only; classify existing panels/utilities in the broad audit and assign later adoption. | Translucent/shadowed local ops surfaces and other legacy styles still diverge from the final target. |

Executor also accepts the four Minor findings as real requirement gaps, fixes them in one scoped
pass and stops without another review loop. The original reviewed snapshot is preserved; final
post-repair hashes identify exactly what changed. This is local readiness for Diego's review,
not approval to publish or a claim that the broad audit findings are already corrected.


### 1AP authorized audit reconciliation — local validation, 2026-10-19

Diego authorizes the confirmed audit fixes in report order, with preview active and review
before commit. A1 count foreground, A2 Mono400, A3 compact Poppins, A4 shared-tag geometry and
consumer overrides, A7 published-bundle copy, A6 Admin guard and A8 state reconciliation are
implemented locally. Bricolage numerals16px+ and titles20px+, native exceptions, content/actions
and actual8px fields remain. A5 has explicit owner/phase/acceptance criteria in the single
[current-state table](2026-10-19-crate-v3-current-state.md) and an exact executable surface
register; its page migrations remain pending as the approved audit proposed.

Validation: eight new computed browser checks plus nine existing1AP preview checks pass, and
six builtAdmin cases pass (Chromium1440/768/390, workers1). Shared26cases, existing Listen38,
actual adaptive-chip Listen1 and Desktop-alias1 pass. Admin affected18files initially167pass/1
old assertion failure: Roles expected compact Bricolage, contradicting the corrected DS role.
Update that specific assertion; all six Roles cases plus15guard cases pass. The remaining17
files passed without changes. Three new actual-page cases cover zero/one/two published bundles.
No whole-suite repeat was run. Five strict scoped type configurations and final lint pass.
Node drift-inventory17cases and CLI pass; the CLI includes Admin16files/12pending-adoption
records without raising any existing budget. Unchanged non-render declarations and behavior/
route bindings in all ten corrected consumers are independently AST-compared to the pre-fix
snapshot (except the dead private UserPresence size variable, explicitly removed).

Admin and21-entrypreview builds pass. Initial JS **526377 / 532480 B gzip**, nine assets,
**6103 B margin**. Generatedcache restored; no dependency/lockfile, backend, pin or baseline
change. Formatter used the existing Prettier3.6.2 cache; shared lint used the explicit existing
Listen config because the shared package has no local ESLint config. Two pre-existing redundant
regex escapes in the touched drift tool were removed after lint RED;17Node cases remain green.
One fresh independent review of this new authorized amendment follows; the earlier reviewed
1AP freeze remains historical. **Stop1AP without commit/push; preview stays active at :5186.**


### 1AP audit reconciliation — final local stop, 2026-10-19

Fresh independent review verified86/86pendingpaths,77/77source/asset hashes and the22source-path
amendment against the preserved earlier1AP freeze. Critical0/Important0/Minor2. No product
regression identified. The two Minors were new A6 prevention correctness gaps: Tailwind variant
prefixes and lexical constant resolution. Executor retains their severity and closes both in
one focused tested pass under Diego's explicit prevention requirement. Variant utility parsing
now preserves bracketed selectors/values; exceptions still require the exact original token.
Constant resolution uses the nearest lexical binding and respects runtime parameter shadowing.
RED4fail/15pass → GREEN19/19; Node17, CLI, scopedAdmin types and lint pass. No second reviewer
or change to UI rendering after the17preview+6builtAdmin checks and526377/532480B bundle result.

All A1–A4/A6–A8 corrections are local and reviewable. A5 follows its approved owner/phase path:
12exact pending surface records and the current-state acceptance table remain visible. Existing
phase/native/live/canonical debt is not marked complete. Actual IAB screenshots are
`.artifacts/review/checkpoint-1ap-reconciliation.jpg` and `checkpoint-1ap-analysis-reconciled.jpg`.
The persistent1AP section now links the eight affected real-page specimens. Previewactive5186.
**Stop1AP, without commit/push. PublishedHEAD/origin stays ba63836d (1AO).**

#### Executor rulings on all behaviors set aside by the fresh review

| Behavior | Ruling | Concrete cost / limit |
| --- | --- | --- |
| Full legacy panel/surface migration | A5 is ownership/phase assignment in this approved order; exact records and acceptance criteria exist. | Translucent/shadowed inherited panels remain until the owning page migration. |
| Remaining PlaylistEditor icons, compact typography and tag overrides | Keep the next bounded group separate; changed operator/artwork/row contracts are covered here. | Editor remains partially migrated; this is no A20/6.8 completion claim. |
| Existing Playlists read-error and concurrent mutations | Preserve actual handlers and API/state semantics, verified by affected tests/AST. | Read error may still look empty after the toast; no stronger concurrency guarantee. |
| Users sticky header and shared Select visible-label association | Carry the two earlier known Minors to their consumer work. | Sticky overlap and complete combobox label/AT qualification remain unresolved. |
| Every untouched element/unvisited contrast or typography state | Accept recorded representative computed tests only. | No whole-product conformance certificate; further states can still expose drift. |
| Arbitrary runtime-generated classes and files outside registered guard scope | Static guard covers registered roles/literal branches and exact pending surfaces; dynamic classes remain outside its guarantee. | Runtime/unsampled file drift still requires consumer review. Ordinary variant and lexical-constant gaps inside the guarantee were fixed. |
| Live backend, authenticated artwork and retries | Helpers/contracts unchanged; use fixtures/delegation tests locally. | Production service freshness, credentials and runtime retry behavior remain uncertified. |
| Native/AT/zoom/other engines/canonical/fullsuite/CI | Follow Diego's phase-close procedure and scoped serial iteration policy. | Native accessibility, engines and full-phase qualification remain pending; canonical evidence stays1M. |

Ruling: complete the two directly requested new-guard correctness gaps in the single repair
pass rather than leave A6 partly effective under the generic Minor-defer guideline. Cost: the
guard gains bounded parsing/binding logic and four focused tests; no second review or broad
source repair. Both original reviewed packages and final repair freezes are retained.


### 1AP approved — publication preparation, 2026-10-19

Diego approved the final1AP and explicitly authorized commit/push followed by PlaylistEditor,
with functional UX preserved and the preview active. All77approved source/asset hashes match
before publication metadata changes. The persistent1AP label/footer now say published; only
its embedding expectation changes. Earlier1AP local stops are historical. The next checkpoint
is1AQ, to stop uncommitted for Diego; no PR/merge/rebase/deploy/release or fullCI/baselines.
The resulting verified publication SHA is recorded in the subsequent1AQ continuation record.

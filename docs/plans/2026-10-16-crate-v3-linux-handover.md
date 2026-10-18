# Crate V3 — Linux continuation

Prepared 2026-10-16 for a Codex agent starting without a local V3 checkout or branch.
This document travels with the checkpoint that closes 1N, 1O and 1P. Read the latest
publication/verification record in `2026-10-15-crate-v3-handover.md` before making changes.

## Active Linux workspace — 1AD approved for publication; next stop 1AE

Use `/home/diego/.codex/worktrees/crate-v3-1q/crate`, existing `feat/crate_v3` tracking origin.
Published HEAD is 1AC `439b3e78daf2719d86cee72dd5726f7bc210c504` (origin verified); original transfer
53177736 remains an ancestor. Leave `/home/diego/Code/Ninja/crate` (`feat/crate_mcp`) untouched.
Node 22.23.3 is `/home/diego/.nvm/versions/node/v22.23.3/bin`; dependencies are installed.

Diego approved the issue-queue sketch and authorised its implementation, retaining the 1AD
uncommitted review stop. Health now puts actual recorded problems and resolution controls first;
activity/catalog/filters are secondary. Empty/no-result/filter/stale/limited states are explicit,
worst loaded severity controls order and task summaries never turn missing counters into zero.
The corrected view restores the sketch accents, 1128 px content cap and reviewed typography/
spacing with one primary next step; all real secondary actions remain.
The same endpoints, actions, eligibility, scan gate, streams/reconnect/cleanup and confirmation
flow remain; confirmation copy now separates check-wide scope, loaded cases and recorded counts.
Only stale metadata assignments are added to existing readers. The approved visual drift
correction also repairs the shared default-border cascade; no shared JS/API/backend changes.

Review <http://127.0.0.1:5186/admin-health-demo.html> or persistent `/#salud-admin`.
The real page uses isolated fictional data/actions; nine sample modes need no API/SSE/library
operation. Both detail label/component pairs measure 8 px; actions/summaries 44 px, filter pills
32 px fine / 44 px coarse. Glyph policy stays 13 whole files / 40 retained UX sites.

Current scoped evidence after visual correction: 55 Health/policy +71 shared Vitest, 30 unique
Chromium cases (one transient focus failure passed unchanged on replay, then all 9 focus passed),
three strict TS configs, lint/format, contract audits and Admin/Listen/preview builds pass.
Admin 526767/532480 B gzip, ten assets, 5713 B margin; Listen 199918/307200 B, 23 assets.
Final proof/rulings and the focus-test limitation are in the main handover. Generated
tsbuildinfo restored. 1AD is approved for commit/push; earlier local-only stops are historical. Next group: Library Trash / 1AE.

Preview service `crate-v3-preview.service` uses this worktree/Node22, restart-on-failure,
loopback :5186. Keep it active. Other user tabs and previous checkpoints stay intact.
No full suites/CI/canonical captures or real backend/native/AT/other-engine QA. 33 PNGs/manifest
remain 1M; pin 258bbaee unchanged/unavailable. Later Health data/instrument tasks and whole 1b.8
remain pending. **Publish approved 1AD, then stop at 1AE before commit/push or another group. No PR/merge/rebase/deploy/release.**

Diego explicitly retained Listen's layered play/halo/progress ring and luminous seek trail
(2 px, thin 1 px) during 1S review. Preserve them. Shared/Listen/Desktop contracts are unchanged.
The generic bootstrap below is retained for a future fresh machine; it does not replace this
active worktree. Final records supersede historical local-only checkpoint notes.

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

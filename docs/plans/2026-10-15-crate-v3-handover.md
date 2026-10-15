# Crate v3 handover

Entry point for any agent (Codex or Claude) that picks up Crate v3. Read this file, then the
implementation plan. Status as of 2026-10-15.

## Where the work lives

- Working tree: `/Users/diego/Code/crate-v3`, branch `feat/crate_v3`. This is the only tree you
  edit and test in. It has its own `node_modules` and `.venv`.
- The old external-disk worktree (`/Volumes/MacData/.../worktrees/crate-v3`) was removed. Older
  docs that mention it, or `git -C worktrees/crate-v3`, mean this clone now.
- Remotes: `origin` is GitHub. `feat/crate_v3` has **not** been pushed yet (Task 0.1 step 4 needs
  Diego's go-ahead).

## Sources of truth, in reading order

1. `docs/plans/2026-10-14-crate-v3-implementation-plan.md`: the only delivery order. Every task
   has Files, Steps, Verify and the commit message. The "Command reference" section defines the
   named commands (`VT-UI`, `VT-LISTEN`, `PY`, `GATES`, `TYPES`, ...) and the Definition of done
   that applies to every task.
2. `docs/plans/2026-10-15-crate-v3-decision-register.md`: PD1 to PD54, all decided. Do not reopen
   them.
3. `docs/plans/2026-10-14-crate-v3-product-design.md` (`PD §n`) and
   `docs/plans/2026-10-14-crate-v3-design-system.md` (`DS §n`): read the sections a task cites.
4. `docs/plans/crate-v3-analysis/*.md`: evidence behind the docs.
5. The visual reference is the new site, `app/web` on branch `feat/website` (read it with
   `git show origin/feat/website:app/web/<path>` after `git fetch origin`). `vnext` is discarded:
   never use it as a reference.

## How to execute the plan

The plan header asks for the `executing-plans` skill. Without it, follow this protocol:

1. Take the next task from the plan whose dependencies are done (see "Order and checkpoints" at
   the end of the plan and the status table below).
2. Read the PD and DS sections the task cites, then the code it names. Line numbers are hints:
   grep for the symbol first.
3. Write the failing test, run it, implement, run it green. Then run the task's Verify commands.
4. One task is one commit, with the exact message the plan gives. Conventional commits, no
   co-author or "Generated with" lines.
5. Update the status table in this file in the same commit when a task finishes.
6. Stop at every **checkpoint** in the plan and report to Diego. Do not start the next release
   group without his review.
7. If a task turns out to be wrong or blocked, do not improvise a different design: write the
   problem down under "Open questions" below and move to an independent task.

## Hard rules

- Never push, open PRs, tag or deploy without Diego's explicit go-ahead.
- Never touch the production server or run queries against production (Task 0.14 needs Diego).
- The instance domain must not appear in any UI, fixture, screenshot or recorded asset.
- The repo rules in `AGENTS.md` and the scoped `AGENTS.md` files apply: no library writes from
  the API, DB code only in `app/crate/db/` concrete modules, no `COUNT`/`SUM`/`AVG` over
  `library_tracks` in a request, no snapshot rebuilds in a request, Admin uses `lucide-react` and
  `sonner`, Listen uses `@crate/ui/icons` and `notify`, `@crate/ui` only for components both apps
  use in the same change, no emojis in UI text.
- Committed visual baselines come only from the `update-listen-visual` CI job, never from a Mac.

## Running agents in parallel

- One agent per task, each in its own git worktree created from `feat/crate_v3`
  (`git worktree add ../crate-v3-<task> -b v3/<task> feat/crate_v3` from
  `/Users/diego/Code/crate-v3`), on the internal disk.
- Only run tasks in parallel when their Files lists do not overlap. Tasks that touch
  `app/shared/ui/lib/appearance-token-registry.ts`, the generated `themes.css`, i18n catalogs or
  `scripts/design-system/` drift ceilings must run one at a time.
- Integrate each finished task into `feat/crate_v3` with a fast-forward or rebase, never a merge
  commit, and rerun its Verify commands after integrating.
- Phase 2A/2B tasks marked `[MAIN]` go on `fix/*` or `perf/*` branches from `main`, not on
  `feat/crate_v3`. Do not start them unless Diego assigns them.

## Status

| Phase | State |
| --- | --- |
| 0.0 font licence (Bricolage Grotesque, OFL) | Done |
| 0.1 track docs, push, rebase on `main` | Steps 1–2 done. Rebase and push wait for Diego (Smart Mix merges to `main` first) |
| 0.2 internal clone | Done |
| 0.3 decisions | Done (decision register) |
| 0.4–0.10, 0.12, 0.13 | Done |
| 0.11 visual baselines | Deferred: needs the branch pushed for the CI job |
| 0.14 production read-only queries | Waiting for Diego |
| 0.15 WebKitGTK runtime check | Deferred |
| Phase 1, 1b | Not started. Next: Tasks 1.0 to 1.12, then 1b.3 and 1b.4 (foundation release) |
| Phases 2–7 | Not started |

## Release order

1. Smart Mix merges to `main` (separate branch, another agent).
2. `feat/crate_v3` rebases on `main` (Task 0.1 step 3).
3. `feat/website` (the new site in `app/web` and the restyled `app/docs`) merges into
   `feat/crate_v3`. From then on the site and the apps share tokens, and the site's screencast
   and screenshots are re-recorded on the v3 UI at the end.
4. Listen, Admin, site and docs ship together as the v3 major release.

## Open questions for Diego

- `--text-subtle` on the dark crateRed popover is 4.27:1, below AA 4.5:1. The test pins it as a
  known failure (Task 0.10); pick the new value.
- Decision register row PD48 still says "Admin functional tests only", while PD, DS and the plan
  include the Admin captures. Confirm the register should be updated.
- Admin initial JS is 514,659 B gzip; Task 0.12 set the ceiling at 520 KiB. Confirm the ceiling.

# ryoku.cratemusic.app Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Crate-styled showcase site for Crate for Ryoku at `ryoku.cratemusic.app`, with a choreographed screencast, real surface clips, a few interactive pieces and an install quickstart.

**Architecture:** `app/ryoku` is an Astro site in the Crate monorepo that imports `app/web`'s tokens, fonts and base styles through a Vite alias. It ships as its own nginx image, routed by Traefik like `crate-docs`. Video lives outside git on the production server and is served from a mounted directory. The screencast is produced by a timeline-driven "director" in crate-for-ryoku and cut with ffmpeg.

**Tech Stack:** Astro, GSAP, Lenis (the versions `app/web` pins), Vitest, Playwright; nginx; Docker/Traefik; Python for the director; wf-recorder, ffmpeg.

**Spec:** `docs/plans/2026-11-14-ryoku-site-design.md`

## Global Constraints

- English only. The site follows `app/web`'s aesthetic by importing it (`app/web/src/styles/tokens.css`, `base.css`, its fonts), never by copying.
- Primary action: Install Crate for Ryoku. Positioning line: "An opinionated mod of Ryoku based on Crate's visual design" (wording may be polished, meaning unchanged). A prominent link to `https://cratemusic.app`.
- The page states that the Crate desktop app needs a Crate server and that Ryotunes plays local music.
- Install commands: `paru -S crate-for-ryoku crate-desktop-bin` then `crate-for-ryoku install`; Ryostore (Bundles > Crate for Ryoku); the release tarball.
- Interactive pieces are hand-built SVG, Canvas 2D or CSS; no chart libraries; all honour `prefers-reduced-motion`.
- No video in git. Clips are served from `/media/` (a mounted host directory).
- No emojis in UI text. No personal data in committed assets.
- `app/ryoku` is not an npm workspace (like `app/web`): `npm ci --prefix app/ryoku`.
- Commits: conventional (`feat(ryoku-site): ...`), no AI attribution, on branch `feat/ryoku-site`.

## Review Focus

1. A visitor with `prefers-reduced-motion`: no autoplaying video, no GSAP motion; posters and static pieces instead. Task 2 adds `reduced-motion.spec.ts`.
2. Media not uploaded yet (first deploy, a missing clip): every video slot falls back to its poster or a quiet placeholder, never a broken player. Task 2 adds `missing-media.spec.ts`.
3. A phone-width visitor: the hero, the surfaces grid and the quickstart fit 375 px with no horizontal scroll. Task 2 adds `mobile.spec.ts`.
4. The Crate site changes a token or font: `app/ryoku` builds against it unchanged. Task 1's build reads `app/web`'s live files.
5. A director step that cannot run (a surface that does not paint from the terminal, a missing app): the run pauses with a cue or aborts, never records a broken take. Task 5 tests `cue` and failing steps.

---

### Task 1: Scaffold `app/ryoku` on the Crate web foundation

**Files:** create `app/ryoku/{package.json,astro.config.mjs,tsconfig.json,vitest.config.ts,playwright.config.ts}`, `src/layouts/Site.astro`, `src/pages/index.astro`, `e2e/smoke.spec.ts`.

**Interfaces:** alias `@crate-web` → `../web/src` (Vite `resolve.alias` plus `server.fs.allow`); `Site.astro` imports `@crate-web/styles/tokens.css` and `base.css` and the web's font faces, meta for `https://ryoku.cratemusic.app`; `index.astro` has seven sections with ids `hero`, `cover`, `surfaces`, `play`, `crate`, `install`, `footer`.

- [ ] **Step 1:** Write `e2e/smoke.spec.ts`: the page loads, all seven ids exist, a token custom property from `tokens.css` resolves on `:root`.
- [ ] **Step 2:** Run it; expected: fail (no app).
- [ ] **Step 3:** Scaffold with `app/web`'s Astro/GSAP/Lenis versions; scripts `dev` (port 5177), `build` (`astro check && astro build`), `test`, `test:e2e`, `budget` (`node ../web/scripts/check-budget.mjs dist 122880`).
- [ ] **Step 4:** `npm ci --prefix app/ryoku`, build, `test:e2e`; expected: pass.
- [ ] **Step 5:** Commit `feat(ryoku-site): scaffold app/ryoku on the Crate web foundation`.

### Task 2: Static sections, copy and media slots

**Files:** create `src/components/{Hero,Surfaces,PoweredByCrate,Install,SiteFooter,MediaClip}.astro`, `src/data/media.ts`, `e2e/{sections,reduced-motion,missing-media,mobile}.spec.ts`.

**Interfaces:** `media.ts` exports `CLIPS: { id; title; caption; poster; webm; mp4? }[]` (paths under `/media/`; ids `qsbar`, `controls`, `launcher`, `gamebar`, `kit`, `pickers`, `dock`, `notifications`) and `HERO` (same shape). `MediaClip.astro` props `{ clip, loop?, autoplay? }`: muted, playsinline, preload metadata, poster; no autoplay under reduced motion; on error or a missing source it shows the poster, or a hairline placeholder if that is missing too.

- [ ] **Step 1:** Write the specs: `sections` (positioning line; Install link to `#install`; a link to `https://cratemusic.app`; the server-requirement sentence and "Ryotunes"); `reduced-motion` (no `video[autoplay]`, revealed elements visible at their final state); `missing-media` (route `/media/**` to 404: posters or placeholders, no broken player); `mobile` (375 px, `scrollWidth <= 375`).
- [ ] **Step 2:** Run them; expected: fail.
- [ ] **Step 3:** Build the components on the web's tokens; GSAP/Lenis reveals behind a `prefers-reduced-motion` check.
- [ ] **Step 4:** Run the specs and `budget`; expected: pass.
- [ ] **Step 5:** Commit `feat(ryoku-site): hero, surfaces, Crate, install and footer sections`.

### Task 3: Interactive pieces

**Files:** create `src/components/play/{ReloadCover,Equalizer,KitControls}.astro`, `src/lib/{beam,eq}.ts`, `src/lib/{beam,eq}.test.ts`, `e2e/play.spec.ts`.

**Interfaces:** `bouncePosition(t: number, trackWidth: number, segmentWidth: number, legMs = 900): { x: number; back: boolean }` (ease-in-out sine, never outside `[0, trackWidth - segmentWidth]`, like Ryoku's Beam scan). `curve(gains: number[], width: number, height: number, samples = 200): [number, number][]` (smooth curve through the band gains, as crate-mark's equalizer). `ReloadCover`: the Crate mark (the outline path in `crate-for-ryoku/plugin/crate-mark/content/CrateLogo.qml`) as inline SVG with the brand gradient, a 3.2 s breathing glow, a 3.6 s sheen, a Beam driven by `bouncePosition`.

- [ ] **Step 1:** Write `beam.test.ts` (inside the track at any `t`; reaches both ends; `back` on the return leg) and `eq.test.ts` (flat gains give a straight centre line; a peak lands at its band's x).
- [ ] **Step 2:** Run `npm run --prefix app/ryoku test`; expected: fail.
- [ ] **Step 3:** Implement the libs and the three components (equalizer bands draggable by pointer and keyboard; kit controls: a Beam slider, chips, a toggle).
- [ ] **Step 4:** Write `play.spec.ts` (dragging a band changes the curve; arrow keys move a focused band; reduced motion holds the cover still and the Beam centred); run all tests; expected: pass.
- [ ] **Step 5:** Commit `feat(ryoku-site): live reload cover, equalizer and kit controls`.

### Task 4: Image, routing, media and deploy

**Files:** create `app/ryoku/Dockerfile`, `app/ryoku/nginx.conf`; modify `docker-compose.project.yaml` (service `crate-ryoku-site`), `.github/workflows/build-images.yml`, every other release/deploy place `crate-docs` appears (`grep -rn crate-docs`), `Makefile` (`ryoku-media-sync`).

**Interfaces:** service `crate-ryoku-site`: Traefik router `ryoku`, rule `Host(ryoku.cratemusic.app)` in backticks, `websecure`, `letsencrypt`; volume `./media/ryoku:/usr/share/nginx/media:ro`; healthcheck as `crate-site`. nginx: `location /media/ { alias /usr/share/nginx/media/; expires 30d; }`, `_astro` immutable as in `app/web/nginx.conf`. `make ryoku-media-sync SRC=<dir>`: `rsync -av` (never `--delete`) into `crate@95.216.3.27:/home/crate/crate/media/ryoku/`.

- [ ] **Step 1:** Build the image locally (`docker build -f app/ryoku/Dockerfile -t crate-ryoku-site:test .`), run it with a local media dir mounted, `curl -fsS` `/` and `/media/<file>`; expected: fails before the files exist.
- [ ] **Step 2:** Write the Dockerfile (node 22 build copying `app/web/src` for the alias, nginx runtime) and `nginx.conf`; rerun; expected: both 200.
- [ ] **Step 3:** Add the compose service, the CI job (mirror `crate-site`, change detection on `app/ryoku/**` and `app/web/src/styles/**`, `promote_latest`), the release and deploy entries; run the deploy-tooling tests and `docker compose -f docker-compose.project.yaml config`.
- [ ] **Step 4:** Commit `feat(ryoku-site): ship app/ryoku as crate-ryoku-site behind ryoku.cratemusic.app`.

### Task 5: The director (crate-for-ryoku repo)

**Files:** create `tools/director/director.py`, `tools/director/timelines/example.json`, `tools/director/tests/test_director.py`, `tools/director/README.md`.

**Interfaces:** timeline JSON `{ "name", "output", "steps": [ { "at": seconds, "do": "surface|window|notify|play|pointer|wait|cue", ... } ] }`; `surface` opens or closes by IPC (`ryoku-shell`, `hyprctl`), `window` launches and places, `notify` runs `notify-send`, `play` drives `playerctl`, `pointer` moves or clicks (ydotool), `cue` pauses with an instruction for Diego, `wait` holds. CLI: `director.py TIMELINE --dry-run` prints the resolved commands with times; `--record OUT.mkv` runs `wf-recorder -r 60` and the steps on schedule; a failing step stops the run and the recorder.

- [ ] **Step 1:** Write `test_director.py`: the dry-run of `example.json` gives the expected commands in order; a `cue` pauses; an unknown `do` or a failing command aborts with a clear message and stops the recorder.
- [ ] **Step 2:** Run `python3 -m pytest tools/director/tests -q`; expected: fail.
- [ ] **Step 3:** Implement; run; expected: pass.
- [ ] **Step 4:** With Diego present, probe each surface the storyboard needs with a one-step timeline (it opens and paints, or needs a `cue`); record the results in the README.
- [ ] **Step 5:** Commit `feat(director): timeline-driven screencast director`.

### Task 6: Storyboard (review gate)

- [ ] **Step 1:** Write `docs/screencast/storyboard.md` in crate-for-ryoku: the hero loop (30-45 s, seamless), each surface clip (4-8 s), the Reddit cut (60-90 s), shot by shot (what opens, closes, notifies, plays; timings), and the pre-session checklist (do-not-disturb, work windows closed, Groove wallpaper, music with a publishable licence, nothing personal on screen).
- [ ] **Step 2:** Turn it into timelines under `tools/director/timelines/` and dry-run each.
- [ ] **Step 3: Review gate.** Diego approves the storyboard and the dry-runs before any recording.
- [ ] **Step 4:** Commit `docs(screencast): storyboard and timelines`.

### Task 7: Record, cut and publish

- [ ] **Step 1:** With Diego, run the checklist and record each timeline (`--record`), retaking until approved.
- [ ] **Step 2:** Cut with `tools/director/cut.sh` (ffmpeg): AV1 WebM plus a JPEG poster per web clip, the seamless hero loop, the Reddit cut in 16:9 and 9:16 as H.264 MP4; keep the hero under 25 MB and each clip under 6 MB.
- [ ] **Step 3:** `make ryoku-media-sync SRC=<cuts>`; Diego creates the `ryoku.cratemusic.app` DNS record.
- [ ] **Step 4:** Merge, let the image build, `make deploy-preflight VERSION=<sha>` then `make deploy VERSION=<sha>`; verify `https://ryoku.cratemusic.app` (sections, media, mobile, reduced motion) and record it in the Crate handoff.

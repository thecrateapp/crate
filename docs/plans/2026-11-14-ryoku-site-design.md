# ryoku.cratemusic.app: Design

> **2026-11-16:** the site is simplified to the hero copy, a screenshot showcase (the Crate
> site's own `components/showcase/Showcase.astro`, fed from `media/shots/`), Powered by Crate,
> Install and the footer. The screencast hero, the surface clips, the reload cover and the Play
> section are gone until a take plays smoothly. The rest of this design is the original plan.

Status: design agreed with Diego on 2026-11-14. Implementation plan to follow once this spec is
approved.

## Goal

A showcase site for **Crate for Ryoku** at `ryoku.cratemusic.app`. Its audience arrives from Reddit
(r/unixporn and Linux communities). The site's job is to make them install Crate for Ryoku, and in
doing so bring them to Crate: the mod is the hook, Crate is the destination.

Positioning line (final wording during implementation): _"An opinionated mod of Ryoku based on
Crate's visual design"_, with a prominent link to `cratemusic.app`.

The site is one more piece of the Crate universe (website, Listen, admin, the Ryoku mod): it follows
the Crate website's aesthetic exactly. English only, like `cratemusic.app`.

## Primary action and honesty

- Primary call to action: **Install Crate for Ryoku**.
- The site states plainly that the Crate desktop app needs a Crate server; it does not play local
  files. For local music, Ryoku's own player is Ryotunes. A visitor without a server must learn this
  before installing.

## Structure

1. **Full-screen hero**: a seamless loop of the choreographed screencast (below), no copy over it at
   first. On scroll the positioning line and the Install button appear.
2. **The reload cover, live**: the Crate mark with its breathing glow and sheen and the back-and-forth
   Beam, recreated on the web; it also works as a transition between sections.
3. **Surfaces**: short looping real clips (4-8 s) of the QS Bar and crate-mark, Controls (Super+Esc),
   the launcher, the Game Bar, Kit, the pickers, the shima dock, notifications, each with minimal copy.
4. **Interactive pieces**: a few hand-built "toys": the crate-mark equalizer and kit controls (Beam,
   chips, sliders) that visitors can play with.
5. **Powered by Crate**: what Crate is, the server requirement, Ryotunes for local music, a prominent
   link to `cratemusic.app`.
6. **Install quickstart**: AUR (`paru -S crate-for-ryoku crate-desktop-bin`, then
   `crate-for-ryoku install`), Ryostore, the release tarball; requirements (the Ryoku version, a Crate
   server).
7. **Footer**: `cratemusic.app`, Listen, the repository, credits (Solar icons CC BY 4.0, the fonts).

Showcase mix (Diego's choice): real clips for whole surfaces, plus a few interactive highlights.

## Screencast and videos

- **A written script (storyboard)** per piece: shot by shot, what opens and closes, which
  notification arrives, what plays in Crate, timing and transitions. Diego approves it before any
  recording.
- **Automated choreography**: a "director" script runs the timeline: surfaces opened and closed over
  IPC (`ryoku-shell`, `hyprctl`), windows launched and placed, scripted notifications (`notify-send`),
  Crate playback (`playerctl`), pointer moves where needed. `wf-recorder` records at 4K 60 fps, so
  every take is identical and re-recordable when something changes.
  - Surfaces that do not paint when opened from a terminal (Controls, QS Bar Settings) are checked one
    by one first; for those the script pauses and cues Diego to open them by shortcut, or another path
    is found.
- **Diego's real desktop**, prepared with a pre-session checklist: do-not-disturb except scripted
  notifications, work windows closed, Groove wallpaper, chosen music in Crate, nothing personal on
  screen (mail, chats, paths, other people's names).
- **Deliverables**, all cut from the same footage:
  - the hero loop (30-45 s, seamless);
  - the surface clips (4-8 s loops);
  - the Reddit cut (60-90 s) in 16:9 and 9:16;
  - WebM/AV1 with a still poster for the web, MP4/H.264 for Reddit.
- **Sound**: web clips are silent. Reddit cuts may carry the music playing in Crate only if the track's
  licence allows publishing.

## Technical

- **`app/ryoku` in the Crate monorepo**: Astro with GSAP and Lenis, like `app/web`. The aesthetic is
  imported, not copied: a Vite alias points at `app/web/src` for the tokens, fonts, base styles and
  the components that fit (navigation, footer). If the Crate site changes, this one follows.
- **Interactive pieces**: hand-built SVG, Canvas 2D or CSS, per Crate's instrument rule (no chart
  libraries). They honour `prefers-reduced-motion`.
- **Video outside git**: the clips live on the production server in a directory mounted into the
  site's container and served by its nginx with long cache headers. A sync command uploads them
  without deleting anything else. The image build stays light.
- **Deployment**, like `docs.cratemusic.app`: a new service in `docker-compose.project.yaml` with a
  Traefik router `Host(ryoku.cratemusic.app)` and its certificate; the image builds in "Build & Push
  Docker Images" and deploys with `make deploy`. Diego creates the DNS record for
  `ryoku.cratemusic.app`.
- **Tests**, like `app/web`: Vitest for the interactive pieces; a Playwright smoke per section (the
  Install and `cratemusic.app` links, reduced-motion behaviour); a page-weight budget excluding video.

## Out of scope

- Other languages (English only for now).
- Alternative Ryoku styles (the closed-package ruling of Wave 7): the site shows the Crate setup only.
- A hosted demo Crate server for visitors.

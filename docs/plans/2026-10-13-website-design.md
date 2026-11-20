# Crate website — design

> **Estado (2026-11-18):** Implementado en app/web (cratemusic.app). Se conserva como histórico de diseño.

Date: 2026-10-13
Status: validated (content + visual direction). Hero selected: A3 · Mark (2026-10-13).

## Goal

Replace `app/site` with a multi-page site that presents Crate as what it is: a self-hosted
music platform with its own technical identity. The site keeps the Crate app colours
(dark + cyan) but not the HUD language, and focuses on what Crate does. No competitor comparisons. Activism stays in the copy
of the hero and in `/why`, not in the visual language.

## Decisions

| Topic | Decision |
| --- | --- |
| Stack | Astro + React islands only where needed. Static HTML per page and locale. |
| Location | `app/web`, outside npm workspaces (like `app/site`, `app/docs`). Replaces `crate-site` at launch. |
| Language | English first. Astro i18n routing: `/` = en, `/<locale>/` later. Short strings in a typed dictionary (`src/i18n/en.ts`), long-form text as content collections per locale (`src/content/<collection>/en/*.md`). |
| Comparisons | None. No feature matrices, no "unlike X". |
| License | AGPL-3.0 added to the repo before launch (the site says "open source"). |
| Downloads | `https://github.com/thecrateapp/crate/releases/latest/download/<alias>` using the unversioned aliases added in `chore/stable-release-asset-names`. |
| Server requirements | "Linux x86_64 with Docker. 4 cores and 8 GB RAM recommended." Images are amd64-only; no ARM claim. |
| Status labels | Federation: available. Smart Mix (Android): available (launch gate below). Jams and the VirtualDJ plugin: Coming soon. |
| Performance claims | No latency or throughput figures, except the Smart Mix measurements (beat alignment p95 on a phone, BPM accuracy, Rust analysis time and memory), published on `/listen` from 2026-10-26. |

## Site map

```
/              Home
/listen        Listen: 10 chapters, deep-dives for Radio and Paths, Smart Mix chapter
/admin         Admin: 7 chapters
/architecture  System map, traced event, engineering stories, scale, stack
/developers    APIs, dev stack, contributing → docs.cratemusic.app
/why           The manifesto (corrected), linked from the footer
```

Navigation: Listen · Admin · Architecture · Developers · Docs (external) · GitHub.
Footer: Read the manifesto → `/why`, GitHub, Docs, AGPL-3.0.

## Home

1. **Hero (A3 · Mark)** — see "Hero" below. One focal point, one CTA:
   - H1: "Crate is not a streaming service."
   - Subline: "It's a tool for revolution."
   - CTA: the installer pill `curl -fsSL https://cratemusic.app/install.sh | bash` + Copy.
2. **Statement** — the three current paragraphs, revealed word by word, directly below the hero
   ("Crate is free, open-source software…", "Install it in your server…", "Own your music.
   Support your artists. Refuse the middleman."). "No algorithms." kept as is.
3. **Screencast** — pinned section, five chapters advanced by scroll:
   01 Library · 02 Player · 03 Radio · 04 Paths · 05 Offline. Desktop window with a synced
   phone overlay. See "Screencast pipeline".
4. **Get Crate**
   - Server: installer + requirements line + link to the install docs.
   - Clients: macOS (Apple Silicon, Intel), Windows (exe, msi), Linux (AppImage, deb, rpm),
     Android (apk). iOS: install as a PWA (instructions).
5. **Explore** — four large text rows: Listen, Admin, Architecture, Developers.

## /listen

1. **Play** — gapless; smart transitions (crossfade length from BPM, key and energy; albums stay
   gapless); **Smart Mix on Android** (server-planned transitions: automatic intro/outro cue
   points, beat grid, Camelot compatibility, BS.1770 loudness, equal-power fade on two decks,
   0–12 s, never blocks playback, offline fallback); 10-band EQ with 21 presets; the Smart EQ
   chain (your preset → curator track → curator album → genre, inherited from parents →
   analysis-derived → flat, with the reason shown); adaptive EQ per track; synced lyrics with
   tap-to-seek; WebGL visualizer.
2. **Smart Mix** (`#smart-mix`, added 2026-10-26) — "Not a crossfade. A planned transition."
   Three techniques the planner picks per transition (Gapless, Adaptive blend, Beatmatch + Bass
   swap); a scroll-scrubbed transition visual (beat grids locking, tempo ramp and restore,
   equal-power gain, lows swapping at the midpoint); Analysis → Planner → Engine; measured
   figures; platform status (Android available, web and desktop Smart transitions, iOS planned,
   VirtualDJ coming soon); listener controls. Play keeps the web/desktop Smart transitions.
3. **Radio** (deep-dive) — seed → target point in bliss space (20-float vectors) → nearest
   neighbours via pgvector → weighted score (sound 0.34, artists 0.22, genre 0.16, BPM 0.09,
   energy 0.08, Camelot 0.05, era 0.03, minus penalties) → artist spacing and dedup. Likes move
   the target (8% per like, capped at 40%), dislikes exclude neighbours; feedback persists.
   Seeds: artist, album, track, playlist, Crate, genre, discovery.
3. **Paths** (deep-dive) — start and end can be a track, album, artist or genre; 5–50 steps.
   Three planners: shortest route over the genre map (parent/child/influence 1.0, fusion 1.6,
   related 2.5), artist scene routes, and a line through bliss space. Optional LLM review.
   Saved and regenerable. No waypoints, no "save as playlist" (neither exists in the UI).
4. **Discover** — Explore, moods (8, from audio analysis), Time tunnels, Genre rooms, Radar
   (shows + new releases + pre-releases).
5. **Yours** — Stats (week → all-time, heatmap, sound profile, Replay), Crate Digging stories,
   Crates (curated album collections, shareable, collaborative, ZIP), collaborative playlists.
   Smart playlists are presented as a curator tool (admins create them).
6. **Together** — follow, public profiles, affinity with "Why you match", shared Crates and
   playlists, **federation** (server-to-server, Ed25519-signed, approved pairing, relayed
   playback). Jams: Coming soon.
7. **Everywhere** — desktop (macOS, Windows, Linux) with native media controls, Android, PWA,
   offline mirror, Cast, multiple servers in native apps, OpenSubsonic (tested clients only:
   Feishin, Symfonium, Subtracks), 7 languages, Last.fm and ListenBrainz scrobbling.
8. **Live** — upcoming shows (Ticketmaster, Last.fm), probable setlists playable from your
   library (Setlist.fm), Bandcamp (sync, purchases, contributions).
9. **Decks** — Coming soon: Crate as a VirtualDJ online source (search, folders, load to deck,
   Compatibles folder ranked by tempo, harmony, energy and sound, Camelot/energy metadata).
   Requires VirtualDJ Pro. No beatmatch, bass handoff or Automix claims.

Copy corrections against `app/site`: no "listen together", no waypoints, no "save a path as a
playlist", no DSub/Ultrasonic, Android is a signed release (not a debug build), "loudness"
without "EBU R128".

## /admin

1. **Health** — 17 checks with risk levels, confirmations, Library Trash quarantine.
2. **Imports** — staged imports, watcher + scans, portable metadata (`.crate/album.json`) so the
   catalog can be rebuilt from the files.
3. **Acquisition** — neutral tone. Discography monitoring, new releases, pre-releases fetched on
   release day, quality filtering, fake-FLAC detection. Tidal and Soulseek as optional
   integrations.
4. **Enrichment** — MusicBrainz, Last.fm, Discogs, Fanart.tv, Setlist.fm, Spotify (popularity),
   Deezer/iTunes (images), Cover Art Archive, Wikidata, Wikipedia, Ticketmaster, lrclib,
   Bandcamp.
5. **Genres** — taxonomy tree (61 seeded genres, five relation types), signed release
   (ed25519), local overrides, per-genre EQ with inheritance.
6. **Analysis & Insights** — coverage for features, bliss, fingerprints and Smart Mix profiles
   (backfill with pause/resume/cancel); Insights charts.
7. **Operations** — live tasks, roles and capabilities (RBAC), invites, sessions, system
   metrics, stack view, logs, Telegram bot.

Every LLM feature is labelled "optional — bring your own model": the operator sets up the
model in Admin — Gemini, DeepSeek, or Ollama on your own hardware. LiteLLM is not shipped.

## /architecture

1. **System map** — every service, its runtime, `/music` mount (ro/rw) and memory limit.
2. **Trace** — follow one like: API → `domain_event_outbox` (same transaction) → relay →
   Redis Streams → projector → `ui_snapshots` → Go read plane → SSE to every open client.
3. **Stories**
   1. A 128 MB Go read plane in front of Python, with two layers of fallback.
   2. Transactional outbox to Redis Streams.
   3. Your API can't corrupt your library (ro mount, queue-scoped writes, temp + rename).
   4. Two Redises, on purpose.
   5. Gapless in the browser: HTML5 first, WebAudio second.
   6. Deterministic UUIDv5 identities, MBID-first.
   7. A media worker with five dependencies.
   8. Background work that yields to listeners (resource governor, `SKIP LOCKED` daemons).
   9. One planner, two players that don't trust it (Smart Mix contract across Python, Rust,
      Java, C++).
   10. Rust and Python analyzers with a parity check (no benchmark figures).
   11. Publishing analysis while files change underneath (generation tags, compare-and-swap).
   12. Two ExoPlayers behind one MediaSession.
4. **Scale** — ~4.4K pytest, ~3.7K Vitest, 255 Go and 234 Rust tests; 121 task types; 108
   migrations. Numbers are generated at build time where possible, never hand-maintained.
5. **Stack** — Python 3.13/FastAPI/SQLAlchemy/Dramatiq, PostgreSQL 15 + pgvector, Redis 7, Go,
   Rust (crate-cli, media worker, Tauri), React 19/Vite/Tailwind 4, Capacitor, Tauri 2.

## /developers

- APIs: REST (OpenAPI), OpenSubsonic `/rest` (50 operations, extensions, `sonicSimilarity`
  tracked in #290), `/api/capabilities`, personal access tokens (`crv_`, scopes, allowlist),
  Smart Mix APIs (mix-profile, compatible, transition-plans).
- Run it: `make dev` and the dev URLs.
- Contribute: testing policy ("if you touch it, you test it"), conventional commits, AGPL-3.0.
- VirtualDJ plugin: C++20/CMake, private SDK, status.
- Deep links into docs.cratemusic.app.

## /why

The manifesto with the corrections agreed on 2026-10-13: minimum-wage stream math, Spotify per
stream vs Apple and the 1,000-stream threshold, Prima Materia/Helsing attributed to Ek,
Deerhoof and Xiu Xiu added, Bandcamp math (~$280 vs ~90K streams), missing `<br />`.

## Visual system

- **Colours (non-negotiable)**: background `#0a0a0f`, foreground `#f1f5f9` with opacity steps,
  cyan `#06b6d4` / `#67e8f9` as the only brand colour. Amber only for states (Coming soon).
- **Type**: Cabinet Grotesk (800/700/500) for display, tracking -0.045em, line-height 0.9;
  Poppins (from `app/shared/fonts`) for body; JetBrains Mono for micro labels, figures and the
  installer. Cabinet Grotesk is self-hosted in production (Fontshare, free for commercial use).
- **HUD is optional**: kept only as small mono readouts. No frames, no scanlines.
- **Texture**: fixed grain at ~4.5%, radial vignette. No glassmorphism except the CTA pill over
  WebGL, no decorative gradients, no bento grids.

## Motion

- Spring easing via CSS `linear()` (snappy for entries, smooth for state changes);
  `cubic-bezier(0.22, 1, 0.36, 1)` for hovers. No CSS keyword easings.
- Entry under ~800 ms: nav, word-masked H1, subline, CTA, staggered 80–150 ms.
- Scroll-linked sections use sticky containers (no GSAP pin) and ScrollTrigger scrub.
  `html, body { overflow-x: clip }`, never `hidden` (it breaks sticky).
- WebGL only in: the hero, the bliss space (Radio/Paths deep-dives), the architecture map.
- GSAP + ScrollTrigger + Lenis (disabled on touch and reduced motion). View Transitions between
  pages.
- `prefers-reduced-motion`: static mark, no scrub choreography, opacity-only reveals.

## Screencast pipeline

1. **Script as code** — Playwright drives Listen in Chrome against production with Diego's
   user (decision 2026-10-13; recordings create play events and scrobbles). Every click, scroll
   and target bounding box is written to an event log with timestamps.
2. **Capture** — CDP screencast frames at 2× (desktop 1440×900, mobile 390×844 emulated),
   stored lossless. No Playwright `recordVideo` (VP8 artefacts).
3. **Edit in Remotion**, driven by the event log: spring zoom/pan to each interaction, synthetic
   cursor with smoothed paths and click pulses, 3D perspective tilts, motion blur on fast moves,
   accelerated scrolls, desktop window frame (as the Tauri app) with the phone overlay in sync,
   HUD captions from the site's i18n dictionary.
4. **Export** per chapter (AV1 + H.264, poster per chapter). Chapters play when they enter the
   viewport; no scroll-scrubbed video.

Real library artwork appears publicly (decision 2026-10-13; takedown risk accepted).

## Data exports (offline, never at request time)

- **Bliss sample**: ~2K tracks, vectors projected to 2D (UMAP), track/artist/genre labels,
  written as static JSON for the Radio/Paths deep-dives and the hero cloud.
- **Scale numbers**: test counts, task types, migrations, generated by a script at build time.

## Performance budget

- < 120 KB gzip JS per page, video excluded. LCP < 2.5 s on 4G.
- WebGL loaded lazily, paused off-screen, skipped on reduced motion and low-end devices.
- Video lazy-loaded with posters; no autoplay on Save-Data.

## Hero: A3 · Mark

Chosen on 2026-10-13 from six directions (prototypes in `app/web/prototypes/`, reference
implementation `a3-mark.html` + `field.js` + `hero.js` + `shared.css`).

- **Mark**: ~40K WebGL2 points (12K on mobile) fly from the library cloud into the Crate logo,
  sampled from `logo.svg` by alpha, each point with its own stagger. The mark sits in the upper
  half; the H1, subline and CTA sit centred below it.
- **Cursor**: points near the cursor are pushed away (small local radius) and brighten.
  Fine pointer only.
- **Caption**: mono line under the mark ("48,213 tracks · one library"), fed by the build-time
  scale numbers.
- **Scroll** (sticky, 200vh): the mark dissolves back into the cloud, the camera dives in, the
  copy fades; the field dims to ~16% behind the statement and fades out before the screencast.
- **Production work**: replace synthetic cloud with the bliss sample export (same JSON as the
  Radio/Paths deep-dives) so the dissolve lands on the real library; render loop pauses when
  hidden or off-screen; static PNG of the mark as LCP fallback and reduced-motion state.

## Testing

- Vitest for i18n helpers, download link builder and any island logic.
- Playwright smoke per page (renders, no console errors, reduced-motion path).
- Lighthouse budget check in CI for `/` and `/listen`.

## Launch checklist

- [ ] AGPL-3.0 `LICENSE` in the repo root.
- [ ] Release asset aliases merged and present in the latest release.
- [x] Smart Mix R1 merged and enabled in production; otherwise relabel it "Coming soon".
      Done 2026-10-26: Smart Mix on Android, with Beatmatch and Bass swap, is enabled in
      production and labelled "Available" on `/listen#smart-mix`.
- [ ] `docs/technical/federation-overview.md` updated to match "available".
- [ ] `crate-site` swapped for the `app/web` image; `install.sh` still served at
      `https://cratemusic.app/install.sh`.

## Out of scope

Translations beyond English, a blog, analytics, comparisons, newsletter.

# Paths cover transition

Supersedes the coverflow described in [the 1BC Radio and Paths design](2026-10-20-crate-v3-radio-paths-design.md)
for `/paths/:id`. Builder, list, track list, header, regeneration and deletion are unchanged.

## Decisions (Diego, 2026-10-20)

- The coverflow is retired. Three proposals were reviewed (particle cover, shader transition,
  sound-space constellation) and prototyped with real artwork. The particle "wind" dissolve was
  judged too ostentatious; the approved effect is a **pixelate-blur** transition between covers.
- Tuned values from the prototype: blur 50 %, intensity 1.2, duration 3.0 s.
- The stage only shows the step the queue is playing or was just asked to play. The previous/next
  header buttons were removed: they changed the cover without changing the queue. A real track
  change and a click/Enter that plays use the same transition. No idle animation: nothing moves at
  rest (no BPM "breathing").
- The prototype's data HUD and BPM/energy line are not shipped.

## Layout

`PathCoverJourneyView` keeps its card, header (`MonoLabel` with the track count), readout
(position, title, artist, playing `StatusDot`) and empty state. The coverflow stage becomes:

- **Stage**: one large square cover (`MediaCover`, managed artwork through `renderImage`) centred in
  a band, size `clamp(200px, 56cqw, 400px)`. Behind it a soft radial glow tinted with the cover's
  dominant colour; it eases to the next colour over the transition. The glow honours
  `data-crate-effects="off"` (hidden). The cover keeps the shared media radius.
- **Step strip**: below the readout, origin label · horizontally scrollable row of 48 px cover
  thumbnails with their step number · destination label. A 1 px accent hairline runs from the first
  thumbnail to the playing step (route travelled); the step on stage has the accent border; steps
  before the playing one are dimmed. Narrow containers put the two labels on one row above the strip.
  The strip scrolls itself (`scrollLeft`); it never scrolls the document.

## Interaction

- The strip is the roving-tabindex group formerly owned by the coverflow: ArrowLeft/Right/Home/End
  only move keyboard focus between thumbnails (the stage does not change); click/Enter plays from
  that exact index (`onPlay(index)`) and moves the stage to it; the playing step has
  `aria-current="step"`.
- A real current-track change moves the stage to it; play/pause and list refreshes keep the stage;
  focus follows only when it was already inside the strip. The full track list remains the
  accessible alternative. The canvas is `aria-hidden`; the readout stays `aria-live="polite"`.

## Transition

Each change of the step on stage runs one transition from the cover on stage to the new one:

- The cover coarsens into blocks (each block is the mip-averaged colour of its area), softened by a
  blurred layer (blur 0.5 × coarseness). At the coarsest point the blocks flip to the next cover,
  sweeping from the destination side of travel (forward: right to left; backward: left to right)
  with a little per-block jitter, then the image sharpens. Duration 3 s, linear clock, symmetric
  coarseness curve (smoothstep of a triangle).
- Coarsest block count `clamp(mix(28, 8, jump) / 1.2, 4, 64)`: neighbouring tracks barely
  pixelate, large sonic jumps go chunky.
- `jump` (0–1) uses data already in the path payload: Euclidean distance between the two tracks'
  `bliss_vector`s divided by twice the median consecutive distance of the path; without vectors,
  `hypot(Δenergy, Δvalence, Δdanceability, ΔBPM/120) / 0.55` with missing values neutral (0.5,
  120 BPM). Skipping several steps raises the floor to `(|Δindex| − 1) / 6`. Clamped to 0–1.
- Interruption: a new change during a transition does not snap. The cover currently dominant
  (`t < 0.5` → origin, else target) becomes the new origin, the new transition starts at
  `min(t, 1 − t)` and keeps the running peak, so the mosaic grain is continuous and resolves to
  the newest step.
- A distant step whose cover is still decoding holds the current cover for up to 250 ms, then
  transitions; if it is still not ready, it falls back to the fade.

## Rendering

- Rest state is the HTML `MediaCover`. A WebGL2 canvas (one full-quad program, two textures)
  overlays the cover only while a transition runs; there is no frame loop at rest.
- The renderer lives in its own module loaded with a dynamic import on first use (separate chunk,
  asserted in `AppRouter.bundle.test.tsx`). DPR capped at 2, size from `ResizeObserver`,
  `webglcontextlost` → fallback until `webglcontextrestored`, `WEBGL_lose_context` on unmount.
- Textures: the view receives an optional `loadCover(url)` returning an `ImageBitmap`. Listen
  passes a loader that resolves `ensureMediaAccessUrl(url, "artwork")`, fetches the blob (same CORS
  path as every API call, so web, Capacitor and Tauri textures are never tainted) and decodes a
  centre-cropped 512 px bitmap. Review hosts pass a plain fetch of their fixture artwork. Bitmaps
  for the inspected step ±2 are preloaded; at most 8 are cached and evicted bitmaps are closed.
- Fallbacks: no `loadCover`, no WebGL2, context lost, or either texture unavailable (missing
  artwork, failed load, not yet decoded) → CSS fade-in of the new cover (240 ms).
  `data-crate-effects="off"` → CSS fade-in, no glow. Motion blocked (reduced motion, hidden
  document, `data-crate-motion="reduced"`) → instant swap; a running transition finishes at once.

## Files (Listen-local, `app/listen/src/components/paths/`)

- `path-cover-journey-model.ts`: steps (now carrying bliss vector and features), `pathStepJump`,
  `peakCells`, `transitionDirection`, `retargetTransition`, `coverPreloadWindow`. Coverflow window
  helper removed.
- `path-cover-transition-renderer.ts`: WebGL2 renderer (shader + lifecycle).
- `path-cover-textures.ts`: Listen loader, bitmap cache and dominant colour.
- `PathCoverStage.tsx`: cover, glow, canvas overlay, renderer/texture orchestration.
- `PathStepStrip.tsx`: thumbnail strip with the roving group.
- `PathCoverJourneyView.tsx`, `PathCoverJourney.tsx`, `path-cover-journey.css`: integration;
  coverflow styles removed.
- Review hosts (`RadioPathsReview.tsx`, Storybook story) pass a fixture `loadCover`.

## Tests

- Model: jump from vectors, feature fallback, neutral defaults, index floor, clamp; peak cells;
  direction; retarget continuity; preload window bounds.
- View: inspection without playing, click/Enter plays, `aria-current`, keyboard bounds and focus
  rules (ported from the coverflow tests), strip progress, reduced motion swaps instantly, empty and
  single-step paths, missing artwork.
- Stage with a mocked renderer and loader: transition parameters (direction, peak, 3 s), retarget
  on interruption, CSS fallback without textures/WebGL, effects off, context loss, cleanup.
- Textures: centre crop, cache eviction closes bitmaps, failed loads resolve to `null`.
- `TEST_GAP`: shader output is not observable in jsdom; covered by the review Playwright spec at
  375/1200 px (no running animation at rest, transition canvas only while transitioning).

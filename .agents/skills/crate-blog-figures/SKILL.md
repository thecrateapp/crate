---
name: crate-blog-figures
description: Use when creating, redesigning or reviewing an interactive figure, diagram or animation for a Crate engineering-blog post in app/web — a `data-blog-visual` marker, a `visuals:` frontmatter entry, or a component in `src/components/blog-viz/`.
---

# Crate blog figures

## Overview

A blog figure shows **one mechanism in motion** and still reads as a single frame. It uses the visual
language of the site's own visualizations — the home page "Inside Crate" mix, Admin's enrichment
orbit, Listen's federation graph — and is built on a shared kit. You write a pure model, a scene and a
render function; the kit supplies the frame, the phase loop, the version switch, reduced motion and
cleanup. `docs/technical/engineering-blog.md` ("Interactive figures") lists every figure and its state.

Read the reference implementations before starting (paths under `app/web/src/`):

| Figure                 | Family                  | Files                                                                                             |
| ---------------------- | ----------------------- | ------------------------------------------------------------------------------------------------- |
| Connect handoff (H17)  | nodes + moving messages | `components/blog-viz/ConnectHandoff.astro`, `scripts/viz/blog/connect.ts`, `connect-view.ts`      |
| Crossfade engine (H19) | lanes on a time axis    | `components/blog-viz/CrossfadeEngine.astro`, `scripts/viz/blog/crossfade.ts`, `crossfade-view.ts` |
| Kit                    | frame + loop            | `components/blog-viz/BlogFigure.astro`, `scripts/viz/blog/phase-clock.ts`, `phase-loop.ts`        |

## The figure contract

A figure is exactly these parts, in this order:

1. **Label bar** (`BlogFigure` props): `label` in cyan (one or two words), `context` in mono
   (`phone → desktop`), a `states` switch for a transformation (see below), and `example` when the
   sequence or values are illustrative.
2. **Scene**: the mechanism at full width. Graphs and time axes are one SVG with HTML labels
   positioned in % over it; lane and row families (queues, ranked candidates) can be HTML lanes
   with small SVG parts, as WorkersAdmission and RadioRotation are, so their text never shrinks.
   Real names and constants from the code the article cites. SVG text shrinks with the viewBox:
   a label that travels inside an SVG (a message pill) is enlarged at ≤ 760 px, as
   ConnectHandoff's `.cn-pill` is.
3. **Readouts** (`slot="readout"`, `dl.bf-readout`): three or four values in display type.
   `data-tone="warn"` (amber) marks the failure, `data-tone="ok"` (cyan) the fix.
4. **Phase strip** (`states[].phases`): three or four phases, a one-to-three-word title and one
   sentence each. Backticks mark identifiers. Each track loops in 8–10 seconds.
5. **Caption**: one line of provenance.

The article's prose explains; the figure shows. The figure's own text is the label bar, the scene
labels, the readouts, the phase sentences and the caption.

**Switch.** Give the figure `states` when the article compares versions that the cited commits
identify, and use one scene for all of them so the reader sees what changes. When a "before" frame
would credit a change to the wrong commit, use a single state.

## Behaviour the kit provides

- Loops while visible; the active phase's line fills with progress.
- Clicking a phase pins it; clicking it again resumes. The switch restarts the selected track.
- Reduced motion shows the end of the track without looping; pins still work.
- Without JavaScript the server-rendered frame and every phase are readable.
- Astro navigation disposes the loop through `initViz`.

## Choosing the scene

| The mechanism is about…                               | Blog figure                         | Site reference (styling only)                      | Primitives                                                                                                      |
| ----------------------------------------------------- | ----------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| messages between devices or processes, ownership      | ConnectHandoff, MusicPathJourney    | `viz/Federation.astro`                             | nodes, dotted edges, labelled pill packets moving along edges, cyan halo on the owner, amber arc for a deadline |
| something unfolding in time (audio, fades, schedules) | CrossfadeEngine, SmartMixCandidates | `inside/MixTeaser.astro`                           | lanes on a shared time axis, lit-over-dim clip reveal, playhead, hatched amber interval for the problem         |
| queues, admission, capacity                           | WorkersAdmission                    | `viz/QueueLanes.astro`, `viz/GovernorGauges.astro` | lanes with task pills moving queued → running → done, gauges with a threshold tick                              |
| several sources merging into one record               | EnrichmentJourney                   | `viz/EnrichmentOrbit.astro`                        | radial sources around a record, worker lanes                                                                    |
| many items checked or classified                      | RadioRotation                       | `viz/HealthScan.astro`, `viz/RedisPair.astro`      | rows or tile grids with a state colour                                                                          |

The site components and their `src/content/*/viz.ts` data describe today's product. Copy their
styling into the figure's own scene; take values from the commit the article cites.

## Implementation

1. **Model** `src/scripts/viz/blog/<name>.ts` (pure, shared by server and client):
   `<NAME>_STATES` (id, label, phases), `<NAME>_TRACKS` (`PhaseTrack`: `period`, `starts`, `pins`),
   `<name>Frame(state, t)` returning everything visible, and a readout function. Comment the commit
   the constants come from. Reuse `barsPath`, `ticksPath`, `columnTimes` (`viz/inside-math.ts`) and
   `waveLevels` (`viz/mix-math.ts`) for audio.
2. **Model test** `<name>.test.ts`: one start per phase of copy, then the article's claims as
   assertions ("v1 plays both devices before the phone stops").
3. **Component** `src/components/blog-viz/<Name>.astro`: `<BlogFigure viz="blog-<name>" …>`, scene
   in the default slot, readouts in `slot="readout"`. Render the server frame from the model at the
   most telling moment. State-specific styles: `:global(.bf[data-state="x"]) .part`.
4. **View** `src/scripts/viz/blog/<name>-view.ts`: query elements once, return
   `initPhaseLoop(root, { tracks, initial, render })`; `render` writes attributes and text only.
   Add a `TEST_GAP:` comment pointing at the model test and the e2e spec.
5. **Wiring**: `"blog-<name>"` in `src/scripts/viz/index.ts`; the name in the `visuals` enum of
   `src/content.config.ts`; a slot in `src/pages/blog/[slug].astro`; `visuals: [<name>]` and
   `<div data-blog-visual="<name>"></div>` in the post. Rewrite the sentence that introduces the
   figure so it describes what the figure shows, naming the switch labels when it has a switch.
6. **e2e** `e2e/blog-<name>.spec.ts`: readable without JS; pin each telling phase and assert the
   readouts; the switch, when there is one; the loop advances; reduced motion shows the end; the
   figure fits a 390 px viewport (see the last test in `e2e/blog-connect.spec.ts`).
7. **Retire** the figure it replaces: the earlier figures live in `src/components/blog-viz/` with
   `src/scripts/blog-viz/<name>-model.ts`, `<name>-controller.ts` and their tests. Keeping the
   component file name and the `visuals` name is fine. Update the figure table in
   `docs/technical/engineering-blog.md`.
8. **Check** desktop and 390 px screenshots of every pinned phase before calling it done.

## Common mistakes

| Symptom                                                             | Fix                                                                                                                             |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| A pinned phase shows the result after the message has arrived       | Set `pins[i]` to the moment that shows the mechanism                                                                            |
| `code` in a phase gets a bordered box, labels get paragraph margins | Prose rules outrank scoped styles; the kit resets under `.prose .bf`; match that specificity for new elements                   |
| The figure overflows at 390 px                                      | Don't combine `aspect-ratio` with `min-height`; anchor edge labels inward                                                       |
| A label near the right edge wraps into many lines on mobile         | An absolute label at `left: 84%` shrinks to the space on its right; give it a fixed width (ConnectHandoff's `.cn-device-label`) |
| Reduced motion shows a mid-transition state                         | The kit shows the end of the track; keep that state meaningful                                                                  |
| A large JSON fixture ships to the browser                           | Server-render from it; pass the client only what `render` needs                                                                 |
| Placeholder data ("Artist 1", "Repair #41") or decorative art       | Use names and constants from the cited code; every shape stands for something in the mechanism                                  |

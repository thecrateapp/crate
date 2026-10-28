# 1AZ — Listen player, queue and UI clocks

Base81665c5c (1AY approved and pushed). Reference: approved5186mockup and Diego's amendments,
original design-system §5.14 and Listen implementation-plan1AZ. Three persistent instances remain
5186/6006/5174. Stop uncommitted at1AZ; no PR/merge/deploy/release.

## Tasks and interfaces

1. Reconcile actual Bar/Fullscreen/Extended/Queue chrome and conventional actions with the
   existing solid surfaces, ActionButton, MonoLabel and text Tabs. Keep glyphs, specialized
   SpectrumPlayButton/aura, real48px artwork, remote/locked/offline/buffer gates, safe areas and
   the established thin beam/head geometry. Native seek uses the same scrubbing model everywhere.
2. B24: stable progress snapshots for controllers, leaf progress subscriptions, ref-backed
   analyser sampling/drawing without array state, and one crossfade UI clock updating refs/CSS.
   Preserve remote projection, output target handoff, resume/sleep and lazy EQ/visualizer boundaries.
3. Complete changed shared entries before editing (PlayButton if changed; no speculative EqBands
   extension). Add actual app-local visual contracts and a single scene reused in Storybook and
   review-1az-player.html. Local fixture data/clock only; no production API/preference writes.
4. Focused serial tests and browser checks (desktop/mobile, seeking forward/reverse/keyboard,
   beam/head alignment, volume, disabled/buffering/remote/empty/long queue, tabs/focus), affected
   typechecks/lint/builds/bundles. Fresh source reviewer, one fix pass for confirmed Important/
   Critical findings, ledger decisions, then stop for Diego before commit/push.

Task1 visual slots are consumed by task3. Task2 clocks feed the same production seek/artwork
leaves and never create a second playback engine. Tests cover real provider rerender boundaries.
No synthetic waveform/loudness data; fixture shows static artwork when there is no analyser.
The expanded EQ glyph/chain remains its approved H3 phase; existing EQ continues working.

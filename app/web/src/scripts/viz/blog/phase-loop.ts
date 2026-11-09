import { reducedMotion } from "../../motion/env";
import type { Cleanup } from "../../motion/page";
import { visibleLoop } from "../loop";
import { createPhaseClock, type PhaseTrack } from "./phase-clock";

export interface PhaseFrame {
  state: string;
  time: number;
  phase: number;
  progress: number;
  pinned: number | null;
  /** Seconds the figure has been animating; drives idle movement. */
  ambient: number;
}

type Loop = (
  element: Element,
  frame: (time: number, dt: number) => void,
) => { cleanup: Cleanup };

export interface PhaseLoopOptions {
  tracks: Readonly<Record<string, PhaseTrack>>;
  initial: string;
  render: (frame: PhaseFrame) => void;
  still?: boolean;
  loop?: Loop;
}

/**
 * Runs a BlogFigure: loops while visible, lets the phase list pin a phase and
 * the switch select a track. Reduced motion shows each track's final phase.
 */
export function initPhaseLoop(
  root: HTMLElement,
  {
    tracks,
    initial,
    render,
    still = reducedMotion(),
    loop = visibleLoop,
  }: PhaseLoopOptions,
): Cleanup {
  const clock = createPhaseClock(tracks, root.dataset.state ?? initial, {
    still,
  });
  const switches = [
    ...root.querySelectorAll<HTMLButtonElement>("[data-bf-state]"),
  ];
  const lists = [...root.querySelectorAll<HTMLElement>("[data-bf-phases]")];
  const abort = new AbortController();
  let ambient = 0;
  let shown = "";

  const syncControls = () => {
    const key = `${clock.state}:${clock.phase}:${clock.pinned}`;
    if (key === shown) return;
    shown = key;
    root.dataset.state = clock.state;
    root.dataset.phase = String(clock.phase);
    root.dataset.pinned = clock.pinned === null ? "" : String(clock.pinned);
    for (const button of switches)
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.bfState === clock.state),
      );
    for (const list of lists) {
      const active = list.dataset.bfPhases === clock.state;
      list.hidden = !active;
      if (!active) continue;
      list
        .querySelectorAll<HTMLButtonElement>("[data-bf-phase]")
        .forEach((button, i) => {
          const item = button.closest("li");
          item?.classList.toggle("is-active", i === clock.phase);
          item?.classList.toggle("is-done", i < clock.phase);
          button.setAttribute("aria-pressed", String(clock.pinned === i));
        });
    }
  };

  const draw = () => {
    syncControls();
    root.style.setProperty("--bf-progress", clock.progress.toFixed(3));
    render({
      state: clock.state,
      time: clock.time,
      phase: clock.phase,
      progress: clock.progress,
      pinned: clock.pinned,
      ambient,
    });
  };

  root.addEventListener(
    "click",
    (event) => {
      const target = event.target as Element | null;
      const phase = target?.closest<HTMLElement>("[data-bf-phase]");
      const state = target?.closest<HTMLElement>("[data-bf-state]");
      if (phase) clock.pin(Number(phase.dataset.bfPhase));
      else if (state?.dataset.bfState) clock.select(state.dataset.bfState);
      else return;
      draw();
    },
    { signal: abort.signal },
  );

  draw();
  root.dataset.ready = "true";
  const running = still
    ? null
    : loop(root, (_time, dt) => {
        ambient += dt;
        clock.advance(dt);
        draw();
      });

  return () => {
    abort.abort();
    running?.cleanup();
  };
}

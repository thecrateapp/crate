import { reducedMotion } from "../motion/env";
import type { Cleanup } from "../motion/page";
import { visibleLoop } from "./loop";

const PERIOD = 9.2;

type Phase = "descriptor" | "signed" | "approved" | "grant" | "relay" | "done";

const PHASES: [number, Phase, number][] = [
  [0, "descriptor", 0],
  [1.4, "signed", 0],
  [2.5, "approved", 1],
  [3.7, "grant", 2],
  [4.9, "relay", 3],
  [7.7, "done", 3],
];

interface Point {
  x: number;
  y: number;
}

const ease = (t: number) => {
  const k = Math.min(1, Math.max(0, t));
  return k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2;
};

const along = (a: Point, b: Point, t: number): Point => ({
  x: a.x + (b.x - a.x) * ease(t),
  y: a.y + (b.y - a.y) * ease(t),
});

function position(element: SVGElement | null, point: Point, visible: boolean) {
  if (!element) return;
  element.setAttribute(
    "transform",
    `translate(${point.x.toFixed(1)} ${point.y.toFixed(1)})`,
  );
  element.style.opacity = visible ? "1" : "0";
}

function node(root: HTMLElement, id: string): Point {
  const element = root.querySelector<SVGElement>(`[data-node="${id}"]`);
  return {
    x: Number(element?.dataset.x ?? 0),
    y: Number(element?.dataset.y ?? 0),
  };
}

export function initFederation(root: HTMLElement): Cleanup {
  const steps = [...root.querySelectorAll<HTMLElement>("[data-fed-step]")];
  const descriptor = root.querySelector<SVGGElement>(
    "[data-packet='descriptor']",
  );
  const track = root.querySelector<SVGGElement>("[data-packet='track']");
  const trackLabel = root.querySelector<SVGTextElement>("[data-packet-label]");
  const deltas = [
    ...root.querySelectorAll<SVGGElement>("[data-packet='delta']"),
  ];
  const club = node(root, "club");
  const yours = node(root, "yours");
  const listener = node(root, "listener");
  const peers = [node(root, "north"), node(root, "basement")];
  let shownPhase: Phase | null = null;
  let shownLabel = "";

  function setPhase(phase: Phase, step: number) {
    if (phase === shownPhase) return;
    shownPhase = phase;
    root.dataset.phase = phase;
    steps.forEach((element, i) => {
      element.classList.toggle("is-active", i === step);
      element.classList.toggle("is-done", i < step || phase === "done");
    });
  }

  if (reducedMotion()) {
    setPhase("done", 3);
    [descriptor, track, ...deltas].forEach(
      (element) => element && (element.style.opacity = "0"),
    );
    return () => {};
  }

  let clock = 0;
  const loop = visibleLoop(
    root,
    (_, dt) => {
      clock = (clock + dt) % PERIOD;
      const t = clock;
      const current = [...PHASES].reverse().find(([start]) => t >= start)!;
      setPhase(current[1], current[2]);
      position(descriptor, along(club, yours, t / 1.3), t < 1.35);
      let label = "stream";
      if (t >= 4.9 && t < 6.1)
        position(track, along(club, yours, (t - 4.9) / 1.2), true);
      else if (t >= 6.1 && t < 6.5) position(track, yours, true);
      else if (t >= 6.5 && t < 7.6) {
        label = "ticket";
        position(track, along(yours, listener, (t - 6.5) / 1.1), true);
      } else position(track, yours, false);
      if (t >= 6.1) label = "ticket";
      if (label !== shownLabel && trackLabel) {
        shownLabel = label;
        trackLabel.textContent = label;
      }
      deltas.forEach((delta, i) => {
        const local = (t + i * 1.7) % 3.4;
        position(
          delta,
          along(peers[i % peers.length]!, yours, local / 1.6),
          local < 1.6,
        );
      });
    },
    { onFirstVisible: () => (clock = 0) },
  );

  return () => loop.cleanup();
}

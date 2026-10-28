import { reducedMotion } from "../motion/env";
import type { Cleanup } from "../motion/page";
import { visibleLoop } from "./loop";

const UNIT = 1.15;
const FAR_STEP = 0.32;
const HOLD = 2.8;

export function initEnrichment(root: HTMLElement): Cleanup {
  const jobs = [...root.querySelectorAll<HTMLElement>("[data-job]")].map(
    (element) => {
      const id = element.dataset.job!;
      return {
        element,
        start: Number(element.dataset.start) * UNIT,
        end: Number(element.dataset.end) * UNIT,
        link: root.querySelector<SVGLineElement>(`[data-link="${id}"]`),
        node: root.querySelector<SVGCircleElement>(`[data-node="${id}"]`),
        packet: root.querySelector<SVGCircleElement>(`[data-packet="${id}"]`),
      };
    },
  );
  const farLinks = [...root.querySelectorAll<SVGLineElement>("[data-far]")];
  const farNodes = [
    ...root.querySelectorAll<SVGCircleElement>("[data-far-node]"),
  ];
  const heads = [...root.querySelectorAll<HTMLElement>("[data-pool-head]")];
  if (!jobs.length || reducedMotion()) return () => {};
  const span = Number(root.dataset.span) * UNIT;
  const farEnd = span + farLinks.length * FAR_STEP;
  const cycle = farEnd + HOLD;
  const state = new Map<Element, string>();
  let clock = 0;
  let pulseUntil = 0;

  const set = (element: Element | null, value: string, apply: () => void) => {
    if (!element || state.get(element) === value) return;
    state.set(element, value);
    apply();
  };

  const render = (t: number) => {
    jobs.forEach((job) => {
      const phase = t < job.start ? "wait" : t < job.end ? "run" : "done";
      const progress = Math.min(
        1,
        Math.max(0, (t - job.start) / (job.end - job.start)),
      );
      set(
        job.element,
        phase === "run" ? `run${progress.toFixed(2)}` : phase,
        () => {
          job.element.classList.toggle("is-done", phase === "done");
          job.element.style.setProperty(
            "--fill",
            `${(phase === "wait" ? 0 : progress * 100).toFixed(1)}%`,
          );
        },
      );
      set(job.link, phase, () =>
        job.link!.classList.toggle("is-on", phase !== "wait"),
      );
      set(job.node, phase, () => {
        job.node!.classList.toggle("is-active", phase === "run");
        job.node!.classList.toggle("is-done", phase === "done");
        if (phase === "done" && t - job.end < 0.1) {
          root.classList.remove("is-pulse");
          void root.offsetWidth;
          root.classList.add("is-pulse");
          pulseUntil = t + 0.9;
        }
      });
      if (job.packet) {
        const x1 = Number(job.link?.getAttribute("x1"));
        const y1 = Number(job.link?.getAttribute("y1"));
        const cx = Number(job.link?.getAttribute("x2"));
        const cy = Number(job.link?.getAttribute("y2"));
        const k = phase === "run" ? progress : 0;
        job.packet.setAttribute("cx", (x1 + (cx - x1) * k).toFixed(1));
        job.packet.setAttribute("cy", (y1 + (cy - y1) * k).toFixed(1));
        job.packet.style.opacity = phase === "run" ? "1" : "0";
      }
    });
    farLinks.forEach((link, i) => {
      const on = t >= span + i * FAR_STEP;
      set(link, String(on), () => link.classList.toggle("is-on", on));
      set(farNodes[i]!, String(on), () =>
        farNodes[i]!.classList.toggle("is-done", on),
      );
    });
    heads.forEach((head) => {
      head.style.transform = `translateX(${(
        Math.min(1, t / span) * (head.parentElement?.clientWidth ?? 0)
      ).toFixed(1)}px)`;
    });
    if (t > pulseUntil) root.classList.remove("is-pulse");
  };

  const loop = visibleLoop(
    root,
    (_, dt) => {
      clock = (clock + dt) % cycle;
      if (clock < dt) pulseUntil = 0;
      root.classList.add("is-running");
      render(clock);
    },
    { onFirstVisible: () => (clock = 0) },
  );

  return () => {
    loop.cleanup();
    root.classList.remove("is-running", "is-pulse");
    render(cycle);
  };
}

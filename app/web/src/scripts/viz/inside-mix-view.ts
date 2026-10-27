// TEST_GAP: ScrollTrigger and SVG rendering need a real browser; the geometry and readouts are covered in inside-math.test.ts and the view is checked in the Playwright viz specs.
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { MIX } from "../../content/listen/viz";
import { reducedMotion } from "../motion/env";
import type { Cleanup } from "../motion/page";
import { mixReadout, type MixReadout } from "./inside-math";
import { incoming, PLAN, toX, TRIM } from "./inside-mix";
import { visibleLoop } from "./loop";
import { storyAt } from "./mix-math";

gsap.registerPlugin(ScrollTrigger);

export function initInsideMix(root: HTMLElement): Cleanup {
  if (reducedMotion()) return () => {};
  const clip = root.querySelector<SVGRectElement>("[data-mx-clip]");
  const head = root.querySelector<SVGLineElement>("[data-mx-head]");
  const part = (name: string) =>
    root.querySelector<SVGPathElement>(`[data-mx="${name}"]`);
  const b = {
    beat: part("b-beat"),
    down: part("b-down"),
    muted: part("b-muted"),
    dim: part("b-dim"),
    lit: part("b-lit"),
  };
  const spans = [...root.querySelectorAll<HTMLElement>("[data-mx-stage]")];
  const outputs = Object.fromEntries(
    [...root.querySelectorAll<HTMLElement>("[data-ro]")].map((node) => [
      node.dataset.ro,
      node,
    ]),
  ) as Partial<Record<keyof MixReadout, HTMLElement>>;
  if (!clip || !head) return () => {};

  let builtLock = -1;
  let stage = -1;
  let current = 0;
  let target = 0;
  const shown: Partial<MixReadout> = {};

  const render = (p: number) => {
    const frame = storyAt(PLAN, p);
    const lock = Math.round(frame.lock * 100) / 100;
    if (lock !== builtLock) {
      builtLock = lock;
      const next = incoming(lock);
      b.beat?.setAttribute("d", next.ticks.beat);
      b.down?.setAttribute("d", next.ticks.down);
      b.muted?.setAttribute("d", next.muted);
      b.dim?.setAttribute("d", next.wave);
      b.lit?.setAttribute("d", next.wave);
    }
    const x = toX(frame.time).toFixed(1);
    clip.setAttribute("width", x);
    head.setAttribute("x1", x);
    head.setAttribute("x2", x);
    const readout = mixReadout(
      PLAN,
      frame.time,
      frame.lock,
      MIX.b.looseOffsetMs,
      TRIM,
    );
    for (const key of Object.keys(readout) as (keyof MixReadout)[]) {
      if (shown[key] === readout[key]) continue;
      shown[key] = readout[key];
      const node = outputs[key];
      if (node) node.textContent = readout[key];
    }
    if (frame.stage !== stage) {
      stage = frame.stage;
      spans.forEach((span, i) => span.classList.toggle("is-on", i === stage));
    }
  };

  root.classList.add("is-running");
  const trigger = ScrollTrigger.create({
    trigger: root,
    start: "top 88%",
    end: "bottom 28%",
    onUpdate: (self) => (target = self.progress),
    onRefresh: (self) => (target = self.progress),
  });
  target = trigger.progress;
  current = target;
  render(current);

  const loop = visibleLoop(root, (_, dt) => {
    if (current === target) return;
    current += (target - current) * Math.min(1, dt * 8);
    if (Math.abs(target - current) < 0.0005) current = target;
    render(current);
  });

  return () => {
    loop.cleanup();
    trigger.kill();
    root.classList.remove("is-running");
  };
}

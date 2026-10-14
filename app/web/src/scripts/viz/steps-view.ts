import { typedAt } from "../../lib/json-lines";
import { reducedMotion } from "../motion/env";
import type { Cleanup } from "../motion/page";
import { visibleLoop } from "./loop";

const TYPE_RATE = 60;
const HOLD = 3;

export function initSteps(root: HTMLElement): Cleanup {
  const steps = [...root.querySelectorAll<HTMLElement>("[data-step]")];
  if (!steps.length || reducedMotion()) return () => {};
  const rate = Number(root.dataset.stepRate ?? 0.9);
  const typed = steps.map((step) =>
    [...step.querySelectorAll<HTMLElement>("[data-type]")].map((element) => ({
      element,
      text: element.textContent ?? "",
    })),
  );
  const cycle = steps.length * rate + HOLD;
  let clock = 0;
  let shown = -2;

  const render = (t: number) => {
    const active = Math.min(steps.length, Math.floor(t / rate));
    if (active !== shown) {
      shown = active;
      steps.forEach((step, i) => {
        step.classList.toggle("is-on", i === active);
        step.classList.toggle("is-done", i < active);
      });
    }
    typed.forEach((items, i) =>
      items.forEach(({ element, text }) => {
        const next =
          i < active
            ? text
            : i > active
              ? ""
              : typedAt(text, t - i * rate, TYPE_RATE);
        if (element.textContent !== next) element.textContent = next;
      }),
    );
  };

  const loop = visibleLoop(
    root,
    (_, dt) => {
      clock = (clock + dt) % cycle;
      root.classList.add("is-running");
      render(clock);
    },
    { onFirstVisible: () => (clock = 0) },
  );

  return () => {
    loop.cleanup();
    root.classList.remove("is-running");
    render(cycle);
    steps.forEach((step) => step.classList.remove("is-on"));
  };
}

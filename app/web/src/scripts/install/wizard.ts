// TEST_GAP: scroll position and layout do not exist in jsdom; the step rail is checked in e2e/install.spec.ts.
import type { Cleanup } from "../motion/page";
import { activeStep, railProgress } from "./progress";

export function initWizardRail(root: HTMLElement): Cleanup {
  const steps = [...root.querySelectorAll<HTMLElement>("[data-step]")];
  let frame = 0;
  let shown = -2;

  const update = () => {
    frame = 0;
    const probe = innerHeight * 0.55;
    const rail = root.getBoundingClientRect();
    root.style.setProperty("--p", railProgress(rail, probe).toFixed(4));
    const active = activeStep(
      steps.map((step) => step.getBoundingClientRect()),
      probe,
    );
    if (active === shown) return;
    shown = active;
    steps.forEach((step, index) => {
      step.classList.toggle("is-active", index === active);
      step.classList.toggle("is-done", index < active);
    });
  };

  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(update);
  };

  root.classList.add("is-live");
  update();
  addEventListener("scroll", schedule, { passive: true });
  addEventListener("resize", schedule);

  return () => {
    cancelAnimationFrame(frame);
    removeEventListener("scroll", schedule);
    removeEventListener("resize", schedule);
    root.classList.remove("is-live");
  };
}

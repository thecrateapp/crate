import { reducedMotion } from "../motion/env";
import type { Cleanup } from "../motion/page";
import { scrambleText } from "../motion/scramble";
import { visibleLoop } from "./loop";

const DURATIONS = [3, 1.4, 2.6, 3, 1.8];
const HOLD = 2.6;
const LEAD_DAYS = 24;

export function initRelease(root: HTMLElement): Cleanup {
  const rail = root.querySelector<HTMLElement>(".rail");
  const stages = [...root.querySelectorAll<HTMLElement>("[data-stage]")];
  const clock = root.querySelector<HTMLElement>("[data-release-clock]");
  const now = root.querySelector<HTMLElement>("[data-release-now]");
  const task = root.querySelector<HTMLElement>("[data-release-task]");
  if (!rail || stages.length !== DURATIONS.length || reducedMotion())
    return () => {};
  const steps = stages.map((stage) => [
    ...stage.querySelectorAll<HTMLElement>(".steps li"),
  ]);
  const titles = stages.map(
    (stage) =>
      stage
        .querySelector(".viz-label")
        ?.textContent?.replace(/^\s*\d+\s*/, "")
        .trim() ?? "",
  );
  const tasks = stages.map(
    (stage) => stage.querySelector("code")?.textContent ?? "",
  );
  const starts = DURATIONS.map((_, i) =>
    DURATIONS.slice(0, i).reduce((a, b) => a + b, 0),
  );
  const total = starts[starts.length - 1]! + DURATIONS[DURATIONS.length - 1]!;
  const cycle = total + HOLD;
  const finalClock = clock?.textContent ?? "";
  let time = 0;
  let shownStage = -2;
  let shownClock = "";
  const shownSteps = new Map<HTMLElement, string>();

  const setStep = (element: HTMLElement, state: string) => {
    if (shownSteps.get(element) === state) return;
    shownSteps.set(element, state);
    element.classList.toggle("is-done", state === "done");
    element.classList.toggle("is-active", state === "active");
  };

  const setClock = (text: string) => {
    if (!clock || text === shownClock) return;
    shownClock = text;
    clock.textContent = text;
  };

  const render = (t: number) => {
    const done = t >= total;
    const index = done
      ? stages.length - 1
      : starts.findLastIndex((start) => t >= start);
    const progress = done ? 1 : (t - starts[index]!) / DURATIONS[index]!;
    if (index !== shownStage) {
      shownStage = index;
      stages.forEach((stage, i) => {
        stage.classList.toggle("is-done", i < index || done);
        stage.classList.toggle("is-active", i === index && !done);
      });
      if (now) scrambleText(now, titles[index]!, { durationMs: 380 });
      if (task) task.textContent = tasks[index]!;
    }
    steps.forEach((list, i) =>
      list.forEach((step, j) => {
        if (i < index || done) return setStep(step, "done");
        if (i > index) return setStep(step, "");
        const at = progress * list.length;
        setStep(
          step,
          j < Math.floor(at) ? "done" : j === Math.floor(at) ? "active" : "",
        );
      }),
    );
    rail.style.setProperty(
      "--p",
      Math.min(1, (index + progress) / (stages.length - 1)).toFixed(3),
    );
    if (index === 0)
      setClock(
        `T−${Math.max(1, LEAD_DAYS - Math.floor(progress * LEAD_DAYS))} d`,
      );
    else setClock(finalClock);
  };

  const loop = visibleLoop(
    root,
    (_, dt) => {
      time = (time + dt) % cycle;
      render(time);
    },
    { onFirstVisible: () => (time = 0) },
  );

  return () => {
    loop.cleanup();
    render(total);
    setClock(finalClock);
  };
}

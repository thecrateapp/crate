import { GOVERNOR } from "../../content/admin/viz";
import { reducedMotion } from "../motion/env";
import type { Cleanup } from "../motion/page";
import {
  evaluateGovernor,
  governorSnapshot,
  type Snapshot,
} from "./governor-math";
import { visibleLoop } from "./loop";

export const GOVERNOR_PERIOD = 11;

export function gaugeRenderer(root: HTMLElement) {
  const gauges = [...root.querySelectorAll<HTMLElement>("[data-gauge]")].map(
    (element) => ({
      element,
      key: element.dataset.gauge as keyof Snapshot,
      max: Number(element.dataset.max),
      limit: Number(element.dataset.limit),
      digits: Number(element.dataset.digits),
      unit: element.dataset.unit ?? "",
      output: element.querySelector("output"),
      shown: "",
      over: false,
    }),
  );
  const status = root.querySelector<HTMLElement>("[data-governor-status]");
  let statusShown = "";

  return (snapshot: Snapshot): string[] => {
    const reasons = evaluateGovernor(snapshot, GOVERNOR);
    for (const gauge of gauges) {
      const value = snapshot[gauge.key];
      gauge.element.style.setProperty(
        "--v",
        Math.min(1, value / gauge.max).toFixed(3),
      );
      const text = `${value.toFixed(gauge.digits)}${gauge.unit}`;
      if (text !== gauge.shown && gauge.output) {
        gauge.shown = text;
        gauge.output.textContent = text;
      }
      const over =
        gauge.key === "swapUsedPercent"
          ? reasons.some((reason) => reason.startsWith("swap"))
          : value > gauge.limit;
      if (over !== gauge.over) {
        gauge.over = over;
        gauge.element.classList.toggle("is-over", over);
      }
    }
    const text = reasons.length
      ? `Deferring governed work · ${reasons.join(" · ")} · retry in ${
          GOVERNOR.deferSeconds
        } s`
      : "Allowed · background work runs";
    if (status && text !== statusShown) {
      statusShown = text;
      status.textContent = text;
      status.classList.toggle("is-blocked", reasons.length > 0);
    }
    return reasons;
  };
}

export function initGovernor(root: HTMLElement): Cleanup {
  if (reducedMotion()) return () => {};
  const render = gaugeRenderer(root);
  let clock = 0;
  const loop = visibleLoop(root, (_, dt) => {
    clock = (clock + dt) % GOVERNOR_PERIOD;
    render(governorSnapshot(clock / GOVERNOR_PERIOD));
  });
  return () => {
    loop.cleanup();
    render(governorSnapshot(0));
  };
}

import { EQ_CYCLE, EQ_PRESETS } from "../../content/listen/viz";
import { reducedMotion } from "../motion/env";
import type { Cleanup } from "../motion/page";
import {
  bandPoints,
  nextInCycle,
  smoothPath,
  stepSpring,
  type Spring,
} from "./eq-math";
import { visibleLoop } from "./loop";

const EQ_DWELL = 2.2;
const ROUTE_TIME = 3;
const ROUTE_HOLD = 1.6;
const HOUR_STEP = 0.22;
const SCAN_STEP = 0.14;

export function initInside(root: HTMLElement): Cleanup {
  if (reducedMotion()) return () => {};
  const eqPaths = [...root.querySelectorAll<SVGPathElement>("[data-eq-path]")];
  const eqName = root.querySelector<HTMLElement>("[data-eq-name]");
  const route = root.querySelector<SVGPathElement>("[data-route]");
  const hops = [...root.querySelectorAll<SVGGElement>("[data-hop]")];
  const hours = [...root.querySelectorAll<HTMLElement>("[data-hour]")];
  const rows = [...root.querySelectorAll<HTMLElement>(".rows i")];
  let preset = EQ_CYCLE[0]!;
  let springs: Spring[] = EQ_PRESETS[preset]!.map((value) => ({
    value,
    velocity: 0,
  }));
  let eqClock = 0;
  let clock = 0;
  let hour = -1;
  let scan = -1;
  let lit = -1;

  const loop = visibleLoop(root, (_, dt) => {
    clock += dt;
    eqClock += dt;
    if (eqClock >= EQ_DWELL) {
      eqClock = 0;
      preset = nextInCycle(EQ_CYCLE, preset);
      if (eqName) eqName.textContent = preset.replace(/_/g, " ");
    }
    const target = EQ_PRESETS[preset]!;
    springs = springs.map((spring, i) =>
      stepSpring(spring, target[i]!, dt, 120, 14),
    );
    const d = smoothPath(
      bandPoints(
        springs.map((spring) => spring.value),
        0,
        240,
        8,
        112,
        8,
      ),
    );
    eqPaths.forEach((path) => path.setAttribute("d", d));

    const routeT = (clock % (ROUTE_TIME + ROUTE_HOLD)) / ROUTE_TIME;
    const progress = Math.min(1, routeT);
    route?.style.setProperty("--route", (1 - progress).toFixed(3));
    const reached = Math.floor(progress * (hops.length - 1) + 0.001);
    if (reached !== lit) {
      lit = reached;
      hops.forEach((hop, i) => hop.classList.toggle("is-on", i <= reached));
    }

    const nextHour = Math.floor(clock / HOUR_STEP) % 24;
    if (nextHour !== hour) {
      hour = nextHour;
      hours.forEach((cell) =>
        cell.classList.toggle("is-now", Number(cell.dataset.hour) === hour),
      );
    }

    const nextScan = Math.floor(clock / SCAN_STEP) % (rows.length + 8);
    if (nextScan !== scan) {
      rows[scan]?.classList.remove("is-scan");
      scan = nextScan;
      rows[scan]?.classList.add("is-scan");
    }
  });

  return () => {
    loop.cleanup();
    route?.style.removeProperty("--route");
    hops.forEach((hop) => hop.classList.add("is-on"));
    hours.forEach((cell) => cell.classList.remove("is-now"));
    rows.forEach((row) => row.classList.remove("is-scan"));
  };
}

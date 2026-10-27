import { typedAt } from "../../lib/json-lines";
import { reducedMotion } from "../motion/env";
import type { Cleanup } from "../motion/page";
import { visibleLoop } from "./loop";

const TYPE_RATE = 70;
const DECIDE = 0.25;
const HOLD = 1.5;

interface Probe {
  method: string;
  path: string;
  match: number;
}

export function initAllowlist(root: HTMLElement): Cleanup {
  const request = root.querySelector<HTMLElement>("[data-probe-request]");
  const verdict = root.querySelector<HTMLElement>("[data-probe-verdict]");
  const routes = [...root.querySelectorAll<HTMLElement>("[data-route]")];
  const data = root.querySelector<HTMLScriptElement>("[data-probes]");
  if (!request || !verdict || !data || reducedMotion()) return () => {};
  const probes = JSON.parse(data.textContent ?? "[]") as Probe[];
  const finalRequest = request.innerHTML;
  const finalVerdict = verdict.textContent ?? "";
  const finalClass = verdict.className;
  const finalHit = routes.findIndex((route) =>
    route.classList.contains("is-hit"),
  );
  const methodTag = request.querySelector("b")!.cloneNode(false) as HTMLElement;
  const durations = probes.map(
    (probe) => probe.path.length / TYPE_RATE + DECIDE + HOLD,
  );
  const cycle = durations.reduce((a, b) => a + b, 0);
  let clock = 0;
  let shown = "";

  const show = (index: number, local: number) => {
    const probe = probes[index]!;
    const path = typedAt(probe.path, local, TYPE_RATE);
    const decided = local >= probe.path.length / TYPE_RATE + DECIDE;
    const key = `${index}|${path.length}|${decided}`;
    if (key === shown) return;
    shown = key;
    const method = methodTag.cloneNode(false) as HTMLElement;
    method.textContent = probe.method;
    request.replaceChildren(method, ` ${path}`);
    verdict.classList.toggle("ok", decided && probe.match >= 0);
    verdict.classList.toggle("no", decided && probe.match < 0);
    verdict.textContent = decided
      ? probe.match >= 0
        ? "allowed"
        : "treated as signed out"
      : "checking";
    routes.forEach((route, i) =>
      route.classList.toggle("is-hit", decided && i === probe.match),
    );
  };

  const loop = visibleLoop(
    root,
    (_, dt) => {
      clock = (clock + dt) % cycle;
      let local = clock;
      let index = 0;
      while (local >= durations[index]!) local -= durations[index++]!;
      show(index, local);
    },
    { onFirstVisible: () => (clock = 0) },
  );

  return () => {
    loop.cleanup();
    request.innerHTML = finalRequest;
    verdict.textContent = finalVerdict;
    verdict.className = finalClass;
    routes.forEach((route, i) =>
      route.classList.toggle("is-hit", i === finalHit),
    );
  };
}

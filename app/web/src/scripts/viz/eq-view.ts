import { EQ_CYCLE, EQ_GAIN_MAX, EQ_PRESETS } from "../../content/listen/viz";
import { reducedMotion } from "../motion/env";
import type { Cleanup } from "../motion/page";
import { scrambleText } from "../motion/scramble";
import {
  bandPoints,
  formatGain,
  nextInCycle,
  smoothPath,
  stepSpring,
  type Spring,
} from "./eq-math";
import { observeSize, svg, visibleLoop } from "./loop";

const DWELL = 2.8;
const MANUAL_HOLD = 9;

export function initEq(root: HTMLElement): Cleanup {
  const surface = root.querySelector<SVGSVGElement>(".eq-svg");
  const stage = root.querySelector<HTMLElement>(".eq-stage");
  if (!surface || !stage) return () => {};
  const reduced = reducedMotion();
  const values = [...root.querySelectorAll<HTMLElement>("[data-eq-value]")];
  const chips = [...root.querySelectorAll<HTMLButtonElement>("[data-preset]")];
  const sources = [...root.querySelectorAll<HTMLElement>("[data-source]")];
  const progress = root.querySelector<HTMLElement>("[data-eq-progress]");
  const prevLabel = root.querySelector<HTMLElement>("[data-eq-prev]");
  const currentLabel = root.querySelector<HTMLElement>("[data-eq-current]");
  const nextLabel = root.querySelector<HTMLElement>("[data-eq-next]");
  const listeners = new AbortController();

  let preset = EQ_CYCLE[0]!;
  let previous = EQ_CYCLE[EQ_CYCLE.length - 1]!;
  let springs: Spring[] = EQ_PRESETS[preset]!.map((value) => ({
    value,
    velocity: 0,
  }));
  let elapsed = 0;
  let manualUntil = 0;
  let clock = 0;
  let shown: string[] = [];
  let width = 0;
  let height = 0;
  let geometry: {
    top: number;
    bottom: number;
    left: number;
    right: number;
    zero: number;
  } | null = null;
  let bars: SVGRectElement[] = [];
  let curve: SVGPathElement | null = null;
  let glow: SVGPathElement | null = null;
  let area: SVGPathElement | null = null;
  let ghost: SVGPathElement | null = null;
  let dots: SVGCircleElement[] = [];

  function build(w: number, h: number) {
    width = w;
    height = h;
    surface!.setAttribute("viewBox", `0 0 ${w} ${h}`);
    surface!.replaceChildren();
    const top = 14;
    const bottom = h - 14;
    geometry = { top, bottom, left: 0, right: w, zero: (top + bottom) / 2 };
    const defs = svg(surface!, "defs");
    const up = svg(defs, "linearGradient", {
      id: "lvz-eq-up",
      x1: 0,
      y1: 0,
      x2: 0,
      y2: 1,
    });
    svg(up, "stop", {
      offset: 0,
      "stop-color": "#67e8f9",
      "stop-opacity": 0.55,
    });
    svg(up, "stop", {
      offset: 1,
      "stop-color": "#06b6d4",
      "stop-opacity": 0.04,
    });
    const down = svg(defs, "linearGradient", {
      id: "lvz-eq-down",
      x1: 0,
      y1: 1,
      x2: 0,
      y2: 0,
    });
    svg(down, "stop", {
      offset: 0,
      "stop-color": "#67e8f9",
      "stop-opacity": 0.35,
    });
    svg(down, "stop", {
      offset: 1,
      "stop-color": "#06b6d4",
      "stop-opacity": 0.03,
    });
    const fill = svg(defs, "linearGradient", {
      id: "lvz-eq-area",
      x1: 0,
      y1: 0,
      x2: 0,
      y2: 1,
      gradientUnits: "userSpaceOnUse",
    });
    fill.setAttribute("y1", String(top));
    fill.setAttribute("y2", String(bottom));
    svg(fill, "stop", {
      offset: 0,
      "stop-color": "#06b6d4",
      "stop-opacity": 0.22,
    });
    svg(fill, "stop", {
      offset: 0.5,
      "stop-color": "#06b6d4",
      "stop-opacity": 0.04,
    });
    svg(fill, "stop", {
      offset: 1,
      "stop-color": "#06b6d4",
      "stop-opacity": 0,
    });

    const grid = svg(surface!, "g", { class: "eq-grid" });
    for (const db of [12, 6, 0, -6, -12]) {
      const y = geometry.zero - (db / EQ_GAIN_MAX) * ((bottom - top) / 2);
      svg(grid, "line", {
        x1: 0,
        x2: w,
        y1: y,
        y2: y,
        class: db === 0 ? "zero" : "",
      });
    }
    const step = w / 10;
    for (let i = 1; i < 10; i += 1)
      svg(grid, "line", {
        x1: step * i,
        x2: step * i,
        y1: top,
        y2: bottom,
        class: "col",
      });

    const barWidth = Math.max(6, Math.min(44, step * 0.34));
    bars = springs.map((_, i) =>
      svg(surface!, "rect", {
        x: step * (i + 0.5) - barWidth / 2,
        width: barWidth,
        rx: Math.min(3, barWidth / 4),
        y: geometry!.zero,
        height: 0,
      }),
    );
    area = svg(surface!, "path", {
      class: "eq-area",
      fill: "url(#lvz-eq-area)",
    });
    ghost = svg(surface!, "path", { class: "eq-ghost" });
    glow = svg(surface!, "path", { class: "eq-glow" });
    curve = svg(surface!, "path", { class: "eq-curve" });
    dots = springs.map(() =>
      svg(surface!, "circle", { r: w < 600 ? 2.5 : 3.5, class: "eq-dot" }),
    );
    drawGhost();
    render();
  }

  function points(gains: readonly number[]) {
    const g = geometry!;
    return bandPoints(gains, g.left, g.right, g.top, g.bottom, EQ_GAIN_MAX);
  }

  function drawGhost() {
    if (!geometry || !ghost) return;
    ghost.setAttribute("d", smoothPath(points(EQ_PRESETS[preset]!)));
  }

  function render() {
    if (!geometry || !curve) return;
    const gains = springs.map((spring) => spring.value);
    const pts = points(gains);
    const d = smoothPath(pts);
    curve.setAttribute("d", d);
    glow!.setAttribute("d", d);
    area!.setAttribute(
      "d",
      `${d} L${pts[pts.length - 1]!.x} ${geometry.zero} L${pts[0]!.x} ${
        geometry.zero
      } Z`,
    );
    pts.forEach((point, i) => {
      const bar = bars[i]!;
      const top = Math.min(point.y, geometry!.zero);
      bar.setAttribute("y", top.toFixed(1));
      bar.setAttribute("height", Math.abs(point.y - geometry!.zero).toFixed(1));
      bar.setAttribute(
        "fill",
        point.y <= geometry!.zero ? "url(#lvz-eq-up)" : "url(#lvz-eq-down)",
      );
      dots[i]!.setAttribute("cx", point.x.toFixed(1));
      dots[i]!.setAttribute("cy", point.y.toFixed(1));
      const text = formatGain(gains[i]!);
      if (shown[i] !== text) {
        shown[i] = text;
        values[i]!.textContent = text;
      }
    });
  }

  function select(name: string, manual: boolean) {
    if (!EQ_PRESETS[name]) return;
    if (name !== preset) previous = preset;
    preset = name;
    elapsed = 0;
    if (manual) manualUntil = clock + MANUAL_HOLD;
    if (reduced)
      springs = EQ_PRESETS[name]!.map((value) => ({ value, velocity: 0 }));
    chips.forEach((chip) =>
      chip.setAttribute("aria-pressed", String(chip.dataset.preset === name)),
    );
    sources.forEach((source) =>
      source.classList.toggle(
        "is-on",
        source.dataset.source === (manual ? "preset" : "genre"),
      ),
    );
    if (prevLabel) prevLabel.textContent = previous;
    if (nextLabel)
      nextLabel.textContent = manual ? "manual" : nextInCycle(EQ_CYCLE, name);
    if (currentLabel) scrambleText(currentLabel, name, { durationMs: 420 });
    drawGhost();
    if (reduced) render();
  }

  chips.forEach((chip) =>
    chip.addEventListener(
      "click",
      () => select(chip.dataset.preset ?? "flat", true),
      {
        signal: listeners.signal,
      },
    ),
  );

  const stopResize = observeSize(stage, (w, h) => build(w, h));
  select(preset, false);

  if (reduced) {
    if (progress) progress.style.transform = "scaleX(1)";
    return () => {
      listeners.abort();
      stopResize();
    };
  }

  const loop = visibleLoop(root, (_, dt) => {
    clock += dt;
    const target = EQ_PRESETS[preset]!;
    springs = springs.map((spring, i) =>
      stepSpring(spring, target[i]!, dt, 120, 14),
    );
    if (width && height) render();
    const manual = clock < manualUntil;
    if (!manual) {
      elapsed += dt;
      if (elapsed >= DWELL) {
        const cycleIndex = EQ_CYCLE.indexOf(preset);
        select(
          cycleIndex === -1 ? EQ_CYCLE[0]! : nextInCycle(EQ_CYCLE, preset),
          false,
        );
      }
    }
    if (progress)
      progress.style.transform = `scaleX(${
        manual ? (manualUntil - clock) / MANUAL_HOLD : elapsed / DWELL
      })`;
  });

  return () => {
    listeners.abort();
    stopResize();
    loop.cleanup();
  };
}

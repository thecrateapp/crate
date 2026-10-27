import { EQ_CYCLE, EQ_GAIN_MAX, EQ_PRESETS } from "../../content/listen/viz";
import { mulberry32 } from "../field/sources";
import { radioPicks } from "../listen/scene";
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
import { nearestPoints } from "./inside-math";
import {
  HEAT,
  NEIGHBOURS,
  PICKS,
  radioSeeds,
  soundPoints,
} from "./inside-tiles";
import { visibleLoop } from "./loop";

const EQ_DWELL = 2.4;
const SEED_TIME = 3.4;
const LINK_AT = 0.95;
const HOUR_STEP = 0.28;
const SCAN_STEP = 0.42;
const SCAN_VISIBLE = 5;

function eqTile(root: HTMLElement) {
  const paths = [...root.querySelectorAll<SVGPathElement>("[data-eq-path]")];
  const bands = [...root.querySelectorAll<HTMLElement>("[data-eq-band]")];
  const gains = [...root.querySelectorAll<HTMLElement>("[data-eq-gain]")];
  const name = root.querySelector<HTMLElement>("[data-eq-name]");
  let preset = EQ_CYCLE[0]!;
  let springs: Spring[] = EQ_PRESETS[preset]!.map((value) => ({
    value,
    velocity: 0,
  }));
  let clock = 0;
  const shown = gains.map((gain) => gain.textContent ?? "");

  return (dt: number) => {
    clock += dt;
    if (clock >= EQ_DWELL) {
      clock = 0;
      preset = nextInCycle(EQ_CYCLE, preset);
      if (name)
        scrambleText(name, preset.replace(/_/g, " "), { durationMs: 360 });
    }
    const target = EQ_PRESETS[preset]!;
    springs = springs.map((spring, i) =>
      stepSpring(spring, target[i]!, dt, 120, 14),
    );
    const values = springs.map((spring) => spring.value);
    const d = smoothPath(bandPoints(values, 0, 240, 0, 120, EQ_GAIN_MAX));
    paths.forEach((path) => path.setAttribute("d", d));
    values.forEach((value, i) => {
      const clamped = Math.max(-EQ_GAIN_MAX, Math.min(EQ_GAIN_MAX, value));
      bands[i]?.style.setProperty(
        "transform",
        `translateY(${((-clamped / EQ_GAIN_MAX) * 50).toFixed(2)}%)`,
      );
      const label = formatGain(value);
      if (label !== shown[i] && gains[i]) {
        shown[i] = label;
        gains[i]!.textContent = label;
      }
    });
  };
}

function radioTile(root: HTMLElement) {
  const radio = root.querySelector<HTMLElement>(".radio");
  const target = root.querySelector<SVGGElement>("[data-target]");
  const dots = [...root.querySelectorAll<SVGCircleElement>("[data-dot]")];
  const links = [...root.querySelectorAll<SVGLineElement>("[data-link]")];
  const bars = [...root.querySelectorAll<HTMLElement>("[data-pick-bar]")];
  const scores = [...root.querySelectorAll<HTMLElement>("[data-pick-score]")];
  const metas = [...root.querySelectorAll<HTMLElement>("[data-pick-meta]")];
  const points = soundPoints();
  const seeds = radioSeeds(points);
  let clock = 0;
  let cycle = -1;
  let linked = false;
  let near: number[] = [];

  const reseed = (index: number) => {
    const seed = points[seeds[index % seeds.length]!]!;
    near = nearestPoints(points, seed, NEIGHBOURS + 1).slice(1);
    radio?.classList.remove("is-linked");
    target?.style.setProperty(
      "transform",
      `translate(${seed.x.toFixed(2)}px, ${seed.y.toFixed(2)}px)`,
    );
    dots.forEach((dot) => dot.classList.remove("is-near"));
    links.forEach((link, i) => {
      const point = points[near[i]!]!;
      link.setAttribute("x1", seed.x.toFixed(2));
      link.setAttribute("y1", seed.y.toFixed(2));
      link.setAttribute("x2", point.x.toFixed(2));
      link.setAttribute("y2", point.y.toFixed(2));
    });
    radioPicks(PICKS, mulberry32(index + 1)).forEach((pick, i) => {
      bars[i]?.style.setProperty("transform", `scaleX(${pick.score})`);
      if (scores[i]) scores[i]!.textContent = pick.score.toFixed(2);
      if (metas[i]) metas[i]!.textContent = `${pick.bpm} BPM · ${pick.key}`;
    });
  };

  radio?.classList.add("is-live");
  return (dt: number) => {
    clock += dt;
    const next = Math.floor(clock / SEED_TIME);
    if (next !== cycle) {
      cycle = next;
      linked = false;
      reseed(cycle);
    }
    if (!linked && clock - cycle * SEED_TIME >= LINK_AT) {
      linked = true;
      radio?.classList.add("is-linked");
      near.forEach((i) => dots[i]?.classList.add("is-near"));
    }
  };
}

function heatTile(root: HTMLElement) {
  const heat = root.querySelector<HTMLElement>(".heat");
  const sweep = root.querySelector<SVGGElement>("[data-sweep]");
  let clock = 0;
  let hour = -1;
  heat?.classList.add("is-live");
  return (dt: number) => {
    clock += dt;
    const next = Math.floor(clock / HOUR_STEP) % 24;
    if (next === hour) return;
    hour = next;
    sweep?.style.setProperty("transition-duration", hour === 0 ? "0s" : "");
    sweep?.style.setProperty("transform", `translateX(${hour * HEAT.pitch}px)`);
  };
}

function scanTile(root: HTMLElement) {
  const scan = root.querySelector<HTMLElement>(".scan");
  const rows = [...root.querySelectorAll<HTMLElement>("[data-row]")];
  const meter = [...root.querySelectorAll<HTMLElement>("[data-meter]")];
  const list = root.querySelector<HTMLElement>("[data-scan-rows]");
  const last = rows.length - SCAN_VISIBLE;
  let clock = 0;
  let step = -1;
  scan?.classList.add("is-live");
  return (dt: number) => {
    clock += dt;
    const next = Math.floor(clock / SCAN_STEP) % (rows.length + 4);
    if (next === step) return;
    step = next;
    rows.forEach((row, i) => {
      row.classList.toggle("is-done", i <= step);
      row.classList.toggle("is-now", i === step);
    });
    meter.forEach((cell, i) => cell.classList.toggle("is-done", i <= step));
    const offset = Math.max(0, Math.min(last, step - 2));
    list?.style.setProperty(
      "--off",
      String(step >= rows.length ? last : offset),
    );
  };
}

export function initInside(root: HTMLElement): Cleanup {
  if (reducedMotion()) return () => {};
  const tiles = (id: string) =>
    root.querySelector<HTMLElement>(`[data-tile="${id}"]`);
  const frames = [
    ["eq", eqTile],
    ["radio", radioTile],
    ["heatmap", heatTile],
    ["health", scanTile],
  ] as const;
  const loops = frames.flatMap(([id, build]) => {
    const tile = tiles(id);
    if (!tile) return [];
    const frame = build(tile);
    return [visibleLoop(tile, (_, dt) => frame(dt))];
  });

  return () => loops.forEach((loop) => loop.cleanup());
}

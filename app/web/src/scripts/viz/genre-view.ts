import { EQ_PRESETS } from "../../content/listen/viz";
import { reducedMotion } from "../motion/env";
import type { Cleanup } from "../motion/page";
import { scrambleText } from "../motion/scramble";
import { formatGain, stepSpring, type Spring } from "./eq-math";
import { visibleLoop } from "./loop";

const DWELL = 3.4;
const MANUAL_HOLD = 9;

interface Walk {
  slug: string;
  path: string[];
  preset: string;
  from: string;
}

const label = (slug: string) => slug.replace(/-/g, " ");

const readWalk = (element: HTMLElement | SVGElement): Walk => ({
  slug: element.dataset.walk ?? element.dataset.genre ?? "",
  path: (element.dataset.path ?? "").split(" ").filter(Boolean),
  preset: element.dataset.preset ?? "flat",
  from: element.dataset.from ?? "",
});

export function initGenres(root: HTMLElement): Cleanup {
  const svg = root.querySelector<SVGSVGElement>(".wheel-svg");
  const chips = [...root.querySelectorAll<HTMLButtonElement>("[data-walk]")];
  const nodes = new Map(
    [...root.querySelectorAll<SVGGElement>("[data-genre]")].map((node) => [
      node.dataset.genre!,
      node,
    ]),
  );
  const edges = new Map(
    [...root.querySelectorAll<SVGPathElement>("[data-edge]")].map((edge) => [
      edge.dataset.edge!,
      edge,
    ]),
  );
  const related = [...root.querySelectorAll<SVGPathElement>("[data-pair]")];
  const pathOut = root.querySelector<HTMLElement>("[data-walk-path]");
  const presetOut = root.querySelector<HTMLElement>("[data-walk-preset]");
  const sourceOut = root.querySelector<HTMLElement>("[data-walk-source]");
  const bars = [...root.querySelectorAll<HTMLElement>(".mini-eq li")];
  const gains = [...root.querySelectorAll<HTMLElement>("[data-walk-gain]")];
  if (!svg || !chips.length) return () => {};
  const reduced = reducedMotion();
  const listeners = new AbortController();
  const walks = chips.map(readWalk);
  let current = walks[0]!;
  let springs: Spring[] = (EQ_PRESETS[current.preset] ?? []).map((value) => ({
    value,
    velocity: 0,
  }));
  let lit: Element[] = [];
  let clock = 0;
  let elapsed = 0;
  let manualUntil = 0;
  const shown: string[] = [];

  const renderBars = () =>
    springs.forEach((spring, i) => {
      bars[i]?.style.setProperty("--g", spring.value.toFixed(3));
      const text = formatGain(spring.value);
      if (shown[i] !== text && gains[i]) {
        shown[i] = text;
        gains[i]!.textContent = text;
      }
    });

  const select = (walk: Walk, manual: boolean) => {
    current = walk;
    elapsed = 0;
    if (manual) manualUntil = clock + MANUAL_HOLD;
    lit.forEach((element) =>
      element.classList.remove("is-on", "is-path", "is-from", "is-start"),
    );
    lit = [];
    const add = (element: Element | undefined, ...classes: string[]) => {
      if (!element) return;
      element.classList.add(...classes);
      lit.push(element);
    };
    walk.path.forEach((slug, i) => {
      add(nodes.get(slug), "is-path");
      if (i < walk.path.length - 1) add(edges.get(slug), "is-on");
    });
    add(nodes.get(walk.slug), "is-start");
    add(nodes.get(walk.from), "is-from");
    related
      .filter((edge) => edge.dataset.pair!.split("|").includes(walk.slug))
      .forEach((edge) => add(edge, "is-on"));
    chips.forEach((chip) =>
      chip.setAttribute(
        "aria-pressed",
        String(chip.dataset.walk === walk.slug),
      ),
    );
    if (pathOut) pathOut.textContent = walk.path.map(label).join(" → ");
    if (presetOut)
      scrambleText(presetOut, walk.preset.replace(/_/g, " "), {
        durationMs: 420,
      });
    if (sourceOut)
      sourceOut.textContent =
        walk.from === walk.slug
          ? "its own preset"
          : `inherited from ${label(walk.from)}`;
    if (reduced) {
      springs = (EQ_PRESETS[walk.preset] ?? []).map((value) => ({
        value,
        velocity: 0,
      }));
      renderBars();
    }
  };

  chips.forEach((chip, i) =>
    chip.addEventListener("click", () => select(walks[i]!, true), {
      signal: listeners.signal,
    }),
  );
  svg.addEventListener(
    "pointerover",
    (event) => {
      const node = (event.target as Element).closest<SVGGElement>(
        "[data-genre]",
      );
      if (!node || node.dataset.genre === current.slug) return;
      select(readWalk(node), true);
    },
    { signal: listeners.signal },
  );

  select(current, false);
  if (reduced) return () => listeners.abort();

  const loop = visibleLoop(root, (_, dt) => {
    clock += dt;
    const target = EQ_PRESETS[current.preset] ?? [];
    springs = springs.map((spring, i) =>
      stepSpring(spring, target[i] ?? 0, dt, 140, 15),
    );
    renderBars();
    if (clock < manualUntil) return;
    elapsed += dt;
    if (elapsed < DWELL) return;
    const index = walks.findIndex((walk) => walk.slug === current.slug);
    select(walks[(index + 1) % walks.length]!, false);
  });

  return () => {
    listeners.abort();
    loop.cleanup();
  };
}

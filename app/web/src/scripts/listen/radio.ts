import type { Vec3 } from "../field/math";
import type { Field } from "../field/renderer";
import { mulberry32 } from "../field/sources";
import { svgElement, type DiveContext, type DiveScene } from "./dive";
import { densestIndex, nearest, radioPicks, segment } from "./scene";

const NEIGHBOURS = 14;
const CANDIDATES = 420;
const PICKS = [1, 3, 5, 8, 11];
const LIKE_SHIFT = 0.08;

export function createRadioScene(
  field: Field,
  positions: Float32Array,
  { root, svg, mobile }: DiveContext,
): DiveScene {
  const group = svgElement(svg, "g");
  const lines = Array.from({ length: NEIGHBOURS }, () =>
    svgElement(group, "line", { class: "link", pathLength: 1 }),
  );
  const dots = Array.from({ length: NEIGHBOURS }, () =>
    svgElement(group, "circle", { class: "neighbour", r: 2.5 }),
  );
  const picks = PICKS.map((_, i) => {
    const ring = svgElement(group, "circle", { class: "pick", r: 6 });
    const label = svgElement(group, "text", { class: "pick-label" });
    label.textContent = String(i + 1).padStart(2, "0");
    return { ring, label };
  });
  const seedRing = svgElement(group, "circle", { class: "seed", r: 12 });
  const seedLabel = svgElement(group, "text", { class: "seed-label" });
  seedLabel.textContent = root.dataset.seedLabel ?? "Seed";

  const seedReadout = root.querySelector<HTMLElement>(".radio-seed");
  const weights = [...root.querySelectorAll<HTMLElement>(".radio-weights li")];
  const queueTitle = root.querySelector<HTMLElement>(".radio-queue-title");
  const queue = [
    ...root.querySelectorAll<HTMLElement>(".radio-queue li:not(.title)"),
  ];
  const like = root.querySelector<HTMLElement>(".radio-like");

  radioPicks(PICKS.length, mulberry32(11)).forEach((pick, i) => {
    const row = queue[i];
    if (!row) return;
    row.querySelector(".score")!.textContent = pick.score.toFixed(2);
    row.querySelector(".bpm")!.textContent = `${pick.bpm} BPM`;
    row.querySelector(".key")!.textContent = pick.key;
  });

  let seed: Vec3 = [0, 0, 0];
  let neighbours: number[] = [];

  function setCloud(next: Float32Array) {
    const index = densestIndex(next, 0.12);
    seed = [next[index * 3], next[index * 3 + 1], next[index * 3 + 2]];
    const pool = nearest(next, seed, CANDIDATES, index);
    const stride = Math.floor(CANDIDATES / NEIGHBOURS);
    neighbours = Array.from(
      { length: NEIGHBOURS },
      (_, i) => pool[i * stride + 6],
    );
  }
  setCloud(positions);

  const show = (
    element: Element | null | undefined,
    amount: number,
    rise = 10,
  ) => {
    if (!(element instanceof HTMLElement || element instanceof SVGElement))
      return;
    element.style.opacity = String(amount);
    element.style.transform = rise
      ? `translateY(${(1 - amount) * rise}px)`
      : "";
  };

  function frame(phase: number, time: number) {
    const liked = field.pointAt(neighbours[PICKS[0]]);
    const shift = LIKE_SHIFT * segment(phase, 4.15, 0.6);
    const focus: Vec3 = [0, 1, 2].map(
      (axis) => seed[axis] + (liked[axis] - seed[axis]) * shift,
    ) as Vec3;
    const zoom = segment(phase, 0, 2.2);
    const orbit = 0.6 + time * 0.03 + phase * 0.22;
    const distance = (mobile ? 3.3 : 2.6) - zoom * 0.9;
    const eye: Vec3 = [
      focus[0] + Math.sin(orbit) * distance,
      focus[1] + 0.35 - zoom * 0.15,
      focus[2] + Math.cos(orbit) * distance,
    ];
    field.render({ eye, target: focus, time, focus });

    const center = field.project(focus);
    const seedIn = segment(phase, 0.15, 0.5);
    seedRing.setAttribute("cx", String(center.x));
    seedRing.setAttribute("cy", String(center.y));
    seedRing.setAttribute("r", String(12 + Math.sin(time * 2.4) * 1.5));
    seedRing.style.opacity = String(seedIn);
    seedLabel.setAttribute("x", String(center.x + 18));
    seedLabel.setAttribute("y", String(center.y - 14));
    seedLabel.style.opacity = String(seedIn);
    show(seedReadout, seedIn);

    const queueIn = segment(phase, 3, 0.5);
    neighbours.forEach((index, i) => {
      const point = field.project(field.pointAt(index));
      const reveal = segment(phase, 1 + i * 0.045, 0.45);
      const isPick = PICKS.includes(i);
      const dim = isPick ? 1 : 1 - queueIn * 0.65;
      const line = lines[i];
      line.setAttribute("x1", String(center.x));
      line.setAttribute("y1", String(center.y));
      line.setAttribute("x2", String(point.x));
      line.setAttribute("y2", String(point.y));
      line.style.strokeDashoffset = String(1 - reveal);
      line.style.opacity = String(reveal * 0.7 * dim);
      dots[i].setAttribute("cx", String(point.x));
      dots[i].setAttribute("cy", String(point.y));
      dots[i].style.opacity = String(reveal * dim);
      const pickIndex = PICKS.indexOf(i);
      if (pickIndex < 0) return;
      const pickIn = segment(phase, 3 + pickIndex * 0.1, 0.4);
      const { ring, label } = picks[pickIndex];
      ring.setAttribute("cx", String(point.x));
      ring.setAttribute("cy", String(point.y));
      ring.style.opacity = String(pickIn);
      label.setAttribute("x", String(point.x + 10));
      label.setAttribute("y", String(point.y + 4));
      label.style.opacity = String(pickIn);
    });

    weights.forEach((row, i) => {
      const amount = segment(phase, 2 + i * 0.08, 0.4);
      show(row, amount);
      row.style.setProperty("--fill", String(amount));
    });
    show(queueTitle, segment(phase, 3, 0.4));
    queue.forEach((row, i) => show(row, segment(phase, 3 + i * 0.1, 0.4)));
    show(like, segment(phase, 4.1, 0.5));
    queue[0]?.classList.toggle("is-liked", phase > 4.3);
  }

  return {
    frame,
    setCloud,
    dispose() {
      group.remove();
    },
  };
}

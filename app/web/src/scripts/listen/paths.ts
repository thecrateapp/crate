import type { Vec3 } from "../field/math";
import type { Field } from "../field/renderer";
import { mulberry32 } from "../field/sources";
import { scrambleText } from "../motion/scramble";
import { svgElement, type DiveContext, type DiveScene } from "./dive";
import { pathReadouts, pickNodes, segment, type Candidate } from "./scene";

const STEPS = 6;

export function createPathsScene(
  field: Field,
  positions: Float32Array,
  { root, svg, reduced }: DiveContext,
): DiveScene {
  const visual = root.querySelector<HTMLElement>(".dive-visual")!;
  const group = svgElement(svg, "g");
  const polyline = svgElement(group, "polyline", { class: "route" });
  const circles = Array.from({ length: STEPS }, (_, i) =>
    svgElement(group, "circle", {
      class: i === STEPS - 1 ? "node end" : "node",
      r: i === 0 || i === STEPS - 1 ? 4.5 : 3,
    }),
  );
  const readouts = pathReadouts(STEPS, mulberry32(21));
  const labels = readouts.map((readout) => {
    const label = document.createElement("div");
    label.className = "node-label";
    label.setAttribute("aria-hidden", "true");
    label.dataset.text = `${readout.head}\n${readout.bpm} BPM · ${readout.key}`;
    visual.appendChild(label);
    return label;
  });
  const caption = root.querySelector<HTMLElement>(".paths-caption");
  const saved = root.querySelector<HTMLElement>(".paths-saved");
  if (caption) {
    const range = caption.querySelector(".range");
    if (range)
      range.textContent = `${readouts[0].bpm} → ${readouts[STEPS - 1].bpm} BPM`;
  }

  let nodes: number[] = [];
  let planned = false;

  function plan() {
    const random = mulberry32(5);
    const width = visual.clientWidth;
    const height = visual.clientHeight;
    const count = positions.length / 3;
    const anchors = Array.from({ length: STEPS }, (_, i) => {
      const t = i / (STEPS - 1);
      return {
        x: width * (0.14 + t * 0.72),
        y: height * (0.5 + Math.sin(t * Math.PI * 1.6) * 0.14),
      };
    });
    const candidates: Candidate[] = [];
    for (let i = 0; i < 3500; i++) {
      const index = Math.floor(random() * count);
      const point = field.project(field.pointAt(index));
      if (point.w > 0) candidates.push({ index, x: point.x, y: point.y });
    }
    nodes = pickNodes(candidates, anchors);
    planned = true;
  }

  function camera(time: number): Vec3 {
    const orbit = 0.35 + time * 0.012;
    return [Math.sin(orbit) * 3.1, 0.3, Math.cos(orbit) * 3.1];
  }

  function setLabel(i: number, on: boolean) {
    const label = labels[i];
    if (on === label.classList.contains("is-on")) return;
    label.classList.toggle("is-on", on);
    if (on)
      scrambleText(label, label.dataset.text ?? "", {
        durationMs: 380,
        reducedMotion: reduced,
      });
    else label.textContent = "";
  }

  function frame(phase: number, time: number) {
    const draw = segment(phase, 0.7, 2.2);
    const head = nodes.length
      ? field.pointAt(
          nodes[Math.min(STEPS - 1, Math.floor(draw * (STEPS - 1)))],
        )
      : undefined;
    field.render({
      eye: camera(time),
      time,
      focus: draw > 0 ? head : undefined,
    });
    if (!planned) {
      plan();
      field.render({ eye: camera(time), time });
    }

    const screen = nodes.map((index) => field.project(field.pointAt(index)));
    const segments = draw * (STEPS - 1);
    const whole = Math.floor(segments);
    const points = screen.slice(0, Math.min(whole, STEPS - 1) + 1);
    if (whole < STEPS - 1) {
      const a = screen[whole];
      const b = screen[whole + 1];
      const f = segments - whole;
      points.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, w: 1 });
    }
    polyline.setAttribute(
      "points",
      points.map((p) => `${p.x},${p.y}`).join(" "),
    );
    polyline.style.opacity = draw > 0 ? "1" : "0";

    const endpoints = segment(phase, 0.15, 0.4);
    screen.forEach((p, i) => {
      const isEndpoint = i === 0 || i === STEPS - 1;
      const on = isEndpoint
        ? endpoints > 0.5
        : i <= segments + 0.001 && draw > 0;
      const amount = isEndpoint ? endpoints : on ? 1 : 0;
      circles[i].setAttribute("cx", String(p.x));
      circles[i].setAttribute("cy", String(p.y));
      circles[i].style.opacity = String(amount);
      labels[i].style.transform = `translate3d(${p.x - 20}px, ${
        p.y + (i % 2 === 0 ? -46 : 14)
      }px, 0)`;
      setLabel(i, on);
    });

    if (caption) caption.style.opacity = String(endpoints);
    if (saved) saved.style.opacity = String(segment(phase, 3.1, 0.5));
  }

  return {
    frame,
    setCloud(next) {
      positions = next;
      planned = false;
    },
    dispose() {
      group.remove();
      labels.forEach((label) => label.remove());
    },
  };
}

import { MOODS } from "../../content/listen/viz";
import { gaussian, mulberry32 } from "../field/sources";
import { isMobile, reducedMotion } from "../motion/env";
import type { Cleanup } from "../motion/page";
import { scrambleText } from "../motion/scramble";
import { observeSize, visibleLoop } from "./loop";
import {
  describeFilters,
  moodCentre,
  moodRegion,
  sampleMoodPoints,
} from "./mood-math";

export const MOOD_PAD = 28;
const CYCLE = 2.6;
const INTRO = 1.25;

function sprite(colour: string, size: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const context = canvas.getContext("2d")!;
  const gradient = context.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2,
  );
  gradient.addColorStop(0, colour);
  gradient.addColorStop(0.28, colour);
  gradient.addColorStop(0.42, `${colour}55`);
  gradient.addColorStop(1, `${colour}00`);
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  return canvas;
}

function backOut(t: number): number {
  const k = Math.min(1, Math.max(0, t));
  const c1 = 1.3;
  const c3 = c1 + 1;
  return 1 + c3 * (k - 1) ** 3 + c1 * (k - 1) ** 2;
}

export function initMoods(root: HTMLElement): Cleanup {
  const stage = root.querySelector<HTMLElement>(".moods-stage");
  const canvas = root.querySelector<HTMLCanvasElement>(".moods-canvas");
  const context = canvas?.getContext("2d");
  if (!stage || !canvas || !context) return () => {};
  const reduced = reducedMotion();
  const mobile = isMobile();
  const buttons = [...root.querySelectorAll<HTMLButtonElement>("[data-mood]")];
  const nameOut = root.querySelector<HTMLElement>("[data-mood-name]");
  const filtersOut = root.querySelector<HTMLElement>("[data-mood-filters]");
  const listeners = new AbortController();
  const random = mulberry32(21);
  const points = sampleMoodPoints(MOODS, mobile ? 90 : 190, random);
  const dust = Array.from({ length: mobile ? 260 : 620 }, () => ({
    energy: Math.min(1, Math.max(0, 0.5 + gaussian(random) * 0.24)),
    valence: Math.min(1, Math.max(0, 0.5 + gaussian(random) * 0.26)),
    phase: random() * Math.PI * 2,
  }));
  const meta = points.map((point) => ({
    phase: random() * Math.PI * 2,
    delay: point.mood * 0.06 + random() * 0.4,
    size: 0.75 + random() * 0.6,
  }));
  const lit = sprite("#67e8f9", 32);
  const pale = sprite("#f1f5f9", 32);
  const weights = MOODS.map(() => 1);

  let width = 0;
  let height = 0;
  let ratio = 1;
  let hovered = -1;
  let auto = 0;
  let autoClock = 0;
  let introStart = reduced ? -Infinity : Infinity;
  let regionAlpha = 0;
  let shownActive = -2;
  let now = 0;

  const active = () => (hovered >= 0 ? hovered : reduced ? -1 : auto);
  const px = (valence: number) => MOOD_PAD + valence * (width - MOOD_PAD * 2);
  const py = (energy: number) =>
    MOOD_PAD + (1 - energy) * (height - MOOD_PAD * 2);

  function announce(index: number) {
    if (index === shownActive) return;
    shownActive = index;
    buttons.forEach((button, i) =>
      button.classList.toggle("is-on", i === index),
    );
    const mood = MOODS[index];
    if (!mood) return;
    if (nameOut) scrambleText(nameOut, mood.label, { durationMs: 360 });
    if (filtersOut) {
      const parts = describeFilters(mood.filters);
      const plane = parts.filter((part) => /^(energy|valence)/.test(part));
      const extra = parts.filter((part) => !/^(energy|valence)/.test(part));
      filtersOut.textContent = [
        ...plane,
        ...extra.map((part) => `${part} (third axis)`),
      ].join(" · ");
    }
  }

  function draw(time: number, dt: number) {
    if (!width) return;
    const current = active();
    announce(current);
    const ease = reduced ? 1 : 1 - Math.exp(-dt * 7);
    MOODS.forEach((_, i) => {
      const target = current < 0 || current === i ? 1 : 0.05;
      weights[i]! += (target - weights[i]!) * ease;
    });
    regionAlpha += ((current >= 0 ? 1 : 0) - regionAlpha) * ease;

    context!.setTransform(ratio, 0, 0, ratio, 0, 0);
    context!.clearRect(0, 0, width, height);
    context!.globalCompositeOperation = "source-over";
    context!.strokeStyle = "rgba(241,245,249,0.07)";
    context!.lineWidth = 1;
    context!.beginPath();
    for (let i = 0; i <= 4; i += 1) {
      const x = Math.round(px(i / 4)) + 0.5;
      const y = Math.round(py(i / 4)) + 0.5;
      context!.moveTo(x, py(0));
      context!.lineTo(x, py(1));
      context!.moveTo(px(0), y);
      context!.lineTo(px(1), y);
    }
    context!.stroke();

    const mood = MOODS[current];
    if (mood && regionAlpha > 0.01) {
      const region = moodRegion(mood.filters);
      const x0 = px(region.valence[0]);
      const x1 = px(region.valence[1]);
      const y0 = py(region.energy[1]);
      const y1 = py(region.energy[0]);
      context!.fillStyle = `rgba(6,182,212,${0.06 * regionAlpha})`;
      context!.fillRect(x0, y0, x1 - x0, y1 - y0);
      context!.setLineDash([4, 5]);
      context!.strokeStyle = `rgba(103,232,249,${0.55 * regionAlpha})`;
      context!.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0 - 1, y1 - y0 - 1);
      context!.setLineDash([]);
    }

    context!.globalCompositeOperation = "lighter";
    const sway = reduced ? 0 : 1;
    const intro = time - introStart;
    const cx = px(0.5);
    const cy = py(0.5);
    const dustAlpha = Math.min(1, Math.max(0, intro / INTRO)) * 0.16;
    context!.globalAlpha = dustAlpha;
    for (const point of dust) {
      const x =
        px(point.valence) + Math.sin(time * 0.4 + point.phase) * 2 * sway;
      const y =
        py(point.energy) + Math.cos(time * 0.33 + point.phase) * 2 * sway;
      context!.drawImage(pale, x - 4, y - 4, 8, 8);
    }
    for (let i = 0; i < points.length; i += 1) {
      const point = points[i]!;
      const info = meta[i]!;
      const k = backOut((intro - info.delay) / INTRO);
      if (k <= 0) continue;
      const tx =
        px(point.valence) + Math.sin(time * 0.6 + info.phase) * 1.6 * sway;
      const ty =
        py(point.energy) + Math.cos(time * 0.5 + info.phase) * 1.6 * sway;
      const x = cx + (tx - cx) * k;
      const y = cy + (ty - cy) * k;
      const w = weights[point.mood]!;
      const size = (mobile ? 9 : 11) * info.size * (0.7 + 0.5 * w);
      context!.globalAlpha = Math.min(1, k) * (0.1 + 0.75 * w);
      context!.drawImage(lit, x - size / 2, y - size / 2, size, size);
    }
    context!.globalAlpha = 1;
  }

  function resize(w: number, h: number) {
    width = w;
    height = h;
    ratio = Math.min(2, window.devicePixelRatio || 1);
    canvas!.width = Math.round(w * ratio);
    canvas!.height = Math.round(h * ratio);
    draw(now, 1);
  }

  function pick(event: PointerEvent) {
    const rect = stage!.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    let best = -1;
    let bestDistance = Math.min(width, height) * 0.16;
    MOODS.forEach((mood, i) => {
      const centre = moodCentre(mood);
      const distance = Math.hypot(
        px(centre.valence) - x,
        py(centre.energy) - y,
      );
      if (distance < bestDistance) {
        best = i;
        bestDistance = distance;
      }
    });
    setHover(best);
  }

  function setHover(index: number) {
    if (hovered === index) return;
    hovered = index;
    if (index < 0) autoClock = 0;
    if (reduced) draw(now, 1);
  }

  stage.addEventListener("pointermove", pick, { signal: listeners.signal });
  stage.addEventListener("pointerleave", () => setHover(-1), {
    signal: listeners.signal,
  });
  buttons.forEach((button, i) => {
    button.addEventListener("focus", () => setHover(i), {
      signal: listeners.signal,
    });
    button.addEventListener("blur", () => setHover(-1), {
      signal: listeners.signal,
    });
    button.addEventListener("click", () => setHover(i), {
      signal: listeners.signal,
    });
  });

  const stopResize = observeSize(stage, resize);
  if (reduced) {
    announce(-1);
    return () => {
      listeners.abort();
      stopResize();
    };
  }

  const loop = visibleLoop(
    root,
    (time, dt) => {
      now = time;
      if (introStart === Infinity) introStart = time;
      if (hovered < 0 && time - introStart > INTRO + 0.6) {
        autoClock += dt;
        if (autoClock >= CYCLE) {
          autoClock = 0;
          auto = (auto + 1) % MOODS.length;
        }
      }
      draw(time, dt);
    },
    { margin: "0px" },
  );

  return () => {
    listeners.abort();
    stopResize();
    loop.cleanup();
  };
}

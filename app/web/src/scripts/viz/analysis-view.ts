import { reducedMotion } from "../motion/env";
import type { Cleanup } from "../motion/page";
import { scrambleText } from "../motion/scramble";
import { stepSpring, type Spring } from "./eq-math";
import { visibleLoop } from "./loop";

const DWELL = 4.6;
const MANUAL_HOLD = 10;

interface Track {
  title: string;
  bpm: number;
  key: string;
  camelot: string;
  loudness: number;
  dynamicRange: number;
  features: Record<string, number>;
  vector: number[];
}

const targetsOf = (track: Track): number[] => [
  track.bpm,
  Math.abs(track.loudness),
  track.dynamicRange,
  ...Object.values(track.features),
  ...track.vector,
];

export function initAnalysis(root: HTMLElement): Cleanup {
  const buttons = [...root.querySelectorAll<HTMLButtonElement>("[data-track]")];
  const tracks = buttons.map(
    (button) => JSON.parse(button.dataset.track!) as Track,
  );
  const title = root.querySelector<HTMLElement>("[data-readout-title]");
  const camelot = root.querySelector<HTMLElement>(
    '[data-figure-text="camelot"]',
  );
  const key = root.querySelector<HTMLElement>('[data-figure-text="key"]');
  const figures = ["bpm", "loudness", "dynamicRange"].map((name) =>
    root.querySelector<HTMLElement>(`[data-figure="${name}"]`),
  );
  const featureNames = Object.keys(tracks[0]?.features ?? {});
  const featureBars = featureNames.map((name) =>
    root.querySelector<HTMLElement>(`[data-feature-bar="${name}"]`),
  );
  const featureText = featureNames.map((name) =>
    root.querySelector<HTMLElement>(`[data-feature="${name}"]`),
  );
  const bliss = [...root.querySelectorAll<HTMLElement>("[data-bliss]")];
  if (!tracks.length) return () => {};
  const reduced = reducedMotion();
  const listeners = new AbortController();
  let index = 0;
  let springs: Spring[] = targetsOf(tracks[0]!).map((value) => ({
    value,
    velocity: 0,
  }));
  let clock = 0;
  let elapsed = 0;
  let manualUntil = 0;
  const shown: string[] = [];

  const write = (
    slot: number,
    element: HTMLElement | null | undefined,
    text: string,
  ) => {
    if (!element || shown[slot] === text) return;
    shown[slot] = text;
    element.textContent = text;
  };

  const render = () => {
    const values = springs.map((spring) => spring.value);
    write(0, figures[0], values[0]!.toFixed(1));
    write(1, figures[1], `−${values[1]!.toFixed(1)}`);
    write(2, figures[2], values[2]!.toFixed(1));
    featureNames.forEach((_, i) => {
      const value = Math.max(0, values[3 + i]!);
      featureBars[i]?.style.setProperty("--v", value.toFixed(3));
      write(3 + i, featureText[i], value.toFixed(2));
    });
    bliss.forEach((bar, i) =>
      bar.style.setProperty(
        "--v",
        values[3 + featureNames.length + i]!.toFixed(3),
      ),
    );
  };

  const select = (next: number, manual: boolean) => {
    index = next;
    elapsed = 0;
    if (manual) manualUntil = clock + MANUAL_HOLD;
    const track = tracks[index]!;
    buttons.forEach((button, i) =>
      button.setAttribute("aria-pressed", String(i === index)),
    );
    if (title) scrambleText(title, track.title, { durationMs: 480 });
    if (camelot) camelot.textContent = track.camelot;
    if (key) key.textContent = track.key;
    if (reduced) {
      springs = targetsOf(track).map((value) => ({ value, velocity: 0 }));
      render();
    }
  };

  buttons.forEach((button, i) =>
    button.addEventListener("click", () => select(i, true), {
      signal: listeners.signal,
    }),
  );
  if (reduced) return () => listeners.abort();

  const loop = visibleLoop(
    root,
    (_, dt) => {
      clock += dt;
      const targets = targetsOf(tracks[index]!);
      springs = springs.map((spring, i) =>
        stepSpring(spring, targets[i]!, dt, 90 + (i % 7) * 8, 13),
      );
      render();
      if (clock < manualUntil) return;
      elapsed += dt;
      if (elapsed >= DWELL) select((index + 1) % tracks.length, false);
    },
    {
      onFirstVisible: () => {
        springs = springs.map((spring, i) => ({
          value: i < 3 ? spring.value * 0.6 : 0,
          velocity: 0,
        }));
      },
    },
  );

  return () => {
    listeners.abort();
    loop.cleanup();
  };
}

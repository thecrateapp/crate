import { reducedMotion } from "../motion/env";
import type { Cleanup } from "../motion/page";
import { scrambleText } from "../motion/scramble";
import { onceVisible } from "./loop";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function initHeatmap(root: HTMLElement): Cleanup {
  const grid = root.querySelector<HTMLElement>(".heat-grid");
  const readout = root.querySelector<HTMLElement>("[data-heat-readout]");
  const genre = root.querySelector<HTMLElement>("[data-scramble]");
  const listeners = new AbortController();
  const fallback = readout?.textContent ?? "";

  grid?.addEventListener(
    "pointerover",
    (event) => {
      const cell = (event.target as HTMLElement).closest<HTMLElement>(
        "[data-m]",
      );
      if (!cell || !readout) return;
      const day = DAYS[Number(cell.dataset.d)] ?? "";
      const hour = String(cell.dataset.h).padStart(2, "0");
      readout.textContent = `${day} ${hour}:00 · ${Number(
        cell.dataset.m,
      ).toLocaleString("en-US")} min`;
    },
    { signal: listeners.signal },
  );
  grid?.addEventListener(
    "pointerleave",
    () => {
      if (readout) readout.textContent = fallback;
    },
    { signal: listeners.signal },
  );

  const stopGenre =
    genre && !reducedMotion()
      ? onceVisible(
          genre,
          () =>
            scrambleText(genre, genre.dataset.scramble ?? "", {
              durationMs: 1100,
            }),
          0.6,
        )
      : () => {};

  return () => {
    listeners.abort();
    stopGenre();
  };
}

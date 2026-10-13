import { reducedMotion as prefersReducedMotion } from "./env";

const GLYPHS = "ABCDEFGHJKLMNPRSTUVWXYZ0123456789#/<>_";

interface ScrambleOptions {
  durationMs?: number;
  reducedMotion?: boolean;
}

export function scrambleText(
  element: HTMLElement,
  text: string,
  {
    durationMs = 520,
    reducedMotion = prefersReducedMotion(),
  }: ScrambleOptions = {},
): void {
  if (reducedMotion) {
    element.textContent = text;
    return;
  }
  const start = performance.now();
  function frame(now: number) {
    const progress = Math.min(1, (now - start) / durationMs);
    const settled = Math.floor(text.length * progress);
    element.textContent =
      text.slice(0, settled) +
      [...text.slice(settled)]
        .map((char) =>
          char === " "
            ? " "
            : GLYPHS[Math.floor(Math.random() * GLYPHS.length)],
        )
        .join("");
    if (progress < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

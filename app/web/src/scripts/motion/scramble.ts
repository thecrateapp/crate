import { reducedMotion as prefersReducedMotion } from "./env";

const GLYPHS = "ABCDEFGHJKLMNPRSTUVWXYZ0123456789#/<>_";

interface ScrambleOptions {
  durationMs?: number;
  reducedMotion?: boolean;
}

const running = new WeakMap<HTMLElement, () => void>();

export function scrambleText(
  element: HTMLElement,
  text: string,
  {
    durationMs = 520,
    reducedMotion = prefersReducedMotion(),
  }: ScrambleOptions = {},
): () => void {
  running.get(element)?.();
  if (reducedMotion) {
    element.textContent = text;
    return () => {};
  }
  const start = performance.now();
  let request = 0;
  const cancel = () => {
    cancelAnimationFrame(request);
    if (running.get(element) === cancel) running.delete(element);
  };
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
    if (progress < 1) request = requestAnimationFrame(frame);
    else cancel();
  }
  request = requestAnimationFrame(frame);
  running.set(element, cancel);
  return cancel;
}

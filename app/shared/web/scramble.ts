const GLYPHS = "ABCDEFGHJKLMNPRSTUVWXYZ0123456789#/<>_";
const HOVER_DURATION_MS = 320;

export interface ScrambleOptions {
  durationMs?: number;
  reducedMotion?: boolean;
}

const running = new WeakMap<HTMLElement, () => void>();
const labels = new WeakMap<HTMLElement, string>();

export function scrambleText(
  element: HTMLElement,
  text: string,
  { durationMs = 520, reducedMotion = false }: ScrambleOptions = {},
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

function hoverTarget(link: Element): HTMLElement | null {
  return link.matches("[data-hover-scramble]")
    ? (link as HTMLElement)
    : link.querySelector<HTMLElement>("[data-hover-scramble]");
}

export function initHoverScramble({
  reducedMotion,
}: {
  reducedMotion: boolean;
}): () => void {
  if (
    reducedMotion ||
    !matchMedia("(hover: hover) and (pointer: fine)").matches
  )
    return () => {};

  const onOver = (event: MouseEvent) => {
    const link = (event.target as Element | null)?.closest("a");
    if (!link || link.contains(event.relatedTarget as Node | null)) return;
    const target = hoverTarget(link);
    if (!target) return;
    if (!labels.has(target)) labels.set(target, target.textContent ?? "");
    scrambleText(target, labels.get(target)!, {
      durationMs: HOVER_DURATION_MS,
    });
  };

  document.addEventListener("mouseover", onOver);
  return () => document.removeEventListener("mouseover", onOver);
}

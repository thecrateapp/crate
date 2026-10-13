// TEST_GAP: IntersectionObserver and requestAnimationFrame timing are not available in jsdom; formatCount and countAt are covered in lib/counter.test.ts.
import { countAt, formatCount } from "../../lib/counter";
import { reducedMotion } from "../motion/env";
import type { Cleanup } from "../motion/page";

const DURATION = 1600;

export function initCounters(): Cleanup {
  const items = [...document.querySelectorAll<HTMLElement>("[data-count]")];
  if (!items.length || reducedMotion()) return () => {};
  const frames = new Map<HTMLElement, number>();
  const read = (element: HTMLElement) => ({
    value: Number(element.dataset.value),
    compact: element.dataset.compact !== undefined,
  });
  const show = (element: HTMLElement, progress: number) => {
    const { value, compact } = read(element);
    element.textContent = formatCount(countAt(value, progress), compact);
  };

  function run(element: HTMLElement) {
    const start = performance.now();
    const tick = (now: number) => {
      const progress = (now - start) / DURATION;
      show(element, progress);
      if (progress < 1) frames.set(element, requestAnimationFrame(tick));
      else frames.delete(element);
    };
    frames.set(element, requestAnimationFrame(tick));
  }

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer.unobserve(entry.target);
        run(entry.target as HTMLElement);
      }
    },
    { threshold: 0.6 },
  );
  items.forEach((element) => {
    show(element, 0);
    observer.observe(element);
  });

  return () => {
    observer.disconnect();
    frames.forEach((frame) => cancelAnimationFrame(frame));
    frames.clear();
    items.forEach((element) => show(element, 1));
  };
}

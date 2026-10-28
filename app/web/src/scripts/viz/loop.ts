// TEST_GAP: IntersectionObserver and requestAnimationFrame scheduling do not run in jsdom; views are checked in Playwright.
import type { Cleanup } from "../motion/page";

export interface VisibleLoop {
  readonly visible: boolean;
  cleanup: Cleanup;
}

export function visibleLoop(
  element: Element,
  frame: (time: number, dt: number) => void,
  {
    margin = "10% 0px",
    onFirstVisible,
  }: { margin?: string; onFirstVisible?: () => void } = {},
): VisibleLoop {
  let visible = false;
  let seen = false;
  let request = 0;
  let last = 0;

  const tick = (now: number) => {
    const dt = Math.min(0.05, last ? (now - last) / 1000 : 1 / 60);
    last = now;
    frame(now / 1000, dt);
    request = requestAnimationFrame(tick);
  };

  const start = () => {
    if (request || !visible || document.hidden) return;
    last = 0;
    request = requestAnimationFrame(tick);
  };

  const stop = () => {
    cancelAnimationFrame(request);
    request = 0;
  };

  const observer = new IntersectionObserver(
    ([entry]) => {
      visible = !!entry?.isIntersecting;
      if (visible && !seen) {
        seen = true;
        onFirstVisible?.();
      }
      if (visible) start();
      else stop();
    },
    { rootMargin: margin },
  );
  observer.observe(element);

  const onVisibility = () => (document.hidden ? stop() : start());
  document.addEventListener("visibilitychange", onVisibility);

  return {
    get visible() {
      return visible;
    },
    cleanup() {
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      stop();
    },
  };
}

export function onceVisible(
  element: Element,
  callback: () => void,
  threshold = 0.35,
): Cleanup {
  const observer = new IntersectionObserver(
    ([entry]) => {
      if (!entry?.isIntersecting) return;
      observer.disconnect();
      callback();
    },
    { threshold },
  );
  observer.observe(element);
  return () => observer.disconnect();
}

const SVG_NS = "http://www.w3.org/2000/svg";

export function svg<K extends keyof SVGElementTagNameMap>(
  parent: Element,
  name: K,
  attributes: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes))
    element.setAttribute(key, String(value));
  parent.appendChild(element);
  return element;
}

export function observeSize(
  element: Element,
  callback: (width: number, height: number) => void,
): Cleanup {
  let width = 0;
  let height = 0;
  const observer = new ResizeObserver(([entry]) => {
    if (!entry) return;
    const next = entry.contentRect;
    if (Math.round(next.width) === width && Math.round(next.height) === height)
      return;
    width = Math.round(next.width);
    height = Math.round(next.height);
    if (width > 0 && height > 0) callback(width, height);
  });
  observer.observe(element);
  return () => observer.disconnect();
}

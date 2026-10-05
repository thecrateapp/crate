import { useEffect, useRef, useState } from "react";

import {
  getListenViewportScrollElement,
  getListenViewportScrollTop,
} from "@/lib/viewport-scroll";

export const HEADER_SOLID_SCROLL_THRESHOLD = 96;

interface ScrollState {
  key: string;
  scrolled: boolean;
}

export function useScrolledPast(
  threshold: number,
  enabled: boolean,
  resetKey: string,
) {
  const [state, setState] = useState<ScrollState>({
    key: resetKey,
    scrolled: false,
  });
  const lastRef = useRef(state);

  useEffect(() => {
    if (!enabled) return;
    let frame = 0;
    const scrollTarget: HTMLElement | Window =
      getListenViewportScrollElement() ?? window;
    const measure = () => {
      frame = 0;
      const scrolled = getListenViewportScrollTop() > threshold;
      const last = lastRef.current;
      if (last.key === resetKey && last.scrolled === scrolled) return;
      const next = { key: resetKey, scrolled };
      lastRef.current = next;
      setState(next);
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(measure);
    };
    measure();
    scrollTarget.addEventListener("scroll", schedule, { passive: true });
    return () => {
      scrollTarget.removeEventListener("scroll", schedule);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [enabled, threshold, resetKey]);

  return enabled && state.key === resetKey && state.scrolled;
}

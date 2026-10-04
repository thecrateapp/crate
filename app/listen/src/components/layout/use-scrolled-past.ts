import { useEffect, useRef, useState } from "react";

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
    const measure = () => {
      frame = 0;
      const scrolled = window.scrollY > threshold;
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
    window.addEventListener("scroll", schedule, { passive: true });
    return () => {
      window.removeEventListener("scroll", schedule);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [enabled, threshold, resetKey]);

  return enabled && state.key === resetKey && state.scrolled;
}

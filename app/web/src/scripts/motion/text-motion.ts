import type { Cleanup } from "./page";
import { initReveals } from "./reveal";
import { initSmoothScroll } from "./smooth-scroll";
import { splitWords } from "./split-words";

export function initTextMotion(splitSelector = "[data-split]"): Cleanup {
  document.querySelectorAll<HTMLElement>(splitSelector).forEach((element) => {
    if (!element.querySelector(".w")) splitWords(element);
  });
  const cleanups = [initSmoothScroll(), initReveals()];
  return () => cleanups.forEach((cleanup) => cleanup());
}

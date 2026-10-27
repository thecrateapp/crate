import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import { finePointer, reducedMotion } from "./env";

gsap.registerPlugin(ScrollTrigger);

const LAG_THRESHOLD = 500;
const ADJUSTED_LAG = 33;

let lenis: Lenis | null = null;

function tick(time: number) {
  lenis?.raf(time * 1000);
}

export function initSmoothScroll(): () => void {
  if (lenis || reducedMotion() || !finePointer()) return () => {};
  lenis = new Lenis({ lerp: 0.1 });
  lenis.on("scroll", ScrollTrigger.update);
  gsap.ticker.add(tick);
  gsap.ticker.lagSmoothing(0);
  return () => {
    gsap.ticker.remove(tick);
    gsap.ticker.lagSmoothing(LAG_THRESHOLD, ADJUSTED_LAG);
    lenis?.destroy();
    lenis = null;
  };
}

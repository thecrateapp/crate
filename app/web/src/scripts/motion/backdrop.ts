import type { Cleanup } from "./page";

export function backdropShade(scroll: number, viewport: number): number {
  return Math.min(1, Math.max(0, (scroll - viewport * 0.6) / viewport));
}

export function initBackdrop(): Cleanup {
  const backdrop = document.querySelector<HTMLElement>(".backdrop.is-full");
  if (!backdrop) return () => {};
  let frame = 0;
  const update = () => {
    frame = 0;
    backdrop.style.setProperty(
      "--shade",
      backdropShade(scrollY, innerHeight).toFixed(3),
    );
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(update);
  };
  update();
  addEventListener("scroll", schedule, { passive: true });
  addEventListener("resize", schedule, { passive: true });
  return () => {
    cancelAnimationFrame(frame);
    removeEventListener("scroll", schedule);
    removeEventListener("resize", schedule);
  };
}

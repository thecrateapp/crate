import { reducedMotion } from "@crate-web/scripts/motion/env";
import { bouncePosition } from "../lib/beam";

/**
 * Drives every [data-beam] track: its [data-beam-segment] bounces end to end.
 * data-running="false" (or reduced motion) parks the segment in the middle.
 * data-leg sets the leg length in ms.
 */
export function mountBeams(): () => void {
  const beams = [...document.querySelectorAll<HTMLElement>("[data-beam]")];
  const still = reducedMotion();
  let frame = 0;
  let visible = new Set<HTMLElement>();

  const place = (beam: HTMLElement, time: number) => {
    const segment = beam.querySelector<HTMLElement>("[data-beam-segment]");
    if (!segment) return;
    const track = beam.clientWidth;
    const width = segment.offsetWidth;
    const running = beam.dataset.running !== "false";
    const x = running
      ? bouncePosition(time, track, width, Number(beam.dataset.leg) || 900).x
      : (track - width) / 2;
    segment.style.transform = `translateX(${x}px)`;
  };

  if (still) {
    for (const beam of beams) {
      beam.dataset.running = "false";
      place(beam, 0);
    }
    const settle = () => beams.forEach((beam) => place(beam, 0));
    addEventListener("resize", settle);
    return () => removeEventListener("resize", settle);
  }

  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const beam = entry.target as HTMLElement;
      if (entry.isIntersecting) visible.add(beam);
      else visible.delete(beam);
    }
  });
  beams.forEach((beam) => {
    place(beam, 0);
    observer.observe(beam);
  });

  const tick = (time: number) => {
    visible.forEach((beam) => place(beam, time));
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);

  return () => {
    cancelAnimationFrame(frame);
    observer.disconnect();
    visible = new Set();
  };
}

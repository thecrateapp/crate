import { useLayoutEffect } from "react";
import type { CrossfadeTransition } from "@/contexts/PlayerContext";
import {
  isMotionBlocked,
  subscribeToMotionAvailability,
} from "@/lib/motion-availability";

// One player owns one UI crossfade. Bar/fullscreen/extended share its clock, not React ticks.
const owners = new Map<symbol, CrossfadeTransition>();
let frame = 0;
function readCrossfadeProgress(transition: CrossfadeTransition | null) {
  if (!transition) return 1;
  return isMotionBlocked() || !(transition.durationMs > 0)
    ? 1
    : Math.max(
        0,
        Math.min(
          1,
          (performance.now() - transition.startedAt) / transition.durationMs,
        ),
      );
}
function updateCrossfade() {
  frame = 0;
  const transition = [...owners.values()].sort(
    (a, b) => b.startedAt - a.startedAt,
  )[0];
  if (!transition) return;
  const progress = readCrossfadeProgress(transition);
  document.documentElement.style.setProperty(
    "--listen-crossfade-progress",
    String(progress),
  );
  if (progress < 1) frame = requestAnimationFrame(updateCrossfade);
}
export function useCrossfadeProgress(
  transition: CrossfadeTransition | null,
): number {
  useLayoutEffect(() => {
    if (!transition) return;
    const owner = Symbol("crossfade");
    owners.set(owner, transition);
    const start = () => {
      cancelAnimationFrame(frame);
      updateCrossfade();
    };
    const unsubscribe = subscribeToMotionAvailability(start);
    if (!frame) start();
    return () => {
      owners.delete(owner);
      unsubscribe();
      if (!owners.size) {
        cancelAnimationFrame(frame);
        frame = 0;
        document.documentElement.style.removeProperty(
          "--listen-crossfade-progress",
        );
      }
    };
  }, [transition]);
  // Valid already on the initial render; layout effect aligns shared layers before paint.
  return readCrossfadeProgress(transition);
}
export function getCrossfadeAwareProgress(
  _transition: CrossfadeTransition | null,
  liveCurrentTime: number,
  liveDuration: number,
) {
  return { displayedTime: liveCurrentTime, displayedDuration: liveDuration };
}
export function useCrossfadeAwareProgress(
  transition: CrossfadeTransition | null,
  liveCurrentTime: number,
  liveDuration: number,
) {
  return getCrossfadeAwareProgress(transition, liveCurrentTime, liveDuration);
}

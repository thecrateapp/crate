import type { RepeatMode } from "@/contexts/player-types";

export interface NextTrackResolutionSnapshot<T> {
  queue: T[];
  currentIndex: number;
  nextIndex: number;
  expectedUrl: string;
}

export interface NextTrackResolutionState<T> {
  queue: T[];
  currentIndex: number;
  engineIndex: number;
  engineUrl: string | undefined;
}

export function getNextTrackIndex(
  queueLength: number,
  currentIndex: number,
  repeat: RepeatMode,
): number | null {
  if (queueLength < 2 || repeat === "one") return null;
  if (currentIndex + 1 < queueLength) return currentIndex + 1;
  return repeat === "all" ? 0 : null;
}

export function canApplyNextTrackResolution<T>(
  snapshot: NextTrackResolutionSnapshot<T>,
  state: NextTrackResolutionState<T>,
): boolean {
  return (
    state.queue === snapshot.queue &&
    state.currentIndex === snapshot.currentIndex &&
    state.engineIndex === snapshot.currentIndex &&
    state.engineUrl === snapshot.expectedUrl
  );
}

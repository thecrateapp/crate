import { createContext, useCallback, useContext, useRef } from "react";

import { PlayerProgressContext } from "./player-progress-context";

/**
 * Reads the exact engine position, updated on every engine tick (~27 ms),
 * while `PlayerProgressContext` commits at ~4 Hz. Only leaves that animate
 * continuously (the lyric underline) read it, from their own
 * requestAnimationFrame loop gated by the motion gate.
 */
export const PlayerTimeReaderContext = createContext<(() => number) | null>(
  null,
);

export function usePlayerTimeReader(): () => number {
  const reader = useContext(PlayerTimeReaderContext);
  const progress = useContext(PlayerProgressContext);
  // Providers without a reader (tests, public shells) fall back to progress.
  const latest = useRef(progress?.currentTime ?? 0);
  latest.current = progress?.currentTime ?? 0;
  const fallback = useCallback(() => latest.current, []);
  return reader ?? fallback;
}

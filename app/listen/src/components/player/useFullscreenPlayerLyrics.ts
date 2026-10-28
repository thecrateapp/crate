import type { RefObject } from "react";
import type { Track } from "@/contexts/player-types";
import { useLyrics } from "./extended/use-lyrics";
export { parseSyncedLyrics } from "./extended/lyrics-data";
export type { LyricLine } from "./extended/lyrics-data";
/** Legacy controller facade; the synced clock leaf owns active lines and scrolling. */
export function useFullscreenPlayerLyrics({
  activePanel,
  currentTrack,
  visible,
}: {
  activeLyricRef: RefObject<HTMLButtonElement | null>;
  activePanel: string | null;
  currentTime: number;
  currentTrack: Track | null;
  visible: boolean;
}) {
  const state = useLyrics(
    visible && activePanel === "lyrics" ? currentTrack : null,
  );
  return { ...state, activeLyricIndex: -1 };
}

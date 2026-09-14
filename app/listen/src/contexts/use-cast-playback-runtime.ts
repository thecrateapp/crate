import { useEffect, type Dispatch, type SetStateAction } from "react";

import { subscribeCastPlaybackState } from "@/lib/cast-sender";

interface UseCastPlaybackRuntimeOptions {
  commitCurrentTime: (time: number) => void;
  commitDuration: (duration: number) => void;
  commitIsBuffering: (isBuffering: boolean) => void;
  commitIsPlaying: (isPlaying: boolean) => void;
  setVolumeState: Dispatch<SetStateAction<number>>;
}

export function useCastPlaybackRuntime({
  commitCurrentTime,
  commitDuration,
  commitIsBuffering,
  commitIsPlaying,
  setVolumeState,
}: UseCastPlaybackRuntimeOptions): void {
  useEffect(
    () =>
      subscribeCastPlaybackState((state) => {
        if (!state.active) return;
        commitCurrentTime(state.currentTime);
        if (state.duration > 0) commitDuration(state.duration);
        commitIsBuffering(state.isBuffering);
        commitIsPlaying(state.isPlaying);
        if (state.volume !== undefined) setVolumeState(state.volume);
      }),
    [
      commitCurrentTime,
      commitDuration,
      commitIsBuffering,
      commitIsPlaying,
      setVolumeState,
    ],
  );
}

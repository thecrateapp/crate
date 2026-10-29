import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

import {
  isCastSessionActive,
  subscribeCastPlaybackState,
} from "@/lib/cast-sender";

interface UseCastPlaybackRuntimeOptions {
  queueRef?: { readonly current: unknown[] };
  onQueueEnded?: () => boolean;
  onDisconnect?: () => void;
  onResume?: () => void;
  onPause?: () => void;
  commitCurrentIndex: (index: number) => void;
  commitCurrentTime: (time: number) => void;
  commitDuration: (duration: number) => void;
  commitIsBuffering: (isBuffering: boolean) => void;
  commitIsPlaying: (isPlaying: boolean) => void;
  setVolumeState: Dispatch<SetStateAction<number>>;
}

export function useCastPlaybackRuntime({
  queueRef,
  onQueueEnded,
  onDisconnect,
  onResume,
  onPause,
  commitCurrentIndex,
  commitCurrentTime,
  commitDuration,
  commitIsBuffering,
  commitIsPlaying,
  setVolumeState,
}: UseCastPlaybackRuntimeOptions): boolean {
  const callbacks = useRef({
    queueRef,
    onQueueEnded,
    onDisconnect,
    onResume,
    onPause,
  });
  useLayoutEffect(() => {
    callbacks.current = {
      queueRef,
      onQueueEnded,
      onDisconnect,
      onResume,
      onPause,
    };
  }, [queueRef, onQueueEnded, onDisconnect, onResume, onPause]);
  const wasActive = useRef(false);
  const wasPlaying = useRef(false);
  const [active, setActive] = useState(isCastSessionActive);
  useEffect(
    () =>
      subscribeCastPlaybackState((state) => {
        setActive(state.active);
        if (!state.active) {
          if (wasActive.current) callbacks.current.onDisconnect?.();
          wasActive.current = false;
          wasPlaying.current = false;
          return;
        }
        wasActive.current = true;
        const ended =
          wasPlaying.current &&
          state.playerState !== "PAUSED" &&
          !state.isPlaying &&
          !state.isBuffering &&
          (state.mediaFinished ??
            (state.duration > 0 && state.currentTime >= state.duration - 2)) &&
          state.currentIndex ===
            (callbacks.current.queueRef?.current.length ?? 0) - 1;
        if (state.playerState === "PAUSED") callbacks.current.onPause?.();
        if (!wasPlaying.current && state.isPlaying)
          callbacks.current.onResume?.();
        if (state.isPlaying || state.playerState === "PAUSED" || ended)
          wasPlaying.current = state.isPlaying;
        if (state.currentIndex !== undefined) {
          commitCurrentIndex(state.currentIndex);
        }
        commitCurrentTime(state.currentTime);
        if (state.duration > 0) commitDuration(state.duration);
        commitIsBuffering(state.isBuffering);
        commitIsPlaying(state.isPlaying);
        if (ended && callbacks.current.onQueueEnded?.())
          commitIsBuffering(true);
        if (state.volume !== undefined) setVolumeState(state.volume);
      }),
    [
      commitCurrentIndex,
      commitCurrentTime,
      commitDuration,
      commitIsBuffering,
      commitIsPlaying,
      setVolumeState,
    ],
  );
  return active;
}

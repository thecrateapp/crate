import { useMemo } from "react";

import type {
  PlayerActionsValue,
  PlayerProgressValue,
  PlayerStateValue,
} from "@/contexts/player-context";

interface PlayerContextValuesInput {
  actions: PlayerActionsValue;
  progress: PlayerProgressValue;
  state: PlayerStateValue;
}

export function usePlayerContextValues({
  actions,
  progress,
  state,
}: PlayerContextValuesInput) {
  const stateValue = useMemo(
    () => state,
    [
      state.analyserVersion,
      state.crossfadeTransition,
      state.isBuffering,
      state.isPlaying,
      state.volume,
    ],
  );

  const progressValue = useMemo(
    () => progress,
    [progress.currentTime, progress.duration],
  );

  const actionsValue = useMemo(
    () => actions,
    [
      actions.addToQueue,
      actions.captureQueueSnapshot,
      actions.clearQueue,
      actions.connect,
      actions.currentIndex,
      actions.currentTrack,
      actions.cycleRepeat,
      actions.enterJamSession,
      actions.jamQueueLocked,
      actions.jamTransport,
      actions.jumpTo,
      actions.leaveJamSession,
      actions.next,
      actions.pause,
      actions.play,
      actions.playAll,
      actions.playNext,
      actions.playSource,
      actions.prev,
      actions.publishConnectState,
      actions.queue,
      actions.reorderQueue,
      actions.removeFromQueue,
      actions.repeat,
      actions.restoreQueueSnapshot,
      actions.recentlyPlayed,
      actions.resume,
      actions.seek,
      actions.setJamTransport,
      actions.setPlaybackRate,
      actions.setVolume,
      actions.shuffle,
      actions.smartCrossfadeEnabled,
      actions.syncJamQueue,
      actions.toggleShuffle,
    ],
  );

  return { actionsValue, progressValue, stateValue };
}

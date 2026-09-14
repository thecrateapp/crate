import { useMemo } from "react";
import type { CrossfadeTransition } from "@/contexts/player-context";
import type { RepeatMode, Track } from "@/contexts/player-types";
import { isCastSessionActive } from "@/lib/cast-sender";
import type { PlaybackTargetContext } from "@/lib/playback-targets";

type IsLiked = (
  trackId?: number | null,
  trackEntityUid?: string | null,
  trackPath?: string | null,
  globalTrackUid?: string | null,
) => boolean;

type UsePlayerBarComputedStateOptions = {
  crossfadeTransition: CrossfadeTransition | null;
  isDesktop: boolean;
  fsOpen: boolean;
  isRemoteConnectActive: boolean;
  isBuffering: boolean;
  effectiveDisplayedTime: number;
  effectiveDisplayedDuration: number;
  effectiveVolume: number;
  displayTrack: Track | undefined;
  displayQueue: Track[];
  displayCurrentIndex: number;
  jamQueueLocked: boolean;
  repeat: RepeatMode;
  shuffle: boolean;
  legacyConnectEnabled: boolean;
  activeConnectDeviceId: string | null;
  activeConnectSession: PlaybackTargetContext["activeConnectSession"];
  connect: PlaybackTargetContext["connect"];
  pause: PlaybackTargetContext["pause"];
  pauseLocal: PlaybackTargetContext["pauseLocal"];
  resumeLocal: PlaybackTargetContext["resumeLocal"];
  publishConnectState: PlaybackTargetContext["publishConnectState"];
  isLiked: IsLiked;
};

export function usePlayerBarComputedState({
  crossfadeTransition,
  isDesktop,
  fsOpen,
  isRemoteConnectActive,
  isBuffering,
  effectiveDisplayedTime,
  effectiveDisplayedDuration,
  effectiveVolume,
  displayTrack,
  displayQueue,
  displayCurrentIndex,
  jamQueueLocked,
  repeat,
  shuffle,
  legacyConnectEnabled,
  activeConnectDeviceId,
  activeConnectSession,
  connect,
  pause,
  pauseLocal,
  resumeLocal,
  publishConnectState,
  isLiked,
}: UsePlayerBarComputedStateOptions) {
  const playbackTargetContext = useMemo<PlaybackTargetContext>(
    () => ({
      currentTrack: displayTrack,
      currentTime: effectiveDisplayedTime,
      currentIndex: displayCurrentIndex,
      queue: displayQueue,
      repeatMode: repeat,
      shuffle,
      playbackAuthority: jamQueueLocked
        ? "jam"
        : isRemoteConnectActive
          ? "connect"
          : isCastSessionActive()
            ? "cast"
            : "local",
      volume: effectiveVolume,
      activeConnectDeviceId: legacyConnectEnabled
        ? activeConnectDeviceId
        : null,
      activeConnectSession: legacyConnectEnabled ? activeConnectSession : null,
      connect,
      pause,
      pauseLocal,
      resumeLocal,
      publishConnectState,
    }),
    [
      activeConnectDeviceId,
      activeConnectSession,
      connect,
      displayCurrentIndex,
      displayQueue,
      displayTrack,
      effectiveDisplayedTime,
      effectiveVolume,
      legacyConnectEnabled,
      isRemoteConnectActive,
      jamQueueLocked,
      pause,
      pauseLocal,
      publishConnectState,
      repeat,
      resumeLocal,
      shuffle,
    ],
  );

  const liked = isLiked(
    displayTrack?.libraryTrackId ?? null,
    displayTrack?.entityUid ?? null,
    displayTrack ? displayTrack.path || displayTrack.id : "",
    displayTrack?.globalTrackUid ?? null,
  );

  return {
    displayCrossfadeTransition: isRemoteConnectActive
      ? null
      : crossfadeTransition,
    effectiveIsBuffering: isRemoteConnectActive ? false : isBuffering,
    hidePlayerBarForMobileFullscreen: !isDesktop && fsOpen,
    liked,
    playbackTargetContext,
    progressPct:
      effectiveDisplayedDuration > 0
        ? Math.max(
            0,
            Math.min(
              100,
              (effectiveDisplayedTime / effectiveDisplayedDuration) * 100,
            ),
          )
        : 0,
  };
}

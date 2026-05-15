import {
  useCallback,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";

import type { PlaySource, RepeatMode, Track } from "@/contexts/player-types";
import { toEngineTracks } from "@/contexts/player-engine-adapter";
import {
  clampIndex,
  resolveQueueFromUrls,
} from "@/contexts/player-queue-helpers";
import {
  getEffectiveCrossfadeSeconds,
  getPredictableNextTrack,
  getTrackCacheKey,
  MAX_RECENT,
  saveRecentlyPlayed,
} from "@/contexts/player-utils";
import {
  getCurrentTrackDuration as gpGetCurrentTrackDuration,
  getTrackIndex as gpGetTrackIndex,
  getTracks as gpGetTracks,
  loadQueue as gpLoadQueue,
  pause as gpPause,
  play as gpPlay,
  seekTo as gpSeekTo,
  setCrossfadeDuration as gpSetCrossfadeDuration,
  setLoop as gpSetLoop,
  setSingleMode as gpSetSingleMode,
  stop as gpStop,
} from "@/lib/gapless-player";
import {
  androidNativeEngine,
  isAndroidNativePlayerAvailable,
  shouldUseAndroidNativePlayer,
} from "@/lib/android-native-engine";
import { getCrossfadeDurationPreference } from "@/lib/player-playback-prefs";
import { createQueueRevision } from "@/lib/playback-engine";

interface UsePlayerEngineSyncParams {
  queueRef: MutableRefObject<Track[]>;
  currentIndexRef: MutableRefObject<number>;
  currentTrackRef: MutableRefObject<Track | undefined>;
  repeatRef: MutableRefObject<RepeatMode>;
  shuffleRef: MutableRefObject<boolean>;
  playSourceRef: MutableRefObject<PlaySource | null>;
  smartCrossfadeEnabledRef: MutableRefObject<boolean>;
  effectiveCrossfadeMsRef: MutableRefObject<number>;
  isPlayingRef: MutableRefObject<boolean>;
  durationRef: MutableRefObject<number>;
  bufferingIntentRef: MutableRefObject<boolean>;
  activatedTrackKeyRef: MutableRefObject<string | null>;
  engineTrackMapRef: MutableRefObject<Map<string, Track[]>>;
  setRecentlyPlayed: Dispatch<SetStateAction<Track[]>>;
  commitQueue: (queue: Track[]) => void;
  commitCurrentIndex: (index: number) => void;
  commitCurrentTime: (time: number) => void;
  commitDuration: (duration: number) => void;
  commitIsPlaying: (isPlaying: boolean) => void;
  commitIsBuffering: (isBuffering: boolean) => void;
  buildEngineUrls: (tracks: Track[]) => string[];
  clearPrevRestartLatch: () => void;
  markSeekPosition: (seconds: number) => void;
}

function silenceGaplessEngine() {
  gpPause();
  gpStop();
  gpLoadQueue([], 0);
}

function stopNativeEngineIfAvailable(context: string) {
  if (!isAndroidNativePlayerAvailable()) return;
  void androidNativeEngine.stop().catch((error) => {
    console.error(`[native-player] failed to stop ${context}:`, error);
  });
}

export function usePlayerEngineSync({
  queueRef,
  currentIndexRef,
  currentTrackRef,
  repeatRef,
  shuffleRef,
  playSourceRef,
  smartCrossfadeEnabledRef,
  effectiveCrossfadeMsRef,
  isPlayingRef,
  durationRef,
  bufferingIntentRef,
  activatedTrackKeyRef,
  engineTrackMapRef,
  setRecentlyPlayed,
  commitQueue,
  commitCurrentIndex,
  commitCurrentTime,
  commitDuration,
  commitIsPlaying,
  commitIsBuffering,
  buildEngineUrls,
  clearPrevRestartLatch,
  markSeekPosition,
}: UsePlayerEngineSyncParams) {
  const syncEffectiveCrossfade = useCallback(() => {
    const nextTrack = getPredictableNextTrack(
      queueRef.current,
      currentIndexRef.current,
      repeatRef.current,
      shuffleRef.current,
    );
    const effectiveSeconds = getEffectiveCrossfadeSeconds(
      currentTrackRef.current,
      nextTrack,
      playSourceRef.current,
      shuffleRef.current,
      getCrossfadeDurationPreference(),
      smartCrossfadeEnabledRef.current,
    );
    const effectiveMs = Math.max(0, effectiveSeconds * 1000);
    effectiveCrossfadeMsRef.current = effectiveMs;
    gpSetCrossfadeDuration(effectiveMs);
    return effectiveMs;
  }, [
    currentIndexRef,
    currentTrackRef,
    effectiveCrossfadeMsRef,
    playSourceRef,
    queueRef,
    repeatRef,
    shuffleRef,
    smartCrossfadeEnabledRef,
  ]);

  const addToRecentlyPlayed = useCallback(
    (track: Track) => {
      setRecentlyPlayed((previous) => {
        const filtered = previous.filter(
          (candidate) => candidate.id !== track.id,
        );
        const updated = [track, ...filtered].slice(0, MAX_RECENT);
        saveRecentlyPlayed(updated);
        return updated;
      });
    },
    [setRecentlyPlayed],
  );

  const rememberActiveTrack = useCallback(
    (track: Track | undefined) => {
      if (!track) {
        activatedTrackKeyRef.current = null;
        return;
      }
      const trackKey = getTrackCacheKey(track);
      if (activatedTrackKeyRef.current === trackKey) return;
      activatedTrackKeyRef.current = trackKey;
      addToRecentlyPlayed(track);
    },
    [activatedTrackKeyRef, addToRecentlyPlayed],
  );

  const pullFromEngine = useCallback(
    (sourceQueue?: Track[]) => {
      const resolvedQueue = resolveQueueFromUrls(
        gpGetTracks(),
        sourceQueue ?? queueRef.current,
        engineTrackMapRef.current,
      );
      const resolvedIndex = clampIndex(gpGetTrackIndex(), resolvedQueue.length);
      const resolvedTrack = resolvedQueue[resolvedIndex];
      const engineDuration = Math.max(gpGetCurrentTrackDuration() / 1000, 0);
      const knownDuration =
        typeof resolvedTrack?.duration === "number" &&
        Number.isFinite(resolvedTrack.duration) &&
        resolvedTrack.duration > 0
          ? resolvedTrack.duration
          : 0;
      const resolvedDuration = engineDuration || knownDuration;

      const previousQueue = queueRef.current;
      const sameQueue =
        resolvedQueue.length === previousQueue.length &&
        resolvedQueue.every((track, index) => track === previousQueue[index]);
      if (!sameQueue) {
        commitQueue(resolvedQueue);
      }

      if (resolvedIndex !== currentIndexRef.current) {
        commitCurrentIndex(resolvedIndex);
      }
      if (resolvedDuration !== durationRef.current) {
        commitDuration(resolvedDuration);
      }
      rememberActiveTrack(resolvedTrack);

      return {
        resolvedQueue,
        resolvedIndex,
        resolvedTrack,
      };
    },
    [
      commitCurrentIndex,
      commitDuration,
      commitQueue,
      currentIndexRef,
      durationRef,
      engineTrackMapRef,
      queueRef,
      rememberActiveTrack,
    ],
  );

  const pushToEngine = useCallback(
    (
      nextQueue: Track[],
      requestedIndex: number,
      options?: { autoplay?: boolean; positionMs?: number },
    ) => {
      const nextIndex = clampIndex(requestedIndex, nextQueue.length);
      const autoplay = options?.autoplay ?? isPlayingRef.current;
      const positionMs = options?.positionMs ?? 0;

      if (nextQueue.length === 0) {
        bufferingIntentRef.current = false;
        stopNativeEngineIfAvailable("empty queue sync");
        gpPause();
        gpStop();
        gpLoadQueue([], 0);
        engineTrackMapRef.current = new Map();
        commitQueue([]);
        commitCurrentIndex(0);
        commitCurrentTime(0);
        commitDuration(0);
        commitIsPlaying(false);
        commitIsBuffering(false);
        activatedTrackKeyRef.current = null;
        return;
      }

      if (shouldUseAndroidNativePlayer()) {
        silenceGaplessEngine();
        const targetTrack = nextQueue[nextIndex];
        const knownDuration =
          typeof targetTrack?.duration === "number" &&
          Number.isFinite(targetTrack.duration) &&
          targetTrack.duration > 0
            ? targetTrack.duration
            : 0;
        const positionSeconds = positionMs / 1000;

        commitQueue(nextQueue);
        commitCurrentIndex(nextIndex);
        commitCurrentTime(positionSeconds);
        commitDuration(knownDuration);
        rememberActiveTrack(targetTrack);

        if (positionMs > 0) {
          markSeekPosition(positionSeconds);
        }

        bufferingIntentRef.current = autoplay;
        commitIsBuffering(autoplay);
        commitIsPlaying(autoplay);

        void androidNativeEngine
          .loadQueue({
            revision: createQueueRevision(),
            tracks: toEngineTracks(nextQueue),
            currentIndex: nextIndex,
            positionMs,
            autoplay,
            repeat: repeatRef.current,
            crossfadeMs: effectiveCrossfadeMsRef.current,
            volume: 1,
          })
          .catch((error) => {
            console.error("[native-player] failed to sync queue:", error);
            commitIsBuffering(false);
            commitIsPlaying(false);
          });
        return;
      }

      stopNativeEngineIfAvailable("before web engine sync");
      gpLoadQueue(buildEngineUrls(nextQueue), nextIndex);
      gpSetLoop(repeatRef.current === "all");
      gpSetSingleMode(repeatRef.current === "one");

      pullFromEngine(nextQueue);

      if (positionMs > 0) {
        gpSeekTo(positionMs);
        const positionSeconds = positionMs / 1000;
        commitCurrentTime(positionSeconds);
        markSeekPosition(positionSeconds);
      } else {
        commitCurrentTime(0);
      }

      if (autoplay) {
        bufferingIntentRef.current = true;
        commitIsBuffering(true);
        gpPlay();
      } else {
        bufferingIntentRef.current = false;
        gpPause();
        commitIsPlaying(false);
        commitIsBuffering(false);
      }
    },
    [
      activatedTrackKeyRef,
      buildEngineUrls,
      bufferingIntentRef,
      commitCurrentIndex,
      commitCurrentTime,
      commitDuration,
      commitIsBuffering,
      commitIsPlaying,
      commitQueue,
      effectiveCrossfadeMsRef,
      engineTrackMapRef,
      isPlayingRef,
      markSeekPosition,
      pullFromEngine,
      rememberActiveTrack,
      repeatRef,
    ],
  );

  const advanceCursorTo = useCallback(
    (index: number) => {
      const targetTrack = queueRef.current[index];
      const engineDuration = Math.max(gpGetCurrentTrackDuration() / 1000, 0);
      const fallbackDuration =
        typeof targetTrack?.duration === "number" &&
        Number.isFinite(targetTrack.duration) &&
        targetTrack.duration > 0
          ? targetTrack.duration
          : 0;
      clearPrevRestartLatch();
      commitCurrentIndex(index);
      commitCurrentTime(0);
      commitDuration(engineDuration || fallbackDuration);
      rememberActiveTrack(targetTrack);
      bufferingIntentRef.current = true;
      commitIsBuffering(true);
    },
    [
      bufferingIntentRef,
      clearPrevRestartLatch,
      commitCurrentIndex,
      commitCurrentTime,
      commitDuration,
      commitIsBuffering,
      queueRef,
      rememberActiveTrack,
    ],
  );

  return {
    syncEffectiveCrossfade,
    rememberActiveTrack,
    pullFromEngine,
    pushToEngine,
    advanceCursorTo,
  };
}

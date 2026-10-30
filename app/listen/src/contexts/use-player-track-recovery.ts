import { useCallback, useEffect, useRef } from "react";

import type { PlaySource, Track } from "@/contexts/player-types";
import type { PlaybackQueueReadiness } from "@/contexts/playback-intelligence-model";
import { clampIndex } from "@/contexts/player-queue-helpers";
import { getTrackCacheKey } from "@/contexts/player-utils";
import {
  canApplyNextTrackResolution,
  getNextTrackIndex,
} from "@/contexts/player-next-track-resolution";
import {
  toFreshEngineTrack,
  toStartupEngineQueueSnapshot,
  toStartupEngineTracks,
} from "@/contexts/player-engine-adapter";
import {
  androidNativeEngine,
  shouldUseAndroidNativePlayer,
} from "@/lib/android-native-engine";
import {
  getTrackIndex as gpGetTrackIndex,
  getTracks as gpGetTracks,
  loadQueue as gpLoadQueue,
  play as gpPlay,
  replaceTrack as gpReplaceTrack,
  seekTo as gpSeekTo,
} from "@/lib/gapless-player";
import { createQueueRevision } from "@/lib/playback-engine";
import { getNativeCrossfadeMs } from "@/lib/player-playback-prefs";

interface Ref<T> {
  current: T;
}

interface UsePlayerTrackRecoveryOptions {
  buildEngineUrls: (tracks: Track[], resolvedUrls?: string[]) => string[];
  currentIndexRef: Ref<number>;
  currentTimeRef: Ref<number>;
  effectiveCrossfadeMsRef: Ref<number>;
  lastNonZeroVolumeRef: Ref<number>;
  playSourceRef: Ref<PlaySource | null>;
  queueReadinessRef: Ref<PlaybackQueueReadiness>;
  queueRef: Ref<Track[]>;
  repeatRef: Ref<"off" | "one" | "all">;
  shuffleRef: Ref<boolean>;
}

export interface PlayerTrackRecoveryRuntime {
  preResolveNextTrack: () => void;
  recoverActiveTrackRef: Ref<() => Promise<boolean>>;
}

export function buildTrackResolutionKey(
  currentTrackKey: string,
  nextTrackKey: string,
  currentIndex: number,
  nextIndex: number,
  expectedUrl: string,
): string {
  return [
    currentTrackKey,
    nextTrackKey,
    currentIndex,
    nextIndex,
    expectedUrl,
  ].join(":");
}

export function usePlayerTrackRecovery({
  buildEngineUrls,
  currentIndexRef,
  currentTimeRef,
  effectiveCrossfadeMsRef,
  lastNonZeroVolumeRef,
  playSourceRef,
  queueReadinessRef,
  queueRef,
  repeatRef,
  shuffleRef,
}: UsePlayerTrackRecoveryOptions): PlayerTrackRecoveryRuntime {
  const recoverActiveTrackRef = useRef<() => Promise<boolean>>(
    async () => false,
  );
  const nextTrackResolutionKeyRef = useRef<string | null>(null);

  const recoverActiveTrack = useCallback(async () => {
    const recoveryQueue = queueRef.current;
    if (recoveryQueue.length === 0) return false;
    const recoveryIndex = clampIndex(
      currentIndexRef.current,
      recoveryQueue.length,
    );
    const positionMs = Math.max(0, Math.round(currentTimeRef.current * 1000));
    const nativePlayerActive = shouldUseAndroidNativePlayer();

    if (nativePlayerActive) {
      const revision = createQueueRevision();
      const snapshot = await toStartupEngineQueueSnapshot({
        revision,
        tracks: recoveryQueue,
        currentIndex: recoveryIndex,
        positionMs,
        autoplay: true,
        repeat: repeatRef.current,
        crossfadeMs: getNativeCrossfadeMs(),
        volume: lastNonZeroVolumeRef.current,
        playSource: playSourceRef.current,
        shuffle: shuffleRef.current,
        target: "android-native",
      });
      await androidNativeEngine.loadQueue(snapshot);
      return true;
    }

    const source = playSourceRef.current;
    const activeTrackKey = getTrackCacheKey(recoveryQueue[recoveryIndex]!);
    const generation = ++queueReadinessRef.current.generation;
    queueReadinessRef.current.ready = false;
    queueReadinessRef.current.resumePending = () =>
      recoverActiveTrackRef.current();
    const isCurrent = () => {
      const queue = queueRef.current;
      const track = queue[clampIndex(currentIndexRef.current, queue.length)];
      return (
        generation === queueReadinessRef.current.generation &&
        source === playSourceRef.current &&
        track != null &&
        activeTrackKey === getTrackCacheKey(track)
      );
    };
    let queueSnapshot = [...recoveryQueue];
    let indexSnapshot = recoveryIndex;
    try {
      while (isCurrent()) {
        const engineTracks = await toStartupEngineTracks(
          queueSnapshot,
          indexSnapshot,
        );
        if (!isCurrent()) return false;

        const latestQueue = queueRef.current;
        const latestIndex = clampIndex(
          currentIndexRef.current,
          latestQueue.length,
        );
        if (
          latestIndex !== indexSnapshot ||
          latestQueue.length !== queueSnapshot.length ||
          latestQueue.some(
            (track, index) =>
              getTrackCacheKey(track) !==
              getTrackCacheKey(queueSnapshot[index]!),
          )
        ) {
          queueSnapshot = [...latestQueue];
          indexSnapshot = latestIndex;
          continue;
        }

        gpLoadQueue(
          buildEngineUrls(
            latestQueue,
            engineTracks.map((track) => track.url),
          ),
          latestIndex,
          { restartIfSameIndex: true },
        );
        if (positionMs > 0) gpSeekTo(positionMs);
        queueReadinessRef.current.ready = true;
        queueReadinessRef.current.resumePending = undefined;
        await gpPlay();
        return true;
      }
      return false;
    } finally {
      if (generation === queueReadinessRef.current.generation) {
        queueReadinessRef.current.ready = true;
        queueReadinessRef.current.resumePending = undefined;
      }
    }
  }, [
    buildEngineUrls,
    currentIndexRef,
    currentTimeRef,
    effectiveCrossfadeMsRef,
    lastNonZeroVolumeRef,
    playSourceRef,
    queueReadinessRef,
    queueRef,
    repeatRef,
    shuffleRef,
  ]);

  useEffect(() => {
    recoverActiveTrackRef.current = recoverActiveTrack;
  }, [recoverActiveTrack]);

  const preResolveNextTrack = useCallback(() => {
    if (shouldUseAndroidNativePlayer()) return;

    const queueSnapshot = queueRef.current;
    const currentIndex = currentIndexRef.current;
    const nextIndex = getNextTrackIndex(
      queueSnapshot.length,
      currentIndex,
      repeatRef.current,
    );
    if (nextIndex === null) return;

    const currentTrack = queueSnapshot[currentIndex];
    const nextTrack = queueSnapshot[nextIndex];
    if (!currentTrack || !nextTrack?.globalTrackUid) return;

    const expectedUrl = gpGetTracks()[nextIndex];
    if (!expectedUrl) return;

    const resolutionKey = buildTrackResolutionKey(
      getTrackCacheKey(currentTrack),
      getTrackCacheKey(nextTrack),
      currentIndex,
      nextIndex,
      expectedUrl,
    );
    if (nextTrackResolutionKeyRef.current === resolutionKey) return;
    nextTrackResolutionKeyRef.current = resolutionKey;

    void toFreshEngineTrack(nextTrack)
      .then((resolvedTrack) => {
        if (resolvedTrack.url === expectedUrl) return;

        const engineUrls = gpGetTracks();
        if (
          !canApplyNextTrackResolution(
            {
              queue: queueSnapshot,
              currentIndex,
              nextIndex,
              expectedUrl,
            },
            {
              queue: queueRef.current,
              currentIndex: currentIndexRef.current,
              engineIndex: gpGetTrackIndex(),
              engineUrl: engineUrls[nextIndex],
            },
          )
        ) {
          return;
        }

        gpReplaceTrack(nextIndex, resolvedTrack.url);
        const resolvedUrls = [...engineUrls];
        resolvedUrls[nextIndex] = resolvedTrack.url;
        buildEngineUrls(queueSnapshot, resolvedUrls);
      })
      .catch((error) => {
        if (nextTrackResolutionKeyRef.current === resolutionKey) {
          nextTrackResolutionKeyRef.current = null;
        }
        console.warn("[gapless] failed to resolve next track:", error);
      });
  }, [buildEngineUrls, currentIndexRef, queueRef, repeatRef]);

  return { preResolveNextTrack, recoverActiveTrackRef };
}

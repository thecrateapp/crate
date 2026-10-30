import { useCallback, type MutableRefObject } from "react";

import type { PlaySource, RepeatMode, Track } from "@/contexts/player-types";
import { getTrackCacheKey } from "@/contexts/player-utils";
import {
  androidNativeEngine,
  shouldUseAndroidNativePlayer,
} from "@/lib/android-native-engine";
import {
  addTrack as gpAddTrack,
  gotoTrack as gpGotoTrack,
  insertTrack as gpInsertTrack,
} from "@/lib/gapless-player";
import {
  toFreshEngineTrack,
  toFreshEngineTracks,
} from "@/contexts/player-engine-adapter";

import {
  isCustomCastSessionActive,
  syncCustomCastQueue,
  castQueueJumpTo,
} from "@/lib/cast-sender";

import type { PlaybackQueueReadiness } from "./playback-intelligence-model";

interface Ref<T> {
  current: T;
}

interface UsePlayerIntelligenceActionsOptions {
  queueReadinessRef?: MutableRefObject<PlaybackQueueReadiness>;
  repeatRef: Ref<RepeatMode>;
  shuffleRef: Ref<boolean>;
  advanceCursorTo: (index: number) => void;
  commitIsBuffering: (isBuffering: boolean) => void;
  commitIsPlaying: (isPlaying: boolean) => void;
  commitQueue: (queue: Track[]) => void;
  currentIndexRef: Ref<number>;
  flushCurrentPlayEvent: (reason: "skipped", expectedTrack?: Track) => void;
  playSourceRef: Ref<PlaySource | null>;
  queueRef: Ref<Track[]>;
  recentlyPlayed: Track[];
  registerEngineTrack: (track: Track) => string;
  startTrackerSession: (track: Track, source: PlaySource | null) => void;
  unshuffledQueueRef: Ref<Track[] | null>;
}

export interface PlayerIntelligenceActions {
  appendAndAdvance: (
    tracks: Track[],
    isCurrent?: () => boolean,
  ) => Promise<number>;
  appendIntelligenceTracks: (
    tracks: Track[],
    isCurrent?: () => boolean,
  ) => Promise<number>;
  adoptNativeTracks: (tracks: Track[]) => void;
  insertSuggestionAfterCurrent: (candidates: Track[]) => void;
}

export function selectUniqueTracks(
  candidates: Track[],
  excludedTracks: Track[],
): Track[] {
  const existingKeys = new Set(
    excludedTracks.map((track) => getTrackCacheKey(track)),
  );
  const unique: Track[] = [];
  for (const track of candidates) {
    const key = getTrackCacheKey(track);
    if (!key || existingKeys.has(key)) continue;
    existingKeys.add(key);
    unique.push(track);
  }
  return unique;
}

export function usePlayerIntelligenceActions({
  queueReadinessRef,
  repeatRef,
  shuffleRef,
  advanceCursorTo,
  commitIsBuffering,
  commitIsPlaying,
  commitQueue,
  currentIndexRef,
  flushCurrentPlayEvent,
  playSourceRef,
  queueRef,
  recentlyPlayed,
  registerEngineTrack,
  startTrackerSession,
  unshuffledQueueRef,
}: UsePlayerIntelligenceActionsOptions): PlayerIntelligenceActions {
  const appendIntelligenceTracks = useCallback(
    async (
      tracks: Track[],
      isCurrent: () => boolean = () => true,
    ): Promise<number> => {
      const generation = queueReadinessRef?.current.generation;
      const canApply = () =>
        isCurrent() &&
        queueReadinessRef?.current.ready !== false &&
        generation === queueReadinessRef?.current.generation;
      if (!canApply()) return 0;
      const source = playSourceRef.current;
      const belongsToQueue = () =>
        source === playSourceRef.current &&
        generation === queueReadinessRef?.current.generation;
      const queue = queueRef.current;
      const unique = selectUniqueTracks(
        tracks,
        queue.slice(currentIndexRef.current),
      );
      if (unique.length === 0) return 0;
      const nextQueue = [...queue, ...unique];
      if (isCustomCastSessionActive()) {
        const result = await syncCustomCastQueue(
          {
            queue: nextQueue,
            currentIndex: currentIndexRef.current,
            repeatMode: repeatRef.current,
            shuffle: shuffleRef.current,
          },
          canApply,
        );
        if (!result.ok)
          throw new Error(result.message || "Cast queue append failed");
      } else if (shouldUseAndroidNativePlayer()) {
        const engineTracks = await toFreshEngineTracks(unique, undefined, {
          target: "android-native",
        });
        if (!canApply() || queueRef.current !== queue) return 0;
        const reserved = unique.map((track) => ({ ...track }));
        const removeReservation = (entries: Track[]) => {
          const remaining = new Set(reserved);
          return entries.filter((entry) => !remaining.delete(entry));
        };
        // Reserve positions before dispatch so concurrent manual edits use the
        // same indices as the native queue; progress is confirmed by its ACK.
        commitQueue([...queue, ...reserved]);
        if (unshuffledQueueRef.current)
          unshuffledQueueRef.current = [
            ...unshuffledQueueRef.current,
            ...reserved,
          ];
        try {
          await androidNativeEngine.appendTracks(engineTracks);
        } catch (error) {
          if (belongsToQueue()) {
            commitQueue(removeReservation(queueRef.current));
            if (unshuffledQueueRef.current)
              unshuffledQueueRef.current = removeReservation(
                unshuffledQueueRef.current,
              );
          }
          throw error;
        }
        return belongsToQueue() ? unique.length : 0;
      } else {
        for (const track of unique) gpAddTrack(registerEngineTrack(track));
      }
      if (!canApply()) return 0;
      if (queueRef.current !== queue) {
        // A receiver update may already have adopted the acknowledged queue.
        return unique.every((track) =>
          queueRef.current.some(
            (entry) => getTrackCacheKey(entry) === getTrackCacheKey(track),
          ),
        )
          ? unique.length
          : 0;
      }
      commitQueue(nextQueue);
      if (unshuffledQueueRef.current)
        unshuffledQueueRef.current = [...unshuffledQueueRef.current, ...unique];
      return unique.length;
    },
    [
      queueReadinessRef,
      commitQueue,
      currentIndexRef,
      queueRef,
      registerEngineTrack,
      playSourceRef,
      repeatRef,
      shuffleRef,
      unshuffledQueueRef,
    ],
  );

  const adoptNativeTracks = useCallback(
    (tracks: Track[]) => {
      if (queueReadinessRef?.current.ready === false) return;
      commitQueue([...queueRef.current, ...tracks]);
      if (unshuffledQueueRef.current) {
        unshuffledQueueRef.current = [...unshuffledQueueRef.current, ...tracks];
      }
    },
    [commitQueue, queueRef, queueReadinessRef, unshuffledQueueRef],
  );

  const insertSuggestionAfterCurrent = useCallback(
    (candidates: Track[]) => {
      if (queueReadinessRef?.current.ready === false) return;
      const queue = queueRef.current;
      const insertionIndex = currentIndexRef.current + 1;
      if (insertionIndex <= 0 || insertionIndex > queue.length) return;
      if (queue[insertionIndex]?.isSuggested) return;

      const [suggestion] = selectUniqueTracks(candidates, [
        ...queue,
        ...recentlyPlayed,
      ]);
      if (!suggestion) return;

      const marked: Track = {
        ...suggestion,
        isSuggested: true,
        suggestionSource: "playlist",
      };
      const nextQueue = [...queue];
      nextQueue.splice(insertionIndex, 0, marked);
      if (shouldUseAndroidNativePlayer()) {
        void (async () => {
          const engineTrack = await toFreshEngineTrack(marked, undefined, {
            target: "android-native",
          });
          return androidNativeEngine.insertTrack(insertionIndex, engineTrack);
        })().catch((error) => {
          console.error(
            "[native-player] failed to insert suggested track:",
            error,
          );
        });
      } else {
        gpInsertTrack(insertionIndex, registerEngineTrack(marked));
      }
      commitQueue(nextQueue);

      if (unshuffledQueueRef.current) {
        unshuffledQueueRef.current = [...unshuffledQueueRef.current, marked];
      }
    },
    [
      queueReadinessRef,
      commitQueue,
      currentIndexRef,
      queueRef,
      recentlyPlayed,
      registerEngineTrack,
      unshuffledQueueRef,
    ],
  );

  const appendAndAdvance = useCallback(
    async (
      tracks: Track[],
      isCurrent: () => boolean = () => true,
    ): Promise<number> => {
      const generation = queueReadinessRef?.current.generation;
      const canApply = () =>
        isCurrent() &&
        queueReadinessRef?.current.ready !== false &&
        generation === queueReadinessRef?.current.generation;
      if (!canApply()) return 0;
      const oldLength = queueRef.current.length;
      const added = tracks.length
        ? await appendIntelligenceTracks(tracks, canApply)
        : 0;
      if (!canApply()) return added;
      const nextQueue = queueRef.current;
      const nextIndex = currentIndexRef.current + 1;
      if (nextIndex >= nextQueue.length) return 0;
      if (isCustomCastSessionActive()) {
        const result = await castQueueJumpTo(nextIndex, canApply);
        if (!result.ok)
          throw new Error(result.message || "Cast queue advance failed");
      } else if (shouldUseAndroidNativePlayer()) {
        await androidNativeEngine.jumpTo(nextIndex, true);
      } else gpGotoTrack(nextIndex, true);
      if (!canApply()) return 0;
      const outgoing = nextQueue[currentIndexRef.current];
      flushCurrentPlayEvent("skipped", outgoing);
      advanceCursorTo(nextIndex);
      const incoming = nextQueue[nextIndex];
      if (incoming) startTrackerSession(incoming, playSourceRef.current);
      commitIsPlaying(true);
      commitIsBuffering(false);
      return added || (nextQueue.length >= oldLength ? 1 : 0);
    },
    [
      queueReadinessRef,
      advanceCursorTo,
      appendIntelligenceTracks,
      commitIsBuffering,
      commitIsPlaying,
      currentIndexRef,
      flushCurrentPlayEvent,
      playSourceRef,
      queueRef,
      startTrackerSession,
    ],
  );

  return {
    appendAndAdvance,
    appendIntelligenceTracks,
    adoptNativeTracks,
    insertSuggestionAfterCurrent,
  };
}

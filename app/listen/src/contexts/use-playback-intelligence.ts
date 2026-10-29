import { useCallback, useLayoutEffect, useMemo, useRef } from "react";

import {
  type PlaybackIntelligenceOptions,
  type PlaybackIntelligenceRefs,
} from "./playback-intelligence-model";
import { usePlaybackRefillRuntime } from "./use-playback-refill-runtime";
import { usePlaybackSuggestions } from "./use-playback-suggestions";

export function usePlaybackIntelligence({
  isSoftInterrupted,
  queueReadinessRef,
  stateRefs,
  queue,
  currentIndex,
  isPlaying,
  playSource,
  shuffle,
  repeat,
  infinitePlaybackEnabled,
  smartPlaylistSuggestionsEnabled,
  smartPlaylistSuggestionsCadence,
  recentlyPlayed,
  actions,
}: PlaybackIntelligenceOptions) {
  const localCurrentIndexRef = useRef(currentIndex);
  const localPlaySourceRef = useRef(playSource);
  const localQueueRef = useRef(queue);
  const currentIndexRef = stateRefs?.currentIndexRef ?? localCurrentIndexRef;
  const playSourceRef = stateRefs?.playSourceRef ?? localPlaySourceRef;
  const queueRef = stateRefs?.queueRef ?? localQueueRef;
  const recentlyPlayedRef = useRef(recentlyPlayed);
  // Keep a stable reference to actions so effects don't re-run when the
  // context re-memoizes them. We only ever call via `.current`.
  const actionsRef = useRef(actions);
  const refs = useMemo<PlaybackIntelligenceRefs>(
    () => ({
      queueReadinessRef,
      currentIndexRef,
      playSourceRef,
      queueRef,
      recentlyPlayedRef,
      actionsRef,
    }),
    [
      actionsRef,
      currentIndexRef,
      playSourceRef,
      queueRef,
      queueReadinessRef,
      recentlyPlayedRef,
    ],
  );

  useLayoutEffect(() => {
    localCurrentIndexRef.current = currentIndex;
    localPlaySourceRef.current = playSource;
    localQueueRef.current = queue;
    recentlyPlayedRef.current = recentlyPlayed;
    actionsRef.current = actions;
  }, [currentIndex, playSource, queue, recentlyPlayed, actions]);

  const {
    continueInfinitePlayback,
    recoverAtEnd,
    resume: resumePlaybackIntelligence,
    reset: resetContinuation,
  } = usePlaybackRefillRuntime({
    isSoftInterrupted,
    repeat,
    currentIndex,
    infinitePlaybackEnabled,
    playSource,
    queue,
    refs,
    shuffle,
    isPlaying,
  });
  const resetSuggestions = usePlaybackSuggestions({
    currentIndex,
    playSource,
    queue,
    refs,
    shuffle,
    smartPlaylistSuggestionsCadence,
    smartPlaylistSuggestionsEnabled,
  });

  const resetPlaybackIntelligence = useCallback(() => {
    resetContinuation();
    resetSuggestions();
  }, [resetContinuation, resetSuggestions]);

  return {
    continueInfinitePlayback,
    recoverAtEnd,
    resumePlaybackIntelligence,
    resetPlaybackIntelligence,
  };
}

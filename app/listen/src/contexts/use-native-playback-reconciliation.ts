import { useCallback, useRef } from "react";

import type { PlaySource, Track } from "@/contexts/player-types";
import type {
  EnginePositionEvent,
  EngineMixState,
  EngineMixStateChangedEvent,
  EngineState,
  NativeEventMetadata,
} from "@/lib/playback-engine";
import { androidNativeEngine } from "@/lib/android-native-engine";
import { actualNativeMixState } from "@/lib/native-mix-state";

type ValueRef<T> = { readonly current: T };

// Buffered events drained on relaunch/reconnect and live events from the
// listener can interleave out of order (a stale buffered event applied
// right after a fresher live one). Android supplies a process-local monotonic
// sequence for ordering. nativeTimeMs remains a wall clock used only to
// project playback position; older native shells fall back to that timestamp.
export type NativeEventWatermark = {
  kind: "sequence" | "timestamp";
  value: number;
} | null;

export function isStaleNativeEvent(
  event: NativeEventMetadata,
  watermarkRef: { current: NativeEventWatermark },
): boolean {
  const nativeSequence = event.nativeSequence;
  if (typeof nativeSequence === "number" && Number.isFinite(nativeSequence)) {
    const watermark = watermarkRef.current;
    if (watermark?.kind === "sequence" && nativeSequence <= watermark.value) {
      return true;
    }
    watermarkRef.current = { kind: "sequence", value: nativeSequence };
    return false;
  }

  const nativeTimeMs = event.nativeTimeMs;
  if (typeof nativeTimeMs !== "number" || !Number.isFinite(nativeTimeMs)) {
    return false;
  }
  const watermark = watermarkRef.current;
  if (watermark?.kind === "sequence") return true;
  if (watermark?.kind === "timestamp" && nativeTimeMs < watermark.value) {
    return true;
  }
  watermarkRef.current = { kind: "timestamp", value: nativeTimeMs };
  return false;
}

export function nativeTransitionFlushReason(
  reason: string | undefined,
  fromIndex: number,
  toIndex: number,
  queueLength: number,
  repeat: string,
): "completed" | "skipped" | null {
  if (reason === "playlist") return null;
  if (reason === "auto" || reason === "repeat") return "completed";
  const movedToSequentialNext =
    toIndex === fromIndex + 1 ||
    (repeat === "all" && fromIndex === queueLength - 1 && toIndex === 0);
  return movedToSequentialNext ? "completed" : "skipped";
}

// Native checkpoints advance by their interval plus up to one position tick.
const NATIVE_CHECKPOINT_TICK_SLACK_SECONDS = 1.5;

function nativeMsToSeconds(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, value / 1000)
    : 0;
}

export function projectedNativePositionSeconds(
  positionMs: number | null | undefined,
  nativeTimeMs: number | null | undefined,
  isPlaying: boolean,
  durationMs?: number | null,
): number {
  const positionSeconds = nativeMsToSeconds(positionMs);
  if (
    !isPlaying ||
    typeof nativeTimeMs !== "number" ||
    !Number.isFinite(nativeTimeMs)
  ) {
    return positionSeconds;
  }
  const elapsedSeconds = Math.max(0, (Date.now() - nativeTimeMs) / 1000);
  const projected = positionSeconds + elapsedSeconds;
  const durationSeconds = nativeMsToSeconds(durationMs);
  return durationSeconds > 0 ? Math.min(projected, durationSeconds) : projected;
}

function trackDurationSeconds(track: Track | undefined): number {
  return typeof track?.duration === "number" &&
    Number.isFinite(track.duration) &&
    track.duration > 0
    ? track.duration
    : 0;
}

export interface UseNativePlaybackReconciliationParams {
  clearNativeBufferingRecovery: () => void;
  clearNativeBufferingWatchdog: () => void;
  commitCurrentIndex: (index: number) => void;
  commitCurrentTime: (time: number) => void;
  commitDuration: (duration: number) => void;
  commitIsBuffering: (isBuffering: boolean) => void;
  commitIsPlaying: (isPlaying: boolean) => void;
  currentIndexRef: ValueRef<number>;
  currentTrackRef: ValueRef<Track | undefined>;
  ensureTrackerSession: (
    track: Track | undefined,
    playSource: PlaySource | null,
  ) => void;
  playSourceRef: ValueRef<PlaySource | null>;
  queueRef: ValueRef<Track[]>;
  recordProgress: (positionSeconds: number, maxDeltaSeconds?: number) => void;
  rememberActiveTrack: (track: Track | undefined) => void;
  repeatRef: ValueRef<"off" | "one" | "all">;
  rotateTrackerSession: (
    reason: "completed" | "skipped",
    outgoing: Track | undefined,
    incoming: Track | undefined,
    playSource: PlaySource | null,
  ) => void;
  scheduleNativeBufferingWatchdog: () => void;
  setMixState?: (state: EngineMixState | null) => void;
}

export function useNativePlaybackReconciliation({
  clearNativeBufferingRecovery,
  clearNativeBufferingWatchdog,
  commitCurrentIndex,
  commitCurrentTime,
  commitDuration,
  commitIsBuffering,
  commitIsPlaying,
  currentIndexRef,
  currentTrackRef,
  ensureTrackerSession,
  playSourceRef,
  queueRef,
  recordProgress,
  rememberActiveTrack,
  repeatRef,
  rotateTrackerSession,
  scheduleNativeBufferingWatchdog,
  setMixState,
}: UseNativePlaybackReconciliationParams) {
  const nativeEventWatermarkRef = useRef<NativeEventWatermark>(null);
  const isNativeEventStale = useCallback(
    (event: NativeEventMetadata) =>
      isStaleNativeEvent(event, nativeEventWatermarkRef),
    [],
  );

  // A transition JS did not drive (a natively replaced queue, a Smart Mix
  // handoff, a missed trackChanged) still ends the outgoing play. The
  // expected-track guard in the tracker leaves alone a session JS already
  // moved to the incoming track.
  const followTrack = useCallback(
    (fromIndex: number, toIndex: number) => {
      const queue = queueRef.current;
      const outgoingTrack = queue[fromIndex];
      const incomingTrack = queue[toIndex];
      if (outgoingTrack) {
        rotateTrackerSession(
          nativeTransitionFlushReason(
            undefined,
            fromIndex,
            toIndex,
            queue.length,
            repeatRef.current,
          ) ?? "skipped",
          outgoingTrack,
          incomingTrack,
          playSourceRef.current,
        );
      }
      ensureTrackerSession(incomingTrack, playSourceRef.current);
    },
    [
      ensureTrackerSession,
      playSourceRef,
      queueRef,
      repeatRef,
      rotateTrackerSession,
    ],
  );

  // Native extends long queues and radio while the WebView is frozen; until
  // JS adopts those tracks, the play that native moved past still ends here.
  const closeSessionBeyondQueue = useCallback(
    (toIndex: number, reason?: string) => {
      const queue = queueRef.current;
      const fromIndex = currentIndexRef.current;
      const outgoingTrack = queue[fromIndex];
      if (!outgoingTrack) return;
      rotateTrackerSession(
        nativeTransitionFlushReason(
          reason,
          fromIndex,
          toIndex,
          queue.length,
          repeatRef.current,
        ) ?? "skipped",
        outgoingTrack,
        undefined,
        playSourceRef.current,
      );
    },
    [currentIndexRef, playSourceRef, queueRef, repeatRef, rotateTrackerSession],
  );

  const applyNativePosition = useCallback(
    (event: EnginePositionEvent & { checkpointMs?: number }) => {
      if (
        setMixState &&
        !androidNativeEngine.isCurrentQueueRevision?.(event.revision)
      )
        return;
      if (isNativeEventStale(event)) {
        return;
      }
      const positionSeconds = projectedNativePositionSeconds(
        event.positionMs,
        event.nativeTimeMs,
        event.isPlaying,
        event.durationMs,
      );
      const nativeDurationSeconds = nativeMsToSeconds(event.durationMs);
      const fallbackDurationSeconds = trackDurationSeconds(
        queueRef.current[event.index] ?? currentTrackRef.current,
      );
      commitCurrentTime(positionSeconds);
      if (nativeDurationSeconds > 0 || fallbackDurationSeconds > 0) {
        commitDuration(nativeDurationSeconds || fallbackDurationSeconds);
      }
      commitIsPlaying(event.isPlaying);
      if (event.isPlaying) {
        // Count the position native observed, not the projection: events
        // drained in a burst all project to the same clamped time.
        recordProgress(
          nativeMsToSeconds(event.positionMs),
          event.checkpointMs
            ? event.checkpointMs / 1000 + NATIVE_CHECKPOINT_TICK_SLACK_SECONDS
            : undefined,
        );
      }
    },
    [
      commitCurrentTime,
      commitDuration,
      commitIsPlaying,
      currentTrackRef,
      queueRef,
      recordProgress,
      isNativeEventStale,
      setMixState,
    ],
  );

  const applyNativeState = useCallback(
    (
      state: EngineState,
      options: { rotateIndexChange?: boolean; passiveLifecycle?: boolean } = {},
    ) => {
      if (
        setMixState &&
        !androidNativeEngine.isCurrentQueueRevision?.(state.revision)
      )
        return;
      if (isNativeEventStale(state)) {
        return;
      }
      if (androidNativeEngine.isCurrentQueueRevision?.(state.revision)) {
        setMixState?.(
          state.queueSize > 0
            ? actualNativeMixState(state.mixState, state.revision)
            : null,
        );
      }
      const positionSeconds = projectedNativePositionSeconds(
        state.positionMs,
        state.nativeTimeMs,
        state.isPlaying,
        state.durationMs,
      );
      const nativeDurationSeconds = nativeMsToSeconds(state.durationMs);
      commitCurrentTime(positionSeconds);
      if (state.queueSize === 0) {
        commitDuration(0);
      }

      const queue = queueRef.current;
      if (state.index >= queue.length && state.queueSize > queue.length) {
        closeSessionBeyondQueue(state.index);
      }
      if (state.index >= 0 && state.index < queue.length) {
        const previousIndex = currentIndexRef.current;
        const incomingTrack = queue[state.index];
        const durationSeconds =
          nativeDurationSeconds || trackDurationSeconds(incomingTrack);
        if (durationSeconds > 0) {
          commitDuration(durationSeconds);
        }
        if (state.index !== previousIndex) {
          const outgoingTrack = queue[previousIndex];
          if (options.rotateIndexChange) {
            const reason = nativeTransitionFlushReason(
              undefined,
              previousIndex,
              state.index,
              queue.length,
              repeatRef.current,
            );
            if (reason) {
              rotateTrackerSession(
                reason,
                outgoingTrack,
                incomingTrack,
                playSourceRef.current,
              );
            }
          } else if (state.isPlaying) {
            followTrack(previousIndex, state.index);
          }
          commitCurrentIndex(state.index);
          rememberActiveTrack(incomingTrack);
        } else {
          rememberActiveTrack(incomingTrack);
          if (state.isPlaying) {
            ensureTrackerSession(incomingTrack, playSourceRef.current);
          }
        }
      }

      const isPassiveLifecycleBuffering =
        options.passiveLifecycle && state.playbackState === "buffering";
      commitIsPlaying(state.isPlaying);
      commitIsBuffering(
        isPassiveLifecycleBuffering
          ? false
          : state.playbackState === "buffering",
      );
      if (state.playbackState === "buffering" && !isPassiveLifecycleBuffering) {
        scheduleNativeBufferingWatchdog();
      } else {
        if (state.playbackState !== "buffering") {
          clearNativeBufferingRecovery();
        }
        clearNativeBufferingWatchdog();
      }
      if (state.isPlaying) {
        recordProgress(nativeMsToSeconds(state.positionMs));
      }
    },
    [
      clearNativeBufferingRecovery,
      clearNativeBufferingWatchdog,
      closeSessionBeyondQueue,
      commitCurrentIndex,
      commitCurrentTime,
      commitDuration,
      commitIsBuffering,
      commitIsPlaying,
      currentIndexRef,
      ensureTrackerSession,
      followTrack,
      isNativeEventStale,
      setMixState,
      playSourceRef,
      queueRef,
      recordProgress,
      rememberActiveTrack,
      repeatRef,
      rotateTrackerSession,
      scheduleNativeBufferingWatchdog,
    ],
  );

  const applyNativeMixState = useCallback(
    (event: EngineMixStateChangedEvent) => {
      if (
        !androidNativeEngine.isCurrentQueueRevision?.(event.revision) ||
        isNativeEventStale(event)
      )
        return;
      setMixState?.(actualNativeMixState(event.mixState, event.revision));
    },
    [isNativeEventStale, setMixState],
  );

  const applyNativeTrackChange = useCallback(
    (event: EnginePositionEvent & { reason?: string }) => {
      if (
        setMixState &&
        !androidNativeEngine.isCurrentQueueRevision?.(event.revision)
      )
        return;
      if (isNativeEventStale(event)) {
        return;
      }
      const queue = queueRef.current;
      if (event.index >= queue.length) {
        closeSessionBeyondQueue(event.index, event.reason);
        return;
      }
      if (event.index < 0) return;

      const previousIndex = currentIndexRef.current;
      const incomingTrack = queue[event.index];
      const outgoingTrack = queue[previousIndex];
      const positionSeconds = projectedNativePositionSeconds(
        event.positionMs,
        event.nativeTimeMs,
        event.isPlaying,
        event.durationMs,
      );
      const durationSeconds =
        nativeMsToSeconds(event.durationMs) ||
        trackDurationSeconds(incomingTrack);
      commitCurrentTime(positionSeconds);
      if (durationSeconds > 0) {
        commitDuration(durationSeconds);
      }

      if (event.index !== previousIndex) {
        const reason = nativeTransitionFlushReason(
          event.reason,
          previousIndex,
          event.index,
          queue.length,
          repeatRef.current,
        );
        if (reason) {
          rotateTrackerSession(
            reason,
            outgoingTrack,
            incomingTrack,
            playSourceRef.current,
          );
        } else {
          followTrack(previousIndex, event.index);
        }
        commitCurrentIndex(event.index);
        rememberActiveTrack(incomingTrack);
      } else {
        rememberActiveTrack(incomingTrack);
        if (event.reason === "repeat") {
          rotateTrackerSession(
            "completed",
            incomingTrack,
            incomingTrack,
            playSourceRef.current,
          );
        } else if (event.isPlaying) {
          ensureTrackerSession(incomingTrack, playSourceRef.current);
        }
      }

      commitIsPlaying(event.isPlaying);
      commitIsBuffering(false);
    },
    [
      commitCurrentIndex,
      commitCurrentTime,
      commitDuration,
      commitIsBuffering,
      commitIsPlaying,
      closeSessionBeyondQueue,
      currentIndexRef,
      ensureTrackerSession,
      followTrack,
      isNativeEventStale,
      setMixState,
      playSourceRef,
      queueRef,
      rememberActiveTrack,
      repeatRef,
      rotateTrackerSession,
    ],
  );

  return {
    applyNativePosition,
    applyNativeState,
    applyNativeTrackChange,
    applyNativeMixState,
    isNativeEventStale,
  };
}

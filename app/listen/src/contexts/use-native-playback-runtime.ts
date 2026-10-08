import { useNativePlaybackEventBridge } from "@/contexts/use-native-playback-event-bridge";

import type { CrossfadeTransition } from "@/contexts/player-context";
import type { PlaySource, Track } from "@/contexts/player-types";
import { useNativeBufferingRecovery } from "@/contexts/use-native-buffering-recovery";
import { useNativePlaybackReconciliation } from "@/contexts/use-native-playback-reconciliation";
export {
  isStaleNativeEvent,
  type NativeEventWatermark,
  nativeTransitionFlushReason,
  projectedNativePositionSeconds,
} from "@/contexts/use-native-playback-reconciliation";

type ValueRef<T> = { readonly current: T };
type MutableValueRef<T> = { current: T };

type NativePlaybackRuntimeOptions = {
  beginSoftInterruption: (reason: "stream") => void;
  bufferingIntentRef: MutableValueRef<boolean>;
  commitCurrentIndex: (index: number) => void;
  commitCurrentTime: (time: number) => void;
  commitDuration: (duration: number) => void;
  commitIsBuffering: (isBuffering: boolean) => void;
  commitIsPlaying: (isPlaying: boolean) => void;
  crossfadeTimerRef: MutableValueRef<number | null>;
  currentIndexRef: ValueRef<number>;
  currentTimeRef: ValueRef<number>;
  currentTrackRef: ValueRef<Track | undefined>;
  durationRef: ValueRef<number>;
  effectiveCrossfadeMsRef: ValueRef<number>;
  ensureTrackerSession: (
    track: Track | undefined,
    playSource: PlaySource | null,
  ) => void;
  flushCurrentPlayEvent: (
    reason: "completed" | "skipped",
    track?: Track,
  ) => void;
  lastNonZeroVolumeRef: ValueRef<number>;
  playSourceRef: ValueRef<PlaySource | null>;
  queueRef: ValueRef<Track[]>;
  recordProgress: (positionSeconds: number) => void;
  rememberActiveTrack: (track: Track | undefined) => void;
  repeatRef: ValueRef<"off" | "one" | "all">;
  shuffleRef: ValueRef<boolean>;
  rotateTrackerSession: (
    reason: "completed" | "skipped",
    outgoing: Track | undefined,
    incoming: Track | undefined,
    playSource: PlaySource | null,
  ) => void;
  setCrossfadeTransition: (transition: CrossfadeTransition | null) => void;
};

export function useNativePlaybackRuntime({
  beginSoftInterruption,
  bufferingIntentRef,
  commitCurrentIndex,
  commitCurrentTime,
  commitDuration,
  commitIsBuffering,
  commitIsPlaying,
  crossfadeTimerRef,
  currentIndexRef,
  currentTimeRef,
  currentTrackRef,
  durationRef,
  effectiveCrossfadeMsRef,
  ensureTrackerSession,
  flushCurrentPlayEvent,
  lastNonZeroVolumeRef,
  playSourceRef,
  queueRef,
  recordProgress,
  rememberActiveTrack,
  repeatRef,
  rotateTrackerSession,
  setCrossfadeTransition,
  shuffleRef,
}: NativePlaybackRuntimeOptions) {
  const {
    clearNativeBufferingWatchdog,
    clearNativeBufferingRecovery,
    recoverNativeBuffering,
    retryNativePlaybackAfterAuthError,
    scheduleNativeBufferingWatchdog,
  } = useNativeBufferingRecovery({
    beginSoftInterruption,
    bufferingIntentRef,
    commitIsBuffering,
    commitIsPlaying,
    currentIndexRef,
    currentTimeRef,
    currentTrackRef,
    effectiveCrossfadeMsRef,
    lastNonZeroVolumeRef,
    playSourceRef,
    queueRef,
    repeatRef,
    shuffleRef,
  });

  const {
    applyNativePosition,
    applyNativeState,
    applyNativeTrackChange,
    isNativeEventStale,
  } = useNativePlaybackReconciliation({
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
  });

  useNativePlaybackEventBridge({
    applyNativePosition,
    applyNativeState,
    applyNativeTrackChange,
    beginSoftInterruption,
    bufferingIntentRef,
    clearNativeBufferingWatchdog,
    commitIsBuffering,
    commitIsPlaying,
    crossfadeTimerRef,
    currentIndexRef,
    durationRef,
    flushCurrentPlayEvent,
    isNativeEventStale,
    queueRef,
    recoverNativeBuffering,
    retryNativePlaybackAfterAuthError,
    scheduleNativeBufferingWatchdog,
    setCrossfadeTransition,
  });
}

import {
  useEffect,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";

import type { PlaySource, Track } from "@/contexts/player-types";
import { PLAYER_TRACK_FINISHED_EVENT } from "@/contexts/player-events";
import { canonicalMediaUrl, getStreamUrl } from "@/contexts/player-utils";
import {
  getCurrentTrackDuration as gpGetCurrentTrackDuration,
  isCurrentTrackFullyBuffered,
  isPlaybackGestureRequiredError,
  seekTo as gpSeekTo,
  type GaplessPlayerCallbacks,
} from "@/lib/gapless-player";
import { isOnline as isRuntimeOnline } from "@/lib/capacitor";
import { isCastSessionActive } from "@/lib/cast-sender";
import type { PlaybackQoeFailureCause } from "@/lib/playback-qoe";

function playbackFailureCause(error: unknown): PlaybackQoeFailureCause {
  const text = String(
    error instanceof Error ? `${error.name} ${error.message}` : error,
  ).toUpperCase();
  if (text.includes("DECODE")) return "decode";
  if (text.includes("NOT_SUPPORTED") || text.includes("NOTSUPPORTED")) {
    return "unavailable";
  }
  if (text.includes("NETWORK")) return "network";
  if (text.includes("TIMEOUT")) return "timeout";
  return "other";
}

interface UsePlayerEngineCallbacksParams {
  continueInfinitePlayback?: () => boolean;
  resumePlaybackIntelligence?: () => void;
  callbacksRef: MutableRefObject<GaplessPlayerCallbacks>;
  crossfadeTimerRef: MutableRefObject<number | null>;
  currentIndexRef: MutableRefObject<number>;
  currentTrackRef: MutableRefObject<Track | undefined>;
  playSourceRef: MutableRefObject<PlaySource | null>;
  durationRef: MutableRefObject<number>;
  effectiveCrossfadeMsRef: MutableRefObject<number>;
  isPlayingRef: MutableRefObject<boolean>;
  bufferingIntentRef: MutableRefObject<boolean>;
  pendingRestoreTimeRef: MutableRefObject<number>;
  resumeAfterReloadRef: MutableRefObject<boolean>;
  engineTrackMapRef: MutableRefObject<Map<string, Track[]>>;
  queueRef: MutableRefObject<Track[]>;
  commitCurrentTime: (time: number) => void;
  /** Engine progress ticks; falls back to commitCurrentTime when absent. */
  commitPlaybackTick?: (time: number) => void;
  commitDuration: (duration: number) => void;
  commitIsPlaying: (isPlaying: boolean) => void;
  commitIsBuffering: (isBuffering: boolean) => void;
  clearPrevRestartLatch: () => void;
  clearStallTimer: () => void;
  scheduleStallProtection: () => void;
  cancelRestoreAutoplay: () => void;
  tryRestoreAutoplay: () => void;
  cancelSoftInterruption: () => void;
  requireUserGestureToResume: () => void;
  beginSoftInterruption: (reason: "offline" | "stream") => void;
  isSoftInterrupted: () => boolean;
  ensureTrackerSession: (
    track: Track | undefined,
    source: PlaySource | null,
  ) => void;
  rotateTrackerSession: (
    reason: "completed" | "skipped" | "interrupted",
    expectedTrack: Track | undefined,
    nextTrack: Track | undefined,
    nextSource: PlaySource | null,
  ) => void;
  markSeekPosition: (seconds: number) => void;
  recordProgress: (seconds: number) => void;
  recordPlaybackQualityProgress: (seconds: number) => void;
  recordPlaybackStarted: (durationMs: number) => void;
  recordPlaybackIntent: () => void;
  recordPlaybackResult: (
    outcome: "started" | "failed" | "cancelled",
    cause?: PlaybackQoeFailureCause,
  ) => void;
  onActivePlaybackStarted: () => void;
  pullFromEngine: (sourceQueue?: Track[]) => {
    resolvedTrack: Track | undefined;
  };
  setAnalyserVersion: Dispatch<SetStateAction<number>>;
  setCrossfadeTransition: Dispatch<
    SetStateAction<{
      outgoing: Track;
      incoming: Track;
      durationMs: number;
      startedAt: number;
      outgoingDurationSeconds: number;
    } | null>
  >;
}

export function usePlayerEngineCallbacks({
  continueInfinitePlayback,
  resumePlaybackIntelligence,
  callbacksRef,
  crossfadeTimerRef,
  currentIndexRef,
  currentTrackRef,
  playSourceRef,
  durationRef,
  effectiveCrossfadeMsRef,
  isPlayingRef,
  bufferingIntentRef,
  pendingRestoreTimeRef,
  resumeAfterReloadRef,
  engineTrackMapRef,
  queueRef,
  commitCurrentTime,
  commitPlaybackTick = commitCurrentTime,
  commitDuration,
  commitIsPlaying,
  commitIsBuffering,
  clearPrevRestartLatch,
  clearStallTimer,
  scheduleStallProtection,
  cancelRestoreAutoplay,
  tryRestoreAutoplay,
  cancelSoftInterruption,
  requireUserGestureToResume,
  beginSoftInterruption,
  isSoftInterrupted,
  ensureTrackerSession,
  rotateTrackerSession,
  markSeekPosition,
  recordProgress,
  recordPlaybackQualityProgress,
  recordPlaybackStarted,
  recordPlaybackIntent,
  recordPlaybackResult,
  onActivePlaybackStarted,
  pullFromEngine,
  setAnalyserVersion,
  setCrossfadeTransition,
}: UsePlayerEngineCallbacksParams) {
  const playbackRequestStartedAtRef = useRef<number | null>(null);
  const isCurrentEnginePath = (path: string | undefined): boolean => {
    const currentTrack = currentTrackRef.current;
    if (!path || !currentTrack) return true;
    const engineTracks = engineTrackMapRef.current.get(path);
    if (engineTracks) {
      return engineTracks.some((track) => track.id === currentTrack.id);
    }
    return (
      canonicalMediaUrl(path) === canonicalMediaUrl(getStreamUrl(currentTrack))
    );
  };
  callbacksRef.current = {
    onTimeUpdate: (positionMs, trackIndex) => {
      if (isCastSessionActive()) return;
      const positionSeconds = positionMs / 1000;
      clearStallTimer();
      if (bufferingIntentRef.current && !isSoftInterrupted()) {
        bufferingIntentRef.current = false;
        commitIsBuffering(false);
      }
      commitPlaybackTick(positionSeconds);
      recordProgress(positionSeconds);
      recordPlaybackQualityProgress(positionSeconds);
      if (trackIndex !== currentIndexRef.current && trackIndex >= 0) {
        pullFromEngine();
      }
    },
    onDurationChange: (durationMs) => {
      if (isCastSessionActive()) return;
      commitDuration(Math.max(durationMs / 1000, 0));
    },
    onLoad: (_path, _fullyLoaded, durationMs) => {
      if (isCastSessionActive()) return;
      const durationSeconds = Math.max(durationMs / 1000, 0);
      if (durationSeconds > 0) {
        commitDuration(durationSeconds);
      }
      clearPrevRestartLatch();
      if (pendingRestoreTimeRef.current > 0) {
        gpSeekTo(pendingRestoreTimeRef.current * 1000);
        commitCurrentTime(pendingRestoreTimeRef.current);
        markSeekPosition(pendingRestoreTimeRef.current);
        pendingRestoreTimeRef.current = 0;
      }
      if (!isPlayingRef.current && !isSoftInterrupted()) {
        commitIsBuffering(false);
      }
      bufferingIntentRef.current = false;
      clearStallTimer();
      tryRestoreAutoplay();
    },
    onPlayRequest: () => {
      if (isCastSessionActive()) return;
      if (playbackRequestStartedAtRef.current === null) {
        playbackRequestStartedAtRef.current = Date.now();
        recordPlaybackIntent();
      }
      bufferingIntentRef.current = true;
      if (!isPlayingRef.current && !isSoftInterrupted()) {
        commitIsPlaying(true);
      }
    },
    onPlay: () => {
      if (isCastSessionActive()) return;
      if (playbackRequestStartedAtRef.current !== null) {
        recordPlaybackStarted(
          Math.max(0, Date.now() - playbackRequestStartedAtRef.current),
        );
        recordPlaybackResult("started");
        playbackRequestStartedAtRef.current = null;
      }
      resumeAfterReloadRef.current = false;
      cancelRestoreAutoplay();
      cancelSoftInterruption();
      resumePlaybackIntelligence?.();
      commitIsPlaying(true);
      commitIsBuffering(false);
      bufferingIntentRef.current = false;
      ensureTrackerSession(currentTrackRef.current, playSourceRef.current);
      onActivePlaybackStarted();
    },
    onPause: () => {
      if (isCastSessionActive()) return;
      if (bufferingIntentRef.current && isPlayingRef.current) {
        commitIsBuffering(true);
        return;
      }
      if (isSoftInterrupted()) {
        commitIsPlaying(false);
        commitIsBuffering(true);
        return;
      }
      clearStallTimer();
      commitIsPlaying(false);
      commitIsBuffering(false);
      bufferingIntentRef.current = false;
    },
    onPrev: () => {
      if (isCastSessionActive()) return;
      clearPrevRestartLatch();
      commitCurrentTime(0);
      commitDuration(Math.max(gpGetCurrentTrackDuration() / 1000, 0));
      pullFromEngine();
      bufferingIntentRef.current = false;
      commitIsBuffering(false);
      clearStallTimer();
    },
    onNext: (fromPath, toPath) => {
      if (isCastSessionActive()) return;
      clearPrevRestartLatch();
      const outgoingDurationSeconds = durationRef.current;

      commitCurrentTime(0);
      commitDuration(Math.max(gpGetCurrentTrackDuration() / 1000, 0));
      pullFromEngine();

      const crossfadeMs = effectiveCrossfadeMsRef.current;
      if (crossfadeMs > 0) {
        const outgoing = engineTrackMapRef.current.get(fromPath)?.[0];
        const incoming = engineTrackMapRef.current.get(toPath)?.[0];
        if (outgoing && incoming) {
          if (crossfadeTimerRef.current != null) {
            window.clearTimeout(crossfadeTimerRef.current);
          }
          setCrossfadeTransition({
            outgoing,
            incoming,
            durationMs: crossfadeMs,
            startedAt: performance.now(),
            outgoingDurationSeconds,
          });
          crossfadeTimerRef.current = window.setTimeout(() => {
            setCrossfadeTransition(null);
            crossfadeTimerRef.current = null;
          }, crossfadeMs);
        }
      }
    },
    onTrackFinished: (path) => {
      if (isCastSessionActive()) return;
      const bucket = engineTrackMapRef.current.get(path);
      const endedTrack =
        bucket?.[0] ??
        queueRef.current.find((track) => getStreamUrl(track) === path);
      if (!endedTrack) return;

      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent(PLAYER_TRACK_FINISHED_EVENT, {
            detail: { track: endedTrack },
          }),
        );
      }

      rotateTrackerSession(
        "completed",
        endedTrack,
        currentTrackRef.current,
        playSourceRef.current,
      );
    },
    onAllFinished: () => {
      if (isCastSessionActive() || isSoftInterrupted()) return;
      resumeAfterReloadRef.current = false;
      cancelRestoreAutoplay();
      cancelSoftInterruption();
      if (continueInfinitePlayback?.()) {
        commitIsPlaying(false);
        bufferingIntentRef.current = true;
        return;
      }
      commitIsPlaying(false);
      commitIsBuffering(false);
      bufferingIntentRef.current = false;
    },
    onError: (path, err) => {
      if (isCastSessionActive()) return;
      if (!isCurrentEnginePath(path)) {
        console.warn(
          "[gapless] preload error ignored (non-current track):",
          path,
          err,
        );
        return;
      }
      const requested = playbackRequestStartedAtRef.current !== null;
      if (isPlaybackGestureRequiredError(err)) {
        console.warn("[gapless] playback requires a user gesture:", err);
        if (requested) {
          playbackRequestStartedAtRef.current = null;
          recordPlaybackResult("cancelled");
        }
        cancelRestoreAutoplay();
        requireUserGestureToResume();
        return;
      }
      if (isCurrentTrackFullyBuffered()) {
        console.warn(
          "[gapless] error ignored (current track fully buffered):",
          path,
          err,
        );
        return;
      }
      console.error("[gapless] error:", err);
      cancelRestoreAutoplay();
      // The active source has stopped. A new play request can still fail
      // after the server accepts its range probe. Only onPlay confirms audio.
      bufferingIntentRef.current = false;
      commitIsPlaying(false);
      if (requested) playbackRequestStartedAtRef.current = null;
      void isRuntimeOnline().then((online) => {
        if (requested) {
          recordPlaybackResult(
            "failed",
            online ? playbackFailureCause(err) : "network",
          );
        }
        if (!isCastSessionActive() && isCurrentEnginePath(path)) {
          beginSoftInterruption(online ? "stream" : "offline");
        }
      });
    },
    onBuffering: (path) => {
      if (isCastSessionActive()) return;
      if (!isCurrentEnginePath(path)) return;
      if (isCurrentTrackFullyBuffered()) return;
      if (bufferingIntentRef.current || !isPlayingRef.current) {
        commitIsBuffering(true);
      }
      scheduleStallProtection();
    },
    onAnalyserReady: () => {
      setAnalyserVersion((version) => version + 1);
    },
    onAnalyserInvalidated: () => {
      setAnalyserVersion((version) => version + 1);
    },
  };

  useEffect(
    () => () => {
      if (crossfadeTimerRef.current != null) {
        window.clearTimeout(crossfadeTimerRef.current);
        crossfadeTimerRef.current = null;
      }
    },
    [crossfadeTimerRef],
  );
}

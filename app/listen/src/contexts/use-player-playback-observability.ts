import { useCallback, useEffect, useRef } from "react";

import type { Track } from "@/contexts/player-types";
import { usePlayEventTracker } from "@/contexts/use-play-event-tracker";
import { shouldUseAndroidNativePlayer } from "@/lib/android-native-engine";
import {
  getEffectivePlaybackDeliveryPolicy,
  getPlaybackDeliveryPolicyPreference,
  subscribeToPlaybackDeliveryNetworkChanges,
  type PlaybackDeliveryPreference,
} from "@/lib/player-playback-prefs";
import { recordStablePlayback } from "@/lib/playback-network-quality";
import { getPlaybackDeliveryProvenance } from "@/lib/playback-provenance";
import {
  getPlaybackQoeRuntime,
  installPlaybackQoeFlush,
  recordPlaybackQoe,
  type PlaybackQoeEventName,
  type PlaybackQoeFailureCause,
  type PlaybackQoeOutcome,
} from "@/lib/playback-qoe";

const ACTIVE_REPORT_MS = 60_000;
const ACTIVE_MIN_REMAINDER_MS = 1_000;
const MAX_PROGRESS_STEP_SECONDS = 5;

interface Ref<T> {
  current: T;
}

interface UsePlayerPlaybackObservabilityOptions {
  currentTrackRef: Ref<Track | null | undefined>;
  currentTimeRef: Ref<number>;
  durationRef: Ref<number>;
  playbackDeliveryPolicy: PlaybackDeliveryPreference;
  setPlaybackDeliveryPolicy: (policy: PlaybackDeliveryPreference) => void;
}

export function usePlayerPlaybackObservability({
  currentTrackRef,
  currentTimeRef,
  durationRef,
  playbackDeliveryPolicy,
  setPlaybackDeliveryPolicy,
}: UsePlayerPlaybackObservabilityOptions) {
  const getPlaybackSnapshot = useCallback(
    () => ({
      currentTime: currentTimeRef.current,
      duration: durationRef.current,
    }),
    [currentTimeRef, durationRef],
  );

  const {
    startSession: startTrackerSession,
    ensureSession: ensureTrackerSession,
    flushCurrentPlayEvent,
    rotateSession: rotateTrackerSession,
    markSeekPosition,
    recordProgress,
  } = usePlayEventTracker(getPlaybackSnapshot);

  const recordCurrentPlaybackQoe = useCallback(
    (
      event: PlaybackQoeEventName,
      details: {
        durationMs?: number;
        bufferedAheadSeconds?: number;
        attempt?: number;
        outcome?: PlaybackQoeOutcome;
        cause?: PlaybackQoeFailureCause;
      } = {},
    ) => {
      const track = currentTrackRef.current;
      if (!track) return;
      const policy = getEffectivePlaybackDeliveryPolicy(playbackDeliveryPolicy);
      const provenance = getPlaybackDeliveryProvenance(track);
      recordPlaybackQoe({
        event,
        origin:
          provenance?.origin ??
          (track.origin === "remote" ? "remote" : "local"),
        requestedPolicy: provenance?.requestedPolicy ?? policy,
        effectivePolicy: provenance?.effectivePolicy ?? policy,
        runtime: getPlaybackQoeRuntime(),
        engine: shouldUseAndroidNativePlayer() ? "media3" : "gapless",
        ...details,
      });
    },
    [currentTrackRef, playbackDeliveryPolicy],
  );

  const lastProgressSecondsRef = useRef<number | null>(null);
  const activeMsRef = useRef(0);

  const reportActivePlayback = useCallback(
    (minimumMs: number) => {
      const durationMs = Math.round(activeMsRef.current);
      if (durationMs < minimumMs) return;
      activeMsRef.current = 0;
      recordCurrentPlaybackQoe("active", { durationMs });
    },
    [recordCurrentPlaybackQoe],
  );

  const recordPlaybackQualityProgress = useCallback(
    (seconds: number) => {
      recordStablePlayback(seconds);
      const previous = lastProgressSecondsRef.current;
      lastProgressSecondsRef.current = seconds;
      if (previous === null) return;
      const step = seconds - previous;
      if (step <= 0 || step > MAX_PROGRESS_STEP_SECONDS) return;
      activeMsRef.current += step * 1_000;
      reportActivePlayback(ACTIVE_REPORT_MS);
    },
    [reportActivePlayback],
  );

  const recordPlaybackIntent = useCallback(() => {
    lastProgressSecondsRef.current = null;
    recordCurrentPlaybackQoe("intent");
  }, [recordCurrentPlaybackQoe]);

  const recordPlaybackResult = useCallback(
    (outcome: PlaybackQoeOutcome, cause?: PlaybackQoeFailureCause) => {
      recordCurrentPlaybackQoe("result", { outcome, cause });
    },
    [recordCurrentPlaybackQoe],
  );

  useEffect(() => {
    return subscribeToPlaybackDeliveryNetworkChanges(() => {
      setPlaybackDeliveryPolicy(getPlaybackDeliveryPolicyPreference());
    });
  }, [setPlaybackDeliveryPolicy]);

  useEffect(() => {
    const reportRemainder = () => reportActivePlayback(ACTIVE_MIN_REMAINDER_MS);
    window.addEventListener("pagehide", reportRemainder);
    const uninstall = installPlaybackQoeFlush();
    return () => {
      window.removeEventListener("pagehide", reportRemainder);
      uninstall();
    };
  }, [reportActivePlayback]);

  return {
    startTrackerSession,
    ensureTrackerSession,
    flushCurrentPlayEvent,
    rotateTrackerSession,
    markSeekPosition,
    recordProgress,
    recordPlaybackQualityProgress,
    recordPlaybackIntent,
    recordPlaybackResult,
    recordCurrentPlaybackQoe,
  };
}

export type PlayerPlaybackObservability = ReturnType<
  typeof usePlayerPlaybackObservability
>;

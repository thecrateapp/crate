import { useCallback, useEffect, useRef } from "react";

import {
  androidNativeEngine,
  shouldUseAndroidNativePlayer,
} from "@/lib/android-native-engine";
import { ApiError } from "@/lib/api";
import {
  acknowledgeContinuationBatch,
  fetchContinuationBatch,
} from "@/lib/radio-continuation";
import {
  getPlaySourceSignature,
  RADIO_REFILL_THRESHOLD,
  type PlaybackIntelligenceOptions,
  type PlaybackIntelligenceRefs,
} from "./playback-intelligence-model";

export function nativeOwnsBackgroundRefill(): boolean {
  return (
    document.visibilityState === "hidden" &&
    shouldUseAndroidNativePlayer() &&
    androidNativeEngine.hasBackgroundContinuation()
  );
}

type Options = Pick<
  PlaybackIntelligenceOptions,
  | "playSource"
  | "currentIndex"
  | "queue"
  | "isPlaying"
  | "repeat"
  | "shuffle"
  | "infinitePlaybackEnabled"
> & { refs: PlaybackIntelligenceRefs };

export function usePlaybackRefillRuntime(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  const state = useRef({
    generation: 0,
    inFlight: null as AbortController | null,
    timer: null as ReturnType<typeof setTimeout> | null,
    waitingAtEnd: false,
    failures: 0,
    terminal: false,
    suspended: false,
  });
  const runRef = useRef<() => void>(() => {});

  const reset = useCallback(() => {
    const runtime = state.current;
    runtime.generation++;
    runtime.inFlight?.abort();
    runtime.inFlight = null;
    if (runtime.timer !== null) clearTimeout(runtime.timer);
    runtime.timer = null;
    if (runtime.waitingAtEnd)
      latest.current.refs.actionsRef.current.setBuffering(false);
    runtime.waitingAtEnd = false;
    runtime.failures = 0;
    runtime.terminal = false;
    runtime.suspended = true;
  }, []);

  const supported = useCallback(() => {
    const o = latest.current;
    const source = o.refs.playSourceRef.current;
    return (
      o.repeat === "off" &&
      !!source?.radio &&
      (source.type === "radio" ||
        (o.infinitePlaybackEnabled &&
          (source.type === "album" || source.type === "playlist") &&
          source.radio.seedId != null))
    );
  }, []);

  const schedule = useCallback(() => {
    const runtime = state.current;
    if (runtime.timer !== null || runtime.terminal || runtime.suspended) return;
    const delay =
      Math.min(30_000, 1000 * 2 ** Math.min(runtime.failures++, 5)) *
      (0.8 + Math.random() * 0.4);
    runtime.timer = setTimeout(() => {
      runtime.timer = null;
      runRef.current();
    }, delay);
  }, []);

  const run = useCallback(async () => {
    const runtime = state.current;
    const o = latest.current;
    if (
      !supported() ||
      o.refs.queueReadinessRef?.current.ready === false ||
      runtime.suspended ||
      runtime.terminal ||
      runtime.inFlight ||
      nativeOwnsBackgroundRefill()
    )
      return;
    if (!navigator.onLine) {
      schedule();
      return;
    }
    const source = o.refs.playSourceRef.current!;
    const index = o.refs.currentIndexRef.current;
    const buffer = o.refs.queueRef.current.slice(index);
    if (
      !buffer.length ||
      (!runtime.waitingAtEnd && buffer.length - 1 > RADIO_REFILL_THRESHOLD)
    )
      return;
    const controller = new AbortController();
    const generation = runtime.generation;
    const queueGeneration = o.refs.queueReadinessRef?.current.generation;
    runtime.inFlight = controller;
    const isSameQueue = () =>
      source === latest.current.refs.playSourceRef.current &&
      o.refs.queueReadinessRef?.current.ready !== false &&
      queueGeneration === o.refs.queueReadinessRef?.current.generation;
    const isCurrent = () =>
      !controller.signal.aborted &&
      generation === runtime.generation &&
      isSameQueue() &&
      supported() &&
      !runtime.suspended;
    const deadline = setTimeout(() => {
      if (runtime.inFlight !== controller) return;
      controller.abort();
      runtime.inFlight = null;
      schedule();
    }, 20_000);
    try {
      const synchronize = o.refs.actionsRef.current.synchronizeContinuation;
      if (synchronize) await synchronize();
      if (!isCurrent() || nativeOwnsBackgroundRefill()) return;
      const activeBuffer = o.refs.queueRef.current.slice(
        o.refs.currentIndexRef.current,
      );
      const batch = await fetchContinuationBatch(
        source,
        activeBuffer,
        controller.signal,
      );
      clearTimeout(deadline);
      if (!isCurrent()) return;
      const acknowledge = async () => {
        acknowledgeContinuationBatch(source, batch);
        await latest.current.refs.actionsRef.current.publishContinuationCursor?.(
          source,
          batch.status === "retryable_empty",
        );
      };
      if (batch.status === "exhausted" || batch.status === "auth_required") {
        runtime.terminal = true;
        runtime.waitingAtEnd = false;
        o.refs.actionsRef.current.setBuffering(false);
        return;
      }
      let incorporated = 0;
      if (batch.tracks.length) {
        const tracks =
          source.type === "radio"
            ? batch.tracks
            : batch.tracks.map((track) => ({
                ...track,
                isAutoplayContinuation: true,
              }));
        const actions = latest.current.refs.actionsRef.current;
        const wasWaiting = runtime.waitingAtEnd;
        incorporated = await (wasWaiting
          ? actions.appendAndAdvance(tracks, isCurrent)
          : actions.appendTracks(tracks, isCurrent));
        if (!isCurrent()) {
          if (incorporated > 0 && isSameQueue()) await acknowledge();
          return;
        }
        if (!wasWaiting && runtime.waitingAtEnd && incorporated > 0) {
          await actions.appendAndAdvance([], isCurrent);
          if (!isCurrent()) {
            if (incorporated > 0 && isSameQueue()) await acknowledge();
            return;
          }
        }
      }
      await acknowledge();
      if (!isCurrent()) return;
      if (incorporated > 0) {
        runtime.failures = 0;
        runtime.waitingAtEnd = false;
      } else schedule();
    } catch (error) {
      if (!isCurrent()) return;
      if (
        error instanceof ApiError &&
        (error.status === 401 || error.status === 403)
      ) {
        runtime.terminal = true;
        runtime.waitingAtEnd = false;
        o.refs.actionsRef.current.setBuffering(false);
      } else schedule();
    } finally {
      clearTimeout(deadline);
      if (runtime.inFlight === controller) runtime.inFlight = null;
    }
  }, [schedule, supported]);
  runRef.current = () => {
    void run();
  };

  const continueInfinitePlayback = useCallback(() => {
    if (
      !supported() ||
      latest.current.refs.queueReadinessRef?.current.ready === false ||
      state.current.terminal ||
      nativeOwnsBackgroundRefill()
    )
      return false;
    state.current.suspended = false;
    state.current.waitingAtEnd = true;
    latest.current.refs.actionsRef.current.setBuffering(true);
    runRef.current();
    return true;
  }, [supported]);

  const sourceSignature = getPlaySourceSignature(options.playSource);
  useEffect(() => {
    reset();
    state.current.suspended = !latest.current.isPlaying;
  }, [sourceSignature, reset]);
  useEffect(() => {
    if (!supported()) {
      const suspended = state.current.suspended;
      reset();
      state.current.suspended = suspended;
      return;
    }
    // A natural EOF uses waitingAtEnd; a user pause invokes reset explicitly.
    if (!state.current.suspended) runRef.current();
  }, [
    sourceSignature,
    options.currentIndex,
    options.queue,
    options.repeat,
    options.shuffle,
    options.infinitePlaybackEnabled,
    reset,
    supported,
  ]);
  useEffect(() => {
    const wake = () => {
      if (nativeOwnsBackgroundRefill()) {
        state.current.inFlight?.abort();
        state.current.inFlight = null;
        return;
      }
      if (state.current.timer !== null) clearTimeout(state.current.timer);
      state.current.timer = null;
      runRef.current();
    };
    window.addEventListener("online", wake);
    document.addEventListener("visibilitychange", wake);
    return () => {
      reset();
      window.removeEventListener("online", wake);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [reset]);
  const resume = useCallback(() => {
    state.current.suspended = false;
    if (supported()) runRef.current();
  }, [supported]);
  const recoverAtEnd = useCallback(
    () => !state.current.suspended && continueInfinitePlayback(),
    [continueInfinitePlayback],
  );
  return { continueInfinitePlayback, recoverAtEnd, resume, reset };
}

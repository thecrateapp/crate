import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

import {
  androidNativeEngine,
  shouldUseAndroidNativePlayer,
} from "@/lib/android-native-engine";
import { ApiError } from "@/lib/api";
import { getTrackCacheKey } from "./player-utils";
import {
  acknowledgeContinuationBatch,
  fetchContinuationBatch,
} from "@/lib/radio-continuation";
import {
  getPlaySourceSignature,
  RADIO_REFILL_THRESHOLD,
  type PlaybackIntelligenceOptions,
  type PlaybackIntelligenceRefs,
  type PlaybackResumeOptions,
} from "./playback-intelligence-model";

const MAX_EOF_TRANSPORT_FAILURES = 5;
const MAX_EOF_WAIT_MS = 60_000;
const CURSOR_ACK_TIMEOUT_MS = 10_000;

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
  | "isSoftInterrupted"
> & { refs: PlaybackIntelligenceRefs };

export function usePlaybackRefillRuntime(options: Options) {
  const latest = useRef(options);
  useLayoutEffect(() => {
    latest.current = options;
  }, [options]);
  const state = useRef({
    generation: 0,
    inFlight: null as AbortController | null,
    timer: null as ReturnType<typeof setTimeout> | null,
    graceTimer: null as ReturnType<typeof setTimeout> | null,
    waitingAtEnd: false,
    waitingTrack: null as {
      key: string;
      source: PlaybackIntelligenceOptions["playSource"];
      queueGeneration: number | undefined;
    } | null,
    nativeHandoff: false,
    failures: 0,
    transportFailures: 0,
    needsGesture: false,
    terminal: false,
    suspended: false,
  });
  const runRef = useRef<() => void>(() => {});

  const clearEofWait = useCallback(() => {
    const runtime = state.current;
    if (runtime.graceTimer !== null) clearTimeout(runtime.graceTimer);
    runtime.graceTimer = null;
    runtime.waitingAtEnd = false;
    runtime.waitingTrack = null;
  }, []);

  const yieldToNative = useCallback(() => {
    if (!nativeOwnsBackgroundRefill()) return false;
    const runtime = state.current;
    if (runtime.waitingAtEnd) runtime.nativeHandoff = true;
    if (runtime.graceTimer !== null) clearTimeout(runtime.graceTimer);
    runtime.graceTimer = null;
    runtime.inFlight?.abort();
    runtime.inFlight = null;
    return true;
  }, []);

  const settleAdvancedEof = useCallback(
    (index = latest.current.refs.currentIndexRef.current) => {
      const runtime = state.current;
      const anchor = runtime.waitingTrack;
      const refs = latest.current.refs;
      const track = refs.queueRef.current[index];
      if (
        !runtime.waitingAtEnd ||
        !anchor ||
        !track ||
        anchor.source !== refs.playSourceRef.current ||
        refs.queueReadinessRef?.current.ready === false ||
        anchor.queueGeneration !== refs.queueReadinessRef?.current.generation ||
        anchor.key === getTrackCacheKey(track)
      )
        return false;
      runtime.failures = 0;
      runtime.transportFailures = 0;
      refs.actionsRef.current.setBuffering(false);
      clearEofWait();
      return true;
    },
    [clearEofWait],
  );

  const reset = useCallback(() => {
    const runtime = state.current;
    runtime.generation++;
    runtime.inFlight?.abort();
    runtime.inFlight = null;
    if (runtime.timer !== null) clearTimeout(runtime.timer);
    runtime.timer = null;
    if (runtime.waitingAtEnd)
      latest.current.refs.actionsRef.current.setBuffering(false);
    clearEofWait();
    runtime.failures = 0;
    runtime.transportFailures = 0;
    runtime.needsGesture = false;
    runtime.terminal = false;
    runtime.suspended = true;
    runtime.nativeHandoff = false;
  }, [clearEofWait]);

  const unavailable = useCallback(() => {
    if (!state.current.waitingAtEnd || yieldToNative() || settleAdvancedEof())
      return;
    reset();
    state.current.needsGesture = true;
    latest.current.refs.actionsRef.current.onUnavailable?.();
  }, [reset, settleAdvancedEof, yieldToNative]);

  const startEofDeadline = useCallback(() => {
    const runtime = state.current;
    if (!runtime.waitingAtEnd || runtime.graceTimer !== null || yieldToNative())
      return;
    const generation = runtime.generation;
    const source = latest.current.refs.playSourceRef.current;
    runtime.graceTimer = setTimeout(() => {
      runtime.graceTimer = null;
      if (
        generation === runtime.generation &&
        source === latest.current.refs.playSourceRef.current
      )
        unavailable();
    }, MAX_EOF_WAIT_MS);
  }, [unavailable, yieldToNative]);

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

  const schedule = useCallback(
    (transportFailure = false) => {
      const runtime = state.current;
      if (
        runtime.timer !== null ||
        runtime.terminal ||
        runtime.suspended ||
        runtime.needsGesture
      )
        return;
      if (transportFailure) runtime.transportFailures++;
      if (
        runtime.waitingAtEnd &&
        runtime.transportFailures >= MAX_EOF_TRANSPORT_FAILURES
      ) {
        unavailable();
        return;
      }
      const delay =
        Math.min(30_000, 1000 * 2 ** Math.min(runtime.failures++, 5)) *
        (0.8 + Math.random() * 0.4);
      runtime.timer = setTimeout(() => {
        runtime.timer = null;
        runRef.current();
      }, delay);
    },
    [unavailable],
  );

  const run = useCallback(async () => {
    const runtime = state.current;
    const o = latest.current;
    settleAdvancedEof();
    if (
      yieldToNative() ||
      !supported() ||
      o.isSoftInterrupted?.() ||
      o.refs.queueReadinessRef?.current.ready === false ||
      runtime.suspended ||
      runtime.needsGesture ||
      runtime.terminal ||
      runtime.timer !== null ||
      runtime.inFlight
    )
      return;
    startEofDeadline();
    if (!navigator.onLine) {
      schedule(true);
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
      !latest.current.isSoftInterrupted?.() &&
      !runtime.suspended &&
      !yieldToNative();
    const deadline = setTimeout(() => {
      if (runtime.inFlight !== controller) return;
      controller.abort();
      runtime.inFlight = null;
      schedule(true);
    }, 20_000);
    const clearDeadline = () => clearTimeout(deadline);
    controller.signal.addEventListener("abort", clearDeadline, { once: true });
    try {
      const synchronize = o.refs.actionsRef.current.synchronizeContinuation;
      if (synchronize) await synchronize();
      if (!isCurrent()) return;
      if (runtime.nativeHandoff) {
        const native = await androidNativeEngine.getState();
        if (!isCurrent()) return;
        if (!native) throw new Error("Native continuation state unavailable");
        if (native.playbackState === "paused") {
          reset();
          return;
        }
        runtime.nativeHandoff = false;
        if (native.playbackState === "buffering") runtime.suspended = true;
        if (
          settleAdvancedEof(native.index) ||
          !runtime.waitingAtEnd ||
          runtime.suspended
        )
          return;
      }
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
        const publish =
          latest.current.refs.actionsRef.current.publishContinuationCursor;
        if (!publish) return;
        const publication = Promise.resolve().then(() => {
          if (isSameQueue())
            return publish(source, batch.status === "retryable_empty");
        });
        if (controller.signal.aborted) {
          void publication.catch(() => {});
          return;
        }
        // Cursor publication must not undo a batch already incorporated.
        await new Promise<void>((resolve) => {
          let settled = false;
          const finish = () => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            controller.signal.removeEventListener("abort", finish);
            resolve();
          };
          const timeout = setTimeout(finish, CURSOR_ACK_TIMEOUT_MS);
          controller.signal.addEventListener("abort", finish, { once: true });
          publication.then(finish, finish);
        });
      };
      if (batch.status === "exhausted" || batch.status === "auth_required") {
        runtime.terminal = true;
        clearEofWait();
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
      if (incorporated > 0) {
        runtime.failures = 0;
        runtime.transportFailures = 0;
        if (runtime.waitingAtEnd)
          latest.current.refs.actionsRef.current.setBuffering(false);
        clearEofWait();
      }
      await acknowledge();
      if (!isCurrent()) return;
      if (incorporated === 0) schedule();
    } catch (error) {
      if (!isCurrent()) return;
      if (
        error instanceof ApiError &&
        (error.status === 401 || error.status === 403)
      ) {
        runtime.terminal = true;
        clearEofWait();
        o.refs.actionsRef.current.setBuffering(false);
      } else schedule(true);
    } finally {
      clearTimeout(deadline);
      controller.signal.removeEventListener("abort", clearDeadline);
      if (runtime.inFlight === controller) {
        runtime.inFlight = null;
        if (
          generation === runtime.generation &&
          source === latest.current.refs.playSourceRef.current &&
          (queueGeneration !==
            latest.current.refs.queueReadinessRef?.current.generation ||
            runtime.waitingAtEnd) &&
          runtime.timer === null
        )
          runRef.current();
      }
    }
  }, [
    clearEofWait,
    reset,
    schedule,
    settleAdvancedEof,
    startEofDeadline,
    supported,
    yieldToNative,
  ]);
  useLayoutEffect(() => {
    runRef.current = () => {
      void run();
    };
  }, [run]);

  const continueInfinitePlayback = useCallback(() => {
    if (
      !supported() ||
      latest.current.isSoftInterrupted?.() ||
      latest.current.refs.queueReadinessRef?.current.ready === false ||
      state.current.terminal ||
      state.current.needsGesture ||
      yieldToNative()
    )
      return false;
    const runtime = state.current;
    runtime.suspended = false;
    if (!runtime.waitingAtEnd) {
      runtime.waitingAtEnd = true;
      const refs = latest.current.refs;
      const track = refs.queueRef.current[refs.currentIndexRef.current];
      runtime.waitingTrack = track
        ? {
            key: getTrackCacheKey(track),
            source: refs.playSourceRef.current,
            queueGeneration: refs.queueReadinessRef?.current.generation,
          }
        : null;
      runtime.failures = 0;
      runtime.transportFailures = 0;
    }
    startEofDeadline();
    latest.current.refs.actionsRef.current.setBuffering(true);
    runRef.current();
    return true;
  }, [supported, startEofDeadline, yieldToNative]);

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
      if (
        state.current.waitingAtEnd &&
        document.visibilityState === "hidden" &&
        shouldUseAndroidNativePlayer()
      )
        state.current.nativeHandoff = state.current.waitingAtEnd;
      if (yieldToNative()) return;
      if (
        state.current.nativeHandoff &&
        document.visibilityState === "visible"
      ) {
        if (state.current.graceTimer !== null)
          clearTimeout(state.current.graceTimer);
        state.current.graceTimer = null;
        state.current.inFlight?.abort();
        state.current.inFlight = null;
      }
      if (state.current.timer !== null) return;
      runRef.current();
    };
    window.addEventListener("online", wake);
    document.addEventListener("visibilitychange", wake);
    return () => {
      reset();
      window.removeEventListener("online", wake);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [reset, yieldToNative]);
  const resume = useCallback(
    (intent?: PlaybackResumeOptions) => {
      const runtime = state.current;
      if (runtime.terminal) return false;
      if (runtime.needsGesture) {
        if (!intent?.userGesture) return true;
        runtime.needsGesture = false;
        runtime.suspended = false;
        const refs = latest.current.refs;
        if (refs.currentIndexRef.current < refs.queueRef.current.length - 1) {
          runRef.current();
          return false;
        }
        return continueInfinitePlayback();
      }
      runtime.suspended = false;
      const waitingAtEnd = runtime.waitingAtEnd;
      if (supported()) runRef.current();
      return waitingAtEnd;
    },
    [continueInfinitePlayback, supported],
  );
  const recoverAtEnd = useCallback(
    () => !state.current.suspended && continueInfinitePlayback(),
    [continueInfinitePlayback],
  );
  return { continueInfinitePlayback, recoverAtEnd, resume, reset };
}

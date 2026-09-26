import type { PlayerPauseOptions } from "@/contexts/player-context";
import { recordDevLog } from "@/lib/dev-logs";

const INTERRUPTION_CANDIDATE_WINDOW_MS = 2_000;
const INTERRUPTION_RESUME_TIMEOUT_MS = 30_000;
const OPAQUE_DEVICE_CHANGE_SETTLE_MS = 300;

export interface AudioOutputMediaDevices {
  addEventListener(type: "devicechange", listener: EventListener): void;
  removeEventListener(type: "devicechange", listener: EventListener): void;
}

export interface AudioOutputInterruptionDependencies {
  enumerateInputDevices?: () => Promise<readonly string[] | null>;
  enumerateOutputDevices?: () => Promise<readonly string[] | null>;
  getAudioContext: () => AudioContext | null;
  isPlaying: () => boolean;
  mediaDevices?: AudioOutputMediaDevices | null;
  pause: (options?: PlayerPauseOptions) => void;
  resume: () => void;
}

export interface AudioOutputInterruptionController {
  cancelPendingResume(): void;
  dispose(): void;
  hasPendingResume(): boolean;
  install(): void;
  observe(): () => void;
}

let activeController: AudioOutputInterruptionController | null = null;

/**
 * Explicit transport actions invalidate an interruption-originated resume.
 * The player controls live below the platform integration hook, so this
 * small registration avoids threading cancellation state through every
 * consumer of PlayerActionsValue.
 */
export function cancelPendingAudioOutputResume(): void {
  activeController?.cancelPendingResume();
}

export function isAudioOutputInterruptionPending(): boolean {
  return activeController?.hasPendingResume() ?? false;
}

export function createAudioOutputInterruptionController(
  dependencies: AudioOutputInterruptionDependencies,
): AudioOutputInterruptionController {
  let installed = false;
  let pendingResume = false;
  let pendingResumeTimer: ReturnType<typeof setTimeout> | null = null;
  let observedContext: AudioContext | null = null;
  let outputDeviceIds: Set<string> | null = null;
  let inputDeviceIds: Set<string> | null = null;
  let lastPlayingAt: number | null = null;
  let playbackWasActive = false;
  let deviceChangeWork = Promise.resolve();
  let opaqueDeviceChangeTimer: ReturnType<typeof setTimeout> | null = null;

  const onContextStateChange = (): void => {
    const state = observedContext?.state as string | undefined;
    if (state === "running") {
      resumeAfterInterruption("audio-context-running");
      return;
    }

    if (state === "suspended" || state === "interrupted") {
      pauseForInterruption(`audio-context-${state}`);
    }
  };

  const onContextError = (): void => {
    pauseForInterruption("audio-context-error");
  };

  const onContextSinkChange = (): void => {
    if (pendingResume) {
      resumeAfterInterruption("audio-context-sinkchange");
      return;
    }

    pauseForInterruption("audio-context-sinkchange");
  };

  const observe = (): (() => void) => {
    if (!installed) return () => {};

    if (dependencies.isPlaying()) {
      lastPlayingAt = Date.now();
      playbackWasActive = true;
    } else if (playbackWasActive) {
      lastPlayingAt = Date.now();
      playbackWasActive = false;
    }

    const context = dependencies.getAudioContext();
    const contextChanged = context !== observedContext;
    if (contextChanged) {
      observedContext?.removeEventListener("statechange", onContextStateChange);
      observedContext?.removeEventListener("error", onContextError);
      observedContext?.removeEventListener("sinkchange", onContextSinkChange);
      observedContext = context;
      observedContext?.addEventListener("statechange", onContextStateChange);
      observedContext?.addEventListener("error", onContextError);
      observedContext?.addEventListener("sinkchange", onContextSinkChange);
    }

    if (
      contextChanged &&
      observedContext &&
      observedContext.state !== "running"
    ) {
      onContextStateChange();
    }

    const contextAtObservation = observedContext;
    return () => {
      if (
        !installed ||
        !contextAtObservation ||
        observedContext !== contextAtObservation
      ) {
        return;
      }
      contextAtObservation.removeEventListener(
        "statechange",
        onContextStateChange,
      );
      contextAtObservation.removeEventListener("error", onContextError);
      contextAtObservation.removeEventListener(
        "sinkchange",
        onContextSinkChange,
      );
      observedContext = null;
    };
  };

  const clearPendingResumeTimer = (): void => {
    if (pendingResumeTimer === null) return;
    clearTimeout(pendingResumeTimer);
    pendingResumeTimer = null;
  };

  const pauseForInterruption = (reason: string): void => {
    const wasPlayingRecently =
      lastPlayingAt !== null &&
      Date.now() - lastPlayingAt <= INTERRUPTION_CANDIDATE_WINDOW_MS;
    if (
      pendingResume ||
      (!dependencies.isPlaying() && !playbackWasActive && !wasPlayingRecently)
    ) {
      return;
    }

    pendingResume = true;
    pendingResumeTimer = setTimeout(() => {
      pendingResumeTimer = null;
      pendingResume = false;
      lastPlayingAt = null;
      playbackWasActive = false;
      recordDevLog(
        "audio",
        "output interruption resume expired",
        { reason },
        "debug",
      );
    }, INTERRUPTION_RESUME_TIMEOUT_MS);
    recordDevLog("audio", "output interruption detected", { reason }, "info");
    dependencies.pause({
      immediate: true,
      preserveAudioOutputResume: true,
    });
  };

  const resumeAfterInterruption = (reason: string): void => {
    if (!pendingResume) return;

    clearPendingResumeTimer();
    pendingResume = false;
    if (dependencies.isPlaying()) {
      lastPlayingAt = Date.now();
      playbackWasActive = true;
      recordDevLog(
        "audio",
        "output interruption recovered while playback remained active",
        { reason },
        "debug",
      );
      return;
    }
    lastPlayingAt = null;
    playbackWasActive = false;
    recordDevLog("audio", "output interruption recovered", { reason }, "info");
    dependencies.resume();
  };

  const refreshOutputDevices = async (): Promise<void> => {
    if (!installed || !dependencies.enumerateOutputDevices) return;

    let nextDeviceIds: readonly string[] | null;
    try {
      nextDeviceIds = await dependencies.enumerateOutputDevices();
    } catch (error) {
      recordDevLog(
        "audio",
        "output device enumeration failed",
        { error: String(error) },
        "debug",
      );
      return;
    }

    if (!installed || !nextDeviceIds) return;

    let nextInputDeviceIds: readonly string[] | null = null;
    if (dependencies.enumerateInputDevices) {
      try {
        nextInputDeviceIds = await dependencies.enumerateInputDevices();
      } catch (error) {
        recordDevLog(
          "audio",
          "input device enumeration failed",
          { error: String(error) },
          "debug",
        );
      }
    }
    if (!installed) return;

    const next = new Set(nextDeviceIds.filter(Boolean));
    const previous = outputDeviceIds;
    outputDeviceIds = next;
    const previousInput = inputDeviceIds;
    if (nextInputDeviceIds) {
      inputDeviceIds = new Set(nextInputDeviceIds.filter(Boolean));
    }
    if (!previous) return;

    const hasRemovedOutput = [...previous].some((id) => !next.has(id));
    const currentInput = inputDeviceIds;
    const inputDevicesChanged =
      previousInput !== null &&
      currentInput !== null &&
      (previousInput.size !== currentInput.size ||
        [...previousInput].some((id) => !currentInput.has(id)));

    // Chrome can hide output identities until output-selection permission is
    // granted. A generic devicechange is not proof that the active output
    // changed: microphone and camera changes fire the same event. Only use it
    // as a recovery signal when the active sink is observable (handled below),
    // or as a pause signal when AudioContext confirms it was interrupted.
    const outputIdentityIsOpaque =
      next.size === 0 || (next.size === 1 && next.has("default"));
    const previousOutputIdentityIsOpaque =
      previous.size === 0 || (previous.size === 1 && previous.has("default"));
    if (outputIdentityIsOpaque && previousOutputIdentityIsOpaque) {
      const contextState = dependencies.getAudioContext()?.state;
      if (
        !pendingResume &&
        (contextState === "suspended" || contextState === "interrupted")
      ) {
        pauseForInterruption(`devicechange-audio-context-${contextState}`);
      } else if (inputDevicesChanged) {
        recordDevLog(
          "audio",
          "ignored devicechange without an identifiable output change",
          { reason: "input-device-change" },
          "debug",
        );
      }
      return;
    }

    const context = dependencies.getAudioContext() as
      | (AudioContext & { sinkId?: unknown })
      | null;
    const sinkId =
      typeof context?.sinkId === "string"
        ? context.sinkId
        : context?.sinkId &&
            typeof context.sinkId === "object" &&
            "id" in context.sinkId &&
            typeof context.sinkId.id === "string"
          ? context.sinkId.id
          : null;
    const activeSinkId = sinkId && sinkId !== "default" ? sinkId : null;
    const previousExplicitOutputs = [...previous].filter(
      (id) => id !== "default",
    );
    const nextExplicitOutputs = [...next].filter((id) => id !== "default");
    const removedExplicitOutputs = previousExplicitOutputs.filter(
      (id) => !next.has(id),
    );
    const addedExplicitOutputs = nextExplicitOutputs.filter(
      (id) => !previous.has(id),
    );
    const activeOutputWasRemoved = activeSinkId
      ? previous.has(activeSinkId) && !next.has(activeSinkId)
      : previousExplicitOutputs.length === 1 &&
        nextExplicitOutputs.length === 0 &&
        removedExplicitOutputs.length === 1;
    const activeOutputReturned = activeSinkId
      ? next.has(activeSinkId)
      : nextExplicitOutputs.length === 1 && addedExplicitOutputs.length === 1;

    if (pendingResume) {
      if (activeOutputReturned) {
        resumeAfterInterruption("devicechange");
      }
      return;
    }

    if (hasRemovedOutput && activeOutputWasRemoved) {
      pauseForInterruption("devicechange");
    }
  };

  const enqueueDeviceRefresh = (): void => {
    deviceChangeWork = deviceChangeWork.then(
      () => refreshOutputDevices(),
      () => refreshOutputDevices(),
    );
  };

  const onDeviceChange = (): void => {
    const outputIdentityIsOpaque =
      outputDeviceIds !== null &&
      (outputDeviceIds.size === 0 ||
        (outputDeviceIds.size === 1 && outputDeviceIds.has("default")));

    if (outputIdentityIsOpaque) {
      if (opaqueDeviceChangeTimer !== null) {
        clearTimeout(opaqueDeviceChangeTimer);
      }
      opaqueDeviceChangeTimer = setTimeout(() => {
        opaqueDeviceChangeTimer = null;
        enqueueDeviceRefresh();
      }, OPAQUE_DEVICE_CHANGE_SETTLE_MS);
      return;
    }

    enqueueDeviceRefresh();
  };

  const cancelPendingResume = (): void => {
    clearPendingResumeTimer();
    pendingResume = false;
    lastPlayingAt = null;
    playbackWasActive = false;
  };

  const install = (): void => {
    if (installed) return;
    installed = true;
    activeController = controller;

    dependencies.mediaDevices?.addEventListener("devicechange", onDeviceChange);
    observe();
    deviceChangeWork = deviceChangeWork.then(
      () => refreshOutputDevices(),
      () => refreshOutputDevices(),
    );
  };

  const dispose = (): void => {
    if (!installed) return;
    installed = false;
    cancelPendingResume();
    if (opaqueDeviceChangeTimer !== null) {
      clearTimeout(opaqueDeviceChangeTimer);
      opaqueDeviceChangeTimer = null;
    }
    dependencies.mediaDevices?.removeEventListener(
      "devicechange",
      onDeviceChange,
    );
    observedContext?.removeEventListener("statechange", onContextStateChange);
    observedContext?.removeEventListener("error", onContextError);
    observedContext?.removeEventListener("sinkchange", onContextSinkChange);
    observedContext = null;
    outputDeviceIds = null;
    inputDeviceIds = null;
    if (activeController === controller) activeController = null;
  };

  const controller: AudioOutputInterruptionController = {
    cancelPendingResume,
    dispose,
    hasPendingResume: () => pendingResume,
    install,
    observe,
  };

  return controller;
}

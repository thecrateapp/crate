import type { PlayerPauseOptions } from "@/contexts/player-context";
import { recordDevLog } from "@/lib/dev-logs";

const INTERRUPTION_CANDIDATE_WINDOW_MS = 2_000;

export interface AudioOutputMediaDevices {
  addEventListener(type: "devicechange", listener: EventListener): void;
  removeEventListener(type: "devicechange", listener: EventListener): void;
}

export interface AudioOutputInterruptionDependencies {
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
  observe(): void;
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
  let observedContext: AudioContext | null = null;
  let outputDeviceIds: Set<string> | null = null;
  let lastPlayingAt: number | null = null;
  let deviceChangeWork = Promise.resolve();

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

  const observe = (): void => {
    if (!installed) return;

    if (dependencies.isPlaying()) {
      lastPlayingAt = Date.now();
    }

    const context = dependencies.getAudioContext();
    if (context === observedContext) return;

    observedContext?.removeEventListener("statechange", onContextStateChange);
    observedContext?.removeEventListener("error", onContextError);
    observedContext?.removeEventListener("sinkchange", onContextSinkChange);
    observedContext = context;
    observedContext?.addEventListener("statechange", onContextStateChange);
    observedContext?.addEventListener("error", onContextError);
    observedContext?.addEventListener("sinkchange", onContextSinkChange);

    if (observedContext && observedContext.state !== "running") {
      onContextStateChange();
    }
  };

  const pauseForInterruption = (reason: string): void => {
    const wasPlayingRecently =
      lastPlayingAt !== null &&
      Date.now() - lastPlayingAt <= INTERRUPTION_CANDIDATE_WINDOW_MS;
    if (pendingResume || (!dependencies.isPlaying() && !wasPlayingRecently)) {
      return;
    }

    pendingResume = true;
    recordDevLog("audio", "output interruption detected", { reason }, "info");
    dependencies.pause({
      immediate: true,
      preserveAudioOutputResume: true,
    });
  };

  const resumeAfterInterruption = (reason: string): void => {
    if (!pendingResume) return;

    pendingResume = false;
    if (dependencies.isPlaying()) {
      recordDevLog(
        "audio",
        "output interruption recovered while playback remained active",
        { reason },
        "debug",
      );
      return;
    }
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

    const next = new Set(nextDeviceIds.filter(Boolean));
    const previous = outputDeviceIds;
    outputDeviceIds = next;
    if (!previous) return;

    const hasRemovedOutput = [...previous].some((id) => !next.has(id));
    const hasAddedOutput = [...next].some((id) => !previous.has(id));

    // Chrome intentionally hides output identities until the page has been
    // granted output-selection permission. In that mode enumerateDevices()
    // returns the same generic/default audiooutput entry for every route, so
    // there is no set diff to compare. Treat consecutive devicechange events
    // as the interruption boundary in that opaque mode: the first event is
    // the removal, the next event is the route becoming available again.
    const outputIdentityIsOpaque =
      next.size === 0 || (next.size === 1 && next.has("default"));
    const previousOutputIdentityIsOpaque =
      previous.size === 0 || (previous.size === 1 && previous.has("default"));
    if (outputIdentityIsOpaque && previousOutputIdentityIsOpaque) {
      if (pendingResume) {
        resumeAfterInterruption("devicechange");
      } else {
        pauseForInterruption("devicechange");
      }
      return;
    }

    if (pendingResume) {
      if (hasAddedOutput) {
        resumeAfterInterruption("devicechange");
      }
      return;
    }

    if (hasRemovedOutput) {
      pauseForInterruption("devicechange");
    }
  };

  const onDeviceChange = (): void => {
    deviceChangeWork = deviceChangeWork.then(
      () => refreshOutputDevices(),
      () => refreshOutputDevices(),
    );
  };

  const cancelPendingResume = (): void => {
    pendingResume = false;
    lastPlayingAt = null;
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
    dependencies.mediaDevices?.removeEventListener(
      "devicechange",
      onDeviceChange,
    );
    observedContext?.removeEventListener("statechange", onContextStateChange);
    observedContext?.removeEventListener("error", onContextError);
    observedContext?.removeEventListener("sinkchange", onContextSinkChange);
    observedContext = null;
    outputDeviceIds = null;
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

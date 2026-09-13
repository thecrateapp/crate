import { recordDevLog } from "@/lib/dev-logs";

// A quick alt-tab and a real system sleep fire the exact same
// visibilitychange/focus events on resume — only the elapsed hidden time
// tells them apart. Long enough to never trip on background-tab timer
// throttling (which caps around 1s), short enough to catch a real sleep.
const LONG_ABSENCE_MS = 10_000;

export interface AudioRecoveryOptions {
  rebuildIfTauriOutputMayBeStale?: boolean;
}

export interface AudioRecoveryDependencies {
  getAudioContext: () => AudioContext | null;
  isTauriDesktopRuntime: () => boolean;
  isPlaybackActive: () => boolean;
  isOutputStale: () => boolean;
  markOutputStale: () => void;
  clearOutputStale: () => void;
  rebuildPlayer: (reason: string) => void;
}

export interface AudioRecoveryController {
  install(): void;
  prepare(reason: string, options?: AudioRecoveryOptions): Promise<void>;
  clearSharedGaplessAudioContext(previousContext: AudioContext | null): void;
}

type WindowWithGaplessContext = Window & {
  gapless5AudioContext?: AudioContext;
};

export function createAudioRecoveryController(
  dependencies: AudioRecoveryDependencies,
): AudioRecoveryController {
  let lifecycleRecoveryInstalled = false;
  let contextWakeInFlight: Promise<void> | null = null;
  let hiddenAt: number | null = null;

  // Empirical mitigation, not a documented API contract: on Tauri desktop
  // (WKWebView/WebKitGTK), an AudioContext can report state "running" after
  // a wake/focus event while the underlying CoreAudio/PulseAudio output
  // stream is still torn down — silent, no error, no observable state
  // change. A near-silent oscillator blip nudges the engine to reconnect
  // the real output device. If this stops working on a future WebKit/GTK
  // version, this is where to look — the real fix is upstream in the
  // webview's audio stack, which we don't control.
  const kickAudioOutput = (ctx: AudioContext, reason: string): void => {
    if (
      !dependencies.isTauriDesktopRuntime() ||
      ctx.state !== "running" ||
      typeof window === "undefined"
    ) {
      return;
    }
    try {
      const gain = ctx.createGain();
      gain.gain.value = 0.00001;
      const oscillator = ctx.createOscillator();
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start();
      oscillator.stop(ctx.currentTime + 0.03);
      window.setTimeout(() => {
        try {
          oscillator.disconnect();
          gain.disconnect();
        } catch {
          /* ignore */
        }
      }, 80);
    } catch (error) {
      recordDevLog(
        "audio",
        "output wake kick failed",
        { reason, error: String(error) },
        "debug",
      );
    }
  };

  const clearSharedGaplessAudioContext = (
    previousContext: AudioContext | null,
  ): void => {
    if (typeof window === "undefined") return;
    const w = window as WindowWithGaplessContext;
    if (!w.gapless5AudioContext) return;
    if (!previousContext || w.gapless5AudioContext === previousContext) {
      w.gapless5AudioContext = undefined;
    }
  };

  const prepareInner = async (
    reason: string,
    options: AudioRecoveryOptions,
  ): Promise<void> => {
    let ctx = dependencies.getAudioContext();
    if (!ctx) return;

    if (
      options.rebuildIfTauriOutputMayBeStale &&
      dependencies.isTauriDesktopRuntime() &&
      dependencies.isOutputStale()
    ) {
      dependencies.rebuildPlayer(`${reason}:tauri-output-stale`);
      dependencies.clearOutputStale();
      ctx = dependencies.getAudioContext();
    }

    if (!ctx) return;

    if (ctx.state === "closed") {
      dependencies.rebuildPlayer(reason);
      dependencies.clearOutputStale();
      ctx = dependencies.getAudioContext();
    }

    if (ctx?.state === "suspended") {
      try {
        await ctx.resume();
      } catch (error) {
        recordDevLog(
          "audio",
          "audio context resume failed",
          { reason, error: String(error) },
          "warn",
        );
      }
    }

    ctx = dependencies.getAudioContext();
    if (ctx?.state === "closed") {
      dependencies.rebuildPlayer(`${reason}:resume-closed`);
      dependencies.clearOutputStale();
      ctx = dependencies.getAudioContext();
    }

    if (ctx?.state === "running") {
      kickAudioOutput(ctx, reason);
    }
  };

  const prepare = (
    reason: string,
    options: AudioRecoveryOptions = {},
  ): Promise<void> => {
    const wantsStaleTauriRebuild =
      options.rebuildIfTauriOutputMayBeStale &&
      dependencies.isTauriDesktopRuntime() &&
      dependencies.isOutputStale();

    const trackWake = (wake: Promise<void>): Promise<void> => {
      const tracked = wake.finally(() => {
        if (contextWakeInFlight === tracked) {
          contextWakeInFlight = null;
        }
      });
      contextWakeInFlight = tracked;
      return tracked;
    };

    if (contextWakeInFlight) {
      if (!wantsStaleTauriRebuild) return contextWakeInFlight;
      const currentWake = contextWakeInFlight;
      return trackWake(
        currentWake.then(
          () => prepareInner(reason, options),
          () => prepareInner(reason, options),
        ),
      );
    }

    return trackWake(prepareInner(reason, options));
  };

  const install = (): void => {
    if (
      lifecycleRecoveryInstalled ||
      typeof window === "undefined" ||
      typeof document === "undefined"
    ) {
      return;
    }
    lifecycleRecoveryInstalled = true;

    const wake = (reason: string): void => {
      if (!dependencies.isTauriDesktopRuntime()) return;
      const wasHiddenForLong =
        hiddenAt != null && Date.now() - hiddenAt >= LONG_ABSENCE_MS;
      if (
        !dependencies.isPlaybackActive() ||
        wasHiddenForLong ||
        reason === "devicechange"
      ) {
        dependencies.markOutputStale();
      }
      void prepare(reason);
    };

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        wake("visibilitychange");
        hiddenAt = null;
      } else {
        hiddenAt = Date.now();
      }
    });
    window.addEventListener("focus", () => wake("focus"));
    window.addEventListener("pageshow", () => wake("pageshow"));

    if (typeof navigator !== "undefined" && navigator.mediaDevices) {
      navigator.mediaDevices.addEventListener?.("devicechange", () =>
        wake("devicechange"),
      );
    }
  };

  return {
    install,
    prepare,
    clearSharedGaplessAudioContext,
  };
}

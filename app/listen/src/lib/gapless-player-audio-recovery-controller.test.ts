import { describe, expect, it, vi } from "vitest";

import { createAudioRecoveryController } from "./gapless-player-audio-recovery";

describe("gapless player audio recovery controller", () => {
  it.each([
    ["running", false],
    ["suspended", true],
    ["closed", true],
    ["interrupted", true],
  ] as const)(
    "reports whether the %s AudioContext needs recovery",
    (state, expected) => {
      const context = { state } as unknown as AudioContext;
      const controller = createAudioRecoveryController({
        getAudioContext: () => context,
        isTauriDesktopRuntime: () => false,
        isPlaybackActive: () => true,
        isOutputStale: () => false,
        markOutputStale: vi.fn(),
        rebuildPlayer: vi.fn(),
        clearOutputStale: vi.fn(),
      });

      expect(controller.needsRecovery()).toBe(expected);
    },
  );

  it("requires recovery for a stale Tauri output", () => {
    const context = { state: "running" } as unknown as AudioContext;
    const controller = createAudioRecoveryController({
      getAudioContext: () => context,
      isTauriDesktopRuntime: () => true,
      isPlaybackActive: () => false,
      isOutputStale: () => true,
      markOutputStale: vi.fn(),
      rebuildPlayer: vi.fn(),
      clearOutputStale: vi.fn(),
    });

    expect(
      controller.needsRecovery({
        rebuildIfTauriOutputMayBeStale: true,
      }),
    ).toBe(true);
  });

  it("deduplicates concurrent context wake operations", async () => {
    let releaseResume: (() => void) | undefined;
    const resume = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseResume = resolve;
        }),
    );
    const context = {
      state: "suspended" as AudioContextState,
      resume,
    } as unknown as AudioContext;
    const controller = createAudioRecoveryController({
      getAudioContext: () => context,
      isTauriDesktopRuntime: () => false,
      isPlaybackActive: () => false,
      isOutputStale: () => false,
      markOutputStale: vi.fn(),
      rebuildPlayer: vi.fn(),
      clearOutputStale: vi.fn(),
    });

    const firstWake = controller.prepare("first");
    const secondWake = controller.prepare("second");

    expect(resume).toHaveBeenCalledTimes(1);
    expect(controller.needsRecovery()).toBe(true);

    releaseResume?.();
    await Promise.all([firstWake, secondWake]);
  });

  it("attempts to resume an interrupted WebKit AudioContext", async () => {
    const resume = vi.fn(async () => undefined);
    const rebuildPlayer = vi.fn();
    const context = {
      state: "interrupted" as AudioContextState,
      resume,
    } as unknown as AudioContext;
    const controller = createAudioRecoveryController({
      getAudioContext: () => context,
      isTauriDesktopRuntime: () => true,
      isPlaybackActive: () => true,
      isOutputStale: () => false,
      markOutputStale: vi.fn(),
      rebuildPlayer,
      clearOutputStale: vi.fn(),
    });

    await controller.prepare("webkit-interrupted");

    expect(resume).toHaveBeenCalledTimes(1);
    expect(rebuildPlayer).not.toHaveBeenCalled();
  });
});

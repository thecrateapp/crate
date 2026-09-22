import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  cancelPendingAudioOutputResume,
  createAudioOutputInterruptionController,
  isAudioOutputInterruptionPending,
} from "./audio-output-interruption";

class FakeAudioContext extends EventTarget {
  state: AudioContextState = "running";
}

function flushAsyncWork(): Promise<void> {
  return Promise.resolve()
    .then(() => undefined)
    .then(() => undefined)
    .then(() => undefined);
}

describe("audio output interruption controller", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("pauses when an output disappears and resumes when it returns", async () => {
    vi.useFakeTimers();
    const mediaDevices = new EventTarget() as MediaDevices;
    const audioContext = new FakeAudioContext();
    let isPlaying = true;
    const pause = vi.fn(() => {
      isPlaying = false;
    });
    const resume = vi.fn(() => {
      isPlaying = true;
    });
    let outputDeviceIds = ["default", "headphones"];

    const controller = createAudioOutputInterruptionController({
      enumerateOutputDevices: async () => outputDeviceIds,
      getAudioContext: () => audioContext as unknown as AudioContext,
      isPlaying: () => isPlaying,
      mediaDevices,
      pause,
      resume,
    });
    controller.install();
    await flushAsyncWork();

    outputDeviceIds = ["default"];
    mediaDevices.dispatchEvent(new Event("devicechange"));
    await flushAsyncWork();

    expect(pause).toHaveBeenCalledWith({
      immediate: true,
      preserveAudioOutputResume: true,
    });
    expect(isAudioOutputInterruptionPending()).toBe(true);

    outputDeviceIds = ["default", "headphones"];
    mediaDevices.dispatchEvent(new Event("devicechange"));
    await vi.advanceTimersByTimeAsync(300);
    await flushAsyncWork();

    expect(resume).toHaveBeenCalledTimes(1);
    expect(isAudioOutputInterruptionPending()).toBe(false);
    controller.dispose();
    vi.useRealTimers();
  });

  it("does not resume after the user explicitly cancels the pending resume", async () => {
    const mediaDevices = new EventTarget() as MediaDevices;
    const audioContext = new FakeAudioContext();
    const pause = vi.fn();
    const resume = vi.fn();
    let outputDeviceIds = ["default", "headphones"];

    const controller = createAudioOutputInterruptionController({
      enumerateOutputDevices: async () => outputDeviceIds,
      getAudioContext: () => audioContext as unknown as AudioContext,
      isPlaying: () => true,
      mediaDevices,
      pause,
      resume,
    });
    controller.install();
    await flushAsyncWork();

    outputDeviceIds = ["default"];
    mediaDevices.dispatchEvent(new Event("devicechange"));
    await flushAsyncWork();
    cancelPendingAudioOutputResume();

    outputDeviceIds = ["default", "headphones"];
    mediaDevices.dispatchEvent(new Event("devicechange"));
    await flushAsyncWork();

    expect(resume).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("keeps a recent interruption candidate when the browser pauses first", async () => {
    vi.useFakeTimers();
    const mediaDevices = new EventTarget() as MediaDevices;
    const audioContext = new FakeAudioContext();
    const pause = vi.fn();
    const resume = vi.fn();
    let isPlaying = true;
    let outputDeviceIds = ["default", "headphones"];

    const controller = createAudioOutputInterruptionController({
      enumerateOutputDevices: async () => outputDeviceIds,
      getAudioContext: () => audioContext as unknown as AudioContext,
      isPlaying: () => isPlaying,
      mediaDevices,
      pause,
      resume,
    });
    controller.install();
    await flushAsyncWork();

    isPlaying = false;
    outputDeviceIds = ["default"];
    mediaDevices.dispatchEvent(new Event("devicechange"));
    await flushAsyncWork();

    expect(pause).toHaveBeenCalledWith({
      immediate: true,
      preserveAudioOutputResume: true,
    });

    outputDeviceIds = ["default", "headphones"];
    mediaDevices.dispatchEvent(new Event("devicechange"));
    await vi.advanceTimersByTimeAsync(300);
    await flushAsyncWork();

    expect(resume).toHaveBeenCalledTimes(1);
    controller.dispose();
    vi.useRealTimers();
  });

  it("uses AudioContext state changes when the browser exposes the interruption", () => {
    const mediaDevices = new EventTarget() as MediaDevices;
    const audioContext = new FakeAudioContext();
    let isPlaying = true;
    const pause = vi.fn(() => {
      isPlaying = false;
    });
    const resume = vi.fn(() => {
      isPlaying = true;
    });

    const controller = createAudioOutputInterruptionController({
      enumerateOutputDevices: async () => ["default"],
      getAudioContext: () => audioContext as unknown as AudioContext,
      isPlaying: () => isPlaying,
      mediaDevices,
      pause,
      resume,
    });
    controller.install();

    audioContext.state = "suspended";
    audioContext.dispatchEvent(new Event("statechange"));
    expect(pause).toHaveBeenCalledTimes(1);

    audioContext.state = "running";
    audioContext.dispatchEvent(new Event("statechange"));
    expect(resume).toHaveBeenCalledTimes(1);
    controller.dispose();
  });

  it("pauses when Chrome reports an output error without changing exposed device ids", async () => {
    const mediaDevices = new EventTarget() as MediaDevices;
    const audioContext = new FakeAudioContext();
    let isPlaying = true;
    const pause = vi.fn(() => {
      isPlaying = false;
    });
    const resume = vi.fn(() => {
      isPlaying = true;
    });

    const controller = createAudioOutputInterruptionController({
      enumerateOutputDevices: async () => ["default"],
      getAudioContext: () => audioContext as unknown as AudioContext,
      isPlaying: () => isPlaying,
      mediaDevices,
      pause,
      resume,
    });
    controller.install();
    await flushAsyncWork();

    audioContext.dispatchEvent(new Event("error"));

    expect(pause).toHaveBeenCalledWith({
      immediate: true,
      preserveAudioOutputResume: true,
    });

    audioContext.state = "running";
    audioContext.dispatchEvent(new Event("statechange"));
    expect(resume).toHaveBeenCalledTimes(1);
    controller.dispose();
  });

  it("pauses and resumes when the AudioContext sink changes without exposed device ids", async () => {
    const mediaDevices = new EventTarget() as MediaDevices;
    const audioContext = new FakeAudioContext();
    let isPlaying = true;
    const pause = vi.fn(() => {
      isPlaying = false;
    });
    const resume = vi.fn(() => {
      isPlaying = true;
    });

    const controller = createAudioOutputInterruptionController({
      enumerateOutputDevices: async () => ["default"],
      getAudioContext: () => audioContext as unknown as AudioContext,
      isPlaying: () => isPlaying,
      mediaDevices,
      pause,
      resume,
    });
    controller.install();
    await flushAsyncWork();

    audioContext.dispatchEvent(new Event("sinkchange"));
    expect(pause).toHaveBeenCalledTimes(1);

    audioContext.dispatchEvent(new Event("sinkchange"));
    expect(resume).toHaveBeenCalledTimes(1);
    controller.dispose();
  });

  it("ignores output additions when no interruption is pending", async () => {
    const mediaDevices = new EventTarget() as MediaDevices;
    const audioContext = new FakeAudioContext();
    let isPlaying = true;
    const pause = vi.fn(() => {
      isPlaying = false;
    });
    const resume = vi.fn(() => {
      isPlaying = true;
    });
    let outputDeviceIds = ["default"];

    const controller = createAudioOutputInterruptionController({
      enumerateOutputDevices: async () => outputDeviceIds,
      getAudioContext: () => audioContext as unknown as AudioContext,
      isPlaying: () => isPlaying,
      mediaDevices,
      pause,
      resume,
    });
    controller.install();
    await flushAsyncWork();

    outputDeviceIds = ["default", "headphones"];
    mediaDevices.dispatchEvent(new Event("devicechange"));
    await flushAsyncWork();

    expect(pause).not.toHaveBeenCalled();
    expect(resume).not.toHaveBeenCalled();
    controller.dispose();
  });

  it.each([[""], ["default"]])(
    "uses devicechange edges when Chrome exposes only the generic/default output (%s)",
    async (opaqueDeviceId) => {
      vi.useFakeTimers();
      const mediaDevices = new EventTarget() as MediaDevices;
      const audioContext = new FakeAudioContext();
      let isPlaying = true;
      const pause = vi.fn(() => {
        isPlaying = false;
      });
      const resume = vi.fn(() => {
        isPlaying = true;
      });

      const controller = createAudioOutputInterruptionController({
        enumerateOutputDevices: async () => [opaqueDeviceId],
        getAudioContext: () => audioContext as unknown as AudioContext,
        isPlaying: () => isPlaying,
        mediaDevices,
        pause,
        resume,
      });
      controller.install();
      await flushAsyncWork();

      mediaDevices.dispatchEvent(new Event("devicechange"));
      await vi.advanceTimersByTimeAsync(300);
      await flushAsyncWork();

      expect(pause).toHaveBeenCalledWith({
        immediate: true,
        preserveAudioOutputResume: true,
      });

      mediaDevices.dispatchEvent(new Event("devicechange"));
      await vi.advanceTimersByTimeAsync(300);
      await flushAsyncWork();

      expect(resume).toHaveBeenCalledTimes(1);
      controller.dispose();
      vi.useRealTimers();
    },
  );

  it("coalesces duplicate devicechange events in opaque output mode", async () => {
    vi.useFakeTimers();
    const mediaDevices = new EventTarget() as MediaDevices;
    const audioContext = new FakeAudioContext();
    let isPlaying = true;
    const pause = vi.fn(() => {
      isPlaying = false;
    });
    const resume = vi.fn(() => {
      isPlaying = true;
    });

    const controller = createAudioOutputInterruptionController({
      enumerateOutputDevices: async () => [""],
      getAudioContext: () => audioContext as unknown as AudioContext,
      isPlaying: () => isPlaying,
      mediaDevices,
      pause,
      resume,
    });
    controller.install();
    await flushAsyncWork();

    mediaDevices.dispatchEvent(new Event("devicechange"));
    mediaDevices.dispatchEvent(new Event("devicechange"));
    await vi.advanceTimersByTimeAsync(300);
    await flushAsyncWork();

    expect(pause).toHaveBeenCalledTimes(1);
    expect(resume).not.toHaveBeenCalled();

    mediaDevices.dispatchEvent(new Event("devicechange"));
    await vi.advanceTimersByTimeAsync(300);
    await flushAsyncWork();

    expect(resume).toHaveBeenCalledTimes(1);
    controller.dispose();
    vi.useRealTimers();
  });

  it("does not restart playback when the route recovered without pausing it", async () => {
    vi.useFakeTimers();
    const mediaDevices = new EventTarget() as MediaDevices;
    const audioContext = new FakeAudioContext();
    const pause = vi.fn();
    const resume = vi.fn();

    const controller = createAudioOutputInterruptionController({
      enumerateOutputDevices: async () => [""],
      getAudioContext: () => audioContext as unknown as AudioContext,
      isPlaying: () => true,
      mediaDevices,
      pause,
      resume,
    });
    controller.install();
    await flushAsyncWork();

    mediaDevices.dispatchEvent(new Event("devicechange"));
    await vi.advanceTimersByTimeAsync(300);
    await flushAsyncWork();
    mediaDevices.dispatchEvent(new Event("devicechange"));
    await vi.advanceTimersByTimeAsync(300);
    await flushAsyncWork();

    expect(pause).toHaveBeenCalledTimes(1);
    expect(resume).not.toHaveBeenCalled();
    controller.dispose();
    vi.useRealTimers();
  });
});

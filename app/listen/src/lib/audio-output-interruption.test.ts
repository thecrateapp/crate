import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  cancelPendingAudioOutputResume,
  createAudioOutputInterruptionController,
  isAudioOutputInterruptionPending,
} from "./audio-output-interruption";

class FakeAudioContext extends EventTarget {
  state: AudioContextState = "running";
  sinkId = "default";
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
    vi.useFakeTimers();
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
    await vi.advanceTimersByTimeAsync(300);
    await flushAsyncWork();

    expect(resume).not.toHaveBeenCalled();
    controller.dispose();
    vi.useRealTimers();
  });

  it("does not reclassify an explicit pause as an output interruption", () => {
    const audioContext = new FakeAudioContext();
    let isPlaying = true;
    const pause = vi.fn();
    const controller = createAudioOutputInterruptionController({
      getAudioContext: () => audioContext as unknown as AudioContext,
      isPlaying: () => isPlaying,
      pause,
      resume: vi.fn(),
    });
    controller.install();

    cancelPendingAudioOutputResume();
    isPlaying = false;
    controller.observe();
    audioContext.state = "suspended";
    audioContext.dispatchEvent(new Event("statechange"));

    expect(pause).not.toHaveBeenCalled();
    expect(isAudioOutputInterruptionPending()).toBe(false);
    controller.dispose();
  });

  it("disposes the previous controller when a new one is installed", () => {
    const firstContext = new FakeAudioContext();
    const firstPause = vi.fn();
    const first = createAudioOutputInterruptionController({
      getAudioContext: () => firstContext as unknown as AudioContext,
      isPlaying: () => true,
      pause: firstPause,
      resume: vi.fn(),
    });
    first.install();

    firstContext.state = "suspended";
    firstContext.dispatchEvent(new Event("statechange"));
    expect(isAudioOutputInterruptionPending()).toBe(true);

    const secondContext = new FakeAudioContext();
    const second = createAudioOutputInterruptionController({
      getAudioContext: () => secondContext as unknown as AudioContext,
      isPlaying: () => true,
      pause: vi.fn(),
      resume: vi.fn(),
    });
    second.install();

    expect(firstPause).toHaveBeenCalledTimes(1);
    expect(first.hasPendingResume()).toBe(false);
    expect(isAudioOutputInterruptionPending()).toBe(false);

    secondContext.state = "suspended";
    secondContext.dispatchEvent(new Event("statechange"));
    first.dispose();
    expect(isAudioOutputInterruptionPending()).toBe(true);

    second.dispose();
    expect(isAudioOutputInterruptionPending()).toBe(false);
  });

  it("does not treat a recently user-paused track as an output interruption", async () => {
    vi.useFakeTimers();
    const mediaDevices = new EventTarget() as MediaDevices;
    const audioContext = new FakeAudioContext();
    let isPlaying = true;
    const pause = vi.fn(() => {
      isPlaying = false;
    });
    const resume = vi.fn();
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
    await vi.advanceTimersByTimeAsync(100);

    // Transport controls cancel before the engine's pause callback and the
    // resulting React observation, matching the production event order.
    cancelPendingAudioOutputResume();
    isPlaying = false;
    controller.observe();
    outputDeviceIds = ["default"];
    mediaDevices.dispatchEvent(new Event("devicechange"));
    await flushAsyncWork();

    expect(pause).not.toHaveBeenCalled();
    expect(controller.hasPendingResume()).toBe(false);
    expect(resume).not.toHaveBeenCalled();
    controller.dispose();
    vi.useRealTimers();
  });

  it.each([false, true])(
    "recognizes browser-paused playback after a long track (observe first: %s)",
    async (observeBeforeDeviceChange) => {
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
      await vi.advanceTimersByTimeAsync(5_000);

      isPlaying = false;
      if (observeBeforeDeviceChange) controller.observe();
      outputDeviceIds = ["default"];
      mediaDevices.dispatchEvent(new Event("devicechange"));
      if (!observeBeforeDeviceChange) {
        await flushAsyncWork();
        controller.observe();
      }
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
    },
  );

  it("expires a pending resume so an unrelated later route change cannot resume", async () => {
    vi.useFakeTimers();
    const mediaDevices = new EventTarget() as MediaDevices;
    const audioContext = new FakeAudioContext();
    let isPlaying = true;
    const pause = vi.fn(() => {
      isPlaying = false;
    });
    const resume = vi.fn();
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
    expect(controller.hasPendingResume()).toBe(true);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(controller.hasPendingResume()).toBe(false);

    outputDeviceIds = ["default", "headphones"];
    mediaDevices.dispatchEvent(new Event("devicechange"));
    await flushAsyncWork();

    expect(resume).not.toHaveBeenCalled();
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

  it("ignores a sink change while running without a confirmed interruption", async () => {
    const mediaDevices = new EventTarget() as MediaDevices;
    const audioContext = new FakeAudioContext();
    const pause = vi.fn();
    const resume = vi.fn();

    const controller = createAudioOutputInterruptionController({
      enumerateOutputDevices: async () => ["default"],
      getAudioContext: () => audioContext as unknown as AudioContext,
      isPlaying: () => true,
      mediaDevices,
      pause,
      resume,
    });
    controller.install();
    await flushAsyncWork();

    audioContext.dispatchEvent(new Event("sinkchange"));
    expect(pause).not.toHaveBeenCalled();
    expect(resume).not.toHaveBeenCalled();
    expect(controller.hasPendingResume()).toBe(false);
    controller.dispose();
  });

  it("uses a sink change to recover only after an interruption was observed", async () => {
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

    audioContext.state = "suspended";
    audioContext.dispatchEvent(new Event("sinkchange"));
    expect(pause).toHaveBeenCalledTimes(1);
    expect(controller.hasPendingResume()).toBe(true);

    audioContext.state = "running";
    audioContext.dispatchEvent(new Event("statechange"));
    expect(resume).toHaveBeenCalledTimes(1);
    expect(controller.hasPendingResume()).toBe(false);
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

  it("ignores opaque devicechange events while the AudioContext is running", async () => {
    vi.useFakeTimers();
    const mediaDevices = new EventTarget() as MediaDevices;
    const audioContext = new FakeAudioContext();
    const pause = vi.fn();
    const resume = vi.fn();

    const controller = createAudioOutputInterruptionController({
      enumerateOutputDevices: async () => ["default"],
      getAudioContext: () => audioContext as unknown as AudioContext,
      isPlaying: () => true,
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

    expect(pause).not.toHaveBeenCalled();
    expect(resume).not.toHaveBeenCalled();

    mediaDevices.dispatchEvent(new Event("devicechange"));
    await vi.advanceTimersByTimeAsync(300);
    await flushAsyncWork();

    expect(pause).not.toHaveBeenCalled();
    expect(resume).not.toHaveBeenCalled();
    controller.dispose();
    vi.useRealTimers();
  });

  it("ignores input-device changes when output identity is opaque", async () => {
    vi.useFakeTimers();
    const mediaDevices = new EventTarget() as MediaDevices;
    const audioContext = new FakeAudioContext();
    const pause = vi.fn();
    const resume = vi.fn();
    let inputDeviceIds = ["audioinput:mic-1"];

    const controller = createAudioOutputInterruptionController({
      enumerateOutputDevices: async () => ["default"],
      enumerateInputDevices: async () => inputDeviceIds,
      getAudioContext: () => audioContext as unknown as AudioContext,
      isPlaying: () => true,
      mediaDevices,
      pause,
      resume,
    });
    controller.install();
    await flushAsyncWork();

    inputDeviceIds = ["audioinput:mic-1", "videoinput:camera-1"];
    mediaDevices.dispatchEvent(new Event("devicechange"));
    await vi.advanceTimersByTimeAsync(300);
    await flushAsyncWork();

    inputDeviceIds = ["audioinput:mic-1"];
    mediaDevices.dispatchEvent(new Event("devicechange"));
    await vi.advanceTimersByTimeAsync(300);
    await flushAsyncWork();

    expect(pause).not.toHaveBeenCalled();
    expect(resume).not.toHaveBeenCalled();
    controller.dispose();
    vi.useRealTimers();
  });

  it("uses AudioContext state to confirm an opaque output interruption", async () => {
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
      enumerateOutputDevices: async () => ["default"],
      getAudioContext: () => audioContext as unknown as AudioContext,
      isPlaying: () => isPlaying,
      mediaDevices,
      pause,
      resume,
    });
    controller.install();
    await flushAsyncWork();

    audioContext.state = "suspended";
    mediaDevices.dispatchEvent(new Event("devicechange"));
    await vi.advanceTimersByTimeAsync(300);
    await flushAsyncWork();

    expect(pause).toHaveBeenCalledWith({
      immediate: true,
      preserveAudioOutputResume: true,
    });

    audioContext.state = "running";
    audioContext.dispatchEvent(new Event("statechange"));
    expect(resume).toHaveBeenCalledTimes(1);
    controller.dispose();
    vi.useRealTimers();
  });

  it("ignores removal of outputs other than the active sink", async () => {
    const mediaDevices = new EventTarget() as MediaDevices;
    const audioContext = new FakeAudioContext();
    audioContext.sinkId = "speakers";
    const pause = vi.fn();
    const resume = vi.fn();
    let outputDeviceIds = ["default", "speakers", "headphones"];

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

    outputDeviceIds = ["default", "speakers"];
    mediaDevices.dispatchEvent(new Event("devicechange"));
    await flushAsyncWork();

    expect(pause).not.toHaveBeenCalled();
    expect(resume).not.toHaveBeenCalled();
    controller.dispose();
  });
});

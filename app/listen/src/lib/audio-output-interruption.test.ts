import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  cancelPendingAudioOutputResume,
  createAudioOutputInterruptionController,
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

    expect(pause).toHaveBeenCalledWith({
      immediate: true,
      preserveAudioOutputResume: true,
    });

    outputDeviceIds = ["default", "headphones"];
    mediaDevices.dispatchEvent(new Event("devicechange"));
    await flushAsyncWork();

    expect(resume).toHaveBeenCalledTimes(1);
    controller.dispose();
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
    await flushAsyncWork();

    expect(resume).toHaveBeenCalledTimes(1);
    controller.dispose();
  });

  it("uses AudioContext state changes when the browser exposes the interruption", () => {
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

    audioContext.state = "suspended";
    audioContext.dispatchEvent(new Event("statechange"));
    expect(pause).toHaveBeenCalledTimes(1);

    audioContext.state = "running";
    audioContext.dispatchEvent(new Event("statechange"));
    expect(resume).toHaveBeenCalledTimes(1);
    controller.dispose();
  });

  it("ignores output additions when no interruption is pending", async () => {
    const mediaDevices = new EventTarget() as MediaDevices;
    const audioContext = new FakeAudioContext();
    const pause = vi.fn();
    const resume = vi.fn();
    let outputDeviceIds = ["default"];

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

    outputDeviceIds = ["default", "headphones"];
    mediaDevices.dispatchEvent(new Event("devicechange"));
    await flushAsyncWork();

    expect(pause).not.toHaveBeenCalled();
    expect(resume).not.toHaveBeenCalled();
    controller.dispose();
  });
});

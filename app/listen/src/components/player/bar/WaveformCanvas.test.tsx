import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WaveformCanvas } from "./WaveformCanvas";

function fakeContext() {
  return {
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    setTransform: vi.fn(),
    createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    fillStyle: "",
  };
}

/** Drives requestAnimationFrame by hand with explicit timestamps. */
function installManualFrames() {
  let pending = new Map<number, FrameRequestCallback>();
  let nextId = 1;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    const id = nextId++;
    pending.set(id, callback);
    return id;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
    pending.delete(id);
  });
  return {
    run(timestamp: number) {
      const callbacks = [...pending.values()];
      pending = new Map();
      act(() => callbacks.forEach((callback) => callback(timestamp)));
    },
    get pending() {
      return pending.size;
    },
  };
}

const loudFrame = () => ({
  frequenciesDb: Array.from({ length: 1024 }, () => -30),
  sampleRate: 44100,
});

describe("WaveformCanvas", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete document.documentElement.dataset.crateWindow;
  });

  describe("without a 2D context", () => {
    beforeEach(() => {
      vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    });

    it("renders a canvas for semantic waveform rendering", () => {
      const { container } = render(
        <WaveformCanvas
          frequenciesDb={[]}
          sampleRate={44100}
          isPlaying={false}
        />,
      );

      expect(container.querySelector("canvas")).toBeInTheDocument();
    });

    it("promotes the canvas to its own compositing layer", () => {
      const { container } = render(
        <WaveformCanvas frequenciesDb={[]} sampleRate={44100} isPlaying />,
      );

      expect(container.querySelector("canvas")).toHaveClass(
        "absolute",
        "inset-0",
        "size-full",
        "will-change-transform",
      );
    });
  });

  describe("frame loop", () => {
    let context: ReturnType<typeof fakeContext>;

    beforeEach(() => {
      context = fakeContext();
      vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
        context as unknown as CanvasRenderingContext2D,
      );
    });

    it("samples and paints about 30 times a second on a 90 Hz panel", () => {
      const frames = installManualFrames();
      const readAudioFrame = vi.fn(loudFrame);
      render(
        <WaveformCanvas
          frequenciesDb={[]}
          readAudioFrame={readAudioFrame}
          sampleRate={44100}
          isPlaying
        />,
      );

      for (let index = 0; index < 90; index += 1)
        frames.run((index * 1000) / 90);

      expect(readAudioFrame).toHaveBeenCalledTimes(30);
      expect(context.clearRect).toHaveBeenCalledTimes(30);
    });

    it("does not read the canvas size inside the loop", () => {
      const frames = installManualFrames();
      const widthReads = vi.spyOn(HTMLElement.prototype, "clientWidth", "get");
      render(
        <WaveformCanvas
          frequenciesDb={[]}
          readAudioFrame={loudFrame}
          sampleRate={44100}
          isPlaying
        />,
      );
      const readsAfterMount = widthReads.mock.calls.length;

      for (let index = 0; index < 30; index += 1)
        frames.run((index * 1000) / 30);

      expect(widthReads.mock.calls.length).toBe(readsAfterMount);
    });

    it("stops painting once silence has emptied the bars", () => {
      const frames = installManualFrames();
      const silent = {
        frequenciesDb: Array.from({ length: 1024 }, () => -Infinity),
        sampleRate: 44100,
      };
      render(
        <WaveformCanvas
          frequenciesDb={[]}
          readAudioFrame={() => silent}
          sampleRate={44100}
          isPlaying
        />,
      );

      for (let index = 0; index < 10; index += 1)
        frames.run((index * 1000) / 30);

      // The first paint clears the canvas; later silent frames skip painting.
      expect(context.clearRect).toHaveBeenCalledTimes(1);
      expect(frames.pending).toBe(1);
    });

    it("stops the loop while the desktop window is inactive", async () => {
      const frames = installManualFrames();
      const readAudioFrame = vi.fn(loudFrame);
      render(
        <WaveformCanvas
          frequenciesDb={[]}
          readAudioFrame={readAudioFrame}
          sampleRate={44100}
          isPlaying
        />,
      );
      frames.run(0);
      expect(readAudioFrame).toHaveBeenCalledTimes(1);

      await act(async () => {
        document.documentElement.dataset.crateWindow = "inactive";
        await Promise.resolve();
      });
      frames.run(100);

      expect(frames.pending).toBe(0);
      expect(readAudioFrame).toHaveBeenCalledTimes(1);
    });
  });
});

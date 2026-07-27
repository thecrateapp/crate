import { afterEach, describe, expect, it, vi } from "vitest";

import {
  Gapless5,
  getBufferedAheadSeconds,
  getLoadableTrackIndices,
} from "@/lib/gapless5/gapless5";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function ranges(values: Array<[number, number]>): TimeRanges {
  return {
    length: values.length,
    start: (index: number) => values[index]![0],
    end: (index: number) => values[index]![1],
  };
}

describe("getBufferedAheadSeconds", () => {
  it("returns only the buffered time contiguous with the current position", () => {
    expect(
      getBufferedAheadSeconds({
        currentTime: 12,
        buffered: ranges([
          [0, 10],
          [11, 18],
        ]),
      } as HTMLAudioElement),
    ).toBe(6);
  });

  it("returns zero for gaps, invalid positions and absent ranges", () => {
    expect(
      getBufferedAheadSeconds({
        currentTime: 10.5,
        buffered: ranges([
          [0, 10],
          [11, 18],
        ]),
      } as HTMLAudioElement),
    ).toBe(0);
    expect(
      getBufferedAheadSeconds({
        currentTime: Number.NaN,
        buffered: ranges([]),
      } as HTMLAudioElement),
    ).toBe(0);
  });
});

describe("getLoadableTrackIndices", () => {
  it("keeps a mobile load limit of one to the active stream only", () => {
    expect(getLoadableTrackIndices(2, 5, 1)).toEqual([2]);
  });

  it("loads the active track and its immediate successor on desktop", () => {
    expect(getLoadableTrackIndices(1, 5, 2)).toEqual([1, 2]);
    expect(getLoadableTrackIndices(4, 5, 2)).toEqual([3, 4]);
  });

  it("keeps the unlimited mode bounded to real source indices", () => {
    expect(getLoadableTrackIndices(0, 3, -1)).toEqual([0, 1, 2]);
  });
});

describe("Gapless5.replaceTrack", () => {
  it("preserves the active cursor when refreshing the next source", () => {
    vi.useFakeTimers();
    const player = new Gapless5({
      tracks: ["one", "two", "three", "four", "five"],
      startingTrack: 3,
      useHTML5Audio: false,
      useWebAudio: false,
      loadLimit: 2,
    });

    player.replaceTrack(4, "five-refreshed");

    expect(player.getIndex()).toBe(3);
    expect(player.getTracks()).toEqual([
      "one",
      "two",
      "three",
      "four",
      "five-refreshed",
    ]);
    player.removeAllTracks();
  });
});

describe("Gapless5 mobile background auto-advance", () => {
  it("defers the next request until the active stream has a safe buffer", () => {
    vi.useFakeTimers();
    const instances: FakeAudio[] = [];

    class FakeAudio extends EventTarget {
      buffered = ranges([]);
      controls = false;
      crossOrigin: string | null = null;
      currentTime = 0;
      duration = 180;
      error: MediaError | null = null;
      loop = false;
      networkState = 1;
      paused = true;
      playbackRate = 1;
      preload = "auto";
      preservesPitch = true;
      readyState = 4;
      seekable = ranges([[0, 180]]);
      src = "";
      srcObject: MediaProvider | null = null;
      volume = 1;

      constructor() {
        super();
        instances.push(this);
      }

      load() {}

      pause() {
        this.paused = true;
      }

      play() {
        this.paused = false;
        return Promise.resolve();
      }
    }

    vi.stubGlobal("Audio", FakeAudio);
    const player = new Gapless5({
      tracks: ["one", "two"],
      useHTML5Audio: true,
      useWebAudio: false,
      loadLimit: 2,
      deferAdjacentLoadsUntilBufferedSeconds: 15,
    });
    const first = instances.find((audio) => audio.src === "one");
    expect(first).toBeDefined();
    expect(instances.find((audio) => audio.src === "two")).toBeUndefined();

    first!.dispatchEvent(new Event("loadedmetadata"));
    first!.dispatchEvent(new Event("loadeddata"));
    first!.buffered = ranges([[0, 5]]);
    vi.advanceTimersByTime(30);
    expect(instances.find((audio) => audio.src === "two")).toBeUndefined();

    first!.currentTime = 172;
    first!.buffered = ranges([[0, 176]]);
    player.setPosition(172_000);
    vi.advanceTimersByTime(30);
    expect(instances.find((audio) => audio.src === "two")).toBeDefined();

    player.removeAllTracks();
  });

  it("advances from the native HTMLAudioElement ended event", async () => {
    vi.useFakeTimers();
    const instances: FakeAudio[] = [];

    class FakeAudio extends EventTarget {
      buffered = ranges([]);
      controls = false;
      crossOrigin: string | null = null;
      currentTime = 0;
      duration = 180;
      error: MediaError | null = null;
      loop = false;
      networkState = 1;
      paused = true;
      playbackRate = 1;
      preload = "auto";
      preservesPitch = true;
      readyState = 4;
      seekable = ranges([[0, 180]]);
      src = "";
      srcObject: MediaProvider | null = null;
      volume = 1;
      removedEvents: string[] = [];

      constructor() {
        super();
        instances.push(this);
      }

      load() {}

      pause() {
        this.paused = true;
      }

      play() {
        this.paused = false;
        return Promise.resolve();
      }

      override removeEventListener(
        type: string,
        callback: EventListenerOrEventListenerObject | null,
        options?: boolean | EventListenerOptions,
      ) {
        this.removedEvents.push(type);
        super.removeEventListener(type, callback, options);
      }
    }

    vi.stubGlobal("Audio", FakeAudio);
    const player = new Gapless5({
      tracks: ["one", "two"],
      useHTML5Audio: true,
      useWebAudio: false,
      loadLimit: 2,
      deferAdjacentLoadsUntilBufferedSeconds: 15,
    });
    const first = instances.find((audio) => audio.src === "one");
    expect(first).toBeDefined();
    first!.dispatchEvent(new Event("loadedmetadata"));
    first!.dispatchEvent(new Event("loadeddata"));
    first!.buffered = ranges([[0, 20]]);
    vi.advanceTimersByTime(30);
    const second = instances.find((audio) => audio.src === "two");
    expect(second).toBeDefined();
    second!.dispatchEvent(new Event("loadedmetadata"));
    second!.dispatchEvent(new Event("loadeddata"));

    player.play();
    await Promise.resolve();
    first!.dispatchEvent(new Event("ended"));

    expect(player.getIndex()).toBe(1);
    first!.dispatchEvent(new Event("ended"));
    expect(player.getIndex()).toBe(1);
    player.removeAllTracks();
    expect(first!.removedEvents).toContain("ended");
  });
});

describe("Gapless5 WebAudio promotion", () => {
  it("keeps an active HTML5 source playing when its WebAudio buffer finishes decoding", async () => {
    vi.useFakeTimers();
    let resolveDecode: ((buffer: { duration: number }) => void) | undefined;
    const decodePromise = new Promise<{ duration: number }>((resolve) => {
      resolveDecode = resolve;
    });
    const instances: FakeAudio[] = [];

    class FakeAudio extends EventTarget {
      buffered = ranges([[0, 180]]);
      controls = false;
      crossOrigin: string | null = null;
      currentTime = 0;
      duration = 180;
      error: MediaError | null = null;
      loop = false;
      networkState = 1;
      paused = true;
      pauseCalls = 0;
      playbackRate = 1;
      preload = "auto";
      preservesPitch = true;
      readyState = 4;
      seekable = ranges([[0, 180]]);
      src = "";
      srcObject: MediaProvider | null = null;
      volume = 1;

      constructor() {
        super();
        instances.push(this);
      }

      load() {}

      pause() {
        this.pauseCalls += 1;
        this.paused = true;
      }

      play() {
        this.paused = false;
        return Promise.resolve();
      }
    }

    const node = () => ({
      connect: vi.fn(),
      disconnect: vi.fn(),
    });
    const context = {
      baseLatency: 0,
      currentTime: 0,
      destination: node(),
      state: "running",
      createBufferSource: vi.fn(() => ({
        ...node(),
        buffer: null,
        loop: false,
        playbackRate: { value: 1 },
        start: vi.fn(),
        stop: vi.fn(),
      })),
      createGain: vi.fn(() => ({
        ...node(),
        gain: {
          value: 1,
          linearRampToValueAtTime: vi.fn(),
        },
      })),
      decodeAudioData: vi.fn(() => decodePromise),
      resume: vi.fn(() => Promise.resolve()),
    };

    vi.stubGlobal("Audio", FakeAudio);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        arrayBuffer: async () => new ArrayBuffer(8),
      })),
    );
    Object.defineProperty(window, "gapless5AudioContext", {
      configurable: true,
      writable: true,
      value: context,
    });

    const player = new Gapless5({
      tracks: ["one"],
      useHTML5Audio: true,
      useWebAudio: true,
      switchToWebAudioDuringPlayback: false,
    });
    const first = instances.find((audio) => audio.src === "one");
    expect(first).toBeDefined();
    first!.dispatchEvent(new Event("loadedmetadata"));
    first!.dispatchEvent(new Event("loadeddata"));
    player.play();
    await Promise.resolve();
    expect(first!.paused).toBe(false);

    for (let index = 0; index < 6; index += 1) {
      await Promise.resolve();
    }
    expect(context.decodeAudioData).toHaveBeenCalledTimes(1);
    resolveDecode?.({ duration: 180 });
    for (let index = 0; index < 4; index += 1) {
      await Promise.resolve();
    }

    expect(first!.pauseCalls).toBe(0);
    expect(context.createBufferSource).not.toHaveBeenCalled();

    player.removeAllTracks();
    Reflect.deleteProperty(window, "gapless5AudioContext");
  });
});

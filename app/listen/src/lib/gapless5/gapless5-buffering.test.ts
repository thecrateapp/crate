import { afterEach, describe, expect, it, vi } from "vitest";

import {
  Gapless5,
  getBufferedAheadSeconds,
  getLoadableTrackIndices,
  getStartOffsetMs,
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

  it("retains the previous mobile source while preloading the successor", () => {
    expect(getLoadableTrackIndices(2, 5, 3)).toEqual([1, 2, 3]);
  });

  it("keeps the unlimited mode bounded to real source indices", () => {
    expect(getLoadableTrackIndices(0, 3, -1)).toEqual([0, 1, 2]);
  });
});

describe("getStartOffsetMs", () => {
  it("keeps the restored WebAudio offset when HTML5 is paused at zero", () => {
    expect(getStartOffsetMs(true, 0, false, 53_760, 0.02, 7)).toBe(53_760);
  });

  it("syncs to the HTML5 clock while that element is actively playing", () => {
    expect(getStartOffsetMs(true, 12.5, true, 0, 0.02, 7)).toBe(12_527);
  });

  it("uses the internal offset if the active HTML5 clock is still at zero", () => {
    expect(getStartOffsetMs(true, 0, true, 420, 0.02, 7)).toBe(420);
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
  it("reuses one persistent media element across track transitions", async () => {
    vi.useFakeTimers();
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
      loadLimit: 1,
      persistentHTML5Audio: true,
    });
    const mediaElement = instances.find((audio) => audio.src === "one");
    expect(mediaElement).toBeDefined();
    const createdAfterFirstLoad = instances.length;
    mediaElement!.dispatchEvent(new Event("loadedmetadata"));
    mediaElement!.dispatchEvent(new Event("loadeddata"));

    player.play();
    await Promise.resolve();
    mediaElement!.dispatchEvent(new Event("ended"));

    expect(player.getIndex()).toBe(1);
    expect(mediaElement!.src).toBe("two");
    expect(instances).toHaveLength(createdAfterFirstLoad);
    mediaElement!.dispatchEvent(new Event("loadedmetadata"));
    mediaElement!.dispatchEvent(new Event("loadeddata"));
    await Promise.resolve();
    expect(mediaElement!.paused).toBe(false);

    player.removeAllTracks();
  });

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
  it("ignores decode results from an earlier load of the same source", async () => {
    const pendingDecodes: Array<(buffer: { duration: number }) => void> = [];

    class FakeAudio {
      controls = false;
      loop = false;
      src = "";

      load() {}

      pause() {}

      play() {
        return Promise.resolve();
      }
    }

    const node = () => ({
      connect: vi.fn(),
      disconnect: vi.fn(),
    });
    const context = {
      currentTime: 0,
      destination: node(),
      createGain: vi.fn(() => ({
        ...node(),
        gain: { value: 1, linearRampToValueAtTime: vi.fn() },
      })),
      decodeAudioData: vi.fn(
        () =>
          new Promise<{ duration: number }>((resolve) => {
            pendingDecodes.push(resolve);
          }),
      ),
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
      tracks: ["one", "two"],
      useHTML5Audio: false,
      useWebAudio: true,
      loadLimit: 1,
    });
    const onload = vi.fn();
    player.onload = onload;
    const flushMicrotasks = async () => {
      for (let index = 0; index < 8; index += 1) {
        await Promise.resolve();
      }
    };

    await flushMicrotasks();
    expect(pendingDecodes).toHaveLength(1);

    player.gotoTrack(1);
    await flushMicrotasks();
    expect(pendingDecodes).toHaveLength(2);

    player.gotoTrack(0);
    await flushMicrotasks();
    expect(pendingDecodes).toHaveLength(3);

    pendingDecodes[0]!({ duration: 180 });
    await flushMicrotasks();
    expect(onload).not.toHaveBeenCalled();
    expect(context.createGain).toHaveBeenCalledTimes(1);

    pendingDecodes[2]!({ duration: 210 });
    await flushMicrotasks();
    expect(onload).toHaveBeenCalledTimes(1);
    expect(onload).toHaveBeenCalledWith("one", true);
    expect(context.createGain).toHaveBeenCalledTimes(2);

    pendingDecodes[1]!({ duration: 180 });
    await flushMicrotasks();
    expect(onload).toHaveBeenCalledTimes(1);

    player.removeAllTracks();
    Reflect.deleteProperty(window, "gapless5AudioContext");
  });

  it("starts a queued WebAudio resume from the restored paused position", async () => {
    let resolveDecode: ((buffer: { duration: number }) => void) | undefined;
    const decodePromise = new Promise<{ duration: number }>((resolve) => {
      resolveDecode = resolve;
    });
    const instances: FakeAudio[] = [];
    const startedSources: Array<{ start: ReturnType<typeof vi.fn> }> = [];

    class FakeAudio extends EventTarget {
      buffered = ranges([]);
      controls = false;
      crossOrigin: string | null = null;
      currentTime = 0;
      duration = Number.NaN;
      error: MediaError | null = null;
      loop = false;
      networkState = 1;
      paused = true;
      playbackRate = 1;
      preload = "auto";
      preservesPitch = true;
      readyState = 0;
      seekable = ranges([]);
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
        // The constructor's unlock probe calls play() without handling a
        // rejection; keep the fake media element inert for that probe.
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
      createBufferSource: vi.fn(() => {
        const source = {
          ...node(),
          buffer: null,
          loop: false,
          playbackRate: { value: 1 },
          start: vi.fn(),
          stop: vi.fn(),
        };
        startedSources.push(source);
        return source;
      }),
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
    });
    expect(instances[0]?.paused).toBe(true);

    // Match Tauri recovery: set the saved position and queue play while the
    // WebAudio buffer is still decoding and HTML5 cannot play the FLAC.
    player.setPosition(53_760);
    player.play();
    for (let index = 0; index < 6; index += 1) await Promise.resolve();
    expect(context.decodeAudioData).toHaveBeenCalledTimes(1);

    resolveDecode?.({ duration: 180 });
    for (let index = 0; index < 8; index += 1) await Promise.resolve();

    expect(startedSources).toHaveLength(1);
    expect(startedSources[0]!.start).toHaveBeenCalledWith(0, 53.76);

    player.removeAllTracks();
    Reflect.deleteProperty(window, "gapless5AudioContext");
  });

  it("promotes an active HTML5 source when its WebAudio buffer finishes decoding", async () => {
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
      switchToWebAudioDuringPlayback: true,
    });
    const onSwitchToWebAudio = vi.fn();
    player.onswitchtowebaudio = onSwitchToWebAudio;
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

    expect(first!.pauseCalls).toBeGreaterThan(0);
    expect(context.createBufferSource).toHaveBeenCalledTimes(1);
    expect(onSwitchToWebAudio).toHaveBeenCalledWith("one", expect.any(Object));

    player.removeAllTracks();
    Reflect.deleteProperty(window, "gapless5AudioContext");
  });
});

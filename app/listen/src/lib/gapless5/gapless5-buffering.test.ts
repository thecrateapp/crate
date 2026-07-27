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
    });
    const first = instances.find((audio) => audio.src === "one");
    expect(first).toBeDefined();
    first!.dispatchEvent(new Event("loadedmetadata"));
    first!.dispatchEvent(new Event("loadeddata"));
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
  });
});

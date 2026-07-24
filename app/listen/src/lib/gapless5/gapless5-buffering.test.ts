import { describe, expect, it } from "vitest";

import {
  getBufferedAheadSeconds,
  getLoadableTrackIndices,
} from "@/lib/gapless5/gapless5";

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

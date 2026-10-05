import { describe, expect, it } from "vitest";
import { formatTotalDuration, genreSlug, shuffleArray } from "./utils";

describe("formatTotalDuration", () => {
  it("returns empty string for 0", () => {
    expect(formatTotalDuration(0)).toBe("");
  });

  it("returns empty string for undefined/null", () => {
    expect(formatTotalDuration(0)).toBe("");
  });

  it("formats minutes only", () => {
    expect(formatTotalDuration(120)).toBe("2 min");
  });

  it("formats hours and minutes", () => {
    expect(formatTotalDuration(3660)).toBe("1 hr 1 min");
  });

  it("formats hours only", () => {
    expect(formatTotalDuration(7200)).toBe("2 hr 0 min");
  });
});

describe("shuffleArray", () => {
  it("returns a new array with same elements", () => {
    const original = [1, 2, 3, 4, 5];
    const shuffled = shuffleArray(original);
    expect(shuffled).not.toBe(original);
    expect(shuffled.sort()).toEqual(original.sort());
  });

  it("returns empty array for empty input", () => {
    expect(shuffleArray([])).toEqual([]);
  });

  it("handles single element", () => {
    expect(shuffleArray([42])).toEqual([42]);
  });
});

describe("genreSlug", () => {
  it("lowercases, strips punctuation and joins words with dashes", () => {
    expect(genreSlug("  Post-Hardcore ")).toBe("post-hardcore");
    expect(genreSlug("Drum & Bass")).toBe("drum-bass");
    expect(genreSlug("Hip Hop")).toBe("hip-hop");
  });
});

import { describe, expect, it } from "vitest";
import {
  formatMusicalKey,
  formatTrackAnalysis,
  formatTrackQuality,
} from "./track-meta";
describe("existing track metadata", () => {
  it.each([
    ["C", "major", "8B"],
    ["A", "minor", "8A"],
    ["F#", "minor", "11A"],
    ["Gb", "major", "2B"],
    ["B♭", "minor", "3A"],
    ["D♯", "major", "5B"],
    ["12a", null, "12A"],
    ["A", null, "A"],
    ["mystery", "minor", "mystery"],
    ["__proto__", "major", "__proto__"],
    ["constructor", "major", "constructor"],
  ])("formats %s %s without inventing key data", (key, scale, result) =>
    expect(formatMusicalKey(key, scale)).toBe(result),
  );
  it.each([
    [124.3, "A", "minor", "124 · 8A"],
    [null, "A", "minor", "8A"],
    [124, null, null, "124"],
    [NaN, null, null, null],
    [0, null, null, null],
    [null, "", null, null],
  ])("formats partial analysis %s / %s", (tempo, key, scale, result) =>
    expect(formatTrackAnalysis(tempo, key, scale)).toBe(result),
  );
  it.each([
    ["flac", 24, 96000, "FLAC 24/96"],
    [".flac", 16, 44100, "FLAC 16/44.1"],
    ["flac", null, null, "FLAC"],
    ["mp3", 16, 44100, "MP3"],
    [null, 24, 96000, null],
  ])("shows only provided quality %s", (format, depth, rate, result) =>
    expect(formatTrackQuality(format, depth, rate)).toBe(result),
  );
});

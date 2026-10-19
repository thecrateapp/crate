import { describe, expect, it } from "vitest";

import {
  getQualityBadge,
  getTrackQualityBadge,
  shouldFetchTrackQualityInfo,
} from "@/components/player/bar/player-bar-utils";

describe("player quality badge mapping", () => {
  it("uses the same lossless classification for AIFF rows and the player", () => {
    expect(
      getQualityBadge({ format: "aiff", bitDepth: 16, sampleRate: 44100 }),
    ).toMatchObject({ label: "AIFF 16/44.1", tier: "lossless" });
  });

  it("keeps malformed source numbers out of the displayed quality", () => {
    expect(
      getQualityBadge({
        format: " .FLAC ",
        bitDepth: Number.NaN,
        sampleRate: -1,
      }),
    ).toEqual({ label: "FLAC", detail: "", tier: "lossless" });
  });
  it("classifies AAC 320 tracks as high quality", () => {
    expect(
      getTrackQualityBadge({
        id: "storage-1",
        title: "Track One",
        artist: "Artist",
        format: "m4a",
        bitrate: 320,
        sampleRate: 44100,
        bitDepth: null,
      }),
    ).toEqual(
      expect.objectContaining({
        label: "AAC 320",
        tier: "high",
      }),
    );
  });

  it("classifies 24-bit high-sample-rate FLAC as hi-res", () => {
    expect(
      getTrackQualityBadge({
        id: "storage-2",
        title: "Track Two",
        artist: "Artist",
        format: "flac",
        bitrate: 1411,
        sampleRate: 96000,
        bitDepth: 24,
      }),
    ).toEqual(
      expect.objectContaining({
        label: "Hi-Res 24/96",
        detail: "24-bit / 96 kHz",
        tier: "hi-res",
      }),
    );
  });

  it("requests extra source info when a lossless track is missing bit depth", () => {
    expect(
      shouldFetchTrackQualityInfo({
        format: "flac",
        bitrate: 1411,
        sampleRate: 44100,
        bitDepth: null,
      }),
    ).toBe(true);
  });

  it("still shows partial lossless quality when only the sample rate is known", () => {
    expect(
      getTrackQualityBadge({
        id: "storage-3",
        title: "Track Three",
        artist: "Artist",
        format: "flac",
        bitrate: 1411,
        sampleRate: 44100,
        bitDepth: null,
      }),
    ).toEqual(
      expect.objectContaining({
        label: "FLAC 44.1",
        detail: "44.1 kHz",
        tier: "lossless",
      }),
    );
  });
});

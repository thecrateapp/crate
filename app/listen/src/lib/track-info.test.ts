import { describe, expect, it } from "vitest";

import { formatBitrate } from "@/components/player/extended/info-tab-data";
import {
  bitrateToKbps,
  getTrackQualityFromInfo,
  mergeTrackQualityParts,
  resolveTrackInfoUrl,
  type TrackInfo,
} from "./track-info";

describe("resolveTrackInfoUrl", () => {
  it("uses global catalog info when globalTrackUid is available", () => {
    expect(
      resolveTrackInfoUrl({
        id: "global-42",
        globalTrackUid: "global-42",
        entityUid: "entity-42",
        libraryTrackId: 42,
        path: "Artist/Album/Track.flac",
      }),
    ).toBe("/api/catalog/tracks/global-42/info");
  });

  it("prefers entity_uid over legacy ids when available", () => {
    expect(
      resolveTrackInfoUrl({
        id: "42",
        entityUid: "entity-42",
        libraryTrackId: 42,
        path: "Artist/Album/Track.flac",
      }),
    ).toBe("/api/tracks/by-entity/entity-42/info");
  });

  it("falls back to the library track id when entity_uid is missing", () => {
    expect(
      resolveTrackInfoUrl({
        id: "42",
        libraryTrackId: 42,
        path: "Artist/Album/Track.flac",
      }),
    ).toBe("/api/tracks/42/info");
  });
});

describe("mergeTrackQualityParts", () => {
  it("does not let a partial later source wipe out known lossless metadata", () => {
    expect(
      mergeTrackQualityParts(
        { format: "flac", bitrate: 1411, sampleRate: 44100, bitDepth: 16 },
        {
          format: "flac",
          bitrate: 1411,
          sampleRate: undefined,
          bitDepth: undefined,
        },
      ),
    ).toEqual({
      format: "flac",
      bitrate: 1411,
      sampleRate: 44100,
      bitDepth: 16,
    });
  });
});

describe("bitrateToKbps", () => {
  it("converts bps values from the track info endpoint to kbps", () => {
    expect(bitrateToKbps(1_135_989)).toBe(1136);
    expect(bitrateToKbps(320_000)).toBe(320);
  });

  it("keeps values that are already in kbps", () => {
    expect(bitrateToKbps(320)).toBe(320);
    expect(bitrateToKbps(1411)).toBe(1411);
  });

  it("ignores missing or invalid values", () => {
    expect(bitrateToKbps(null)).toBeNull();
    expect(bitrateToKbps(undefined)).toBeNull();
    expect(bitrateToKbps(0)).toBeNull();
    expect(bitrateToKbps(Number.NaN)).toBeNull();
  });
});

describe("track info bitrate display", () => {
  it("formats bps bitrates as kbps", () => {
    expect(formatBitrate(1_135_989)).toBe("1136 kbps");
    expect(formatBitrate(320)).toBe("320 kbps");
    expect(formatBitrate(null)).toBeNull();
  });

  it("normalizes the info bitrate used by the quality badge", () => {
    const quality = getTrackQualityFromInfo({
      format: "mp3",
      bitrate: 320_000,
      sample_rate: 44_100,
      bit_depth: null,
    } as TrackInfo);

    expect(quality.bitrate).toBe(320);
  });
});

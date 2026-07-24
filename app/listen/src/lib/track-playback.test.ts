import { beforeEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api", () => ({
  api: apiMock,
}));

import {
  __resetTrackPlaybackCacheForTests,
  fetchTrackPlayback,
  getTrackQualityFromPlaybackQuality,
  playbackResolutionShowsDeliveryQuality,
  resolveTrackPlaybackUrl,
} from "@/lib/track-playback";

describe("track playback helpers", () => {
  beforeEach(() => {
    apiMock.mockReset();
    __resetTrackPlaybackCacheForTests();
  });

  it("builds original playback endpoints without a delivery query", () => {
    expect(
      resolveTrackPlaybackUrl(
        {
          entityUid: "track-entity-1",
          libraryTrackId: 12,
          id: "12",
        },
        "original",
      ),
    ).toBe("/api/tracks/by-entity/track-entity-1/playback");
  });

  it("builds playback endpoints from canonical entity_uids", () => {
    expect(
      resolveTrackPlaybackUrl(
        {
          entityUid: "track-entity-1",
          libraryTrackId: 12,
          id: "12",
        },
        "balanced",
      ),
    ).toBe("/api/tracks/by-entity/track-entity-1/playback?delivery=balanced");
  });

  it("prefers global catalog playback endpoints when present", () => {
    expect(
      resolveTrackPlaybackUrl(
        {
          globalTrackUid: "global-track-1",
          entityUid: "track-entity-1",
          libraryTrackId: 12,
          id: "track-entity-1",
        },
        "balanced",
      ),
    ).toBe("/api/catalog/tracks/global-track-1/playback?delivery=balanced");
  });

  it("deduplicates concurrent playback resolution for the active track", async () => {
    apiMock.mockResolvedValue({ stream_url: "/api/tracks/1/stream" });
    const track = {
      id: "global-track-1",
      globalTrackUid: "global-track-1",
    };

    const [first, second] = await Promise.all([
      fetchTrackPlayback(track, "balanced"),
      fetchTrackPlayback(track, "balanced"),
    ]);

    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
  });

  it("prefers the codec when mapping delivery quality", () => {
    expect(
      getTrackQualityFromPlaybackQuality(
        {
          format: "m4a",
          codec: "aac",
          bitrate: 192,
          sample_rate: 44100,
          bit_depth: null,
          bytes: null,
          lossless: false,
        },
        { preferCodec: true },
      ),
    ).toEqual({
      format: "aac",
      bitrate: 192,
      sampleRate: 44100,
      bitDepth: undefined,
    });
  });

  it("keeps the original container format for source quality", () => {
    expect(
      getTrackQualityFromPlaybackQuality({
        format: "flac",
        codec: null,
        bitrate: 1411,
        sample_rate: 44100,
        bit_depth: 16,
        bytes: null,
        lossless: true,
      }),
    ).toEqual({
      format: "flac",
      bitrate: 1411,
      sampleRate: 44100,
      bitDepth: 16,
    });
  });

  it("does not treat remote proxy playback as delivery quality when the source is unchanged", () => {
    expect(
      playbackResolutionShowsDeliveryQuality({
        requested_policy: "balanced",
        effective_policy: "balanced",
        transcoded: false,
        source: {
          format: "flac",
          codec: "flac",
          bitrate: 932,
          sample_rate: 44100,
          bit_depth: 16,
          bytes: 28685483,
          lossless: true,
        },
        delivery: {
          format: "flac",
          codec: "flac",
          bitrate: 932,
          sample_rate: 44100,
          bit_depth: 16,
          bytes: 28685483,
          lossless: true,
        },
      }),
    ).toBe(false);
  });

  it("treats transcoded playback as delivery quality", () => {
    expect(
      playbackResolutionShowsDeliveryQuality({
        requested_policy: "balanced",
        effective_policy: "balanced",
        transcoded: true,
        source: {
          format: "flac",
          codec: "flac",
          bitrate: 932,
          sample_rate: 44100,
          bit_depth: 16,
          bytes: 28685483,
          lossless: true,
        },
        delivery: {
          format: "m4a",
          codec: "aac",
          bitrate: 192,
          sample_rate: 44100,
          bit_depth: null,
          bytes: null,
          lossless: false,
        },
      }),
    ).toBe(true);
  });
});

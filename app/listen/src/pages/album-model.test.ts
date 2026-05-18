import { describe, expect, it } from "vitest";

import {
  buildAlbumPlayerTracks,
  buildAlbumQualityBadges,
} from "@/pages/album-model";

const BASE_ALBUM = {
  id: 81,
  slug: "album-name",
  artist_id: 14,
  artist_slug: "artist-name",
  artist: "Artist Name",
  name: "Album Name",
  display_name: "Album Name",
};

describe("album model", () => {
  it("normalizes album API payloads into playable tracks with quality metadata", () => {
    const tracks = buildAlbumPlayerTracks({
      ...BASE_ALBUM,
      tracks: [
        {
          id: 1,
          entity_uid: "track-entity-1",
          filename: "01-track.m4a",
          format: "m4a",
          bitrate: 320,
          sample_rate: 44100,
          bit_depth: null,
          path: "/music/Artist/Album/01-track.m4a",
          tags: { title: "Track One" },
        },
      ],
    });

    expect(tracks).toEqual([
      expect.objectContaining({
        id: "track-entity-1",
        entityUid: "track-entity-1",
        title: "Track One",
        artist: "Artist Name",
        album: "Album Name",
        format: "m4a",
        bitrate: 320,
        sampleRate: 44100,
        bitDepth: null,
      }),
    ]);
  });

  it("skips unavailable pre-release tracks when building playback queues", () => {
    const tracks = buildAlbumPlayerTracks({
      ...BASE_ALBUM,
      id: -46,
      cover_url: "https://img.example/cover.jpg",
      tracks: [
        {
          id: 321,
          entity_uid: "track-entity-1",
          filename: "01-track.flac",
          format: "flac",
          bitrate: 1411,
          sample_rate: 44100,
          bit_depth: 16,
          path: "/music/Artist/Album/01-track.flac",
          is_available: true,
          tags: { title: "Available Track" },
        },
        {
          id: -46002,
          filename: "Soon",
          format: "",
          bitrate: null,
          path: "",
          is_available: false,
          tags: { title: "Future Track" },
        },
      ],
    });

    expect(tracks).toHaveLength(1);
    expect(tracks[0]).toEqual(
      expect.objectContaining({
        id: "track-entity-1",
        title: "Available Track",
        albumId: undefined,
        libraryTrackId: 321,
        albumCover: "https://img.example/cover.jpg",
      }),
    );
  });

  it("builds one quality badge per format using the highest-quality exemplar", () => {
    const badges = buildAlbumQualityBadges([
      {
        id: 1,
        entity_uid: "track-aac-low",
        filename: "01-track.m4a",
        format: "m4a",
        bitrate: 256,
        sample_rate: 44100,
        bit_depth: null,
        path: "/music/Artist/Album/01-track.m4a",
        tags: { title: "Track One" },
      },
      {
        id: 2,
        entity_uid: "track-aac-high",
        filename: "02-track.m4a",
        format: "m4a",
        bitrate: 320,
        sample_rate: 44100,
        bit_depth: null,
        path: "/music/Artist/Album/02-track.m4a",
        tags: { title: "Track Two" },
      },
      {
        id: 3,
        entity_uid: "track-flac",
        filename: "03-track.flac",
        format: "flac",
        bitrate: 1411,
        sample_rate: 96000,
        bit_depth: 24,
        path: "/music/Artist/Album/03-track.flac",
        tags: { title: "Track Three" },
      },
    ]);

    expect(badges).toEqual([
      expect.objectContaining({
        label: "AAC 320",
        tier: "high",
      }),
      expect.objectContaining({
        label: "Hi-Res 24/96",
        tier: "hi-res",
      }),
    ]);
  });
});

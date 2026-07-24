import { describe, expect, it } from "vitest";

import {
  hasPlayableTrackReference,
  resolvePlayableTrackId,
  toPlayableTrack,
} from "@/lib/playable-track";

describe("playable track mapper", () => {
  it("normalizes snake_case API payloads into player tracks", () => {
    const track = toPlayableTrack(
      {
        id: 12,
        entity_uid: "entity-12",
        title: "Track One",
        artist: "Artist",
        artist_id: 4,
        artist_slug: "artist",
        album: "Album",
        album_id: 8,
        album_slug: "album",
        path: "/music/artist/album/01.flac",
        duration: 211,
        format: "flac",
        bitrate: 1411,
        sample_rate: 44100,
        bit_depth: 16,
        bpm: 124,
        audio_key: "C",
        audio_scale: "minor",
        energy: 0.72,
        danceability: 0.41,
        valence: 0.28,
        bliss_vector: [0.1, 0.2, 0.3],
      },
      { cover: "/api/albums/8/cover" },
    );

    expect(track).toEqual(
      expect.objectContaining({
        id: "entity-12",
        entityUid: "entity-12",
        artistId: 4,
        artistSlug: "artist",
        albumId: 8,
        albumSlug: "album",
        albumCover: "/api/albums/8/cover",
        duration: 211,
        format: "flac",
        bitrate: 1411,
        sampleRate: 44100,
        bitDepth: 16,
        bpm: 124,
        audioKey: "C",
        audioScale: "minor",
        energy: 0.72,
        danceability: 0.41,
        valence: 0.28,
        blissVector: [0.1, 0.2, 0.3],
      }),
    );
  });

  it("preserves camelCase metadata and resolves a stable playback id", () => {
    expect(
      resolvePlayableTrackId({
        id: "fallback-id",
        entityUid: "entity-99",
        title: "Track Two",
        artist: "Artist",
      }),
    ).toBe("entity-99");

    const track = toPlayableTrack({
      id: "fallback-id",
      entityUid: "entity-99",
      title: "Track Two",
      artist: "Artist",
      sampleRate: 48000,
      bitDepth: null,
      bitrate: 320,
      format: "aac",
    });

    expect(track).toEqual(
      expect.objectContaining({
        id: "entity-99",
        entityUid: "entity-99",
        sampleRate: 48000,
        bitDepth: null,
        bitrate: 320,
        format: "aac",
      }),
    );
  });

  it("understands track_* aliases from stats/home/radio payloads", () => {
    const track = toPlayableTrack({
      track_id: 42,
      track_entity_uid: "entity-42",
      track_path: "/music/artist/album/42.flac",
      title: "Track Three",
      artist: "Artist",
      album: "Album",
    });

    expect(track).toEqual(
      expect.objectContaining({
        id: "entity-42",
        entityUid: "entity-42",
        path: "/music/artist/album/42.flac",
        libraryTrackId: 42,
      }),
    );

    expect(
      resolvePlayableTrackId({
        track_id: 42,
        track_entity_uid: "entity-42",
        title: "Track Three",
        artist: "Artist",
      }),
    ).toBe("entity-42");
  });

  it("treats UUID string ids as canonical entity ids when snapshots are partial", () => {
    const uuid = "123e4567-e89b-12d3-a456-426614174000";
    const track = toPlayableTrack({
      id: uuid,
      title: "Partial Track",
      artist: "Artist",
    });

    expect(track.entityUid).toBe(uuid);
    expect(hasPlayableTrackReference({ id: uuid })).toBe(true);
  });

  it("uses global catalog track ids as the playback identity when present", () => {
    const track = toPlayableTrack({
      id: "local-entity-1",
      entity_uid: "local-entity-1",
      globalTrackUid: "global-track-1",
      title: "Canonical Track",
      artist: "Artist",
    });

    expect(track.id).toBe("global-track-1");
    expect(track.globalTrackUid).toBe("global-track-1");
    expect(track.entityUid).toBe("local-entity-1");
    expect(
      hasPlayableTrackReference({ globalTrackUid: "global-track-1" }),
    ).toBe(true);
  });

  it("does not treat remote-only global ids as local entity ids", () => {
    const globalUid = "123e4567-e89b-12d3-a456-426614174000";
    const track = toPlayableTrack({
      id: globalUid,
      globalTrackUid: globalUid,
      title: "Remote Canonical Track",
      artist: "Artist",
    });

    expect(track.id).toBe(globalUid);
    expect(track.globalTrackUid).toBe(globalUid);
    expect(track.entityUid).toBeUndefined();
  });

  it("normalizes remote federation tracks into player refs", () => {
    const track = toPlayableTrack({
      title: "Travel by Telephone",
      artist: "Rival Schools",
      album: "United By Fate",
      origin: "remote",
      node_uid: "node-b",
      node_name: "Friend Crate",
      remote_entity_uid: "123e4567-e89b-12d3-a456-426614174000",
      availability: { catalog: true, stream: true, import: false },
    });

    expect(track).toEqual(
      expect.objectContaining({
        id: "remote:node-b:123e4567-e89b-12d3-a456-426614174000",
        origin: "remote",
        remote: expect.objectContaining({
          nodeUid: "node-b",
          nodeName: "Friend Crate",
          remoteEntityUid: "123e4567-e89b-12d3-a456-426614174000",
          availability: { catalog: true, stream: true, import: false },
        }),
      }),
    );
    expect(
      hasPlayableTrackReference({
        origin: "remote",
        node_uid: "node-b",
        remote_entity_uid: "123e4567-e89b-12d3-a456-426614174000",
        availability: { catalog: true, stream: true, import: false },
      }),
    ).toBe(true);
  });
});

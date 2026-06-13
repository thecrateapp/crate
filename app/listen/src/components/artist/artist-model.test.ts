import { describe, expect, it } from "vitest";

import {
  buildArtistPlayerTrack,
  buildArtistShowItems,
  topTrackToTrackRowData,
} from "@/components/artist/artist-model";

describe("artist top track model", () => {
  it("preserves track identity when mapping top tracks to TrackRow data", () => {
    const row = topTrackToTrackRowData({
      id: "not-a-playable-id",
      track_entity_uid: "track-entity-1",
      track_id: 101,
      artist_id: 7,
      artist_entity_uid: "artist-entity-7",
      artist_slug: "converge",
      album_id: 9,
      album_entity_uid: "album-entity-9",
      album_slug: "jane-doe",
      title: "Concubine",
      artist: "Converge",
      album: "Jane Doe",
      duration: 82,
      track: 1,
      format: "flac",
      bitrate: 1411,
      sample_rate: 44100,
      bit_depth: 16,
    });

    expect(row).toEqual(
      expect.objectContaining({
        id: "track-entity-1",
        entity_uid: "track-entity-1",
        library_track_id: 101,
        artist_entity_uid: "artist-entity-7",
        album_entity_uid: "album-entity-9",
        track_number: 1,
        format: "flac",
        bitrate: 1411,
        sample_rate: 44100,
        bit_depth: 16,
      }),
    );
  });

  it("preserves track identity when mapping top tracks to player tracks", () => {
    const track = buildArtistPlayerTrack(
      {
        id: "not-a-playable-id",
        track_entity_uid: "track-entity-2",
        track_id: 102,
        artist_id: 7,
        artist_entity_uid: "artist-entity-7",
        artist_slug: "converge",
        album_id: 9,
        album_entity_uid: "album-entity-9",
        album_slug: "jane-doe",
        title: "Fault and Fracture",
        artist: "Converge",
        album: "Jane Doe",
        duration: 188,
        track: 2,
      },
      "Converge",
    );

    expect(track).toEqual(
      expect.objectContaining({
        id: "track-entity-2",
        entityUid: "track-entity-2",
        libraryTrackId: 102,
        artistEntityUid: "artist-entity-7",
        albumEntityUid: "album-entity-9",
      }),
    );
  });
});

describe("artist show model", () => {
  it("deduplicates repeated artist show events before rendering", () => {
    const items = buildArtistShowItems([
      {
        id: "show-99",
        show_id: 99,
        artist_name: "High Vis",
        artist_id: 52,
        artist_slug: "high-vis",
        date: "2026-07-31",
        local_time: "19:00",
        venue: "Grant Park",
        city: "Chicago",
        country: "USA",
        country_code: "US",
      },
      {
        id: "show-99",
        show_id: 99,
        artist_name: "High Vis",
        artist_id: 52,
        artist_slug: "high-vis",
        date: "2026-07-31",
        local_time: "19:00",
        venue: "Grant Park",
        city: "Chicago",
        country: "USA",
        country_code: "US",
      },
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]?.event_key).toBe("show-99");
  });
});

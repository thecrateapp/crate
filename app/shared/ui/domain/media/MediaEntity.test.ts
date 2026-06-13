import { describe, expect, it } from "vitest";

import type {
  AlbumEntity,
  ArtistEntity,
  MediaEntity,
  PlaylistEntity,
  TrackEntity,
} from "./MediaEntity";

const album: AlbumEntity = {
  kind: "album",
  id: 1,
  uid: "album-1",
  slug: "jane-doe",
  name: "Jane Doe",
  subtitle: "Converge",
  artistName: "Converge",
  year: 2001,
  trackCount: 12,
  duration: 2730,
  format: "FLAC",
  bitDepth: 16,
  sampleRate: 44.1,
  image: {
    url: "/covers/jane-doe.jpg",
    fallbackUrl: "/covers/converge.jpg",
    shape: "square",
    alt: "Jane Doe cover",
  },
  href: "/artists/converge/jane-doe",
};

const artist: ArtistEntity = {
  kind: "artist",
  name: "Converge",
  subtitle: "52.6M scrobbles",
  albumCount: 14,
  trackCount: 160,
  listenerCount: 639_200,
  genres: ["hardcore", "mathcore"],
  image: {
    url: "/artists/converge.jpg",
    shape: "circle",
    alt: "Converge",
  },
};

const track: TrackEntity = {
  kind: "track",
  name: "Concubine",
  artistName: "Converge",
  albumName: "Jane Doe",
  trackNumber: 1,
  duration: 79,
  isPlaying: true,
};

const playlist: PlaylistEntity = {
  kind: "playlist",
  name: "Heavy rotation",
  trackCount: 42,
  isSmart: true,
  isFollowed: false,
};

describe("MediaEntity", () => {
  it("supports the shared discriminated media contract", () => {
    const entities: MediaEntity[] = [album, artist, track, playlist];

    expect(entities.map((entity) => entity.kind)).toEqual([
      "album",
      "artist",
      "track",
      "playlist",
    ]);
    expect(album.image?.fallbackUrl).toBe("/covers/converge.jpg");
    expect(track.isPlaying).toBe(true);
  });

  it("can be narrowed by kind without loose field inference", () => {
    expect(displayLabel(album)).toBe("Jane Doe by Converge");
    expect(displayLabel(artist)).toBe("Converge");
    expect(displayLabel(track)).toBe("Concubine from Jane Doe");
    expect(displayLabel(playlist)).toBe("Heavy rotation");
  });
});

function displayLabel(entity: MediaEntity): string {
  switch (entity.kind) {
    case "album":
      return `${entity.name} by ${entity.artistName}`;
    case "artist":
      return entity.name;
    case "track":
      return `${entity.name} from ${entity.albumName}`;
    case "playlist":
      return entity.name;
    default: {
      const exhaustive: never = entity;
      return exhaustive;
    }
  }
}

// @ts-expect-error Album entities use the shared `name` field, not a local `title` field.
const legacyAlbumTitle: AlbumEntity = { kind: "album", title: "Jane Doe" };

void legacyAlbumTitle;

import { describe, expect, it } from "vitest";

import { albumCoverApiUrl } from "@/lib/library-routes";
import { radioStationArtwork } from "./radio-station-view";

const GENRE = {
  type: "genre" as const,
  title: "Grime Radio",
  genre_slug: "grime",
  genre_name: "grime",
};

describe("genre radio artwork", () => {
  it("prefers the genre's own cover", () => {
    expect(
      radioStationArtwork({
        ...GENRE,
        cover_url: "https://cdn.example/genres/grime.webp",
        album_id: 7,
      }),
    ).toBe("https://cdn.example/genres/grime.webp");
  });

  it("falls back to the representative album cover", () => {
    const artwork = radioStationArtwork({
      ...GENRE,
      album_id: 7,
      album_entity_uid: "album-uid",
      album_name: "Cosmonautica",
    });

    expect(artwork).toBeTruthy();
    expect(artwork).toBe(
      albumCoverApiUrl(
        { albumId: 7, albumEntityUid: "album-uid", albumName: "Cosmonautica" },
        { size: 256 },
      ),
    );
  });

  it("stays empty without a cover or an album", () => {
    expect(radioStationArtwork(GENRE)).toBeNull();
  });
});

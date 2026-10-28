import { expect, it } from "vitest";
import {
  catalogAlbumItem,
  catalogArtistItem,
  catalogTrackItem,
  trackCoverPath,
} from "./catalog-search-model";
it("builds canonical album artwork from search identity and keeps original result objects", () => {
  const album = {
    name: "Blending",
    artist: "High Vis",
    global_album_uid: "album-1",
    year: 2022,
  };
  const artist = { name: "High Vis", global_artist_uid: "artist-1" };
  expect(catalogAlbumItem(album)).toMatchObject({
    kind: "album",
    data: album,
    meta: "2022",
    imageUrl: expect.stringContaining("album-1"),
  });
  expect(catalogArtistItem(artist)).toMatchObject({
    kind: "artist",
    data: artist,
    imageUrl: expect.stringContaining("artist-1"),
  });
  expect(
    catalogTrackItem({
      title: "Song",
      artist: "High Vis",
      album: "Blending",
      global_track_uid: "track-1",
      global_album_uid: "album-1",
    }),
  ).toMatchObject({
    key: "global:track-1",
    imageUrl: expect.stringContaining("album-1"),
  });
});
it("uses supported local album references and avoids inventing artwork routes without identity", () => {
  expect(
    trackCoverPath({ artist: "High Vis", album: "Blending", album_id: 12 }),
  ).toContain("/api/albums/12/cover");
  expect(trackCoverPath({ artist: "High Vis" })).toBeUndefined();
  expect(
    trackCoverPath({ artist: "High Vis", album: "Blending" }),
  ).toBeUndefined();
  expect(trackCoverPath({ artist: "High Vis", cover: "/fixture.jpg" })).toBe(
    "/fixture.jpg",
  );
});

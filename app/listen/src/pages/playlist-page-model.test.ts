import type { TFunction } from "i18next";
import { expect, it } from "vitest";
import { buildPlaylistEditableTracks } from "./playlist-page-model";
import type { PlaylistData } from "./playlist-types";
it("keeps actual album artwork identity when reopening the playlist editor", () => {
  const data = {
    tracks: [
      {
        id: 1,
        title: "Talk For Hours",
        artist: "High Vis",
        album: "Blending",
        duration: 183,
        track_path: "",
        global_track_uid: "track-1",
        global_album_uid: "album-1",
        album_id: 8,
        position: 0,
      },
    ],
  } as PlaylistData;
  expect(
    buildPlaylistEditableTracks(data, ((key: string) => key) as TFunction)[0],
  ).toMatchObject({
    globalAlbumUid: "album-1",
    albumId: 8,
    title: "Talk For Hours",
  });
});

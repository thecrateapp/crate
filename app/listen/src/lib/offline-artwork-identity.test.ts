import { expect, it } from "vitest";
import {
  offlineArtworkRef,
  offlineArtworkRefs,
  offlineItemArtworkPath,
  offlineTrackArtworkPath,
} from "./offline-artwork-identity";
it("uses canonical identities without persisting media credentials or responsive variants", () => {
  expect(
    offlineArtworkRef("/api/albums/7/cover?size=128&media_ticket=secret"),
  ).toEqual({ key: "artwork:album:7", path: "/api/albums/7/cover" });
  expect(offlineArtworkRef("/api/playlists/4/cover?v=3")).toEqual({
    key: "artwork:playlist:4",
    path: "/api/playlists/4/cover",
  });
  for (const source of [
    null,
    "data:image/png,x",
    "/api/albums/0/cover",
    "/api/artists/7/photo",
  ])
    expect(offlineArtworkRef(source)).toBeNull();
  expect(offlineTrackArtworkPath({ album_id: null })).toBeUndefined();
  expect(offlineTrackArtworkPath({ album_id: 7 })).toMatch(
    /^\/api\/albums\/7\/cover/,
  );
});
it("shares an album image across a playlist and individual tracks", () => {
  const items = [
    {
      artwork: { cover_url: "/api/playlists/4/cover" },
      tracks: [{ album_id: 7 }, { album_id: 7 }],
    },
    { tracks: [{ album_id: 7 }] },
  ];
  expect(offlineArtworkRefs(items as never)).toEqual([
    { key: "artwork:playlist:4", path: "/api/playlists/4/cover" },
    { key: "artwork:album:7", path: "/api/albums/7/cover" },
  ]);
  expect(offlineItemArtworkPath(items[0] as never)).toBe(
    "/api/playlists/4/cover",
  );
  expect(offlineItemArtworkPath(items[1] as never)).toMatch(
    /^\/api\/albums\/7\/cover/,
  );
});

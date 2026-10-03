import { describe, expect, it } from "vitest";

import {
  buildCrateSharePayload,
  cratePagePath,
  orderCrateAlbums,
} from "@/components/crates/crate-model";
import type { CrateSummary } from "@/pages/crates-types";

const crate: CrateSummary = {
  id: "2d89b6b2-0a62-41a4-b7aa-c2cd3dab69d6",
  short_code: "c6VS1y82",
  public_ref: "testing-crates-c6VS1y82",
  owner_id: 1,
  owner_name: "Diego",
  name: "Testing Crates",
  description: "",
  visibility: "public",
  is_collaborative: false,
  is_ordered: true,
  sort_direction: "desc",
  loop_enabled: false,
  access: "owner",
  album_count: 2,
  track_count: 10,
  first_album: null,
  albums: [
    {
      global_album_uid: "a",
      position: 0,
      name: "First",
      artist_name: "Artist",
      has_cover: true,
    },
    {
      global_album_uid: "b",
      position: 5,
      name: "Second",
      artist_name: "Artist",
      has_cover: false,
    },
  ],
};

describe("crate-model", () => {
  it("builds the canonical slug path with a UUID fallback", () => {
    expect(cratePagePath(crate)).toBe("/crate/testing-crates-c6VS1y82");
    expect(cratePagePath({ id: crate.id, public_ref: null })).toBe(
      `/crate/${crate.id}`,
    );
  });

  it("numbers albums by rank and reverses descending Crates", () => {
    const albums = orderCrateAlbums(crate.albums, true, "desc");
    expect(albums.map((album) => [album.name, album.displayNumber])).toEqual([
      ["Second", 2],
      ["First", 1],
    ]);
  });

  it("shares the slug URL with public cover images", () => {
    const payload = buildCrateSharePayload(
      crate,
      orderCrateAlbums(crate.albums, true, "desc"),
    );
    expect(payload.url).toMatch(/\/share\/crate\/testing-crates-c6VS1y82$/);
    expect(payload.crateOwnerName).toBe("Diego");
    expect(payload.crateAlbums?.[1]?.imageUrl).toContain(
      `/share/image/crate/${crate.id}/album/a?size=768`,
    );
  });
});

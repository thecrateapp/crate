import { describe, expect, it } from "vitest";

import {
  ARTIST_HERO_CONTRACT_VERSION,
  artistHeroCompositionSize,
  artistHeroViewKey,
} from "../../../../shared/web/artist-hero-contract";

describe("artist hero contract", () => {
  it("keeps the canonical target dimensions stable", () => {
    expect(artistHeroCompositionSize("desktop")).toEqual({
      width: 1480,
      height: 600,
    });
    expect(artistHeroCompositionSize("mobile")).toEqual({
      width: 1080,
      height: 1350,
    });
  });

  it("keys a view by render revision and recipe hash", () => {
    expect(ARTIST_HERO_CONTRACT_VERSION).toBe(1);
    expect(
      artistHeroViewKey({
        schema_version: 1,
        composition: "desktop",
        render_revision: "cover-fit-v4:abc",
        recipe_hash: "1234567890abcdef",
        width: 1480,
        height: 600,
        bounds: { left: 0, top: 0, right: 1, bottom: 1 },
        asset_path: "/api/artists/1/hero",
      }),
    ).toBe("desktop:cover-fit-v4:abc:1234567890abcdef");
  });
});

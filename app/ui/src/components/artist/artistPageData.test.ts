import { describe, expect, it } from "vitest";

import { buildArtistTabs } from "./artistPageData";

describe("buildArtistTabs", () => {
  it("includes artwork management in the artist page", () => {
    expect(buildArtistTabs(0)).toContainEqual({
      key: "artwork",
      label: "Artwork",
    });
  });
});

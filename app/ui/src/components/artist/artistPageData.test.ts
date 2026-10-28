import { describe, expect, it } from "vitest";

import { buildArtistTabs, buildExternalLinks } from "./artistPageData";

describe("buildArtistTabs", () => {
  it("keeps Overview as the only general artist information tab", () => {
    const tabs = buildArtistTabs(2);
    expect(tabs[0]).toEqual({ key: "overview", label: "Overview" });
    expect(tabs.some((tab) => tab.label === "About")).toBe(false);
    expect(tabs).toContainEqual({ key: "shows", label: "Shows (2)" });
  });
  it("includes artwork management in the artist page", () => {
    expect(buildArtistTabs(0)).toContainEqual({
      key: "artwork",
      label: "Artwork",
    });
  });
});

it("keeps provider links descriptive, without warning or success status", () => {
  const links = buildExternalLinks({
    lastfm: { url: "https://last.fm/music/Slowdive" },
    spotify: { url: "https://open.spotify.com/artist/example" },
  });
  expect(links).toHaveLength(2);
  expect(links.every((link) => link.color === "text-text-secondary")).toBe(
    true,
  );
});

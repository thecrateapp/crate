import { describe, expect, it } from "vitest";

import { shouldRefreshHomeDiscoveryForScope } from "./home-discovery-scope";

describe("shouldRefreshHomeDiscoveryForScope", () => {
  it.each([
    "home",
    "library",
    "global_catalog",
    "upcoming",
    "home:user:42",
    "artist:42",
    "album:42",
    "playlist:42",
  ])("refreshes discovery for %s", (scope) => {
    expect(shouldRefreshHomeDiscoveryForScope(scope)).toBe(true);
  });

  it.each(["artist", "home:user", "playlist", "track:42", "settings"])(
    "ignores unrelated scope %s",
    (scope) => {
      expect(shouldRefreshHomeDiscoveryForScope(scope)).toBe(false);
    },
  );
});

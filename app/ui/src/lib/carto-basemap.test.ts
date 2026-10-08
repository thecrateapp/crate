import { describe, expect, it } from "vitest";

import { cartoBasemapTileUrl } from "./carto-basemap";

const DARK_ALL_TILE_TEMPLATE =
  "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";

describe("cartoBasemapTileUrl", () => {
  it("preserves the dark_all template and URL-encodes the API key", () => {
    expect(cartoBasemapTileUrl("public key/+?=")).toBe(
      `${DARK_ALL_TILE_TEMPLATE}?key=public%20key%2F%2B%3F%3D`,
    );
  });

  it.each([undefined, ""])(
    "returns the unkeyed template safely when the API key is %s",
    (apiKey) => {
      const url = cartoBasemapTileUrl(apiKey);

      expect(url).toBe(DARK_ALL_TILE_TEMPLATE);
      expect(url).not.toContain("undefined");
      expect(url).not.toContain("?key=");
    },
  );
});

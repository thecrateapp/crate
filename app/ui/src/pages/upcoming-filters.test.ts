import { describe, expect, it } from "vitest";

import {
  buildUpcomingCityOptions,
  filterUpcomingItems,
  type UpcomingFilterItem,
} from "./upcoming-filters";

describe("upcoming filters", () => {
  it("keeps release and show type filters strict", () => {
    const items: UpcomingFilterItem[] = [
      { type: "show", artist: "Metallica", city: "Las Vegas" },
      { type: "release", artist: "Boards of Canada" },
    ];

    expect(filterUpcomingItems(items, { type: "releases" })).toEqual([
      items[1],
    ]);
    expect(filterUpcomingItems(items, { type: "shows" })).toEqual([items[0]]);
  });

  it("city filtering only returns matching shows", () => {
    const items: UpcomingFilterItem[] = [
      { type: "show", artist: "Metallica", city: "Las Vegas" },
      { type: "show", artist: "Placebo", city: "Madrid" },
      { type: "release", artist: "Placebo" },
    ];

    expect(filterUpcomingItems(items, { type: "all", city: "Madrid" })).toEqual(
      [items[1]],
    );
  });

  it("does not drop low-frequency cities from searchable options", () => {
    const items: UpcomingFilterItem[] = Array.from(
      { length: 60 },
      (_, index) => ({
        type: "show",
        artist: `Artist ${index}`,
        city: `City ${index}`,
      }),
    );
    items.push({ type: "show", artist: "Placebo", city: "Madrid" });

    expect(buildUpcomingCityOptions(items, { type: "all" })).toContainEqual([
      "Madrid",
      1,
    ]);
  });
});

import { describe, expect, it } from "vitest";

import {
  buildUpcomingCityOptions,
  filterUpcomingItems,
  sameShowIds,
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

describe("sameShowIds", () => {
  const shows = [
    { type: "show" as const, show_id: 1, artist: "Band", date: "2099-05-15" },
    { type: "show" as const, show_id: 2, artist: " BAND ", date: "2099-05-15" },
    { type: "show" as const, show_id: 3, artist: "Band", date: "2099-05-16" },
    { type: "show" as const, show_id: 4, artist: "Other", date: "2099-05-15" },
    { type: "release" as const, artist: "Band", date: "2099-05-15" },
  ];

  it("lists the show first, then the same artist on the same date", () => {
    expect(sameShowIds(shows, shows[1]!)).toEqual([2, 1]);
    expect(sameShowIds(shows, shows[2]!)).toEqual([3]);
  });

  it("caps the list at the merge editor's limit", () => {
    const many = Array.from({ length: 12 }, (_, index) => ({
      type: "show" as const,
      show_id: index + 1,
      artist: "Band",
      date: "2099-05-15",
    }));
    expect(sameShowIds(many, many[11]!)).toEqual([
      12, 1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
  });

  it("has nothing to offer for an item without a show ID", () => {
    expect(sameShowIds(shows, shows[4]!)).toEqual([]);
  });
});

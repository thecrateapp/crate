import { beforeEach, describe, expect, it } from "vitest";

import { loadSearchRecents } from "./SearchBar";

describe("admin search recents", () => {
  beforeEach(() => localStorage.clear());

  it("migrates recents from the legacy storage key", () => {
    localStorage.setItem("search-recents", JSON.stringify(["Quicksand"]));

    expect(loadSearchRecents()).toEqual(["Quicksand"]);
    expect(localStorage.getItem("search-recents:v1")).toBe(
      JSON.stringify(["Quicksand"]),
    );
    expect(localStorage.getItem("search-recents")).toBeNull();
  });
});

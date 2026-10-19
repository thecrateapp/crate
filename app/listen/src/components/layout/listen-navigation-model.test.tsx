import { describe, expect, it } from "vitest";
import {
  collectionNavigationItems,
  listenNavigationItems,
} from "./listen-navigation-model";
const t = (key: string) => key;
describe("Listen navigation destinations", () => {
  it("preserves all collection destinations and the separate desktop Bandcamp route", () => {
    const desktop = collectionNavigationItems(t, false, {
      pathname: "/library",
      search: "?tab=albums",
    });
    expect(desktop).toHaveLength(7);
    expect(desktop[5]!.to).toBe("/bandcamp");
    expect(
      desktop.filter((item) => item.active).map((item) => item.to),
    ).toEqual(["/library?tab=albums"]);
    expect(
      collectionNavigationItems(t, true, {
        pathname: "/collection/liked",
        search: "?tab=albums",
      })
        .filter((item) => item.active)
        .map((item) => item.to),
    ).toEqual(["/collection/liked"]);
  });
  it("marks the same fallback as the Library for an unknown section", () => {
    expect(
      collectionNavigationItems(t, false, {
        pathname: "/library",
        search: "?tab=unknown",
      })
        .filter((item) => item.active)
        .map((item) => item.to),
    ).toEqual(["/library?tab=playlists"]);
  });
  it("retains the different main desktop/mobile destinations", () => {
    expect(listenNavigationItems(t, false).map((item) => item.to)).toEqual([
      "/",
      "/explore",
      "/upcoming",
      "/stats",
    ]);
    expect(listenNavigationItems(t, true).map((item) => item.to)).toEqual([
      "/",
      "/explore",
      "/upcoming",
    ]);
  });
});

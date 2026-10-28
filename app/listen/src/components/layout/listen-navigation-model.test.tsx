import { describe, expect, it } from "vitest";
import {
  collectionNavigationItems,
  listenNavigationItems,
} from "./listen-navigation-model";
const t = (key: string) => key;
describe("Listen navigation destinations", () => {
  it("keeps Contributions in Collection and removes Bandcamp in desktop and mobile navigation", () => {
    const desktop = collectionNavigationItems(t, false, {
      pathname: "/library",
      search: "?tab=albums",
    });
    expect(desktop).toHaveLength(6);
    expect(desktop[5]!.to).toBe("/library?tab=contributions");
    for (const mobile of [true, false]) {
      expect(
        collectionNavigationItems(t, mobile, {
          pathname: "/bandcamp",
          search: "",
        }).some((item) => item.to.includes("bandcamp") || item.active),
      ).toBe(false);
    }
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

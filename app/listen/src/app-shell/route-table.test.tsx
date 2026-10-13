import { ANONYMOUS_APP_ROUTE_PATTERNS } from "@/app-shell/AppLayoutRoute";
import { describe, expect, it } from "vitest";

import { protectedAppRoutes, publicAppRoutes } from "@/app-shell/route-table";

describe("protected app routes", () => {
  it("does not expose federation-specific remote routes in Listen", () => {
    const paths = protectedAppRoutes
      .map((route) => route.path)
      .filter((path): path is string => Boolean(path));

    expect(paths.filter((path) => path.startsWith("remote/"))).toEqual([]);
  });

  it("keeps Jam Rooms behind the temporary disabled-access route", () => {
    const paths = protectedAppRoutes
      .map((route) => route.path)
      .filter((path): path is string => Boolean(path));

    expect(paths).not.toContain("jam");
    expect(paths).not.toContain("jam/rooms/:roomId");
    expect(paths).not.toContain("jam/invite/:token");
    expect(paths).toContain("jam/*");
  });
});

describe("public app routes", () => {
  it("serves shared Crate pages from the app layout so playback survives navigation", () => {
    const publicPaths = publicAppRoutes
      .map((route) => route.path)
      .filter((path): path is string => Boolean(path));
    const appPaths = protectedAppRoutes.map((route) => route.path);

    expect(publicPaths).not.toContain("/crate/:crateRef");
    expect(appPaths).toContain("crate/:crateRef");
    expect(appPaths).not.toContain("crate/invite/:token");
    expect(appPaths).not.toContain("playlist/invite/:token");
    expect(ANONYMOUS_APP_ROUTE_PATTERNS).toEqual(["/crate/:crateRef"]);
  });
});

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
  it("keeps shared Crate pages outside the authenticated shell", () => {
    const paths = publicAppRoutes
      .map((route) => route.path)
      .filter((path): path is string => Boolean(path));

    expect(paths).toContain("/crate/:crateRef");
    expect(protectedAppRoutes.map((route) => route.path)).toContain(
      "crate/invite/:token",
    );
    expect(protectedAppRoutes.map((route) => route.path)).not.toContain(
      "crate/:crateRef",
    );
  });
});

import { describe, expect, it } from "vitest";

import { protectedAppRoutes } from "@/app-shell/route-table";

describe("protected app routes", () => {
  it("does not expose federation-specific remote routes in Listen", () => {
    const paths = protectedAppRoutes
      .map((route) => route.path)
      .filter((path): path is string => Boolean(path));

    expect(paths.filter((path) => path.startsWith("remote/"))).toEqual([]);
  });
});

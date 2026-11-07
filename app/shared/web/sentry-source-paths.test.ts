import { describe, expect, it } from "vitest";

import { createSentrySourcePathRewriter } from "./sentry-source-paths";

describe("createSentrySourcePathRewriter", () => {
  const listenWeb = createSentrySourcePathRewriter({
    repoRoot: "/repo",
    distDir: "/repo/app/listen/dist",
  });
  const listenDesktop = createSentrySourcePathRewriter({
    repoRoot: "/home/runner/work/crate/crate",
    distDir: "/home/runner/work/crate/crate/app/listen-desktop/dist",
  });
  const listenDesktopWindows = createSentrySourcePathRewriter({
    repoRoot: "D:\\a\\crate\\crate",
    distDir: "D:\\a\\crate\\crate\\app\\listen-desktop\\dist",
  });
  const admin = createSentrySourcePathRewriter({
    repoRoot: "/repo",
    distDir: "/repo/app/ui/dist",
  });

  it("gives Listen sources one path in the web, desktop and Windows builds", () => {
    const web = { mapDir: "/repo/app/listen/dist/assets" };
    const desktop = {
      mapDir: "/home/runner/work/crate/crate/app/listen-desktop/dist/assets",
    };
    const windows = {
      mapDir: "d:\\a\\crate\\crate\\app\\listen-desktop\\dist\\assets",
    };

    expect(listenWeb("../../src/lib/api.ts", {}, web)).toBe(
      "../app/listen/src/lib/api.ts",
    );
    expect(listenDesktop("../../../listen/src/lib/api.ts", {}, desktop)).toBe(
      "../app/listen/src/lib/api.ts",
    );
    expect(
      listenDesktopWindows("..\\..\\..\\listen\\src\\lib\\api.ts", {}, windows),
    ).toBe("../app/listen/src/lib/api.ts");

    expect(listenWeb("../../../shared/web/api.ts", {}, web)).toBe(
      "../app/shared/web/api.ts",
    );
    expect(listenDesktop("../../../shared/web/api.ts", {}, desktop)).toBe(
      "../app/shared/web/api.ts",
    );
  });

  it("collapses dependencies to node_modules whatever the hoisting", () => {
    const web = { mapDir: "/repo/app/listen/dist/assets" };
    const adminMap = { mapDir: "/repo/app/ui/dist/assets" };

    expect(
      listenWeb(
        "../../../../node_modules/@sentry/browser/node_modules/@sentry/core/build/esm/instrument/fetch.js",
        {},
        web,
      ),
    ).toBe("../node_modules/@sentry/core/build/esm/instrument/fetch.js");
    expect(
      admin(
        "../../node_modules/@sentry/browser/build/npm/esm/prod/helpers.js",
        {},
        adminMap,
      ),
    ).toBe("../node_modules/@sentry/browser/build/npm/esm/prod/helpers.js");
    expect(
      admin(
        "../../../../node_modules/react-dom/cjs/react-dom-client.production.js",
        {},
        adminMap,
      ),
    ).toBe("../node_modules/react-dom/cjs/react-dom-client.production.js");
  });

  it("climbs from nested map directories and handles absolute sources", () => {
    expect(
      listenWeb(
        "/repo/app/listen/src/main.tsx",
        {},
        {
          mapDir: "/repo/app/listen/dist",
        },
      ),
    ).toBe("app/listen/src/main.tsx");
    expect(
      listenWeb(
        "../../../src/sw.ts",
        {},
        {
          mapDir: "/repo/app/listen/dist/assets/workers",
        },
      ),
    ).toBe("../../app/listen/src/sw.ts");
  });

  it("keeps URLs, unknown locations and calls without context readable", () => {
    expect(listenWeb("webpack://crate/./src/a.ts")).toBe("crate/./src/a.ts");
    expect(
      listenWeb(
        "../../../../../../elsewhere/a.ts",
        {},
        {
          mapDir: "/repo/app/listen/dist/assets",
        },
      ),
    ).toBe("../../../../../../elsewhere/a.ts");
    expect(listenWeb("..\\src\\a.ts")).toBe("../src/a.ts");
  });
});

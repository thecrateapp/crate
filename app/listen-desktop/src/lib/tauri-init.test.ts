import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { shouldUseTauriHttpPlugin } from "./tauri-init";

describe("shouldUseTauriHttpPlugin", () => {
  it("uses the privileged client for HTTPS servers", () => {
    expect(shouldUseTauriHttpPlugin("https://api.example.com/health")).toBe(
      true,
    );
  });

  it.each([
    "http://localhost:8585/health",
    "http://127.0.0.1:8585/health",
    "http://[::1]:8585/health",
  ])("allows cleartext only for loopback URLs: %s", (url) => {
    expect(shouldUseTauriHttpPlugin(url)).toBe(true);
  });

  it("keeps arbitrary cleartext URLs out of the privileged client", () => {
    expect(shouldUseTauriHttpPlugin("http://api.example.com/health")).toBe(
      false,
    );
  });

  it("grants the same custom-port origins accepted by the runtime", () => {
    const capability = JSON.parse(
      readFileSync(
        new URL("../../src-tauri/capabilities/default.json", import.meta.url),
        "utf8",
      ),
    ) as {
      permissions: Array<
        string | { identifier: string; allow?: Array<{ url: string }> }
      >;
    };
    const httpScope = capability.permissions.find(
      (permission) =>
        typeof permission === "object" &&
        permission.identifier === "http:default",
    );
    const allowed =
      typeof httpScope === "object"
        ? httpScope.allow?.map((entry) => entry.url)
        : undefined;

    expect(allowed).toEqual(
      expect.arrayContaining([
        "https://*:*",
        "http://localhost:*",
        "http://127.0.0.1:*",
        "http://[::1]:*",
      ]),
    );
  });
});

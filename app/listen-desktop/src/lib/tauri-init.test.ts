import { describe, expect, it } from "vitest";

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
});

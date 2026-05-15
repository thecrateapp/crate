import { describe, expect, it, beforeEach, vi } from "vitest";

vi.mock("@/lib/platform", () => ({
  usesConfigurableServer: true,
}));

import {
  normaliseServerUrl,
  deriveLabel,
  getServers,
  addServer,
  getCurrentServer,
  setCurrentServerId,
  removeServer,
  setCurrentServerToken,
  setCurrentServerRefreshToken,
  updateServerLabel,
} from "./server-store";

beforeEach(() => {
  localStorage.clear();
});

describe("normaliseServerUrl", () => {
  it("trims and removes trailing slashes", () => {
    expect(normaliseServerUrl("  https://example.com/  ")).toBe(
      "https://example.com",
    );
  });

  it("defaults to https", () => {
    expect(normaliseServerUrl("example.com")).toBe("https://example.com");
  });

  it("returns empty for empty input", () => {
    expect(normaliseServerUrl("")).toBe("");
  });
});

describe("deriveLabel", () => {
  it("extracts hostname", () => {
    expect(deriveLabel("https://api.example.com")).toBe("example.com");
  });

  it("strips api prefix", () => {
    expect(deriveLabel("https://api.foo.bar")).toBe("foo.bar");
  });

  it("falls back to raw url on error", () => {
    expect(deriveLabel("not-a-url")).toBe("not-a-url");
  });
});

describe("addServer / getServers", () => {
  it("adds a server", () => {
    const s = addServer("https://crate.local");
    expect(s.url).toBe("https://crate.local");
    expect(getServers()).toHaveLength(1);
  });

  it("does not duplicate existing servers", () => {
    addServer("https://crate.local");
    addServer("https://crate.local");
    expect(getServers()).toHaveLength(1);
  });
});

describe("getCurrentServer", () => {
  it("returns null when no current server", () => {
    expect(getCurrentServer()).toBeNull();
  });

  it("returns the current server after setting it", () => {
    const s = addServer("https://crate.local");
    setCurrentServerId(s.id);
    expect(getCurrentServer()?.id).toBe(s.id);
  });
});

describe("removeServer", () => {
  it("removes a server and clears current if it was active", () => {
    const s = addServer("https://crate.local");
    setCurrentServerId(s.id);
    removeServer(s.id);
    expect(getServers()).toHaveLength(0);
    expect(getCurrentServer()).toBeNull();
  });
});

describe("setCurrentServerToken", () => {
  it("sets token for current server", () => {
    const s = addServer("https://crate.local");
    setCurrentServerId(s.id);
    setCurrentServerToken("tok123");
    expect(getCurrentServer()?.token).toBe("tok123");
  });

  it("is a no-op when no current server", () => {
    expect(() => setCurrentServerToken("tok")).not.toThrow();
  });
});

describe("setCurrentServerRefreshToken", () => {
  it("sets refresh token for current server", () => {
    const s = addServer("https://crate.local");
    setCurrentServerId(s.id);
    setCurrentServerRefreshToken("ref123");
    expect(getCurrentServer()?.refreshToken).toBe("ref123");
  });
});

describe("updateServerLabel", () => {
  it("updates label", () => {
    const s = addServer("https://crate.local");
    updateServerLabel(s.id, "My Crate");
    expect(getServers()[0]!.label).toBe("My Crate");
  });

  it("ignores empty label", () => {
    const s = addServer("https://crate.local");
    updateServerLabel(s.id, "   ");
    expect(getServers()[0]!.label).not.toBe("");
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform", () => ({
  usesConfigurableServer: true,
  isCapacitorRuntime: true,
  isTauriRuntime: false,
  getListenAppId: () => "listen-android",
}));

vi.mock("@/lib/native-secure-session", () => ({
  getSecureSessionValue: vi.fn(async () => null),
  removeSecureSessionValue: vi.fn(async () => {}),
  setSecureSessionValue: vi.fn(async () => {}),
}));

describe("pinned Android debug server", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
    vi.stubEnv("VITE_CRATE_FIXED_SERVER_URL", "https://api.dev.lespedants.org");
  });

  it("seeds dev and rejects switching to a production server", async () => {
    const apiModule = await import("@/lib/api");
    const serverStore = await import("@/lib/server-store");

    expect(apiModule.getApiBase()).toBe("https://api.dev.lespedants.org");
    expect(serverStore.getCurrentServer()?.url).toBe(
      "https://api.dev.lespedants.org",
    );
    expect(() => serverStore.addServer("https://api.lespedants.org")).toThrow(
      /fixed server/i,
    );
  });

  it("accepts the production API for a prod-pinned Smart Mix build", async () => {
    vi.stubEnv("VITE_CRATE_FIXED_SERVER_URL", "https://api.lespedants.org");
    vi.resetModules();

    const apiModule = await import("@/lib/api");
    const serverStore = await import("@/lib/server-store");

    expect(apiModule.getApiBase()).toBe("https://api.lespedants.org");
    expect(serverStore.getCurrentServer()?.url).toBe(
      "https://api.lespedants.org",
    );
  });

  it("re-pins an existing DBG install from dev to production", async () => {
    localStorage.setItem(
      "crate-servers",
      JSON.stringify([
        {
          id: "dev-server",
          label: "dev.lespedants.org",
          url: "https://api.dev.lespedants.org",
          tokenExpiresAt: null,
        },
      ]),
    );
    localStorage.setItem("crate-current-server", "dev-server");
    vi.stubEnv("VITE_CRATE_FIXED_SERVER_URL", "https://api.lespedants.org");
    vi.resetModules();

    const apiModule = await import("@/lib/api");
    const serverStore = await import("@/lib/server-store");

    expect(apiModule.getApiBase()).toBe("https://api.lespedants.org");
    expect(serverStore.getCurrentServer()?.url).toBe(
      "https://api.lespedants.org",
    );
    expect(
      serverStore
        .getServers()
        .some((server) => server.url === "https://api.lespedants.org"),
    ).toBe(true);
  });
});

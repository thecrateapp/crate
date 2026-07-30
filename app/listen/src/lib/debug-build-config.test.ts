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
});

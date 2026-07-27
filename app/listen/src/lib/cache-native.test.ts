import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiBaseMock } = vi.hoisted(() => ({
  apiBaseMock: vi.fn<() => string>(),
}));

vi.mock("@/lib/api", () => ({
  apiSseUrl: vi.fn((path: string) => `${apiBaseMock()}${path}`),
  getApiBase: apiBaseMock,
}));

vi.mock("@/lib/platform", () => ({
  usesConfigurableServer: true,
}));

vi.mock("@/lib/library-routes", () => ({
  recordAssetInvalidationScope: vi.fn(),
}));

vi.mock("@/lib/sse", () => ({
  markSseChannelOpen: vi.fn(),
  markSseChannelEvent: vi.fn(),
  markSseChannelError: vi.fn(),
  markSseChannelClosed: vi.fn(),
  onSseChannelState: vi.fn(() => () => {}),
  onSseReconnect: vi.fn(() => () => {}),
}));

import { cacheClear, cacheGet, cacheSet } from "@/lib/cache";

function setNativeUser(
  apiBase: string,
  serverId: string,
  userId: number,
): void {
  apiBaseMock.mockReturnValue(apiBase);
  localStorage.setItem("crate-current-server", serverId);
  localStorage.setItem(
    `listen-auth-user-id:${encodeURIComponent(apiBase)}`,
    String(userId),
  );
}

describe("native cache identity", () => {
  beforeEach(() => {
    cacheClear();
    localStorage.clear();
    apiBaseMock.mockReset();
  });

  it("isolates cached Home data by the server-scoped native user", () => {
    setNativeUser("https://api-a.example.test", "server-a", 1);
    cacheSet("/api/me/home/discovery", { hero: "High Vis" });

    setNativeUser("https://api-a.example.test", "server-a", 2);

    expect(cacheGet("/api/me/home/discovery")).toBeNull();
  });

  it("isolates cached Collection data when the native server changes", () => {
    setNativeUser("https://api-a.example.test", "server-a", 1);
    cacheSet("/api/catalog/me/artists", [{ artist_name: "High Vis" }]);

    setNativeUser("https://api-b.example.test", "server-b", 1);

    expect(cacheGet("/api/catalog/me/artists")).toBeNull();
  });
});

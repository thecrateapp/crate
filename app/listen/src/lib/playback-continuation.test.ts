import { afterEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => vi.fn());
const apiBaseMock = vi.hoisted(() => vi.fn(() => "https://api.example"));
vi.mock("@/lib/api", () => ({ api: apiMock, getApiBase: apiBaseMock }));

describe("getPlaybackContinuationToken", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
    apiMock.mockReset();
    apiBaseMock.mockReturnValue("https://api.example");
  });

  async function load() {
    return import("@/lib/playback-continuation");
  }

  it("reuses the token until two hours before it expires", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-16T12:00:00Z"));
    apiMock.mockResolvedValue({
      token: "crv_first",
      expiresAt: "2026-10-17T00:00:00Z",
    });
    const { getPlaybackContinuationToken } = await load();

    const first = await getPlaybackContinuationToken();
    vi.setSystemTime(new Date("2026-10-16T21:59:00Z"));
    const reused = await getPlaybackContinuationToken();

    expect(apiMock).toHaveBeenCalledOnce();
    expect(apiMock).toHaveBeenCalledWith(
      "/api/playback/continuation-token",
      "POST",
    );
    expect(reused).toEqual(first);
    expect(first).toEqual({
      token: "crv_first",
      expiresAtMs: Date.parse("2026-10-17T00:00:00Z"),
      apiBase: "https://api.example",
    });

    apiMock.mockResolvedValue({
      token: "crv_second",
      expiresAt: "2026-10-17T10:00:00Z",
    });
    vi.setSystemTime(new Date("2026-10-16T22:01:00Z"));
    expect((await getPlaybackContinuationToken()).token).toBe("crv_second");
  });

  it("asks for a new token when the server changes", async () => {
    apiMock.mockResolvedValue({
      token: "crv_home",
      expiresAt: "2099-01-01T00:00:00Z",
    });
    const { getPlaybackContinuationToken } = await load();
    await getPlaybackContinuationToken();

    apiBaseMock.mockReturnValue("https://other.example");
    apiMock.mockResolvedValue({
      token: "crv_other",
      expiresAt: "2099-01-01T00:00:00Z",
    });

    expect(await getPlaybackContinuationToken()).toMatchObject({
      token: "crv_other",
      apiBase: "https://other.example",
    });
  });
});

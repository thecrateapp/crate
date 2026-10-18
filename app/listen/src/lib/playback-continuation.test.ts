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
      undefined,
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

  it("sends the queue descriptor and keys the cached token on it", async () => {
    apiMock.mockResolvedValue({
      token: "crv_radio",
      expiresAt: "2099-01-01T00:00:00Z",
    });
    const { getPlaybackContinuationToken } = await load();
    const descriptor = { kind: "shaped_radio" as const, sessionId: "radio-1" };

    await getPlaybackContinuationToken(descriptor);
    await getPlaybackContinuationToken(descriptor);
    await getPlaybackContinuationToken(null);

    expect(apiMock).toHaveBeenNthCalledWith(
      1,
      "/api/playback/continuation-token",
      "POST",
      { descriptor },
    );
    expect(apiMock).toHaveBeenNthCalledWith(
      2,
      "/api/playback/continuation-token",
      "POST",
      undefined,
    );
    expect(apiMock).toHaveBeenCalledTimes(2);
  });

  it("describes radio and infinite queues for native continuation", async () => {
    const { continuationDescriptor } = await load();
    const off = { shuffle: false, infinite: false };
    const infinite = { shuffle: false, infinite: true };

    expect(
      continuationDescriptor(
        {
          type: "radio",
          name: "Radio",
          radio: { seedType: "track", seedId: 4, shapedSessionId: "radio-1" },
        },
        off,
      ),
    ).toEqual({ kind: "shaped_radio", sessionId: "radio-1" });
    expect(
      continuationDescriptor(
        {
          type: "radio",
          name: "Radio",
          radio: { seedType: "track", seedId: 4, seedEntityUid: "uid-4" },
        },
        off,
      ),
    ).toEqual({ kind: "seeded_radio", seedType: "track", seedId: "uid-4" });
    expect(
      continuationDescriptor(
        {
          type: "playlist",
          name: "Mix",
          radio: { seedType: "playlist", seedId: 7 },
        },
        infinite,
      ),
    ).toEqual({ kind: "seeded_radio", seedType: "playlist", seedId: "7" });
    expect(
      continuationDescriptor(
        {
          type: "playlist",
          name: "Mix",
          radio: { seedType: "playlist", seedId: "daily" },
        },
        infinite,
      ),
    ).toEqual({
      kind: "seeded_radio",
      seedType: "home_playlist",
      seedId: "daily",
    });
    expect(
      continuationDescriptor(
        {
          type: "album",
          name: "Album",
          radio: { seedType: "album", seedId: 3 },
        },
        off,
      ),
    ).toBeNull();
    expect(
      continuationDescriptor(
        {
          type: "album",
          name: "Album",
          radio: { seedType: "album", seedId: 3 },
        },
        { shuffle: true, infinite: true },
      ),
    ).toBeNull();
    expect(
      continuationDescriptor({ type: "queue", name: "Queue" }, infinite),
    ).toBeNull();
  });
});

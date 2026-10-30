import { afterEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => vi.fn());
const apiBaseMock = vi.hoisted(() => vi.fn(() => "https://api.example"));
vi.mock("@/lib/api", () => ({ api: apiMock, getApiBase: apiBaseMock }));

describe("getPlaybackContinuationToken", () => {
  it.each([
    { shuffle: false, infinite: false },
    { shuffle: false, infinite: true },
    { shuffle: true, infinite: false },
    { shuffle: true, infinite: true },
  ])(
    "keeps a saved path finite with continuation preferences %j",
    async (preferences) => {
      const { continuationDescriptor } = await load();
      const { transitionSource } = await import("@/lib/smart-mix");
      const source = {
        type: "path" as const,
        name: "Saved journey",
        id: 77,
        href: "/paths/77",
      };

      expect(continuationDescriptor(source, preferences)).toBeNull();
      expect(transitionSource(source, preferences.shuffle)).toBe(
        preferences.shuffle ? "shuffle" : "manual",
      );
      expect(apiMock).not.toHaveBeenCalled();
    },
  );
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
    ).toEqual({
      kind: "shaped_radio",
      sessionId: "radio-1",
      batchIndex: 1,
    });
    expect(
      continuationDescriptor(
        {
          type: "radio",
          name: "Radio",
          radio: { seedType: "track", seedId: 4, seedEntityUid: "uid-4" },
        },
        off,
      ),
    ).toEqual(
      expect.objectContaining({
        kind: "seeded_radio",
        seedType: "track",
        seedId: "uid-4",
        sessionId: expect.any(String),
        batchIndex: 0,
      }),
    );
    expect(
      continuationDescriptor(
        {
          type: "playlist",
          name: "Mix",
          radio: { seedType: "playlist", seedId: 7 },
        },
        infinite,
      ),
    ).toEqual(
      expect.objectContaining({
        kind: "seeded_radio",
        seedType: "playlist",
        seedId: "7",
        sessionId: expect.any(String),
        batchIndex: 0,
      }),
    );
    expect(
      continuationDescriptor(
        {
          type: "playlist",
          name: "Mix",
          radio: { seedType: "playlist", seedId: "daily" },
        },
        infinite,
      ),
    ).toEqual(
      expect.objectContaining({
        kind: "seeded_radio",
        seedType: "home_playlist",
        seedId: "daily",
      }),
    );
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
    ).toEqual(
      expect.objectContaining({
        kind: "seeded_radio",
        seedType: "album",
        seedId: "3",
        batchIndex: 0,
      }),
    );
    expect(
      continuationDescriptor({ type: "queue", name: "Queue" }, infinite),
    ).toBeNull();
  });
});

it("reuses a token while its indexed cursor advances and can explicitly revoke the cache", async () => {
  vi.resetModules();
  apiMock.mockReset();
  apiMock.mockResolvedValue({
    token: "crv_indexed",
    expiresAt: "2099-01-01T00:00:00Z",
  });
  const { getPlaybackContinuationToken, invalidatePlaybackContinuationToken } =
    await import("./playback-continuation");
  const descriptor = {
    kind: "shaped_radio" as const,
    sessionId: "s",
    batchIndex: 1,
  };
  await getPlaybackContinuationToken(descriptor);
  await getPlaybackContinuationToken({ ...descriptor, batchIndex: 2 });
  expect(apiMock).toHaveBeenCalledOnce();
  invalidatePlaybackContinuationToken();
  await getPlaybackContinuationToken({ ...descriptor, batchIndex: 2 });
  expect(apiMock).toHaveBeenCalledTimes(2);
});

it("rejects a late token response after logout invalidates authorization", async () => {
  vi.resetModules();
  apiMock.mockReset();
  let complete!: (value: { token: string; expiresAt: string }) => void;
  apiMock.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const { getPlaybackContinuationToken, invalidatePlaybackContinuationToken } =
    await import("./playback-continuation");
  const pending = getPlaybackContinuationToken();
  invalidatePlaybackContinuationToken();
  complete({ token: "crv_old", expiresAt: "2099-01-01T00:00:00Z" });
  await expect(pending).rejects.toThrow("authorization changed");
});

it("revision removal: describes and authorizes continuation without a numeric revision", async () => {
  vi.resetModules();
  apiMock.mockReset();
  apiMock.mockResolvedValue({
    token: "crv_cursor",
    expiresAt: "2099-01-01T00:00:00Z",
  });
  const { continuationDescriptor, getPlaybackContinuationToken } = await import(
    "./playback-continuation"
  );
  const descriptor = continuationDescriptor(
    {
      type: "radio",
      name: "Radio",
      radio: { seedType: "track", seedId: 7, shapedSessionId: "session" },
    },
    { shuffle: false, infinite: true },
  );

  await getPlaybackContinuationToken(descriptor);

  expect(descriptor).toEqual({
    kind: "shaped_radio",
    sessionId: "session",
    batchIndex: 1,
  });
  expect(apiMock.mock.calls[0]?.[2]).toEqual({ descriptor });
  expect(apiMock.mock.calls[0]?.[2].descriptor).not.toHaveProperty("revision");
});

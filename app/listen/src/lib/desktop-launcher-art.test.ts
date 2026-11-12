import { afterEach, describe, expect, it, vi } from "vitest";

import {
  albumArtKey,
  artistArtKey,
  findLoadedImage,
  launcherArtUrl,
  ON_DEMAND_PLAN,
  PREWARM_PLAN,
  prefetchLauncherArt,
  rememberLauncherArtSource,
  resetLauncherArtForTests,
  type LauncherArtDeps,
} from "./desktop-launcher-art";

function rememberAlbums(count: number): string[] {
  return Array.from({ length: count }, (_, i) => {
    const key = `album:${i + 1}`;
    rememberLauncherArtSource(key, {
      kind: "album",
      input: { albumId: i + 1 },
    });
    return key;
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const okImage = () =>
  new Response(new Blob([new Uint8Array([1, 2, 3])]), { status: 200 });

function deps(overrides: Partial<LauncherArtDeps> = {}) {
  return {
    authorize: vi.fn((url: string) =>
      Promise.resolve(`${url}&media_ticket=SECRET`),
    ),
    fetch: vi.fn(() =>
      Promise.resolve(
        new Response(new Blob([new Uint8Array([1, 2, 3])]), { status: 200 }),
      ),
    ),
    toSquare: vi.fn(() =>
      Promise.resolve(new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])])),
    ),
    store: vi.fn(() => Promise.resolve(true)),
    ...overrides,
  } satisfies LauncherArtDeps;
}

describe("launcher art", () => {
  afterEach(() => resetLauncherArtForTests());

  it("keys art by entity id, never by URL", () => {
    expect(albumArtKey({ albumId: 11, globalAlbumUid: "g1" })).toBe("album:11");
    expect(albumArtKey({ globalAlbumUid: "g-1" })).toBe("album:g:g-1");
    expect(albumArtKey({ albumEntityUid: "e_1" })).toBe("album:e:e_1");
    expect(artistArtKey({ artistId: 3 })).toBe("artist:3");
    expect(artistArtKey({})).toBeNull();
    expect(albumArtKey({ globalAlbumUid: "https://x/y?ticket=1" })).toBeNull();
  });

  it("asks for a 256 px image of the album or the artist", () => {
    expect(launcherArtUrl({ kind: "album", input: { albumId: 11 } })).toContain(
      "/api/albums/11/cover",
    );
    expect(launcherArtUrl({ kind: "album", input: { albumId: 11 } })).toMatch(
      /size=256/,
    );
    expect(
      launcherArtUrl({ kind: "artist", input: { artistId: 3 } }),
    ).toContain("/api/artists/3/photo");
  });

  it("fetches missing art with the session and hands only bytes to the shell", async () => {
    rememberLauncherArtSource("album:11", {
      kind: "album",
      input: { albumId: 11 },
    });
    const d = deps();
    await prefetchLauncherArt(["album:11", "album:12", 7, "x"], d);

    expect(d.authorize).toHaveBeenCalledTimes(1);
    expect(d.fetch).toHaveBeenCalledWith(
      expect.stringContaining("media_ticket=SECRET"),
      expect.objectContaining({ priority: "high" }),
    );
    expect(d.toSquare).toHaveBeenCalledWith(expect.any(Blob), 256);
    expect(d.store).toHaveBeenCalledWith("album:11", [0xff, 0xd8, 0xff, 0xe0]);
    expect(JSON.stringify(vi.mocked(d.store).mock.calls)).not.toMatch(
      /SECRET|http|\/api/,
    );
  });

  it("drops failures and does not fetch a key twice at once", async () => {
    rememberLauncherArtSource("artist:3", {
      kind: "artist",
      input: { artistId: 3 },
    });
    let release: (r: Response) => void = () => {};
    const d = deps({
      fetch: vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            release = resolve;
          }),
      ),
    });
    const first = prefetchLauncherArt(["artist:3"], d);
    await prefetchLauncherArt(["artist:3"], d);
    await vi.waitFor(() => expect(d.fetch).toHaveBeenCalledTimes(1));
    release(new Response(null, { status: 404 }));
    await first;
    expect(d.store).not.toHaveBeenCalled();

    const failing = deps({ authorize: vi.fn().mockRejectedValue(new Error()) });
    await expect(
      prefetchLauncherArt(["artist:3"], failing),
    ).resolves.toBeUndefined();
    expect(failing.store).not.toHaveBeenCalled();

    const undecodable = deps({ toSquare: vi.fn().mockResolvedValue(null) });
    await prefetchLauncherArt(["artist:3"], undecodable);
    expect(undecodable.store).not.toHaveBeenCalled();
    await expect(
      prefetchLauncherArt(undefined, deps()),
    ).resolves.toBeUndefined();
  });

  it("authorizes every miss of a search at once, before fetching", async () => {
    const keys = rememberAlbums(6);
    const events: string[] = [];
    const d = deps({
      authorize: vi.fn((url: string) => {
        events.push("authorize");
        return Promise.resolve(url);
      }),
      fetch: vi.fn(() => {
        events.push("fetch");
        return Promise.resolve(okImage());
      }),
    });
    await prefetchLauncherArt(keys, d);
    expect(events.slice(0, 6)).toEqual(Array(6).fill("authorize"));
    expect(d.store).toHaveBeenCalledTimes(6);
  });

  it("fetches a search's misses four at a time", async () => {
    const keys = rememberAlbums(10);
    let running = 0;
    let peak = 0;
    const d = deps({
      fetch: vi.fn(async () => {
        running += 1;
        peak = Math.max(peak, running);
        await new Promise((resolve) => setTimeout(resolve, 5));
        running -= 1;
        return okImage();
      }),
    });
    await prefetchLauncherArt(keys, d);
    expect(ON_DEMAND_PLAN.concurrency).toBe(4);
    expect(peak).toBe(4);
    expect(d.store).toHaveBeenCalledTimes(10);
    expect(d.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ priority: "high" }),
    );
  });

  it("reuses an image the webview already loaded before refetching", async () => {
    const [key] = rememberAlbums(1);
    const loaded =
      "https://music.example/api/albums/1/cover?size=512&media_ticket=T";
    const d = deps({ loadedImage: vi.fn(() => loaded) });
    await prefetchLauncherArt([key], d);
    expect(d.fetch).toHaveBeenCalledTimes(1);
    expect(d.fetch).toHaveBeenCalledWith(
      loaded,
      expect.objectContaining({ cache: "force-cache" }),
    );
    expect(d.authorize).not.toHaveBeenCalled();
    expect(d.store).toHaveBeenCalledWith(key, expect.any(Array));

    // a stale reuse falls back to a fresh, authorized 256 px fetch
    resetLauncherArtForTests();
    rememberAlbums(1);
    const stale = deps({
      loadedImage: vi.fn(() => loaded),
      fetch: vi.fn((url: string) =>
        Promise.resolve(
          url === loaded ? new Response(null, { status: 403 }) : okImage(),
        ),
      ),
    });
    await prefetchLauncherArt([key], stale);
    expect(stale.fetch).toHaveBeenCalledTimes(2);
    expect(stale.authorize).toHaveBeenCalledTimes(1);
    expect(stale.store).toHaveBeenCalledTimes(1);
  });

  it("finds the smallest loaded copy of the same image at 256 px or more", () => {
    const base = "https://music.example/api/albums/1/cover";
    const entries = [
      { name: `${base}?size=128&v=2&media_ticket=a` },
      { name: `${base}?size=1024&v=2&media_ticket=b` },
      { name: `${base}?size=512&v=2&format=webp&media_ticket=c` },
      { name: `${base}?size=320&v=1&media_ticket=old-version` },
      { name: "https://music.example/api/albums/2/cover?size=256&v=2" },
      { name: "not a url" },
    ];
    expect(findLoadedImage(`${base}?size=256&v=2`, entries)).toBe(
      `${base}?size=512&v=2&format=webp&media_ticket=c`,
    );
    expect(findLoadedImage(`${base}?size=256&v=3`, entries)).toBeNull();
    expect(
      findLoadedImage(
        "https://music.example/api/albums/9/cover?size=256",
        entries,
      ),
    ).toBeNull();
  });

  it("prewarms at low priority, two at a time, yielding between images", async () => {
    const keys = rememberAlbums(6);
    let running = 0;
    let peak = 0;
    const pause = vi.fn(() => Promise.resolve());
    const d = deps({
      fetch: vi.fn(async () => {
        running += 1;
        peak = Math.max(peak, running);
        await new Promise((resolve) => setTimeout(resolve, 2));
        running -= 1;
        return okImage();
      }),
    });
    await prefetchLauncherArt(keys, d, { ...PREWARM_PLAN, pause });
    expect(PREWARM_PLAN.concurrency).toBe(2);
    expect(peak).toBe(2);
    expect(pause).toHaveBeenCalledTimes(6);
    expect(d.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ priority: "low" }),
    );
  });

  it("lets a search fetch a key the prewarm has queued but not started", async () => {
    const keys = rememberAlbums(3);
    const gate = deferred<void>();
    const prewarm = deps({
      fetch: vi.fn(async () => {
        await gate.promise;
        return okImage();
      }),
    });
    const background = prefetchLauncherArt(keys, prewarm, {
      ...PREWARM_PLAN,
      concurrency: 1,
      pause: () => Promise.resolve(),
    });
    const search = deps();
    await prefetchLauncherArt([keys[2]], search);
    expect(search.store).toHaveBeenCalledWith(keys[2], expect.any(Array));
    gate.resolve();
    await background;
    // the prewarm skips what the search already stored
    expect(vi.mocked(prewarm.store).mock.calls.map(([key]) => key)).toEqual([
      keys[0],
      keys[1],
    ]);
  });

  it("stops a prewarm when its signal aborts", async () => {
    const keys = rememberAlbums(4);
    const controller = new AbortController();
    const d = deps({
      fetch: vi.fn(async () => {
        controller.abort();
        return okImage();
      }),
    });
    await prefetchLauncherArt(
      keys,
      d,
      { ...PREWARM_PLAN, concurrency: 1, pause: () => Promise.resolve() },
      controller.signal,
    );
    expect(d.fetch).toHaveBeenCalledTimes(1);
  });
});

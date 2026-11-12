import { afterEach, describe, expect, it, vi } from "vitest";

import {
  albumArtKey,
  artistArtKey,
  launcherArtUrl,
  prefetchLauncherArt,
  rememberLauncherArtSource,
  resetLauncherArtForTests,
  type LauncherArtDeps,
} from "./desktop-launcher-art";

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
});

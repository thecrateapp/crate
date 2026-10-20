import { beforeEach, expect, it, vi } from "vitest";
const { fetchMock, decodeMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  decodeMock: vi.fn(async () => {}),
}));
vi.mock("./offline-artwork-image", () => ({
  validateOfflineArtworkImage: decodeMock,
}));
import { offlineArtworkVersion } from "./offline-artwork-events";
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  apiFetch: fetchMock,
}));
import * as assets from "./offline-assets";
const ref = { key: "artwork:album:7", path: "/api/albums/7/cover" };
const stores = new Map<string, Map<string, Response>>();
const revoke = vi.fn();
const cacheUrl = (key: string | Request) =>
  new URL(typeof key === "string" ? key : key.url, window.location.origin).href;
beforeEach(() => {
  stores.clear();
  decodeMock.mockReset().mockResolvedValue(undefined);
  fetchMock.mockReset();
  revoke.mockReset();
  fetchMock.mockImplementation(
    async () =>
      new Response(new Uint8Array([137, 80, 78, 71, 1]), {
        headers: { "content-type": "image/png" },
      }),
  );
  vi.stubGlobal("caches", {
    open: async (name: string) => {
      let entries = stores.get(name);
      if (!entries) {
        entries = new Map();
        stores.set(name, entries);
      }
      return {
        match: async (key: string) => entries!.get(cacheUrl(key))?.clone(),
        put: async (key: string, value: Response) => {
          entries!.set(cacheUrl(key), value.clone());
        },
        delete: async (key: string | Request) => entries!.delete(cacheUrl(key)),
        keys: async () => [...entries!.keys()].map((url) => new Request(url)),
      };
    },
  });
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn(() => "blob:offline-cover"),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: revoke,
  });
});
it("downloads one shared cover per profile and can read it with the network gone", async () => {
  await assets.cacheOfflineArtwork("user-a", [ref, ref]);
  await assets.cacheOfflineArtwork("user-a", [ref]);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  fetchMock.mockRejectedValue(new Error("network offline"));
  const local = await assets.readOfflineArtwork("user-a", ref);
  expect(local?.src).toBe("blob:offline-cover");
  local?.release();
  expect(revoke).toHaveBeenCalledWith("blob:offline-cover");
  expect(await assets.readOfflineArtwork("user-b", ref)).toBeNull();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
it("rejects an authentication HTML response rather than caching it as a cover", async () => {
  fetchMock.mockResolvedValue(
    new Response("login", { headers: { "content-type": "text/html" } }),
  );
  await assets.cacheOfflineArtwork("user-a", [ref]);
  expect(await assets.readOfflineArtwork("user-a", ref)).toBeNull();
});
it("does not start or publish a cancelled image download", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    assets.cacheOfflineArtwork("user-a", [ref], controller.signal),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(fetchMock).not.toHaveBeenCalled();
  expect(await assets.readOfflineArtwork("user-a", ref)).toBeNull();
});
it("retains shared covers until their last item is removed and leaves audio untouched", async () => {
  await assets.cacheOfflineArtwork("user-a", [
    ref,
    { key: "artwork:album:8", path: "/api/albums/8/cover" },
  ]);
  const cache = [...stores.values()][0]!;
  cache.set("http://localhost:3000/api/tracks/audio", new Response("audio"));
  await assets.pruneOfflineArtwork("user-a", [
    { tracks: [{ album_id: 7 }] },
  ] as never);
  expect(await assets.readOfflineArtwork("user-a", ref)).not.toBeNull();
  expect(
    await assets.readOfflineArtwork("user-a", {
      key: "artwork:album:8",
      path: "/api/albums/8/cover",
    }),
  ).toBeNull();
  expect(cache.get("http://localhost:3000/api/tracks/audio")).toBeDefined();
  await assets.pruneOfflineArtwork("user-a", []);
  expect(await assets.readOfflineArtwork("user-a", ref)).toBeNull();
});
it("does not publish artwork cancelled while its response body is being read", async () => {
  const controller = new AbortController();
  fetchMock.mockResolvedValue({
    ok: true,
    headers: new Headers({ "content-type": "image/png" }),
    blob: async () => {
      controller.abort();
      return new Blob(["image"], { type: "image/png" });
    },
  });
  await expect(
    assets.cacheOfflineArtwork("user-a", [ref], controller.signal),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(await assets.readOfflineArtwork("user-a", ref)).toBeNull();
});
it.each([0, 2 * 1024 * 1024 + 1])(
  "does not store an image body of %s bytes",
  async (size) => {
    fetchMock.mockResolvedValue(
      new Response(new Uint8Array(size), {
        headers: { "content-type": "image/png" },
      }),
    );
    await assets.cacheOfflineArtwork("user-a", [ref]);
    expect(await assets.readOfflineArtwork("user-a", ref)).toBeNull();
  },
);

it("does not retain an undecodable image-labelled response and accepts a later valid retry", async () => {
  decodeMock.mockRejectedValueOnce(new Error("Invalid image"));
  await assets.cacheOfflineArtwork("user-a", [ref]);
  expect(await assets.readOfflineArtwork("user-a", ref)).toBeNull();
  await assets.cacheOfflineArtwork("user-a", [ref]);
  expect((await assets.readOfflineArtwork("user-a", ref))?.src).toBe(
    "blob:offline-cover",
  );
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
it("does not invalidate an album lease when another cover changes or pruning removes nothing", async () => {
  await assets.cacheOfflineArtwork("user-a", [ref]);
  const before = offlineArtworkVersion("user-a", ref.key);
  await assets.cacheOfflineArtwork("user-a", [
    { key: "artwork:album:8", path: "/api/albums/8/cover" },
  ]);
  await assets.pruneOfflineArtwork("user-a", [
    { tracks: [{ album_id: 7 }, { album_id: 8 }] },
  ] as never);
  expect(offlineArtworkVersion("user-a", ref.key)).toBe(before);
});
it("evicts a persisted broken cover so the next sync can replace it", async () => {
  const { discardOfflineArtwork } = await import("./offline-artwork");
  await assets.cacheOfflineArtwork("user-a", [ref]);
  await discardOfflineArtwork("user-a", ref);
  expect(await assets.readOfflineArtwork("user-a", ref)).toBeNull();
  await assets.cacheOfflineArtwork("user-a", [ref]);
  expect((await assets.readOfflineArtwork("user-a", ref))?.src).toBe(
    "blob:offline-cover",
  );
});

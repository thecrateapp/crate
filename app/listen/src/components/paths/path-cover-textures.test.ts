import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CoverBitmapCache,
  createCoverLoader,
  decodeCoverBitmap,
  dominantColorFromPixels,
} from "./path-cover-textures";

const bitmap = (width = 512, height = 512) =>
  ({ width, height, close: vi.fn() }) as unknown as ImageBitmap;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("cover textures", () => {
  it("centre-crops covers to a square texture", async () => {
    const source = bitmap(800, 600),
      cropped = bitmap();
    const decode = vi
      .fn()
      .mockResolvedValueOnce(source)
      .mockResolvedValueOnce(cropped);
    vi.stubGlobal("createImageBitmap", decode);
    await expect(decodeCoverBitmap(new Blob(["x"]))).resolves.toBe(cropped);
    expect(decode).toHaveBeenLastCalledWith(source, 100, 0, 600, 600, {
      resizeWidth: 512,
      resizeHeight: 512,
      resizeQuality: "high",
    });
    expect(source.close).toHaveBeenCalled();
  });

  it("fetches through the resolved media URL and turns failures into null", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue(bitmap()));
    const request = vi
      .fn()
      .mockResolvedValueOnce(new Response("cover bytes"))
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockRejectedValueOnce(new Error("offline"));
    const load = createCoverLoader(
      async (url) => `${url}?media_ticket=t`,
      "omit",
      request,
    );
    await expect(load("/api/albums/1/cover")).resolves.not.toBeNull();
    expect(request).toHaveBeenCalledWith("/api/albums/1/cover?media_ticket=t", {
      credentials: "omit",
    });
    await expect(load("/api/albums/2/cover")).resolves.toBeNull();
    await expect(load("/api/albums/3/cover")).resolves.toBeNull();
  });

  it("deduplicates requests and closes evicted bitmaps", async () => {
    const bitmaps = new Map<string, ImageBitmap>();
    const load = vi.fn(async (url: string) => {
      const value = bitmap();
      bitmaps.set(url, value);
      return value;
    });
    const cache = new CoverBitmapCache(load, 2);
    await Promise.all([cache.request("a"), cache.request("a")]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(cache.peek("a")).toBe(bitmaps.get("a"));
    await cache.request("b");
    await cache.request("a"); // touch: "b" is now the oldest
    await cache.request("c");
    expect(cache.peek("b")).toBeUndefined();
    expect(bitmaps.get("b")!.close).toHaveBeenCalled();
    expect(cache.peek("a")).toBe(bitmaps.get("a"));
    cache.clear();
    expect(bitmaps.get("a")!.close).toHaveBeenCalled();
    expect(bitmaps.get("c")!.close).toHaveBeenCalled();
  });

  it("retries failed loads instead of caching the failure", async () => {
    const value = bitmap();
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(value);
    const cache = new CoverBitmapCache(load);
    await expect(cache.request("a")).resolves.toBeNull();
    expect(cache.peek("a")).toBeUndefined();
    await expect(cache.request("a")).resolves.toBeNull();
    await expect(cache.request("a")).resolves.toBe(value);
    expect(load).toHaveBeenCalledTimes(3);
    expect(cache.peek("a")).toBe(value);
  });

  it("closes a bitmap that finishes decoding after its entry was evicted", async () => {
    let resolve!: (value: ImageBitmap) => void;
    const late = bitmap();
    const cache = new CoverBitmapCache(
      (url) =>
        url === "slow"
          ? new Promise((done) => (resolve = done))
          : Promise.resolve(bitmap()),
      1,
    );
    const slow = cache.request("slow");
    await cache.request("fast");
    resolve(late);
    await expect(slow).resolves.toBeNull();
    expect(late.close).toHaveBeenCalled();
  });

  it("weights saturated colour over greys", () => {
    const pixels = new Uint8ClampedArray([
      255, 0, 0, 255, 128, 128, 128, 255, 120, 120, 120, 255,
    ]);
    expect(dominantColorFromPixels(pixels)).toMatch(/^rgb\((2[0-9]{2}) /);
    expect(dominantColorFromPixels(new Uint8ClampedArray())).toBe(
      "transparent",
    );
  });
});

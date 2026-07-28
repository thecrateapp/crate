import { describe, expect, it, vi } from "vitest";

import { cacheWebOfflineAsset, hasWebOfflineAsset } from "@/lib/offline-web";

describe("web offline media adapter", () => {
  it("checks every canonical alias without refetching", async () => {
    const match = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(new Response("cached"));

    await expect(
      hasWebOfflineAsset({ match }, [
        "/api/by-entity/one",
        "/api/by-storage/two",
      ]),
    ).resolves.toBe(true);
    expect(match).toHaveBeenCalledTimes(2);
  });

  it("validates expected bytes before caching", async () => {
    const put = vi.fn();
    const response = new Response("abc", {
      status: 200,
      headers: { "content-length": "3" },
    });

    await cacheWebOfflineAsset(
      { match: vi.fn(async () => undefined), put },
      "/api/tracks/one/stream",
      async () => response,
      3,
    );

    expect(put).toHaveBeenCalledTimes(1);
    await expect(
      cacheWebOfflineAsset(
        { match: vi.fn(async () => undefined), put },
        "/api/tracks/two/stream",
        async () => response,
        4,
      ),
    ).rejects.toThrow("integrity");
  });
});

import { describe, expect, it, vi } from "vitest";

const cacheNativeTrackAssetMock = vi.hoisted(() => vi.fn(async () => {}));

vi.mock("@/lib/capacitor-runtime", () => ({
  isIosBrowser: false,
  isNative: true,
}));

vi.mock("@/lib/offline-native-assets", () => ({
  cacheNativeTrackAsset: cacheNativeTrackAssetMock,
  clearNativeOfflineAssets: vi.fn(),
  deleteNativeCachedTrackAsset: vi.fn(),
  estimateNativeOfflineBytes: vi.fn(),
  getNativeOfflinePlaybackUrl: vi.fn(),
  hasCachedNativeTrackAssets: vi.fn(),
  offlineTrackFromIdentity: vi.fn(),
}));

import { cacheTrackAsset } from "@/lib/offline-assets";

describe("native offline asset caching", () => {
  it("forwards profile cancellation to the native transfer", async () => {
    const controller = new AbortController();
    const track = {
      entity_uid: "track-1",
      title: "Track",
      artist: "Artist",
      stream_url: "/stream/track-1",
      download_url: "/download/track-1",
    };

    await cacheTrackAsset("profile", track, controller.signal);

    expect(cacheNativeTrackAssetMock).toHaveBeenCalledWith(
      "profile",
      track,
      controller.signal,
    );
  });
});

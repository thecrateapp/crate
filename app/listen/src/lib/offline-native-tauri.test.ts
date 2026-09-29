import { beforeEach, describe, expect, it, vi } from "vitest";

const { verifyAssetsMock, invokeMock, statMock } = vi.hoisted(() => ({
  verifyAssetsMock: vi.fn(),
  invokeMock: vi.fn(),
  statMock: vi.fn(),
}));

vi.mock("@capacitor/core", () => ({
  registerPlugin: () => ({ verifyAssets: verifyAssetsMock }),
}));
vi.mock("@capacitor/filesystem", () => ({
  Directory: { Data: "DATA" },
  Filesystem: { stat: statMock, deleteFile: vi.fn() },
}));
vi.mock("@/lib/platform", () => ({ isTauriRuntime: true }));

import { verifyNativeOfflineAssets } from "@/lib/offline-native";

describe("Tauri offline asset verification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.__crateTauriInvoke = invokeMock;
  });

  it("verifies one profile batch in a single scoped Rust command", async () => {
    invokeMock.mockResolvedValue([
      {
        path: "offline-media/profile-a/one.m4a",
        exists: true,
        size: 128,
        valid: true,
      },
      {
        path: "offline-media/profile-a/two.m4a",
        exists: false,
        size: 0,
        valid: false,
      },
    ]);

    const result = await verifyNativeOfflineAssets([
      { path: "offline-media/profile-a/one.m4a", expectedBytes: 128 },
      { path: "offline-media/profile-a/two.m4a", expectedBytes: 256 },
    ]);

    expect(invokeMock).toHaveBeenCalledWith("verify_offline_media_assets", {
      profileKey: "profile-a",
      assets: [
        { path: "offline-media/profile-a/one.m4a", expectedBytes: 128 },
        { path: "offline-media/profile-a/two.m4a", expectedBytes: 256 },
      ],
    });
    expect(result.map((asset) => asset.valid)).toEqual([true, false]);
    expect(verifyAssetsMock).not.toHaveBeenCalled();
    expect(statMock).not.toHaveBeenCalled();
  });
});

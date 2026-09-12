import { beforeEach, describe, expect, it, vi } from "vitest";

const { writeFileMock, readFileMock } = vi.hoisted(() => ({
  writeFileMock: vi.fn(),
  readFileMock: vi.fn(),
}));

vi.mock(import("@capacitor/core"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    Capacitor: {
      ...actual.Capacitor,
      isNativePlatform: () => true,
      getPlatform: () => "android",
    },
  };
});

vi.mock("@capacitor/filesystem", () => ({
  Directory: { Data: "DATA" },
  Encoding: { UTF8: "utf8" },
  Filesystem: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    readFile: readFileMock,
    writeFile: writeFileMock,
  },
}));

import { updateOfflineNativeAssetIndex } from "@/lib/offline-storage";

describe("updateOfflineNativeAssetIndex (native)", () => {
  let writtenFiles: Map<string, string>;
  let writeDelays: number[];

  beforeEach(() => {
    writtenFiles = new Map();
    writeDelays = [];
    readFileMock.mockImplementation(async ({ path }: { path: string }) => ({
      data: writtenFiles.get(path) ?? null,
    }));
    writeFileMock.mockImplementation(
      async ({ path, data }: { path: string; data: string }) => {
        // Simulate slow disk I/O: whichever write is issued first can
        // still take longer than one issued after it. Without reading
        // fresh from inside the serialized write slot, that lets an
        // earlier-issued write finish last and silently revert whatever
        // a later, faster mutation for a different key already wrote.
        const delay = writeDelays.shift() ?? 0;
        if (delay > 0)
          await new Promise((resolve) => setTimeout(resolve, delay));
        writtenFiles.set(path, data);
      },
    );
  });

  it("keeps both mutations even when the first-issued write finishes last", async () => {
    writeDelays = [20, 0];

    const trackA = updateOfflineNativeAssetIndex("profile-1", (current) => ({
      ...current,
      trackA: { assetKey: "trackA" } as never,
    }));
    const trackB = updateOfflineNativeAssetIndex("profile-1", (current) => ({
      ...current,
      trackB: { assetKey: "trackB" } as never,
    }));

    await Promise.all([trackA, trackB]);

    const finalRaw = writtenFiles.get(
      "offline-meta/offline-assets-profile-1.json",
    );
    const final = JSON.parse(finalRaw ?? "{}");
    expect(final).toHaveProperty("trackA");
    expect(final).toHaveProperty("trackB");
  });
});

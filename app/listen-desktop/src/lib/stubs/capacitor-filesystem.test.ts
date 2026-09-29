import { beforeEach, describe, expect, it, vi } from "vitest";

const { appLocalDataDirMock, fsMocks, joinMock } = vi.hoisted(() => ({
  appLocalDataDirMock: vi.fn(),
  fsMocks: {
    mkdir: vi.fn(),
    readTextFile: vi.fn(),
    remove: vi.fn(),
    rename: vi.fn(),
    stat: vi.fn(),
    writeTextFile: vi.fn(),
  },
  joinMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/path", () => ({
  BaseDirectory: { AppLocalData: "APP_LOCAL_DATA" },
  appLocalDataDir: appLocalDataDirMock,
  join: joinMock,
}));

vi.mock("@tauri-apps/plugin-fs", () => fsMocks);

import { Directory, Filesystem } from "./capacitor-filesystem";

describe("Tauri Capacitor Filesystem adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    appLocalDataDirMock.mockResolvedValue("/app/local-data");
    joinMock.mockImplementation(async (...parts: string[]) => parts.join("/"));
  });

  it("exposes the rename contract used by shared offline storage", async () => {
    await Filesystem.rename({
      from: "offline-meta/index.json.next",
      to: "offline-meta/index.json",
      directory: Directory.Data,
      toDirectory: Directory.Data,
    });

    expect(fsMocks.rename).toHaveBeenCalledWith(
      "offline-meta/index.json.next",
      "offline-meta/index.json",
      {
        oldPathBaseDir: "APP_LOCAL_DATA",
        newPathBaseDir: "APP_LOCAL_DATA",
      },
    );
  });

  it("exposes the URI lookup contract used by shared offline storage", async () => {
    await expect(
      Filesystem.getUri({
        path: "offline-media/profile/song.m4a",
        directory: Directory.Data,
      }),
    ).resolves.toEqual({
      uri: "/app/local-data/offline-media/profile/song.m4a",
    });
  });
});

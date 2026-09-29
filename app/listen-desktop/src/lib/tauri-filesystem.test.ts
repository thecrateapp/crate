import { beforeEach, describe, expect, it, vi } from "vitest";

const { appLocalDataDirMock, fsMocks, joinMock } = vi.hoisted(() => ({
  appLocalDataDirMock: vi.fn(),
  joinMock: vi.fn(),
  fsMocks: {
    mkdir: vi.fn(),
    readTextFile: vi.fn(),
    remove: vi.fn(),
    rename: vi.fn(),
    stat: vi.fn(),
    writeTextFile: vi.fn(),
  },
}));

vi.mock("@tauri-apps/api/path", () => ({
  BaseDirectory: { AppLocalData: "APP_LOCAL_DATA" },
  appLocalDataDir: appLocalDataDirMock,
  join: joinMock,
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  mkdir: fsMocks.mkdir,
  readTextFile: fsMocks.readTextFile,
  remove: fsMocks.remove,
  rename: fsMocks.rename,
  stat: fsMocks.stat,
  writeTextFile: fsMocks.writeTextFile,
}));

import {
  downloadFile,
  getFileUri,
  mkdir,
  readFile,
  remove,
  rename,
  stat,
  writeFile,
} from "./tauri-filesystem";

describe("Tauri filesystem adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    appLocalDataDirMock.mockResolvedValue("/app/local-data");
    joinMock.mockImplementation(async (...parts: string[]) => parts.join("/"));
    fsMocks.stat.mockResolvedValue({ size: 42 });
  });

  it("maps Capacitor Data operations to Tauri AppLocalData", async () => {
    await mkdir("offline-meta", { recursive: true });
    await writeFile("offline-meta/index.json", "{}", { recursive: true });
    await readFile("offline-meta/index.json");
    await remove("offline-meta/index.json");

    expect(fsMocks.mkdir).toHaveBeenCalledWith("offline-meta", {
      baseDir: "APP_LOCAL_DATA",
      recursive: true,
    });
    expect(fsMocks.writeTextFile).toHaveBeenCalledWith(
      "offline-meta/index.json",
      "{}",
      { baseDir: "APP_LOCAL_DATA" },
    );
    expect(fsMocks.readTextFile).toHaveBeenCalledWith(
      "offline-meta/index.json",
      {
        baseDir: "APP_LOCAL_DATA",
      },
    );
    expect(fsMocks.remove).toHaveBeenCalledWith("offline-meta/index.json", {
      baseDir: "APP_LOCAL_DATA",
    });
  });

  it("renames metadata within the app-local directory", async () => {
    await rename("offline-meta/index.json.next", "offline-meta/index.json");

    expect(fsMocks.rename).toHaveBeenCalledWith(
      "offline-meta/index.json.next",
      "offline-meta/index.json",
      {
        oldPathBaseDir: "APP_LOCAL_DATA",
        newPathBaseDir: "APP_LOCAL_DATA",
      },
    );
  });

  it("returns an absolute locator for the asset protocol", async () => {
    await expect(getFileUri("offline-media/profile/song.m4a")).resolves.toBe(
      "/app/local-data/offline-media/profile/song.m4a",
    );
    await expect(stat("offline-media/profile/song.m4a")).resolves.toEqual({
      size: 42,
      uri: "/app/local-data/offline-media/profile/song.m4a",
    });
    expect(appLocalDataDirMock).toHaveBeenCalledOnce();
  });

  it("retries resolving AppLocalData after a failed lookup", async () => {
    vi.resetModules();
    appLocalDataDirMock
      .mockRejectedValueOnce(new Error("profile unavailable"))
      .mockResolvedValueOnce("/app/local-data");
    const filesystem = await import("./tauri-filesystem");

    await expect(
      filesystem.getFileUri("offline-media/profile/song.m4a"),
    ).rejects.toThrow("profile unavailable");
    await expect(
      filesystem.getFileUri("offline-media/profile/song.m4a"),
    ).resolves.toBe("/app/local-data/offline-media/profile/song.m4a");
    expect(appLocalDataDirMock).toHaveBeenCalledTimes(2);
  });

  it("rejects unscoped downloads so callers use the transfer registry", async () => {
    await expect(
      downloadFile(
        "https://crate.test/stream",
        "offline-media/profile/song.m4a",
        { Authorization: "Bearer token" },
      ),
    ).rejects.toThrow("require a scoped transfer");
  });

  it("rejects paths that escape app-local storage", async () => {
    await expect(getFileUri("offline-media/../outside.mp3")).rejects.toThrow(
      "Invalid Tauri offline path",
    );
  });

  it.each([
    "The system cannot find the file specified. (os error 2)",
    "The system cannot find the path specified. (os error 3)",
  ])("normalizes Windows missing-file error %s", async (message) => {
    fsMocks.readTextFile.mockRejectedValue(new Error(message));

    await expect(readFile("offline-meta/index.json")).rejects.toMatchObject({
      code: "OS-PLUG-FILE-0008",
      message: "File not found",
    });
  });

  it("preserves non-missing filesystem errors", async () => {
    fsMocks.readTextFile.mockRejectedValue(new Error("Permission denied"));

    await expect(readFile("offline-meta/index.json")).rejects.toThrow(
      "Permission denied",
    );
  });
});

import { appLocalDataDir, BaseDirectory, join } from "@tauri-apps/api/path";
import { invoke } from "@tauri-apps/api/core";
import {
  mkdir as tauriMkdir,
  readTextFile,
  remove as tauriRemove,
  rename as tauriRename,
  stat as tauriStat,
  writeTextFile,
} from "@tauri-apps/plugin-fs";

const appLocalDataBase = BaseDirectory.AppLocalData;
const FILE_NOT_FOUND_CODE = "OS-PLUG-FILE-0008";

interface PathOptions {
  directory?: string;
}

function relativePath(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/^\/+/, "");
  if (
    !normalized ||
    normalized.split("/").some((segment: string) => segment === "..")
  ) {
    throw new Error("Invalid Tauri offline path");
  }
  return normalized;
}

function baseDir(_directory?: string): BaseDirectory {
  return appLocalDataBase;
}

async function absolutePath(path: string): Promise<string> {
  return join(await appLocalDataDir(), relativePath(path));
}

function normalizeFileSystemError(error: unknown): unknown {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === FILE_NOT_FOUND_CODE
  ) {
    return error;
  }

  const message = error instanceof Error ? error.message : String(error);
  if (!/\bos error (?:2|3)\b/i.test(message)) return error;

  return Object.assign(new Error("File not found"), {
    code: FILE_NOT_FOUND_CODE,
  });
}

async function withNormalizedFileSystemError<T>(
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw normalizeFileSystemError(error);
  }
}

export async function mkdir(
  path: string,
  options: PathOptions & { recursive?: boolean } = {},
): Promise<void> {
  await withNormalizedFileSystemError(() =>
    tauriMkdir(relativePath(path), {
      baseDir: baseDir(options.directory),
      recursive: options.recursive,
    }),
  );
}

export async function readFile(
  path: string,
  options: PathOptions = {},
): Promise<{ data: string }> {
  return {
    data: await withNormalizedFileSystemError(() =>
      readTextFile(relativePath(path), {
        baseDir: baseDir(options.directory),
      }),
    ),
  };
}

export async function writeFile(
  path: string,
  data: string,
  options: PathOptions & { recursive?: boolean } = {},
): Promise<void> {
  await withNormalizedFileSystemError(() =>
    writeTextFile(relativePath(path), data, {
      baseDir: baseDir(options.directory),
    }),
  );
}

export async function stat(
  path: string,
  options: PathOptions = {},
): Promise<{ size: number; uri: string }> {
  const normalized = relativePath(path);
  const info = await withNormalizedFileSystemError(() =>
    tauriStat(normalized, {
      baseDir: baseDir(options.directory),
    }),
  );
  return { size: info.size, uri: await absolutePath(normalized) };
}

export async function getFileUri(
  path: string,
  _options: PathOptions = {},
): Promise<string> {
  return absolutePath(path);
}

export async function remove(
  path: string,
  options: PathOptions = {},
): Promise<void> {
  await withNormalizedFileSystemError(() =>
    tauriRemove(relativePath(path), {
      baseDir: baseDir(options.directory),
    }),
  );
}

export async function rename(
  from: string,
  to: string,
  options: PathOptions & { toDirectory?: string } = {},
): Promise<void> {
  await withNormalizedFileSystemError(() =>
    tauriRename(relativePath(from), relativePath(to), {
      oldPathBaseDir: baseDir(options.directory),
      newPathBaseDir: baseDir(options.toDirectory ?? options.directory),
    }),
  );
}

export async function downloadFile(
  url: string,
  path: string,
  headers?: Record<string, string>,
  _options: PathOptions = {},
): Promise<{ path: string }> {
  const normalized = relativePath(path);
  if (!normalized.startsWith("offline-media/")) {
    throw new Error("Invalid Tauri offline media path");
  }

  const target = await withNormalizedFileSystemError(() =>
    invoke<string>("download_offline_media", {
      url,
      path: normalized,
      headers: headers ?? {},
    }),
  );
  return { path: target };
}

import {
  downloadFile,
  getFileUri,
  mkdir,
  readFile,
  remove,
  rename,
  stat,
  writeFile,
} from "../tauri-filesystem";

export enum Directory {
  Data = "DATA",
  Documents = "DOCUMENTS",
  Cache = "CACHE",
}

export enum Encoding {
  UTF8 = "utf8",
}

interface FilesystemPathOptions {
  path: string;
  directory?: Directory;
}

interface FilesystemWriteOptions extends FilesystemPathOptions {
  data: string;
  encoding?: Encoding;
  recursive?: boolean;
}

interface FilesystemReadOptions extends FilesystemPathOptions {
  encoding?: Encoding;
}

interface FilesystemRenameOptions {
  from: string;
  to: string;
  directory?: Directory;
  toDirectory?: Directory;
}

interface FilesystemDownloadOptions extends FilesystemPathOptions {
  url: string;
  headers?: Record<string, string>;
  recursive?: boolean;
}

export const Filesystem = {
  mkdir: (
    options: FilesystemPathOptions & { recursive?: boolean },
  ): Promise<void> => mkdir(options.path, options),
  readFile: (
    options: FilesystemReadOptions,
  ): Promise<{ data: string | Blob }> => readFile(options.path, options),
  writeFile: (options: FilesystemWriteOptions): Promise<void> =>
    writeFile(options.path, options.data, options),
  stat: (
    options: FilesystemPathOptions,
  ): Promise<{ size?: number; uri: string }> => stat(options.path, options),
  getUri: async (options: FilesystemPathOptions): Promise<{ uri: string }> => ({
    uri: await getFileUri(options.path, options),
  }),
  deleteFile: (options: FilesystemPathOptions): Promise<void> =>
    remove(options.path, options),
  rename: (options: FilesystemRenameOptions): Promise<void> =>
    rename(options.from, options.to, options),
  downloadFile: (
    options: FilesystemDownloadOptions,
  ): Promise<{ path?: string; blob?: Blob }> =>
    downloadFile(options.url, options.path, options.headers, options),
};

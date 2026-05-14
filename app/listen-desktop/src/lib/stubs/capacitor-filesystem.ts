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

interface FilesystemDownloadOptions extends FilesystemPathOptions {
  url: string;
  headers?: Record<string, string>;
  recursive?: boolean;
}

function unsupported(): Promise<never> {
  throw new Error("Capacitor Filesystem is not available in the Tauri shell");
}

export const Filesystem = {
  mkdir: (_options: FilesystemPathOptions & { recursive?: boolean }): Promise<void> => unsupported(),
  readFile: (_options: FilesystemReadOptions): Promise<{ data: string | Blob }> => unsupported(),
  writeFile: (_options: FilesystemWriteOptions): Promise<void> => unsupported(),
  stat: (
    _options: FilesystemPathOptions,
  ): Promise<{ size?: number; uri: string }> => unsupported(),
  deleteFile: (_options: FilesystemPathOptions): Promise<void> => unsupported(),
  downloadFile: (
    _options: FilesystemDownloadOptions,
  ): Promise<{ path?: string; blob?: Blob }> => unsupported(),
};

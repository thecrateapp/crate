import { registerPlugin } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";

export interface NativeOfflineAssetExpectation {
  path: string;
  expectedBytes?: number | null;
}

export interface NativeOfflineAssetVerification {
  path: string;
  exists: boolean;
  size: number;
  valid: boolean;
}

interface NativeOfflineIntegrityPlugin {
  verifyAssets(options: {
    assets: NativeOfflineAssetExpectation[];
  }): Promise<{ assets: NativeOfflineAssetVerification[] }>;
}

let nativeOfflineIntegrity: NativeOfflineIntegrityPlugin | null = null;

function getNativeOfflineIntegrity(): NativeOfflineIntegrityPlugin {
  nativeOfflineIntegrity ??= registerPlugin<NativeOfflineIntegrityPlugin>(
    "CrateOfflineIntegrity",
  );
  return nativeOfflineIntegrity;
}

async function verifyWithFilesystem(
  assets: NativeOfflineAssetExpectation[],
): Promise<NativeOfflineAssetVerification[]> {
  return Promise.all(
    assets.map(async ({ path, expectedBytes }) => {
      try {
        const stat = await Filesystem.stat({
          path,
          directory: Directory.Data,
        });
        const size = Math.max(0, Number(stat.size || 0));
        const expected = Math.max(0, Number(expectedBytes || 0));
        const valid = expected === 0 || size === 0 || size === expected;
        if (!valid) {
          await Filesystem.deleteFile({
            path,
            directory: Directory.Data,
          }).catch(() => undefined);
        }
        return { path, exists: true, size, valid };
      } catch {
        return { path, exists: false, size: 0, valid: false };
      }
    }),
  );
}

export async function verifyNativeOfflineAssets(
  assets: NativeOfflineAssetExpectation[],
): Promise<NativeOfflineAssetVerification[]> {
  if (!assets.length) return [];
  try {
    const response = await getNativeOfflineIntegrity().verifyAssets({ assets });
    if (response.assets.length === assets.length) return response.assets;
  } catch {
    // Older native shells fall back until the bridge upgrade is installed.
  }
  return verifyWithFilesystem(assets);
}

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
  excludeFromBackup(options: { path: string }): Promise<{ excluded: boolean }>;
  verifyAssets(options: {
    assets: NativeOfflineAssetExpectation[];
  }): Promise<{ assets: NativeOfflineAssetVerification[] }>;
}

export async function excludeNativeOfflineAssetFromBackup(
  path: string,
): Promise<void> {
  const result = await getNativeOfflineIntegrity().excludeFromBackup({ path });
  if (!result.excluded) {
    throw new Error("Offline asset could not be excluded from device backup");
  }
}

let nativeOfflineIntegrity: NativeOfflineIntegrityPlugin | null = null;
const NATIVE_INTEGRITY_BATCH_SIZE = 500;
const FILESYSTEM_VERIFY_CONCURRENCY = 8;

function getNativeOfflineIntegrity(): NativeOfflineIntegrityPlugin {
  nativeOfflineIntegrity ??= registerPlugin<NativeOfflineIntegrityPlugin>(
    "CrateOfflineIntegrity",
  );
  return nativeOfflineIntegrity;
}

async function verifyWithFilesystem(
  assets: NativeOfflineAssetExpectation[],
): Promise<NativeOfflineAssetVerification[]> {
  const results = new Array<NativeOfflineAssetVerification>(assets.length);
  let nextIndex = 0;
  const verifyNext = async () => {
    while (nextIndex < assets.length) {
      const index = nextIndex;
      nextIndex += 1;
      const { path, expectedBytes } = assets[index]!;
      try {
        const stat = await Filesystem.stat({
          path,
          directory: Directory.Data,
        });
        const size = Math.max(0, Number(stat.size || 0));
        const expected = Math.max(0, Number(expectedBytes || 0));
        // A 0-byte file is never a legitimately cached track — it means an
        // interrupted/truncated write, not one with no content. Matches the
        // same rule assertNativeTrackIntegrity applies right after a
        // download; without it, a corrupted cache entry would keep passing
        // this check forever and only fail once actual playback is attempted.
        const valid = size > 0 && (expected === 0 || size === expected);
        if (!valid) {
          await Filesystem.deleteFile({
            path,
            directory: Directory.Data,
          }).catch(() => undefined);
        }
        results[index] = { path, exists: true, size, valid };
      } catch {
        results[index] = { path, exists: false, size: 0, valid: false };
      }
    }
  };
  await Promise.all(
    Array.from(
      {
        length: Math.min(FILESYSTEM_VERIFY_CONCURRENCY, assets.length),
      },
      verifyNext,
    ),
  );
  return results;
}

async function verifyNativeOfflineAssetBatch(
  assets: NativeOfflineAssetExpectation[],
): Promise<NativeOfflineAssetVerification[]> {
  try {
    const response = await getNativeOfflineIntegrity().verifyAssets({ assets });
    if (response.assets.length === assets.length) return response.assets;
  } catch {
    // Older native shells fall back until the bridge upgrade is installed.
  }
  return verifyWithFilesystem(assets);
}

export async function verifyNativeOfflineAssets(
  assets: NativeOfflineAssetExpectation[],
): Promise<NativeOfflineAssetVerification[]> {
  if (!assets.length) return [];
  const batches: NativeOfflineAssetExpectation[][] = [];
  for (
    let index = 0;
    index < assets.length;
    index += NATIVE_INTEGRITY_BATCH_SIZE
  ) {
    batches.push(assets.slice(index, index + NATIVE_INTEGRITY_BATCH_SIZE));
  }
  const results = await Promise.all(batches.map(verifyNativeOfflineAssetBatch));
  return results.flat();
}

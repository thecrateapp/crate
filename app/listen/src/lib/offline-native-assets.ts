import { Capacitor } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";

import { api, apiUrl, getApiAuthHeaders } from "@/lib/api";
import {
  isAndroidNative,
  isIosNative,
  isNative,
} from "@/lib/capacitor-runtime";
import { recordDevLog } from "@/lib/dev-logs";
import {
  excludeNativeOfflineAssetFromBackup,
  verifyNativeOfflineAssets,
} from "@/lib/offline-native";
import type { PlaybackResolution } from "@/lib/track-playback";
import {
  getOfflineTrackAssetAliases,
  getOfflineTrackAssetKey,
  normalizeIdentityValue,
} from "@/lib/offline-track-identity";
import type {
  OfflineManifestTrack,
  OfflineNativeAssetRecord,
} from "./offline-model";
import {
  ensureOfflineNativeAssetIndexLoaded,
  getActiveOfflineProfileKey,
  loadOfflineNativeAssetIndex,
  updateOfflineNativeAssetIndex,
} from "./offline-storage";
import type { OfflineTrackIdentityInput } from "./offline-track-identity";

const ANDROID_OFFLINE_DELIVERY_POLICY = "balanced";
const FILESYSTEM_NOT_FOUND_CODE = "OS-PLUG-FILE-0008";

function isMissingNativeFileError(error: unknown): boolean {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === FILESYSTEM_NOT_FOUND_CODE
  ) {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  return /(?:does not exist|file not found)/i.test(message);
}

function throwIfOfflineTransferAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error("Offline transfer cancelled");
  error.name = "AbortError";
  throw error;
}

export async function hasCachedNativeTrackAssets(
  profileKey: string,
  tracks: OfflineManifestTrack[],
): Promise<Set<string>> {
  if (!tracks.length) return new Set();

  const assets = await ensureOfflineNativeAssetIndexLoaded(profileKey);
  const expectations: Array<{
    assetKey: string;
    aliases: string[];
    path: string;
    expectedBytes: number | null;
  }> = [];
  for (const track of tracks) {
    const assetKey = getOfflineTrackAssetKey(track);
    if (!assetKey) continue;
    const aliases = getOfflineTrackAssetAliases(track);
    const entry = aliases.map((alias) => assets[alias]).find(Boolean);
    if (!entry?.path || entry.state === "deleting") continue;
    expectations.push({
      assetKey,
      aliases,
      path: entry.path,
      expectedBytes: entry.byteLength ?? track.byte_length ?? null,
    });
  }

  const results = await verifyNativeOfflineAssets(
    expectations.map(({ path, expectedBytes }) => ({ path, expectedBytes })),
  );
  const found = new Set<string>();
  const staleAliases = new Set<string>();
  for (let index = 0; index < expectations.length; index += 1) {
    const expectation = expectations[index];
    const result = results[index];
    if (!expectation) continue;
    if (result?.exists && result.valid) {
      found.add(expectation.assetKey);
      continue;
    }
    for (const alias of expectation.aliases) staleAliases.add(alias);
  }
  if (staleAliases.size) {
    // The stat check above can take a while across many tracks — re-read
    // the index from inside the atomic update instead of reusing the
    // snapshot captured before it, so a concurrent cache/delete that
    // landed in the meantime isn't clobbered by this stale-entry prune.
    await updateOfflineNativeAssetIndex(profileKey, (current) => {
      const next = { ...current };
      let changed = false;
      for (const alias of staleAliases) {
        if (next[alias]) {
          delete next[alias];
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }
  return found;
}

export async function estimateNativeOfflineBytes(
  profileKey: string,
): Promise<number> {
  const assets = await ensureOfflineNativeAssetIndexLoaded(profileKey);
  return Object.values(assets).reduce(
    (total, asset) =>
      total +
      (asset.state === "deleting"
        ? 0
        : Math.max(0, Number(asset.byteLength || 0))),
    0,
  );
}

function normalizeAudioExtension(value?: string | null): string | null {
  const candidate = (value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
  if (!candidate) return null;
  if (candidate === "aac") return "m4a";
  return candidate;
}

function inferOfflineFileExtension(
  track: OfflineManifestTrack,
  formatOverride?: string | null,
): string {
  return (
    normalizeAudioExtension(formatOverride) ||
    normalizeAudioExtension(track.format) ||
    "bin"
  );
}

function safeOfflineFileStem(assetKey: string): string {
  const trimmed = assetKey.trim();
  return trimmed.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function expectedTrackBytes(track: OfflineManifestTrack): number {
  return Math.max(0, Number(track.byte_length || 0));
}

export async function assertNativeTrackIntegrity(
  path: string,
  expectedBytes?: number | null,
): Promise<{ uri: string; size: number }> {
  const stat = await Filesystem.stat({
    path,
    directory: Directory.Data,
  });
  const actualSize = Number(stat.size || 0);
  const expectedSize = Math.max(0, Number(expectedBytes ?? 0));
  // A 0-byte file is never a valid asset, even when we have no expected
  // size to compare against — it means a download that started and
  // produced an empty file, not one that legitimately has no content.
  const isValid =
    actualSize > 0 && (expectedSize === 0 || actualSize === expectedSize);
  if (!isValid) {
    await Filesystem.deleteFile({
      path,
      directory: Directory.Data,
    }).catch(() => {
      // best-effort cleanup on integrity failure
    });
    throw new Error("Offline copy failed integrity check");
  }
  return { uri: stat.uri, size: actualSize };
}

interface NativeOfflineDownloadTarget {
  streamUrl: string;
  extension: string;
  expectedBytes: number | null;
  effectivePolicy: string;
}

function nativePlaybackPathForTrack(
  track: OfflineManifestTrack,
): string | null {
  if (track.entity_uid) {
    return `/api/tracks/by-entity/${encodeURIComponent(
      track.entity_uid,
    )}/playback?delivery=${ANDROID_OFFLINE_DELIVERY_POLICY}`;
  }
  if (track.track_id) {
    return `/api/tracks/${encodeURIComponent(
      String(track.track_id),
    )}/playback?delivery=${ANDROID_OFFLINE_DELIVERY_POLICY}`;
  }
  return null;
}

function sourceNeedsMobileVariant(
  track: OfflineManifestTrack,
  resolution?: PlaybackResolution | null,
): boolean {
  const sourceFormat = normalizeAudioExtension(
    resolution?.source?.format || track.format,
  );
  const sourceBitrate = Number(
    resolution?.source?.bitrate || track.bitrate || 0,
  );
  const sourceSampleRate = Number(
    resolution?.source?.sample_rate || track.sample_rate || 0,
  );
  if (resolution?.source?.lossless) return true;
  if (!sourceFormat) return false;
  if (["flac", "wav", "alac", "aiff", "aif"].includes(sourceFormat))
    return true;
  if (["m4a", "mp3", "opus", "ogg"].includes(sourceFormat)) {
    return sourceBitrate > 256 || sourceSampleRate > 48_000;
  }
  return false;
}

async function resolveNativeOfflineDownloadTarget(
  track: OfflineManifestTrack,
): Promise<NativeOfflineDownloadTarget> {
  const fallback = {
    streamUrl: track.stream_url,
    extension: inferOfflineFileExtension(track),
    expectedBytes: expectedTrackBytes(track) || null,
    effectivePolicy: "original",
  };
  if (!isAndroidNative) return fallback;

  const playbackPath = nativePlaybackPathForTrack(track);
  if (!playbackPath) return fallback;

  let resolution: PlaybackResolution;
  try {
    resolution = await api<PlaybackResolution>(playbackPath);
  } catch {
    if (sourceNeedsMobileVariant(track)) {
      throw new Error("Could not prepare the Android offline copy");
    }
    return fallback;
  }

  if (resolution.preparing && sourceNeedsMobileVariant(track, resolution)) {
    throw new Error("Preparing the Android offline copy. Try again shortly.");
  }

  if (resolution.effective_policy === "original") return fallback;

  const deliveryFormat =
    resolution.delivery?.format || resolution.delivery?.codec;
  return {
    streamUrl: resolution.stream_url || track.stream_url,
    extension: inferOfflineFileExtension(track, deliveryFormat),
    expectedBytes: Number(resolution.delivery?.bytes || 0) || null,
    effectivePolicy: resolution.effective_policy,
  };
}

export async function cacheNativeTrackAsset(
  profileKey: string,
  track: OfflineManifestTrack,
  signal?: AbortSignal,
): Promise<void> {
  if (!isNative) return;
  throwIfOfflineTransferAborted(signal);
  const assetKey = getOfflineTrackAssetKey(track);
  if (!assetKey) {
    throw new Error("Offline copy requires entity_uid or storage_id");
  }
  const existingAssets = await ensureOfflineNativeAssetIndexLoaded(profileKey);
  throwIfOfflineTransferAborted(signal);
  const existing = getOfflineTrackAssetAliases(track)
    .map((alias) => existingAssets[alias])
    .find(Boolean);
  if (existing?.state === "deleting") {
    await deleteNativeCachedTrackAsset(profileKey, track);
  } else if (existing) {
    return;
  }

  const downloadTarget = await resolveNativeOfflineDownloadTarget(track);
  throwIfOfflineTransferAborted(signal);
  const dirPath = `offline-media/${profileKey}`;
  const filePath = `${dirPath}/${safeOfflineFileStem(assetKey)}.${
    downloadTarget.extension
  }`;

  await Filesystem.mkdir({
    path: dirPath,
    directory: Directory.Data,
    recursive: true,
  }).catch(() => {
    // mkdir may fail if the directory already exists
  });

  await Filesystem.downloadFile({
    url: apiUrl(downloadTarget.streamUrl),
    path: filePath,
    directory: Directory.Data,
    recursive: true,
    headers: getApiAuthHeaders(),
  });
  if (signal?.aborted) {
    await Filesystem.deleteFile({
      path: filePath,
      directory: Directory.Data,
    }).catch(() => undefined);
    throwIfOfflineTransferAborted(signal);
  }

  const { uri, size } = await assertNativeTrackIntegrity(
    filePath,
    downloadTarget.expectedBytes,
  );
  if (isIosNative) {
    try {
      await excludeNativeOfflineAssetFromBackup(filePath);
    } catch (error) {
      await Filesystem.deleteFile({
        path: filePath,
        directory: Directory.Data,
      }).catch(() => undefined);
      throw error;
    }
  }
  if (signal?.aborted) {
    await Filesystem.deleteFile({
      path: filePath,
      directory: Directory.Data,
    }).catch(() => undefined);
    throwIfOfflineTransferAborted(signal);
  }

  try {
    await updateOfflineNativeAssetIndex(profileKey, (current) => {
      throwIfOfflineTransferAborted(signal);
      return {
        ...current,
        [assetKey]: {
          assetKey,
          entityUid: track.entity_uid ?? null,
          storageId: track.storage_id,
          path: filePath,
          uri,
          playbackUrl: Capacitor.convertFileSrc(uri),
          state: "ready",
          byteLength: downloadTarget.expectedBytes || size,
          updatedAt: track.updated_at ?? null,
        },
      };
    });
  } catch (error) {
    if (signal?.aborted) {
      await Filesystem.deleteFile({
        path: filePath,
        directory: Directory.Data,
      }).catch(() => undefined);
    }
    throw error;
  }
}

export async function deleteNativeCachedTrackAsset(
  profileKey: string,
  track: OfflineTrackIdentityInput,
  storageId?: string | null,
): Promise<void> {
  if (!isNative) return;
  const aliases = getOfflineTrackAssetAliases(track, storageId);
  if (!aliases.length) return;
  let entry: OfflineNativeAssetRecord | undefined;
  await updateOfflineNativeAssetIndex(profileKey, (current) => {
    entry = aliases.map((alias) => current[alias]).find(Boolean);
    if (!entry) return current;
    const next = { ...current };
    for (const alias of aliases) {
      const candidate = current[alias];
      if (candidate?.path === entry.path) {
        next[alias] = { ...candidate, state: "deleting" };
      }
    }
    return next;
  });
  if (entry?.path) {
    try {
      await Filesystem.deleteFile({
        path: entry.path,
        directory: Directory.Data,
      });
    } catch (error) {
      if (!isMissingNativeFileError(error)) {
        recordDevLog(
          "offline",
          "failed to delete cached track asset",
          { path: entry.path, error: String(error) },
          "warn",
        );
        throw error;
      }
    }
  }
  if (!entry) return;
  await updateOfflineNativeAssetIndex(profileKey, (current) => {
    const next = { ...current };
    for (const alias of aliases) {
      const candidate = next[alias];
      if (candidate?.state === "deleting" && candidate.path === entry?.path) {
        delete next[alias];
      }
    }
    return next;
  });
}

export async function clearNativeOfflineAssets(
  profileKey: string,
): Promise<void> {
  if (!isNative) return;
  const failures: unknown[] = [];
  let markedAssets: Record<string, OfflineNativeAssetRecord> = {};
  await updateOfflineNativeAssetIndex(profileKey, (assets) => {
    markedAssets = Object.fromEntries(
      Object.entries(assets).map(([assetKey, asset]) => [
        assetKey,
        { ...asset, state: "deleting" as const },
      ]),
    );
    return markedAssets;
  });
  const deletedPaths = new Set<string>();
  await Promise.all(
    Object.values(markedAssets).map(async (asset) => {
      try {
        await Filesystem.deleteFile({
          path: asset.path,
          directory: Directory.Data,
        });
        deletedPaths.add(asset.path);
      } catch (error) {
        if (isMissingNativeFileError(error)) {
          deletedPaths.add(asset.path);
          return;
        }
        failures.push(error);
        recordDevLog(
          "offline",
          "failed to delete cached asset during clear-all",
          { path: asset.path, error: String(error) },
          "warn",
        );
      }
    }),
  );
  await updateOfflineNativeAssetIndex(profileKey, (assets) => {
    const remaining = { ...assets };
    for (const [assetKey, asset] of Object.entries(assets)) {
      if (asset.state === "deleting" && deletedPaths.has(asset.path)) {
        delete remaining[assetKey];
      }
    }
    return remaining;
  });
  if (failures.length) throw failures[0];
}

export function getNativeOfflinePlaybackUrl(
  track: OfflineTrackIdentityInput,
  storageId?: string | null,
  options: { target?: "webview" | "android-native" } = {},
): string | null {
  if (!isNative) return null;
  const profileKey = getActiveOfflineProfileKey();
  if (!profileKey) return null;
  const assets = loadOfflineNativeAssetIndex(profileKey);
  const entry = getOfflineTrackAssetAliases(track, storageId)
    .map((alias) => assets[alias])
    .find(Boolean);
  if (!entry || entry.state === "deleting") return null;
  return options.target === "android-native"
    ? entry.uri || null
    : entry.playbackUrl || null;
}

export function offlineTrackFromIdentity(
  track: OfflineTrackIdentityInput,
  storageId?: string | null,
): OfflineManifestTrack {
  return typeof track === "object" && track
    ? (track as OfflineManifestTrack)
    : {
        storage_id:
          typeof track === "string"
            ? normalizeIdentityValue(storageId) || normalizeIdentityValue(track)
            : normalizeIdentityValue(storageId),
        title: "",
        artist: "",
        stream_url: "",
        download_url: "",
      };
}
